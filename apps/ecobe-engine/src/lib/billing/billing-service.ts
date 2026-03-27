import { prisma } from '../prisma'
import { redis } from '../redis'
import Stripe from 'stripe'
import { env } from '../../config/env'
import { OrgPlanTier, Organization } from '@prisma/client'
import { z } from 'zod'

// Initialize Stripe
const stripe = new Stripe(env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia' as any,
})

// Pricing Configuration
export const PRICING = {
  FREE: {
    monthlyPrice: 0,
    annualPrice: 0,
    stripePriceId: null,
  },
  GROWTH: {
    monthlyPrice: 299,
    annualPrice: 2990, // ~17% discount
    stripePriceIdMonthly: env.STRIPE_GROWTH_MONTHLY_PRICE_ID,
    stripePriceIdAnnual: env.STRIPE_GROWTH_ANNUAL_PRICE_ID,
  },
  ENTERPRISE: {
    monthlyPrice: null, // Custom pricing
    annualPrice: null,
    stripePriceId: null,
  },
}

// Usage-based pricing
export const USAGE_PRICING = {
  carbonCommandOverage: 0.01, // per command over limit
  additionalRegion: 10, // per region per month
  dedicatedSupport: 500, // per month
  customModel: 100, // per model per month
}

export interface BillingMetrics {
  currentUsage: {
    commands: number
    regions: number
    customModels: number
  }
  limits: {
    commands: number
    regions: number
    customModels: number
  }
  overage: {
    commands: number
    amount: number
  }
  nextBillingDate: Date
  estimatedTotal: number
}

export interface Invoice {
  id: string
  orgId: string
  amount: number
  currency: string
  status: 'draft' | 'open' | 'paid' | 'void'
  lineItems: InvoiceLineItem[]
  dueDate: Date
  paidAt?: Date
  stripeInvoiceId?: string
}

export interface InvoiceLineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export class BillingService {
  /**
   * Create a Stripe customer for an organization
   */
  static async createStripeCustomer(org: Organization): Promise<string> {
    const customer = await stripe.customers.create({
      email: org.billingEmail || undefined,
      name: org.name,
      metadata: {
        orgId: org.id,
        planTier: org.planTier,
      },
    })

    // Store the Stripe customer ID
    await prisma.organization.update({
      where: { id: org.id },
      data: { 
        metadata: {
          ...(org.metadata as any || {}),
          stripeCustomerId: customer.id,
        },
      },
    })

    return customer.id
  }

