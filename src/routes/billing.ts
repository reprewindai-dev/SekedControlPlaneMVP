import { Request, Response } from 'express';
import Stripe from 'stripe';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';

const stripe = new Stripe(env.stripeSecretKey, { apiVersion: '2022-11-15' });

export async function billingWebhookHandler(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing signature');

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, env.stripeWebhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed', err);
    return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
  }

  try {
    const payload = event.data.object as Stripe.Checkout.Session | Stripe.Invoice | Stripe.PaymentIntent;
    const amount =
      (payload as any).amount_total ??
      (payload as any).amount_paid ??
      (payload as any).amount ??
      0;
    const currency = (payload as any).currency ?? 'usd';
    const orgId = (payload as any).metadata?.orgId ?? (payload as any).metadata?.org_id;

    if (!orgId) {
      return res.status(400).json({ error: 'Missing orgId in metadata' });
    }

    const billingEmail =
      (payload as any).customer_details?.email ??
      (payload as any).customer_email ??
      (payload as any).receipt_email ??
      (payload as any).metadata?.billingEmail ??
      null;

    if (!billingEmail) {
      return res.status(400).json({ error: 'Missing billing email in Stripe payload' });
    }

    const paymentMethodJson = {
      eventType: event.type,
      currency,
      amount,
      customerId: (payload as any).customer ?? null,
      paymentIntentId: (payload as any).payment_intent ?? null,
      invoiceId: (payload as any).invoice ?? null,
    };

    const existing = await prisma.billingAccount.findFirst({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await prisma.billingAccount.update({
        where: { id: existing.id },
        data: {
          status: 'active',
          billingEmail,
          paymentMethodJson: paymentMethodJson as any,
          customerRef: (payload as any).customer ? String((payload as any).customer) : existing.customerRef,
          subscriptionRef: (payload as any).subscription ? String((payload as any).subscription) : existing.subscriptionRef,
        },
      });
    } else {
      await prisma.billingAccount.create({
        data: {
          orgId,
          status: 'active',
          billingEmail,
          paymentMethodJson: paymentMethodJson as any,
          customerRef: (payload as any).customer ? String((payload as any).customer) : null,
          subscriptionRef: (payload as any).subscription ? String((payload as any).subscription) : null,
        },
      });
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('Billing webhook handling failed', err);
    return res.status(500).json({ error: 'Webhook handling failed' });
  }
}
