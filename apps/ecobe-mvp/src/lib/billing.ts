import { createHmac, timingSafeEqual } from 'crypto'

import Stripe from 'stripe'

import { prisma } from './prisma'
import { env } from './env'

type StripeEvent = {
  id: string
  type: string
  created?: number
  data?: {
    object?: Record<string, any>
  }
}

export type PlanTier = 'tier_1' | 'tier_2' | 'tier_3'

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-02-25.clover',
    })
  : null

export async function processStripeWebhook(rawBody: string, signatureHeader: string | null) {
  const event = parseStripeEvent(rawBody, signatureHeader)
  const object = event.data?.object ?? {}
  const organizationId = await resolveOrganizationId(event.type, object)

  if (!organizationId) {
    throw new Error(`Unable to resolve organization for Stripe event ${event.id}`)
  }

  try {
    await handleStripeEvent(event, organizationId)
    await recordWebhookDelivery({
      organizationId,
      providerEventId: event.id,
      eventType: event.type,
      status: 'processed',
      responseCode: 200,
      requestBody: event,
      responseBody: { received: true },
    })
  } catch (error) {
    await recordWebhookDelivery({
      organizationId,
      providerEventId: event.id,
      eventType: event.type,
      status: 'failed',
      responseCode: 500,
      requestBody: event,
      responseBody: { error: error instanceof Error ? error.message : String(error) },
    })
    throw error
  }

  return event
}

export async function createStripeCheckoutSession(input: {
  organizationId: string
  organizationSlug: string
  organizationName: string
  planTier: PlanTier
  successUrl?: string | null
  cancelUrl?: string | null
}) {
  const client = requireStripe()
  const billingAccount = await ensureStripeCustomer({
    organizationId: input.organizationId,
    organizationSlug: input.organizationSlug,
    organizationName: input.organizationName,
  })

  const priceId = priceIdForPlanTier(input.planTier)
  if (!priceId) {
    throw new Error(`Missing Stripe price id for ${input.planTier}`)
  }

  const session = await client.checkout.sessions.create({
    mode: 'subscription',
    customer: billingAccount.stripeCustomerId ?? undefined,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: resolveCheckoutUrl(input.successUrl, env.STRIPE_CHECKOUT_SUCCESS_URL, '/billing/success'),
    cancel_url: resolveCheckoutUrl(input.cancelUrl, env.STRIPE_CHECKOUT_CANCEL_URL, '/billing/cancel'),
    allow_promotion_codes: true,
    metadata: {
      organizationId: input.organizationId,
      organizationSlug: input.organizationSlug,
      planTier: input.planTier,
    },
    subscription_data: {
      metadata: {
        organizationId: input.organizationId,
        organizationSlug: input.organizationSlug,
        planTier: input.planTier,
      },
    },
  })

  return {
    sessionId: session.id,
    url: session.url,
    customerId: billingAccount.stripeCustomerId,
    planTier: input.planTier,
  }
}

export async function createStripePortalSession(input: {
  organizationId: string
  organizationSlug: string
  organizationName: string
  returnUrl?: string | null
}) {
  const client = requireStripe()
  const billingAccount = await ensureStripeCustomer({
    organizationId: input.organizationId,
    organizationSlug: input.organizationSlug,
    organizationName: input.organizationName,
  })

  if (!billingAccount.stripeCustomerId) {
    throw new Error('Stripe customer is not configured')
  }

  const session = await client.billingPortal.sessions.create({
    customer: billingAccount.stripeCustomerId,
    return_url: resolveCheckoutUrl(input.returnUrl, env.STRIPE_PORTAL_RETURN_URL, '/settings/billing'),
  })

  return {
    url: session.url,
    customerId: billingAccount.stripeCustomerId,
  }
}

