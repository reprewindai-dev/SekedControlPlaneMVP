import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto'

import { env } from './env'
import { prisma } from './prisma'

type OutboundRunEvent = {
  id: string
  runId: string
  organizationId: string
  eventType: string
  payload: unknown
  signature: string
  createdAt: Date
}

type DeliveryRecordInput = {
  organizationId: string
  webhookEndpointId: string
  providerEventId: string
  eventType: string
  status: string
  responseCode?: number | null
  requestBody: unknown
  responseBody: unknown
}

const WEBHOOK_TIMEOUT_MS = 5000

export function encryptWebhookSecret(secret: string) {
  const iv = randomBytes(12)
  const key = getWebhookEncryptionKey()
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

export function decryptWebhookSecret(encryptedSecret: string) {
  const [ivEncoded, authTagEncoded, ciphertextEncoded] = encryptedSecret.split('.')
  if (!ivEncoded || !authTagEncoded || !ciphertextEncoded) {
    throw new Error('Invalid encrypted webhook secret payload')
  }

  const key = getWebhookEncryptionKey()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagEncoded, 'base64'))

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64')),
    decipher.final(),
  ])

  return plaintext.toString('utf8')
}

export async function dispatchRunEventWebhooks(event: OutboundRunEvent) {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      organizationId: event.organizationId,
    },
    select: {
      id: true,
      organizationId: true,
      url: true,
      encryptedSecret: true,
    },
  })

  if (!endpoints.length) {
    return
  }

  const body = {
    id: event.id,
    type: event.eventType,
    organizationId: event.organizationId,
    runId: event.runId,
    createdAt: event.createdAt.toISOString(),
    payload: event.payload,
    auditSignature: event.signature,
  }

  await Promise.allSettled(
    endpoints.map(async (endpoint) => {
      if (!endpoint.encryptedSecret) {
        await recordWebhookDelivery({
          organizationId: endpoint.organizationId,
          webhookEndpointId: endpoint.id,
          providerEventId: event.id,
          eventType: event.eventType,
          status: 'failed',
          responseCode: null,
          requestBody: body,
          responseBody: { error: 'Webhook secret is not available for delivery' },
        })
        return
      }

      const secret = decryptWebhookSecret(endpoint.encryptedSecret)
      const timestamp = new Date().toISOString()
      const serializedBody = JSON.stringify(body)
      const signature = createHmac('sha256', secret)
        .update(`${timestamp}.${serializedBody}`)
        .digest('hex')

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ecobe-event-id': event.id,
            'x-ecobe-event-type': event.eventType,
            'x-ecobe-organization-id': event.organizationId,
            'x-ecobe-timestamp': timestamp,
            'x-ecobe-signature': signature,
          },
          body: serializedBody,
          signal: controller.signal,
        })

        const responseText = await response.text()

        await recordWebhookDelivery({
          organizationId: endpoint.organizationId,
          webhookEndpointId: endpoint.id,
          providerEventId: event.id,
          eventType: event.eventType,
          status: response.ok ? 'processed' : 'failed',
          responseCode: response.status,
          requestBody: body,
          responseBody: normalizeResponseBody(responseText),
        })
      } catch (error) {
        await recordWebhookDelivery({
          organizationId: endpoint.organizationId,
          webhookEndpointId: endpoint.id,
          providerEventId: event.id,
          eventType: event.eventType,
          status: 'failed',
          responseCode: null,
          requestBody: body,
          responseBody: {
            error: error instanceof Error ? error.message : String(error),
          },
        })
      } finally {
        clearTimeout(timeout)
      }
    })
  )
}

async function recordWebhookDelivery(input: DeliveryRecordInput) {
  await prisma.webhookDelivery.create({
    data: {
      organizationId: input.organizationId,
      webhookEndpointId: input.webhookEndpointId,
      provider: 'customer_webhook',
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      status: input.status,
      responseCode: input.responseCode ?? undefined,
      requestBody: input.requestBody as any,
      responseBody: input.responseBody as any,
      processedAt: new Date(),
    },
  })
}

function getWebhookEncryptionKey() {
  const source =
    env.WEBHOOK_SECRET_ENCRYPTION_KEY ||
    (env.NODE_ENV === 'production' ? env.AUDIT_SIGNING_SECRET : env.WEBHOOK_SECRET_ENCRYPTION_KEY || env.AUDIT_SIGNING_SECRET)

  const digest = createHash('sha256').update(source).digest()
  return digest.subarray(0, 32)
}

function normalizeResponseBody(body: string) {
  if (!body) {
    return { body: '' }
  }

  const truncated = body.length > 2000 ? `${body.slice(0, 2000)}...` : body

  try {
    return JSON.parse(truncated)
  } catch {
    return { body: truncated }
  }
}