  /**
   * Create a subscription for an organization
   */
  static async createSubscription(
    orgId: string,
    planTier: OrgPlanTier,
    billingPeriod: 'monthly' | 'annual' = 'monthly'
  ): Promise<Stripe.Subscription> {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    })

    if (!org) {
      throw new Error('Organization not found')
    }

    // Get or create Stripe customer
    let customerId = (org.metadata as any)?.stripeCustomerId
    if (!customerId) {
      customerId = await this.createStripeCustomer(org)
    }

    // Get the appropriate price ID
    let priceId: string | null = null
    if (planTier === OrgPlanTier.GROWTH) {
      priceId = billingPeriod === 'monthly'
        ? process.env.STRIPE_PRICE_MONTHLY || null
        : process.env.STRIPE_PRICE_YEARLY || null
    }

    if (!priceId) {
      throw new Error('Invalid plan tier or pricing not configured')
    }

    // Create the subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      metadata: {
        orgId: org.id,
        planTier,
      },
      trial_period_days: 14, // 14-day trial
    })

    // Update organization
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        planTier,
        metadata: {
          ...(org.metadata as any || {}),
          stripeSubscriptionId: subscription.id,
          billingPeriod,
        },
      },
    })

    return subscription
  }

  /**
   * Cancel a subscription
   */
  static async cancelSubscription(orgId: string): Promise<void> {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    })

    if (!org) {
      throw new Error('Organization not found')
    }

    const subscriptionId = (org.metadata as any)?.stripeSubscriptionId
    if (!subscriptionId) {
      throw new Error('No active subscription found')
    }

    // Cancel at period end
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    })

    // Update organization
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        metadata: {
          ...(org.metadata as any || {}),
          subscriptionCancelling: true,
        },
      },
    })
  }

  /**
   * Get billing metrics for an organization
   */
  static async getBillingMetrics(orgId: string): Promise<BillingMetrics> {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    })

    if (!org) {
      throw new Error('Organization not found')
    }

    // Get current month's usage
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const usage = await prisma.orgUsageCounter.findUnique({
      where: {
        orgId_periodStart: {
          orgId,
          periodStart: startOfMonth,
        },
      },
    })

    const commandCount = usage?.commandCount || 0
    const commandLimit = org.monthlyCommandLimit

    // Calculate overage
    const overage = Math.max(0, commandCount - commandLimit)
    const overageAmount = overage * USAGE_PRICING.carbonCommandOverage

    // Get custom models count
    const customModels = await prisma.carbonCommand.findMany({
      where: {
        orgId,
        createdAt: { gte: startOfMonth },
        modelFamily: { notIn: ['gpt-4', 'claude', 'llama', 'mixtral'] },
      },
      distinct: ['modelFamily'],
    })

    // Calculate next billing date
    const nextBillingDate = new Date(startOfMonth)
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1)

    // Calculate estimated total
    let basePrice = 0
    if (org.planTier === OrgPlanTier.GROWTH) {
      const billingPeriod = (org.metadata as any)?.billingPeriod || 'monthly'
      basePrice = billingPeriod === 'monthly' 
        ? PRICING.GROWTH.monthlyPrice 
        : PRICING.GROWTH.annualPrice / 12
    }

    const estimatedTotal = basePrice + overageAmount + 
      (customModels.length * USAGE_PRICING.customModel)

    return {
      currentUsage: {
        commands: commandCount,
        regions: 0, // TODO: Implement region tracking
        customModels: customModels.length,
      },
      limits: {
        commands: commandLimit,
        regions: org.planTier === OrgPlanTier.ENTERPRISE ? -1 : 
          (org.planTier === OrgPlanTier.GROWTH ? 10 : 3),
        customModels: org.planTier === OrgPlanTier.FREE ? 0 : -1,
      },
      overage: {
        commands: overage,
        amount: overageAmount,
      },
      nextBillingDate,
      estimatedTotal,
    }
  }

  /**
   * Generate an invoice for usage
   */
  static async generateInvoice(orgId: string): Promise<Invoice> {
    const metrics = await this.getBillingMetrics(orgId)
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    })

    if (!org) {
      throw new Error('Organization not found')
    }

    const lineItems: InvoiceLineItem[] = []

    // Base subscription
    if (org.planTier === OrgPlanTier.GROWTH) {
      const billingPeriod = (org.metadata as any)?.billingPeriod || 'monthly'
      const basePrice = billingPeriod === 'monthly' 
        ? PRICING.GROWTH.monthlyPrice 
        : PRICING.GROWTH.annualPrice / 12

      lineItems.push({
        description: `${org.planTier} Plan - ${billingPeriod}`,
        quantity: 1,
        unitPrice: basePrice,
        amount: basePrice,
      })
    }

    // Overage charges
    if (metrics.overage.commands > 0) {
      lineItems.push({
        description: `Additional Carbon Commands (${metrics.overage.commands} commands)`,
        quantity: metrics.overage.commands,
        unitPrice: USAGE_PRICING.carbonCommandOverage,
        amount: metrics.overage.amount,
      })
    }

    // Custom models
    if (metrics.currentUsage.customModels > 0) {
      lineItems.push({
        description: `Custom Model Usage (${metrics.currentUsage.customModels} models)`,
        quantity: metrics.currentUsage.customModels,
        unitPrice: USAGE_PRICING.customModel,
        amount: metrics.currentUsage.customModels * USAGE_PRICING.customModel,
      })
    }

    const totalAmount = lineItems.reduce((sum, item) => sum + item.amount, 0)

    const invoice: Invoice = {
      id: `inv_${Date.now()}`,
      orgId,
      amount: totalAmount,
      currency: 'USD',
      status: 'draft',
      lineItems,
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    }

    // Store invoice in database (you'd create an Invoice model)
    // await prisma.invoice.create({ data: invoice })

    return invoice
  }

  /**
   * Process a webhook from Stripe
   */
  static async processStripeWebhook(
    signature: string,
    rawBody: string
  ): Promise<void> {
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) {
      throw new Error('Stripe webhook secret not configured')
    }

    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
    } catch (err) {
      throw new Error('Invalid webhook signature')
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdate(event.data.object as Stripe.Subscription)
        break

      case 'customer.subscription.deleted':
        await this.handleSubscriptionCancellation(event.data.object as Stripe.Subscription)
        break

      case 'invoice.payment_succeeded':
        await this.handlePaymentSuccess(event.data.object as Stripe.Invoice)
        break

      case 'invoice.payment_failed':
        await this.handlePaymentFailure(event.data.object as Stripe.Invoice)
        break
    }
  }

  /**
   * Handle subscription updates
   */
  private static async handleSubscriptionUpdate(
    subscription: Stripe.Subscription
  ): Promise<void> {
    const orgId = subscription.metadata.orgId
    if (!orgId) return

    const planTier = subscription.metadata.planTier as OrgPlanTier

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        planTier,
        metadata: {
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          currentPeriodEnd: (subscription as any).current_period_end || null,
        },
      },
    })
  }

  /**
   * Handle subscription cancellation
   */
  private static async handleSubscriptionCancellation(
    subscription: Stripe.Subscription
  ): Promise<void> {
    const orgId = subscription.metadata.orgId
    if (!orgId) return

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        planTier: OrgPlanTier.FREE,
        monthlyCommandLimit: 1000,
      },
    })
  }

  /**
   * Handle payment success
   */
  private static async handlePaymentSuccess(
    invoice: Stripe.Invoice
  ): Promise<void> {
    // Update organization billing status
    const customerId = invoice.customer as string
    const customer = await stripe.customers.retrieve(customerId)
    
    if ('metadata' in customer && customer.metadata.orgId) {
      await prisma.organization.update({
        where: { id: customer.metadata.orgId },
        data: {
          metadata: {
            lastPaymentDate: new Date().toISOString(),
            paymentStatus: 'current',
          },
        },
      })
    }
  }

  /**
   * Handle payment failure
   */
  private static async handlePaymentFailure(
    invoice: Stripe.Invoice
  ): Promise<void> {
    const customerId = invoice.customer as string
    const customer = await stripe.customers.retrieve(customerId)
    
    if ('metadata' in customer && customer.metadata.orgId) {
      await prisma.organization.update({
        where: { id: customer.metadata.orgId },
        data: {
          metadata: {
            paymentStatus: 'failed',
            lastPaymentFailure: new Date().toISOString(),
          },
        },
      })

      // TODO: Send payment failure notification
    }
  }
}