export async function getBillingSnapshot(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      slug: true,
      name: true,
      planTier: true,
      billingAccount: {
        include: {
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
          invoices: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
        },
      },
    },
  })

  if (!organization) {
    throw new Error('Organization not found')
  }

  const currentSubscription = organization.billingAccount?.subscriptions[0] ?? null

  return {
    organization: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      planTier: organization.planTier,
    },
    billing: organization.billingAccount
      ? {
          status: organization.billingAccount.status,
          stripeCustomerId: organization.billingAccount.stripeCustomerId,
          currentSubscription,
          recentInvoices: organization.billingAccount.invoices,
          portalEnabled: Boolean(stripe && organization.billingAccount.stripeCustomerId),
        }
      : {
          status: 'active',
          stripeCustomerId: null,
          currentSubscription: null,
          recentInvoices: [],
          portalEnabled: Boolean(stripe),
        },
  }
}

export async function assertRunEntitlements(organizationId: string, payload: Record<string, any>) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      billingAccount: {
        include: {
          subscriptions: {
            where: {
              status: {
                in: ['active', 'past_due'],
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  })

  if (!organization) {
    throw new Error('Organization not found')
  }

  if (organization.billingAccount?.status === 'canceled') {
    throw new Error('Billing account is canceled')
  }

  const planTier = normalizePlanTier(organization.billingAccount?.subscriptions[0]?.planTier ?? organization.planTier)
  const providers = Array.isArray(payload.providerConstraints?.providers) ? payload.providerConstraints.providers : []
  const preferredRegions = Array.isArray(payload.providerConstraints?.preferredRegions)
    ? payload.providerConstraints.preferredRegions
    : []
  const hasCarbonPolicy = Boolean(
    payload.carbonPolicy && typeof payload.carbonPolicy === 'object' && Object.keys(payload.carbonPolicy).length
  )

  if (planTier === 'tier_1' && (providers.length > 1 || preferredRegions.length > 1 || hasCarbonPolicy)) {
    throw new Error('Advanced routing requires tier_3')
  }

  if (planTier === 'tier_2' && hasCarbonPolicy) {
    throw new Error('Carbon policy routing requires tier_3')
  }

  return {
    planTier,
    billingStatus: organization.billingAccount?.status ?? 'active',
  }
}

export async function previewUsageInvoice(input: {
  organizationId: string
  periodStart?: Date | null
  periodEnd?: Date | null
}) {
  const billingAccount = await prisma.billingAccount.findUnique({
    where: { organizationId: input.organizationId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          planTier: true,
        },
      },
    },
  })

  if (!billingAccount) {
    throw new Error('Billing account not found')
  }

  const usageRecords = await prisma.usageRecord.findMany({
    where: {
      organizationId: input.organizationId,
      recordedAt: {
        gte: input.periodStart ?? undefined,
        lte: input.periodEnd ?? undefined,
      },
    },
    orderBy: { recordedAt: 'asc' },
  })

  const lineItemsMap = new Map<string, {
    description: string
    quantity: number
    amount: number
    unit: string
    metric: string
  }>()

  for (const record of usageRecords) {
    const key = `${record.metric}:${record.unit}`
    const existing = lineItemsMap.get(key)

    if (existing) {
      existing.quantity += record.quantity
      existing.amount += record.amountUsd
      continue
    }

    lineItemsMap.set(key, {
      description: `${record.metric} (${record.unit})`,
      quantity: record.quantity,
      amount: record.amountUsd,
      unit: record.unit,
      metric: record.metric,
    })
  }

  const lineItems = Array.from(lineItemsMap.values()).map((item) => ({
    description: item.description,
    quantity: Number(item.quantity.toFixed(4)),
    unitAmount: item.quantity > 0 ? Number((item.amount / item.quantity).toFixed(4)) : 0,
    amount: Number(item.amount.toFixed(2)),
    currency: 'USD',
    metadata: {
      metric: item.metric,
      unit: item.unit,
    },
  }))

  const amountDue = Number(lineItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2))

  return {
    organization: billingAccount.organization,
    billingAccountId: billingAccount.id,
    stripeCustomerId: billingAccount.stripeCustomerId,
    periodStart: input.periodStart ?? (usageRecords[0]?.recordedAt ?? null),
    periodEnd: input.periodEnd ?? (usageRecords[usageRecords.length - 1]?.recordedAt ?? null),
    usageRecordCount: usageRecords.length,
    amountDue,
    currency: 'USD',
    lineItems,
  }
}

