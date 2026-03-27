import { Prisma } from '@prisma/client'
import { prisma } from './db'
import type { CarbonCommandPayload } from './carbon-command'

type CarbonCommand = Prisma.CarbonCommandGetPayload<Record<string, never>>
type AdaptiveProfileKey = {
  orgId: string
  workloadType: string | null
  modelFamily: string | null
  region: string | null
}

const equalsNullFilter = { equals: null }

function toNullableFilter(value: string | null): string | typeof equalsNullFilter {
  return value ?? equalsNullFilter
}

function toAdaptiveProfileWhere(key: AdaptiveProfileKey): Prisma.AdaptiveProfileWhereInput {
  return {
    orgId: key.orgId,
    workloadType: toNullableFilter(key.workloadType),
    modelFamily: toNullableFilter(key.modelFamily),
    region: toNullableFilter(key.region),
  }
}

type SignalType =
  | 'REGION_DRIFT'
  | 'LATENCY_REGRESSION'
  | 'EMISSIONS_OUTLIER'
  | 'SLA_BREACH'
  | 'FALLBACK_EXCESS'

interface AdaptiveAdjustment {
  metric: string
  value: number | string | boolean
  reason: string
}

interface AdaptiveRunContext {
  command: CarbonCommand
  payload: CarbonCommandPayload
  baseScores: Record<string, number>
  adjustments: AdaptiveAdjustment[]
  finalScores: Record<string, number>
  reasoning: string[]
}

export async function recordAdaptiveSignal(options: {
  orgId: string
  signalType: SignalType
  workloadType?: string | null
  modelFamily?: string | null
  region?: string | null
  metric: string
  value: number
  threshold?: number
  details?: Record<string, unknown>
}) {
  await prisma.adaptiveSignal.create({
    data: {
      orgId: options.orgId,
      signalType: options.signalType,
      workloadType: options.workloadType,
      modelFamily: options.modelFamily,
      region: options.region,
      metric: options.metric,
      value: options.value,
      threshold: options.threshold ?? null,
      details: (options.details ?? {}) as any,
    },
  })
}

export async function upsertAdaptiveProfile(options: {
  orgId: string
  workloadType?: string | null
  modelFamily?: string | null
  region?: string | null
  weightModifiers?: Record<string, number>
  regionAdjustments?: Record<string, number>
  executionAdjustments?: Record<string, number>
  confidenceModifiers?: Record<string, number>
}) {
  const uniqueKey: AdaptiveProfileKey = {
    orgId: options.orgId,
    workloadType: options.workloadType ?? null,
    modelFamily: options.modelFamily ?? null,
    region: options.region ?? null,
  }

  const updateData = {
    weightModifiersJson: (options.weightModifiers ?? {}) as Prisma.JsonObject,
    regionAdjustmentsJson: (options.regionAdjustments ?? {}) as Prisma.JsonObject,
    executionModeAdjustmentsJson: (options.executionAdjustments ?? {}) as Prisma.JsonObject,
    confidenceModifiersJson: (options.confidenceModifiers ?? {}) as Prisma.JsonObject,
    lastUpdatedAt: new Date(),
  }

  const existing = await prisma.adaptiveProfile.findFirst({
    where: toAdaptiveProfileWhere(uniqueKey),
  })

  if (existing) {
    await prisma.adaptiveProfile.update({
      where: { id: existing.id },
      data: updateData,
    })
    return
  }

  await prisma.adaptiveProfile.create({
    data: {
      orgId: uniqueKey.orgId,
      workloadType: uniqueKey.workloadType,
      modelFamily: uniqueKey.modelFamily,
      region: uniqueKey.region,
      ...updateData,
    },
  })
}

export async function logAdaptiveRun(context: AdaptiveRunContext) {
  await prisma.adaptiveRunLog.upsert({
    where: { commandId: context.command.id },
    update: {
      baseScoreJson: context.baseScores as any,
      adjustmentsJson: context.adjustments as any,
      finalScoreJson: context.finalScores as any,
      reasoningJson: context.reasoning as any,
    },
    create: {
      commandId: context.command.id,
      orgId: context.command.orgId,
      baseScoreJson: context.baseScores as any,
      adjustmentsJson: context.adjustments as any,
      finalScoreJson: context.finalScores as any,
      reasoningJson: context.reasoning as any,
    },
  })
}

export async function buildAdaptiveRun(
  command: CarbonCommand,
  payload: CarbonCommandPayload,
  scores: Record<string, number>
): Promise<AdaptiveRunContext> {
  const profile = await prisma.adaptiveProfile.findFirst({
    where: {
      orgId: command.orgId,
      workloadType: toNullableFilter(command.workloadType ?? payload.workload.type ?? null),
      modelFamily: toNullableFilter(command.modelFamily ?? payload.workload.modelFamily ?? null),
      region: toNullableFilter(command.selectedRegion ?? null),
    },
  })

  const adjustments: AdaptiveAdjustment[] = []
  const finalScores = { ...scores }
  const reasoning: string[] = []

  if (profile) {
    const weightModifiers = (profile.weightModifiersJson as Record<string, number>) || {}
    Object.entries(weightModifiers).forEach(([metric, delta]) => {
      if (typeof finalScores[metric] === 'number') {
        finalScores[metric] = Number((finalScores[metric] + delta).toFixed(4))
        adjustments.push({ metric, value: delta, reason: 'weight_modifier' })
      }
    })

    const regionAdjustments = (profile.regionAdjustmentsJson as Record<string, number>) || {}
    if (command.selectedRegion && typeof regionAdjustments[command.selectedRegion] === 'number') {
      finalScores.total = Number((finalScores.total + regionAdjustments[command.selectedRegion]).toFixed(4))
      adjustments.push({ metric: 'total', value: regionAdjustments[command.selectedRegion], reason: 'region_adjustment' })
    }

    const confidenceModifiers = (profile.confidenceModifiersJson as Record<string, number>) || {}
    if (typeof confidenceModifiers[command.executionMode ?? command.mode] === 'number') {
      finalScores.total = Number((finalScores.total + confidenceModifiers[command.executionMode ?? command.mode]).toFixed(4))
      adjustments.push({
        metric: 'total',
        value: confidenceModifiers[command.executionMode ?? command.mode],
        reason: 'confidence_modifier',
      })
    }
  }

  if (adjustments.length === 0) {
    reasoning.push('No adaptive adjustments applied; using base scores only.')
  } else {
    reasoning.push('Adaptive adjustments applied based on profile history.')
  }

  return {
    command,
    payload,
    baseScores: scores,
    adjustments,
    finalScores,
    reasoning,
  }
}
