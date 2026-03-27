import crypto from 'crypto'

import type { Prisma } from '@prisma/client'
import { z } from 'zod'

import { env } from '../../config/env'
import { prisma } from '../db'
import { sha256Canonical } from '../proof/export-chain'
import {
  CanonicalDecisionEnvelopeSchema,
  CanonicalProofEnvelopeSchema,
  CanonicalTransportMetadataSchema,
} from './canonical'

export const DecisionEvaluatedV1Schema = z.object({
  version: z.literal('DecisionEvaluatedV1'),
  decisionId: z.string(),
  decisionFrameId: z.string(),
  action: z.enum(['run_now', 'reroute', 'delay', 'throttle', 'deny']),
  reasonCode: z.string(),
  baseline: z.object({
    region: z.string(),
    carbonIntensity: z.number(),
    waterImpactLiters: z.number(),
    waterScarcityImpact: z.number(),
  }),
  selected: z.object({
    region: z.string(),
    carbonIntensity: z.number(),
    waterImpactLiters: z.number(),
    waterScarcityImpact: z.number(),
  }),
  policyTrace: z.record(z.any()),
  provenance: z.object({
    signalsUsed: z.array(z.string()),
    datasetVersions: z.record(z.string()),
    sourceProvenance: z.array(z.record(z.any())),
  }),
  canonicalDecision: CanonicalDecisionEnvelopeSchema.optional(),
  proof: CanonicalProofEnvelopeSchema.optional(),
  adapter: CanonicalTransportMetadataSchema.optional(),
  confidence: z.number().min(0).max(1),
  timestamp: z.string(),
  signature: z.string(),
})

export type DecisionEvaluatedV1 = z.infer<typeof DecisionEvaluatedV1Schema>

function signingKey() {
  return env.DECISION_EVENT_SIGNATURE_SECRET || env.ECOBE_INTERNAL_API_KEY || 'ecobe-dev-signing-key'
}

function toCanonicalJson(payload: unknown) {
  if (typeof payload === 'string') {
    return payload
  }
  return JSON.stringify(payload)
}

function signCanonical(payload: unknown, secret: string) {
  const canonical = toCanonicalJson(payload)
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex')
}

function computeNextAttempt(attemptCount: number) {
  const base = Math.max(250, env.DECISION_EVENT_RETRY_BASE_MS)
  const delayMs = Math.min(15 * 60 * 1000, base * Math.pow(2, Math.max(0, attemptCount)))
  return new Date(Date.now() + delayMs)
}

export function buildDecisionEvaluatedEvent(input: {
  decisionId: string
  decisionFrameId: string
  action: 'run_now' | 'reroute' | 'delay' | 'throttle' | 'deny'
  reasonCode: string
  baseline: {
    region: string
    carbonIntensity: number
    waterImpactLiters: number
    waterScarcityImpact: number
  }
  selected: {
    region: string
    carbonIntensity: number
    waterImpactLiters: number
    waterScarcityImpact: number
  }
  policyTrace: Record<string, unknown>
  confidence: number
  signalsUsed: string[]
  datasetVersions: Record<string, string>
  sourceProvenance: Record<string, unknown>[]
  canonicalDecision?: z.infer<typeof CanonicalDecisionEnvelopeSchema>
  proof?: z.infer<typeof CanonicalProofEnvelopeSchema>
  adapter?: z.infer<typeof CanonicalTransportMetadataSchema>
  timestamp: string
}) {
  const unsignedPayload = {
    version: 'DecisionEvaluatedV1' as const,
    decisionId: input.decisionId,
    decisionFrameId: input.decisionFrameId,
    action: input.action,
    reasonCode: input.reasonCode,
    baseline: input.baseline,
    selected: input.selected,
    policyTrace: input.policyTrace,
    provenance: {
      signalsUsed: input.signalsUsed,
      datasetVersions: input.datasetVersions,
      sourceProvenance: input.sourceProvenance,
    },
    canonicalDecision: input.canonicalDecision,
    proof: input.proof,
    adapter: input.adapter,
    confidence: input.confidence,
    timestamp: input.timestamp,
  }
  const signature = signCanonical(unsignedPayload, signingKey())
  return DecisionEvaluatedV1Schema.parse({
    ...unsignedPayload,
    signature,
  })
}

export async function enqueueDecisionEvaluatedEvents(
  tx: any,
  eventPayload: DecisionEvaluatedV1
) {
  const sinks = await tx.integrationWebhookSink.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  })

  if (sinks.length === 0) {
    return { enqueued: 0 }
  }

  const records = sinks.map((sink: { id: string }) => ({
    eventType: 'DecisionEvaluatedV1',
    eventKey: `decision-evaluated:${eventPayload.decisionFrameId}:${sink.id}`,
    sinkId: sink.id,
    payload: eventPayload as unknown as Prisma.InputJsonValue,
    status: 'PENDING' as const,
    attemptCount: 0,
    nextAttemptAt: new Date(),
  }))

  const result = await tx.decisionEventOutbox.createMany({
    data: records,
    skipDuplicates: true,
  })

  return { enqueued: result.count }
}