export async function generateInternalInvoice(input: {
  organizationId: string
  periodStart?: Date | null
  periodEnd?: Date | null
}) {
  const preview = await previewUsageInvoice(input)
  const billingAccountId = preview.billingAccountId
  const periodStart = preview.periodStart
  const periodEnd = preview.periodEnd

  const existingInvoice =
    periodStart && periodEnd
      ? await prisma.invoice.findFirst({
          where: {
            billingAccountId,
            externalInvoiceId: null,
            periodStart,
            periodEnd,
          },
          include: {
            lineItems: true,
          },
        })
      : null

  if (existingInvoice) {
    return existingInvoice
  }

  const invoice = await prisma.invoice.create({
    data: {
      billingAccountId,
      amountDue: preview.amountDue,
      amountPaid: 0,
      currency: preview.currency,
      status: 'active',
      periodStart: periodStart ?? undefined,
      periodEnd: periodEnd ?? undefined,
      lineItems: {
        create: preview.lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitAmount: item.unitAmount,
          amount: item.amount,
          currency: item.currency,
          metadata: item.metadata,
        })),
      },
    },
    include: {
      lineItems: true,
    },
  })

  return invoice
}

function parseStripeEvent(rawBody: string, signatureHeader: string | null): StripeEvent {
  if (env.STRIPE_WEBHOOK_SECRET) {
    verifyStripeSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET)
  }

  return JSON.parse(rawBody) as StripeEvent
}

function verifyStripeSignature(payload: string, signatureHeader: string | null, secret: string) {
  if (!signatureHeader) {
    throw new Error('Missing Stripe-Signature header')
  }

  const parsed = Object.fromEntries(
    signatureHeader.split(',').map((entry) => {
      const [key, value] = entry.split('=')
      return [key, value]
    })
  )

  const timestamp = parsed.t
  const signature = parsed.v1

  if (!timestamp || !signature) {
    throw new Error('Invalid Stripe-Signature header')
  }

  const signedPayload = `${timestamp}.${payload}`
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex')
  const provided = Buffer.from(signature)
  const computed = Buffer.from(expected)

  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    throw new Error('Stripe signature verification failed')
  }
}

async function resolveOrganizationId(eventType: string, object: Record<string, any>) {
  const metadataOrganizationId = object.metadata?.organizationId
  if (metadataOrganizationId) {
    return metadataOrganizationId
  }

  const customerId = extractCustomerId(object)
  if (!customerId) {
    return null
  }

  const billingAccount = await prisma.billingAccount.findFirst({
    where: {
      stripeCustomerId: customerId,
    },
    select: {
      organizationId: true,
    },
  })

  if (billingAccount) {
    return billingAccount.organizationId
  }

  if (eventType.startsWith('customer.') && object.metadata?.organizationSlug) {
    const organization = await prisma.organization.findUnique({
      where: { slug: object.metadata.organizationSlug },
      select: { id: true },
    })
    return organization?.id ?? null
  }

  return null
}

async function handleStripeEvent(event: StripeEvent, organizationId: string) {
  const object = event.data?.object ?? {}

  switch (event.type) {
    case 'customer.created':
    case 'customer.updated':
      await upsertBillingAccount({
        organizationId,
        stripeCustomerId: object.id,
        status: 'active',
      })
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(organizationId, object)
      break
    case 'invoice.created':
    case 'invoice.finalized':
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.voided':
      await syncInvoice(organizationId, object)
      break
    default:
      break
  }
}

