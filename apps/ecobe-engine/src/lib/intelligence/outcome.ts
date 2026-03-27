import type { CarbonCommand } from '@prisma/client'

import { prisma } from '../db'
import type { CarbonCommandPayload } from '../carbon-command'
import { buildFingerprint, generateWorkloadEmbedding } from './fingerprint'
import { storeWorkloadFingerprint } from './vector-store'
import { logIntelligenceEvent } from '../logger'

export interface ExternalOutcomePayload {
  workloadId: string
  region: string
  latency?: number
  carbonIntensity?: number
  cost?: number
  success: boolean
}

export class IntelligenceOutcomeError extends Error {
  constructor(public code: 'WORKLOAD_NOT_FOUND' | 'INTELLIGENCE_DISABLED', message: string) {
    super(message)
  }
}

export async function recordExternalWorkloadOutcome(payload: ExternalOutcomePayload) {
  const command = await prisma.carbonCommand.findUnique({ where: { id: payload.workloadId } })
  if (!command) {
    throw new IntelligenceOutcomeError('WORKLOAD_NOT_FOUND', 'No workload found for the provided ID.')
  }

  const saved = await persistOutcomeSnapshot({
    command,
    region: payload.region,
    carbonIntensity: payload.carbonIntensity ?? null,
    latency: payload.latency ?? null,
    cost: payload.cost ?? null,
    success: payload.success,
  })

  return saved
}

export async function persistOutcomeSnapshot(params: {
  command: CarbonCommand
  region: string
  carbonIntensity?: number | null
  latency?: number | null
  cost?: number | null
  success: boolean
}) {
  const predicted = params.command.estimatedEmissionsKgCo2e ?? 0
  const actualCarbon = params.carbonIntensity ?? predicted
  const carbonSaved = Math.max(predicted - actualCarbon, 0)

  await prisma.workloadDecisionOutcome.create({
    data: {
      workloadId: params.command.id,
      region: params.region,
      carbonSaved,
      latency: params.latency ?? 0,
      cost: params.cost ?? 0,
      success: params.success,
    },
  })

  const requestPayload = params.command.requestPayload as CarbonCommandPayload | null
  if (requestPayload) {
    const fingerprint = buildFingerprint(requestPayload)
    const embedding = await generateWorkloadEmbedding(fingerprint)
    if (embedding) {
      await storeWorkloadFingerprint({
        workloadId: params.command.id,
        embedding,
        metadata: {
          workloadId: params.command.id,
          orgId: params.command.orgId,
          regionChosen: params.region,
          carbonIntensity: actualCarbon,
          latency: params.latency ?? null,
          cost: params.cost ?? null,
          carbonSaved,
          success: params.success,
        },
      })
    }
  }

  logIntelligenceEvent('INTELLIGENCE_OUTCOME_STORED', {
    workloadId: params.command.id,
    region: params.region,
    carbonSaved,
    success: params.success,
  })

  return carbonSaved
}