export async function processDecisionEventOutboxBatch(limit = env.DECISION_EVENT_DISPATCH_BATCH_SIZE) {
  const now = new Date()
  const candidates = await prisma.decisionEventOutbox.findMany({
    where: {
      status: {
        in: ['PENDING', 'FAILED'],
      },
      nextAttemptAt: {
        lte: now,
      },
    },
    include: {
      sink: true,
    },
    take: Math.max(1, limit),
    orderBy: {
      createdAt: 'asc',
    },
  })

  let sent = 0
  let failed = 0
  let deadLetter = 0

  for (const item of candidates) {
    if (!item.sink || item.sink.status !== 'ACTIVE') {
      await prisma.decisionEventOutbox.update({
        where: { id: item.id },
        data: {
          status: 'DEAD_LETTER',
          lastError: 'SINK_INACTIVE_OR_MISSING',
          processedAt: new Date(),
        },
      })
      deadLetter += 1
      continue
    }

    const payload = item.payload as Record<string, unknown>
    const body = JSON.stringify(payload)
    const signature = signCanonical(body, item.sink.signingSecret || signingKey())
    const idempotencyKey = item.eventKey

    await prisma.decisionEventOutbox.update({
      where: { id: item.id },
      data: { status: 'PROCESSING' },
    })

    try {
      const response = await fetch(item.sink.targetUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ecobe-event-type': item.eventType,
          'x-ecobe-event-key': item.eventKey,
          'x-ecobe-idempotency-key': idempotencyKey,
          'x-ecobe-signature': `v1=${signature}`,
          ...(item.sink.authToken ? { authorization: `Bearer ${item.sink.authToken}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(Math.max(200, env.DECISION_EVENT_DISPATCH_TIMEOUT_MS)),
      })

      if (response.ok) {
        await prisma.$transaction([
          prisma.decisionEventOutbox.update({
            where: { id: item.id },
            data: {
              status: 'SENT',
              processedAt: new Date(),
              lastResponseCode: response.status,
              lastError: null,
            },
          }),
          prisma.integrationWebhookSink.update({
            where: { id: item.sinkId ?? '' },
            data: {
              lastSuccessAt: new Date(),
              lastResponseCode: response.status,
              lastError: null,
            },
          }),
        ])
        sent += 1
      } else {
        const nextAttemptCount = item.attemptCount + 1
        const shouldDeadLetter = nextAttemptCount >= env.DECISION_EVENT_MAX_ATTEMPTS
        await prisma.$transaction([
          prisma.decisionEventOutbox.update({
            where: { id: item.id },
            data: {
              status: shouldDeadLetter ? 'DEAD_LETTER' : 'FAILED',
              attemptCount: nextAttemptCount,
              nextAttemptAt: shouldDeadLetter ? item.nextAttemptAt : computeNextAttempt(nextAttemptCount),
              lastResponseCode: response.status,
              lastError: `HTTP_${response.status}`,
              processedAt: shouldDeadLetter ? new Date() : null,
            },
          }),
          prisma.integrationWebhookSink.update({
            where: { id: item.sinkId ?? '' },
            data: {
              lastFailureAt: new Date(),
              lastResponseCode: response.status,
              lastError: `HTTP_${response.status}`,
            },
          }),
        ])
        if (shouldDeadLetter) deadLetter += 1
        else failed += 1
      }
    } catch (error) {
      const nextAttemptCount = item.attemptCount + 1
      const shouldDeadLetter = nextAttemptCount >= env.DECISION_EVENT_MAX_ATTEMPTS
      const message = error instanceof Error ? error.message : 'NETWORK_ERROR'
      await prisma.$transaction([
        prisma.decisionEventOutbox.update({
          where: { id: item.id },
          data: {
            status: shouldDeadLetter ? 'DEAD_LETTER' : 'FAILED',
            attemptCount: nextAttemptCount,
            nextAttemptAt: shouldDeadLetter ? item.nextAttemptAt : computeNextAttempt(nextAttemptCount),
            lastError: message,
            processedAt: shouldDeadLetter ? new Date() : null,
          },
        }),
        prisma.integrationWebhookSink.update({
          where: { id: item.sinkId ?? '' },
          data: {
            lastFailureAt: new Date(),
            lastError: message,
          },
        }),
      ])
      if (shouldDeadLetter) deadLetter += 1
      else failed += 1
    }
  }

  return { processed: candidates.length, sent, failed, deadLetter }
}

export async function createTestEventForSink(sinkId: string) {
  const sink = await prisma.integrationWebhookSink.findUnique({
    where: { id: sinkId },
  })
  if (!sink) {
    throw new Error('SINK_NOT_FOUND')
  }

  const now = new Date().toISOString()
  const payload = buildDecisionEvaluatedEvent({
    decisionId: `test-${Date.now()}`,
    decisionFrameId: `test-frame-${Date.now()}`,
    action: 'run_now',
    reasonCode: 'TEST_EVENT',
    baseline: {
      region: 'baseline-region',
      carbonIntensity: 400,
      waterImpactLiters: 10,
      waterScarcityImpact: 8,
    },
    selected: {
      region: 'selected-region',
      carbonIntensity: 120,
      waterImpactLiters: 3,
      waterScarcityImpact: 1.2,
    },
    policyTrace: {
      policyVersion: 'test',
      profile: 'default',
    },
    confidence: 0.9,
    signalsUsed: ['test'],
    datasetVersions: { test: 'v1' },
    sourceProvenance: [],
    timestamp: now,
  })

  const created = await prisma.decisionEventOutbox.create({
    data: {
      eventType: 'DecisionEvaluatedV1',
      eventKey: `decision-evaluated:test:${sink.id}:${Date.now()}`,
      sinkId: sink.id,
      payload: payload as unknown as Prisma.InputJsonValue,
      status: 'PENDING',
      nextAttemptAt: new Date(),
    },
  })

  return {
    outboxId: created.id,
    eventHash: sha256Canonical(payload),
  }
}