async function ensureStripeCustomer(input: {
  organizationId: string
  organizationSlug: string
  organizationName: string
}) {
  const client = requireStripe()
  const existing = await prisma.billingAccount.findUnique({
    where: { organizationId: input.organizationId },
  })

  if (existing?.stripeCustomerId) {
    await client.customers.update(existing.stripeCustomerId, {
      name: input.organizationName,
      metadata: {
        organizationId: input.organizationId,
        organizationSlug: input.organizationSlug,
      },
    })

    return existing
  }

  const customer = await client.customers.create({
    name: input.organizationName,
    metadata: {
      organizationId: input.organizationId,
      organizationSlug: input.organizationSlug,
    },
  })

  return upsertBillingAccount({
    organizationId: input.organizationId,
    stripeCustomerId: customer.id,
    status: 'active',
  })
}

async function upsertBillingAccount(input: {
  organizationId: string
  stripeCustomerId?: string | null
  status: 'active' | 'past_due' | 'canceled'
}) {
  return prisma.billingAccount.upsert({
    where: { organizationId: input.organizationId },
    update: {
      stripeCustomerId: input.stripeCustomerId ?? undefined,
      status: input.status,
    },
    create: {
      organizationId: input.organizationId,
      stripeCustomerId: input.stripeCustomerId ?? undefined,
      status: input.status,
    },
  })
}

async function syncSubscription(organizationId: string, object: Record<string, any>) {
  const billingAccount = await upsertBillingAccount({
    organizationId,
    stripeCustomerId: extractCustomerId(object),
    status: mapStripeStatus(object.status),
  })

  const subscriptionId = object.id
  if (!subscriptionId) {
    throw new Error('Stripe subscription event missing subscription id')
  }

  const planTier = extractPlanTier(object)

  await prisma.subscription.upsert({
    where: {
      externalSubscriptionId: subscriptionId,
    },
    update: {
      planTier,
      status: mapStripeStatus(object.status),
      currentPeriodStart: toDate(object.current_period_start),
      currentPeriodEnd: toDate(object.current_period_end),
      cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
    },
    create: {
      billingAccountId: billingAccount.id,
      externalSubscriptionId: subscriptionId,
      planTier,
      status: mapStripeStatus(object.status),
      currentPeriodStart: toDate(object.current_period_start),
      currentPeriodEnd: toDate(object.current_period_end),
      cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
    },
  })

  if (mapStripeStatus(object.status) === 'active') {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { planTier },
    })
  }
}

async function syncInvoice(organizationId: string, object: Record<string, any>) {
  const billingAccount = await upsertBillingAccount({
    organizationId,
    stripeCustomerId: extractCustomerId(object),
    status: mapInvoiceStatus(object.status),
  })

  const invoiceId = object.id
  if (!invoiceId) {
    throw new Error('Stripe invoice event missing invoice id')
  }

  const invoice = await prisma.invoice.upsert({
    where: {
      externalInvoiceId: invoiceId,
    },
    update: {
      amountDue: centsToDollars(object.amount_due),
      amountPaid: centsToDollars(object.amount_paid),
      currency: normalizeCurrency(object.currency),
      status: mapInvoiceStatus(object.status),
      hostedInvoiceUrl: object.hosted_invoice_url ?? null,
      periodStart: toDate(object.period_start),
      periodEnd: toDate(object.period_end),
    },
    create: {
      billingAccountId: billingAccount.id,
      externalInvoiceId: invoiceId,
      amountDue: centsToDollars(object.amount_due),
      amountPaid: centsToDollars(object.amount_paid),
      currency: normalizeCurrency(object.currency),
      status: mapInvoiceStatus(object.status),
      hostedInvoiceUrl: object.hosted_invoice_url ?? null,
      periodStart: toDate(object.period_start),
      periodEnd: toDate(object.period_end),
    },
  })

  await prisma.invoiceLineItem.deleteMany({
    where: { invoiceId: invoice.id },
  })

  const lineItems = Array.isArray(object.lines?.data) ? object.lines.data : []
  if (!lineItems.length) {
    return
  }

  await prisma.invoiceLineItem.createMany({
    data: lineItems.map((item: Record<string, any>) => ({
      invoiceId: invoice.id,
      description: item.description ?? 'Stripe invoice line item',
      quantity: Number(item.quantity ?? 1),
      unitAmount: centsToDollars(item.price?.unit_amount ?? item.amount ?? 0),
      amount: centsToDollars(item.amount ?? 0),
      currency: normalizeCurrency(item.currency ?? object.currency),
      metadata: item.metadata ?? {},
    })),
  })
}

