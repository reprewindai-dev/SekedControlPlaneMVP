import { badRequest, json } from '@/lib/http'
import { processStripeWebhook } from '@/lib/billing'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rawBody = await request.text()

  if (!rawBody) {
    return badRequest('Empty billing webhook payload')
  }

  try {
    const event = await processStripeWebhook(
      rawBody,
      request.headers.get('stripe-signature')
    )

    return json({
      received: true,
      provider: 'stripe',
      eventId: event.id,
      eventType: event.type,
    })
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'Invalid billing webhook',
    }, { status: 400 })
  }
}
