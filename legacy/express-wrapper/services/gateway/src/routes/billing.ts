import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export async function billingRoutes(app: any) {
  app.post('/billing/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const sig = request.headers['stripe-signature'] as string;
    if (!sig) return reply.code(400).send({ error: 'Missing signature' });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        request.rawBody as Buffer,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err: any) {
      return reply.code(400).send({ error: `Webhook signature verification failed: ${err.message}` });
    }

    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      const orgId = invoice.metadata?.orgId;
      if (!orgId) return reply.code(400).send({ error: 'Missing orgId in metadata' });

      await prisma.billingAccount.upsert({
        where: { orgId },
        update: { status: 'active', billingEmail: invoice.customer_email || 'billing@example.com' },
        create: {
          orgId,
          status: 'active',
          billingEmail: invoice.customer_email || 'billing@example.com',
          paymentMethodJson: null as any,
        },
      });
    }

    return reply.send({ received: true });
  });
}