async function recordWebhookDelivery(input: {
  organizationId: string
  providerEventId: string
  eventType: string
  status: string
  responseCode: number
  requestBody: unknown
  responseBody: unknown
}) {
  await prisma.webhookDelivery.create({
    data: {
      organizationId: input.organizationId,
      provider: 'stripe',
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      status: input.status,
      responseCode: input.responseCode,
      requestBody: input.requestBody as any,
      responseBody: input.responseBody as any,
      processedAt: new Date(),
    },
  })
}

function requireStripe() {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  return stripe
}

function extractCustomerId(object: Record<string, any>) {
  if (typeof object.customer === 'string') {
    return object.customer
  }

  if (typeof object.id === 'string' && String(object.object) === 'customer') {
    return object.id
  }

  return null
}

function extractPlanTier(object: Record<string, any>): PlanTier {
  const rawTier =
    object.metadata?.planTier ??
    object.items?.data?.[0]?.price?.lookup_key ??
    object.items?.data?.[0]?.price?.nickname ??
    'tier_2'

  return normalizePlanTier(rawTier)
}

function normalizePlanTier(value: string): PlanTier {
  if (value === 'tier_1') return 'tier_1'
  if (value === 'tier_3') return 'tier_3'
  return 'tier_2'
}

function mapStripeStatus(status?: string): 'active' | 'past_due' | 'canceled' {
  if (!status) {
    return 'active'
  }

  if (['canceled', 'unpaid', 'incomplete_expired'].includes(status)) {
    return 'canceled'
  }

  if (['past_due', 'incomplete'].includes(status)) {
    return 'past_due'
  }

  return 'active'
}

function mapInvoiceStatus(status?: string): 'active' | 'past_due' | 'canceled' {
  if (!status) {
    return 'active'
  }

  if (['void', 'voided', 'uncollectible'].includes(status)) {
    return 'canceled'
  }

  if (['open', 'draft'].includes(status)) {
    return 'past_due'
  }

  return 'active'
}

function priceIdForPlanTier(planTier: PlanTier) {
  if (planTier === 'tier_1') return env.STRIPE_TIER_1_PRICE_ID
  if (planTier === 'tier_3') return env.STRIPE_TIER_3_PRICE_ID
  return env.STRIPE_TIER_2_PRICE_ID
}

function resolveCheckoutUrl(explicit: string | null | undefined, configured: string, fallbackPath: string) {
  if (explicit) {
    return explicit
  }

  if (configured) {
    return configured
  }

  if (env.NEXT_PUBLIC_APP_URL) {
    return `${env.NEXT_PUBLIC_APP_URL}${fallbackPath}`
  }

  throw new Error(`Missing billing return URL for ${fallbackPath}`)
}

function toDate(value?: number | string | null) {
  if (value === null || value === undefined) {
    return null
  }

  const numeric = Number(value)
  if (Number.isNaN(numeric)) {
    return null
  }

  return new Date(numeric * 1000)
}

function centsToDollars(value?: number | null) {
  return Number(((value ?? 0) / 100).toFixed(2))
}

function normalizeCurrency(value?: string | null) {
  return (value ?? 'usd').toUpperCase()
}
