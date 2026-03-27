/**
 * DEKES Webhook Dispatcher
 *
 * Sends status updates and events to the DEKES SaaS webhook endpoints.
 * Used to notify DEKES when:
 * - Handoff status changes (ACCEPTED, CONVERTED, FAILED)
 * - Budget warnings/exceeded
 * - Policy delays
 */

import { env } from '../config/env'
import { prisma } from './db'

interface DekesWebhookPayload {
  handoffId?: string
  eventType: string
  severity: 'CRITICAL' | 'WARNING' | 'INFO'
  data: Record<string, unknown>
}

/**
 * Send a webhook event to the configured DEKES SaaS instance.
 * Fire-and-forget — failures are logged but don't block the caller.
 */
export async function dispatchDekesWebhook(payload: DekesWebhookPayload): Promise<boolean> {
  const webhookUrl = env.DEKES_WEBHOOK_URL
  const webhookSecret = env.DEKES_WEBHOOK_SECRET

  if (!webhookUrl) {
    // No webhook configured — skip silently
    return false
  }

  try {
    const body = JSON.stringify({
      ...payload,
      timestamp: new Date().toISOString(),
      source: 'ECOBE_ENGINE',
      secret: webhookSecret ?? undefined,
    })

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(webhookSecret ? { Authorization: `Bearer ${webhookSecret}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(10000), // 10s timeout
    })

    const success = response.ok

    // Record integration event
    await prisma.integrationEvent.create({
      data: {
        source: 'DEKES_INTEGRATION',
        eventType: `WEBHOOK_DISPATCH_${payload.eventType}`,
        message: JSON.stringify({
          url: webhookUrl,
          status: response.status,
          eventType: payload.eventType,
          handoffId: payload.handoffId,
        }),
        success,
        errorCode: success ? null : String(response.status),
      },
    }).catch(() => {})

    if (!success) {
      console.warn(`DEKES webhook dispatch failed (${response.status}):`, payload.eventType)
    }

    return success
  } catch (error: any) {
    console.error('DEKES webhook dispatch error:', error.message)

    // Record failure
    await prisma.integrationEvent.create({
      data: {
        source: 'DEKES_INTEGRATION',
        eventType: `WEBHOOK_DISPATCH_${payload.eventType}`,
        message: JSON.stringify({
          url: webhookUrl,
          error: error.message,
          eventType: payload.eventType,
        }),
        success: false,
        errorCode: 'NETWORK_ERROR',
      },
    }).catch(() => {})

    return false
  }
}

/**
 * Notify DEKES that a handoff status has changed.
 */
export async function notifyDekesHandoffStatus(
  handoffId: string,
  status: 'ACCEPTED' | 'CONVERTED' | 'FAILED',
  notes?: string
): Promise<boolean> {
  return dispatchDekesWebhook({
    handoffId,
    eventType: 'HANDOFF_STATUS_UPDATE',
    severity: status === 'FAILED' ? 'WARNING' : 'INFO',
    data: { status, notes },
  })
}

/**
 * Notify DEKES about a budget warning or exceeded event.
 */
export async function notifyDekesBudgetEvent(
  eventType: 'BUDGET_WARNING' | 'BUDGET_EXCEEDED',
  budgetUsed: number,
  budgetLimit: number,
  currency: string = 'USD'
): Promise<boolean> {
  return dispatchDekesWebhook({
    eventType,
    severity: eventType === 'BUDGET_EXCEEDED' ? 'CRITICAL' : 'WARNING',
    data: { budgetUsed, budgetLimit, currency },
  })
}

/**
 * Notify DEKES about a policy delay.
 */
export async function notifyDekesPolicyDelay(
  region: string,
  delayMinutes: number,
  cleanWindowRegion?: string
): Promise<boolean> {
  return dispatchDekesWebhook({
    eventType: 'POLICY_DELAY',
    severity: delayMinutes > 60 ? 'WARNING' : 'INFO',
    data: { region, delayMinutes, cleanWindowRegion },
  })
}
