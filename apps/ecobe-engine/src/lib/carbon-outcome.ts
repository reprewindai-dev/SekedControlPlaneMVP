import { differenceInMinutes, startOfDay } from 'date-fns'
import {
  Prisma,
  PredictionQuality,
  CarbonMeasurementSource,
  CarbonCommandStatus,
  type CarbonCommand,
} from '@prisma/client'
import { prisma } from './db'
import { recordAdaptiveSignal, upsertAdaptiveProfile } from './adaptive'
import { toInputJson } from './json'

const equalsNullFilter = { equals: null } as const
const toNullableFilter = (value: string | null | undefined) => value ?? equalsNullFilter

export type MeasurementSource = 'estimated' | 'provider-reported' | 'metered'

export interface CarbonOutcomePayload {
  commandId: string
  orgId: string
  execution: {
    actualRegion: string
    actualStartAt: string
    actualEndAt?: string
    actualLatencyMs?: number
    actualGpuHours?: number
    actualCpuHours?: number
    actualMemoryGb?: number
  }
  emissions?: {
    actualCarbonIntensity?: number
    actualEmissionsKgCo2e?: number
    measurementSource?: MeasurementSource
  }
  cost?: {
    actualCostUsd?: number
    costIndexObserved?: number
  }
  status: {
    completed: boolean
    slaMet?: boolean
    fallbackTriggered?: boolean
  }
  metadata?: {
    source?: string
    providerExecutionId?: string
    notes?: string
    [key: string]: unknown
  }
}

export class CarbonOutcomeError extends Error {
  constructor(
    public code: 'COMMAND_NOT_FOUND' | 'ORG_MISMATCH' | 'OUTCOME_ALREADY_EXISTS' | 'INVALID_REQUEST',
    message: string
  ) {
    super(message)
  }
}

const measurementMap: Record<MeasurementSource, CarbonMeasurementSource> = {
  estimated: 'ESTIMATED',
  'provider-reported': 'PROVIDER_REPORTED',
  metered: 'METERED',
}

interface VarianceMetrics {
  diff: number | null
  pct: number | null
}

interface ComparisonResult {
  predictedRegion?: string | null
  actualRegion: string
  predictedStartAt?: Date | null
  actualStartAt: Date
  startVarianceMinutes: number | null
  predictedEmissionsKgCo2e?: number | null
  actualEmissionsKgCo2e?: number | null
  emissionsVariance: VarianceMetrics
  predictedLatencyMs?: number | null
  actualLatencyMs?: number | null
  latencyVariance: VarianceMetrics
  predictedCostIndex?: number | null
  actualCostIndex?: number | null
  costVariance: VarianceMetrics
}

const toDate = (value?: string): Date | undefined => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const varianceMetrics = (predicted?: number | null, actual?: number | null): VarianceMetrics => {
  if (predicted === undefined || predicted === null || actual === undefined || actual === null) {
    return { diff: null, pct: null }
  }
  const diff = actual - predicted
  const pct = predicted === 0 ? null : Number(((Math.abs(diff) / Math.abs(predicted)) * 100).toFixed(2))
  return {
    diff: Number(diff.toFixed(3)),
    pct,
  }
}

const determineQuality = (
  regionMatch: boolean,
  emissionsPct: number | null,
  latencyPct: number | null,
  slaMet?: boolean
): PredictionQuality => {
  const within = (value: number | null, threshold: number) => value !== null && value <= threshold

  if (
    regionMatch &&
    (slaMet ?? true) &&
    within(emissionsPct, 10) &&
    within(latencyPct, 10)
  ) {
    return 'HIGH'
  }

  if (
    regionMatch &&
    within(emissionsPct, 20) &&
    within(latencyPct, 20)
  ) {
    return 'MEDIUM'
  }

  return 'LOW'
}

const startVarianceMinutes = (predicted?: Date | null, actual?: Date | null): number | null => {
  if (!predicted || !actual) return null
  return Math.abs(differenceInMinutes(predicted, actual))
}

const buildLearningSignals = (
  quality: PredictionQuality,
  comparison: ComparisonResult
): Record<string, unknown> => {
  return {
    shouldUpdateModel: quality !== 'HIGH',
    outlier: quality === 'LOW' && (comparison.emissionsVariance.pct ?? 0) > 40,
    notes:
      quality === 'HIGH'
        ? 'Prediction remained within acceptable variance thresholds'
        : 'Variance exceeded targets; feed into scoring adjustments',
  }
}

const VARIANCE_THRESHOLDS = {
  emissions: 30,
  latency: 20,
  cost: 15,
}

const PROFILE_WEIGHT_DELTA = 0.05
const REGION_ADJUST_DELTA = 0.04
const CONFIDENCE_DELTA = 0.03

const clampDelta = (value: number) => Number(Math.max(-0.5, Math.min(0.5, value)).toFixed(4))

async function emitAdaptiveSignals(
  command: CarbonCommand,
  payload: CarbonOutcomePayload,
  comparison: ComparisonResult,
  quality: PredictionQuality,
  regionMatch: boolean
) {
  const varianceSignals: Array<{
    signalType: Parameters<typeof recordAdaptiveSignal>[0]['signalType']
    metric: string
    value: number
    threshold?: number
    details: Record<string, unknown>
  }> = []

  const evaluateVariance = (
    pct: number | null,
    threshold: number,
    signalType: Parameters<typeof recordAdaptiveSignal>[0]['signalType'],
    metric: string
  ) => {
    if (pct !== null && Math.abs(pct) > threshold) {
      varianceSignals.push({
        signalType,
        metric,
        value: pct,
        threshold,
        details: {
          commandId: command.id,
          predicted: comparison[`predicted${metric}` as keyof ComparisonResult] ?? null,
          actual: comparison[`actual${metric}` as keyof ComparisonResult] ?? null,
        },
      })
    }
  }

  evaluateVariance(comparison.emissionsVariance.pct, VARIANCE_THRESHOLDS.emissions, 'EMISSIONS_OUTLIER', 'Emissions')
  evaluateVariance(comparison.latencyVariance.pct, VARIANCE_THRESHOLDS.latency, 'LATENCY_REGRESSION', 'Latency')
  evaluateVariance(comparison.costVariance.pct, VARIANCE_THRESHOLDS.cost, 'EMISSIONS_OUTLIER', 'Cost')

  if (!regionMatch) {
    varianceSignals.push({
      signalType: 'REGION_DRIFT',
      metric: 'region_mismatch',
      value: 1,
      details: {
        predictedRegion: comparison.predictedRegion ?? null,
        actualRegion: comparison.actualRegion,
      },
    })
  }

  if (payload.status.slaMet === false) {
    varianceSignals.push({
      signalType: 'SLA_BREACH',
      metric: 'sla_breach',
      value: 1,
      details: {
        commandId: command.id,
      },
    })
  }

  if (payload.status.fallbackTriggered) {
    varianceSignals.push({
      signalType: 'FALLBACK_EXCESS',
      metric: 'fallback_triggered',
      value: 1,
      details: {
        fallbackRegion: comparison.actualRegion,
      },
    })
  }

  await Promise.all(
    varianceSignals.map((signal) =>
      recordAdaptiveSignal({
        orgId: command.orgId,
        signalType: signal.signalType,
        workloadType: command.workloadType,
        modelFamily: command.modelFamily,
        region: comparison.predictedRegion ?? comparison.actualRegion,
        metric: signal.metric,
        value: signal.value,
        threshold: signal.threshold,
        details: signal.details,
      })
    )
  )

  await adjustAdaptiveProfile(command, payload, comparison, quality, regionMatch)
}

async function adjustAdaptiveProfile(
  command: CarbonCommand,
  payload: CarbonOutcomePayload,
  comparison: ComparisonResult,
  quality: PredictionQuality,
  regionMatch: boolean
) {
  const profileKey = {
    orgId: command.orgId,
    workloadType: command.workloadType ?? null,
    modelFamily: command.modelFamily ?? null,
    region: command.selectedRegion ?? null,
  }

  const existing = await prisma.adaptiveProfile.findFirst({
    where: {
      orgId: profileKey.orgId,
      workloadType: toNullableFilter(profileKey.workloadType),
      modelFamily: toNullableFilter(profileKey.modelFamily),
      region: toNullableFilter(profileKey.region),
    },
  })

  const existingWeightModifiers = (existing?.weightModifiersJson as Record<string, number> | null) ?? null
  const existingRegionAdjustments = (existing?.regionAdjustmentsJson as Record<string, number> | null) ?? null
  const existingConfidenceModifiers = (existing?.confidenceModifiersJson as Record<string, number> | null) ?? null

  const weightModifiers: Record<string, number> = {
    ...(existingWeightModifiers ?? {}),
  }
  const regionAdjustments: Record<string, number> = {
    ...(existingRegionAdjustments ?? {}),
  }
  const confidenceModifiers: Record<string, number> = {
    ...(existingConfidenceModifiers ?? {}),
  }

  const adjust = (map: Record<string, number>, key: string, delta: number) => {
    map[key] = clampDelta((map[key] ?? 0) + delta)
  }

  if (comparison.emissionsVariance.pct !== null && comparison.emissionsVariance.pct > VARIANCE_THRESHOLDS.emissions) {
    adjust(weightModifiers, 'carbon', PROFILE_WEIGHT_DELTA)
  }

  if (comparison.latencyVariance.pct !== null && comparison.latencyVariance.pct > VARIANCE_THRESHOLDS.latency) {
    adjust(weightModifiers, 'latency', PROFILE_WEIGHT_DELTA)
  }

  if (comparison.costVariance.pct !== null && comparison.costVariance.pct > VARIANCE_THRESHOLDS.cost) {
    adjust(weightModifiers, 'cost', PROFILE_WEIGHT_DELTA)
  }

  if (!regionMatch && comparison.predictedRegion) {
    adjust(regionAdjustments, comparison.predictedRegion, -REGION_ADJUST_DELTA)
  } else if (regionMatch && comparison.predictedRegion && quality === 'HIGH') {
    adjust(regionAdjustments, comparison.predictedRegion, REGION_ADJUST_DELTA)
  }

  const modeKey = command.executionMode ?? command.mode
  if (payload.status.slaMet === false) {
    adjust(confidenceModifiers, modeKey, -CONFIDENCE_DELTA)
  } else if (payload.status.slaMet && quality === 'HIGH') {
    adjust(confidenceModifiers, modeKey, CONFIDENCE_DELTA)
  }

  if (
    existing &&
    Object.entries(weightModifiers).every(([key, val]) => existingWeightModifiers?.[key] === val) &&
    Object.entries(regionAdjustments).every(([key, val]) => existingRegionAdjustments?.[key] === val) &&
    Object.entries(confidenceModifiers).every(([key, val]) => existingConfidenceModifiers?.[key] === val)
  ) {
    return
  }

  await upsertAdaptiveProfile({
    orgId: profileKey.orgId,
    workloadType: profileKey.workloadType ?? null,
    modelFamily: profileKey.modelFamily ?? null,
    region: profileKey.region ?? null,
    weightModifiers,
    regionAdjustments,
    confidenceModifiers,
  })
}

async function updateAccuracyMetrics(
  orgId: string,
  regionMatch: boolean,
  emissionsPct: number | null,
  latencyPct: number | null,
  costPct: number | null,
  quality: PredictionQuality
) {
  const today = startOfDay(new Date())

  await prisma.$transaction(async (tx: any) => {
    const existing = await tx.carbonCommandAccuracyDaily.findFirst({
      where: {
        date: today,
        orgId,
        workloadType: null,
        region: null,
      },
    })

    if (!existing) {
      await tx.carbonCommandAccuracyDaily.create({
        data: {
          date: today,
          orgId,
          workloadType: null,
          region: null,
          totalCommands: 1,
          regionMatchCount: regionMatch ? 1 : 0,
          avgEmissionsVariancePct: emissionsPct ?? 0,
          avgLatencyVariancePct: latencyPct ?? 0,
          avgCostVariancePct: costPct ?? 0,
          highQualityCount: quality === 'HIGH' ? 1 : 0,
          mediumQualityCount: quality === 'MEDIUM' ? 1 : 0,
          lowQualityCount: quality === 'LOW' ? 1 : 0,
        },
      })
      return
    }

    const total = existing.totalCommands + 1
    const avg = (prev: number, value: number | null) => {
      const safeValue = value ?? prev
      return Number(((prev * existing.totalCommands + safeValue) / total).toFixed(2))
    }

    await tx.carbonCommandAccuracyDaily.update({
      where: { id: existing.id },
      data: {
        totalCommands: total,
        regionMatchCount: existing.regionMatchCount + (regionMatch ? 1 : 0),
        avgEmissionsVariancePct: avg(existing.avgEmissionsVariancePct, emissionsPct),
        avgLatencyVariancePct: avg(existing.avgLatencyVariancePct, latencyPct),
        avgCostVariancePct: avg(existing.avgCostVariancePct, costPct),
        highQualityCount: existing.highQualityCount + (quality === 'HIGH' ? 1 : 0),
        mediumQualityCount: existing.mediumQualityCount + (quality === 'MEDIUM' ? 1 : 0),
        lowQualityCount: existing.lowQualityCount + (quality === 'LOW' ? 1 : 0),
      },
    })
  })
}

export interface CarbonOutcomeResponse {
  outcomeId: string
  commandId: string
  comparison: {
    predictedRegion?: string | null
    actualRegion: string
    predictedEmissionsKgCo2e?: number | null
    actualEmissionsKgCo2e?: number | null
    emissionsVarianceKg: number | null
    emissionsVariancePct: number | null
    predictedLatencyMs?: number | null
    actualLatencyMs?: number | null
    latencyVarianceMs: number | null
    latencyVariancePct: number | null
    predictedCostIndex?: number | null
    actualCostIndex?: number | null
    costVariancePct: number | null
  }
  verification: {
    regionMatch: boolean
    slaMet?: boolean
    fallbackTriggered?: boolean
    predictionQuality: PredictionQuality
  }
  learningSignals: Record<string, unknown>
}

export async function processCarbonOutcome(payload: CarbonOutcomePayload): Promise<CarbonOutcomeResponse> {
  const command = await prisma.carbonCommand.findUnique({ where: { id: payload.commandId } })
  if (!command) {
    throw new CarbonOutcomeError('COMMAND_NOT_FOUND', 'No CarbonCommand exists for the provided commandId.')
  }

  if (command.orgId !== payload.orgId) {
    throw new CarbonOutcomeError('ORG_MISMATCH', 'The provided orgId does not match the command owner.')
  }

  const existingOutcome = await prisma.carbonCommandOutcome.findUnique({ where: { commandId: payload.commandId } })
  if (existingOutcome) {
    throw new CarbonOutcomeError('OUTCOME_ALREADY_EXISTS', 'An outcome has already been recorded for this command.')
  }

  if (payload.metadata?.providerExecutionId) {
    const duplicateProvider = await prisma.carbonCommandOutcome.findUnique({
      where: { providerExecutionId: payload.metadata.providerExecutionId },
    })
    if (duplicateProvider) {
      throw new CarbonOutcomeError('OUTCOME_ALREADY_EXISTS', 'Provider execution has already been recorded.')
    }
  }

  const actualStart = toDate(payload.execution.actualStartAt)
  if (!actualStart) {
    throw new CarbonOutcomeError('INVALID_REQUEST', 'Invalid actualStartAt timestamp.')
  }

  const predictedRegion = command.selectedRegion
  const predictedStartAt = command.selectedStartAt ?? command.createdAt
  const predictedEmissions = command.estimatedEmissionsKgCo2e ?? null
  const predictedLatency = command.expectedLatencyMs ?? null
  const predictedCostIndex = command.expectedCostIndex ?? null

  const actualEmissions = payload.emissions?.actualEmissionsKgCo2e ?? null
  const actualLatency = payload.execution.actualLatencyMs ?? null
  const actualCostIndex = payload.cost?.costIndexObserved ?? null

  const comparison: ComparisonResult = {
    predictedRegion,
    actualRegion: payload.execution.actualRegion,
    predictedStartAt,
    actualStartAt: actualStart,
    startVarianceMinutes: startVarianceMinutes(predictedStartAt, actualStart),
    predictedEmissionsKgCo2e: predictedEmissions,
    actualEmissionsKgCo2e: actualEmissions,
    emissionsVariance: varianceMetrics(predictedEmissions, actualEmissions),
    predictedLatencyMs: predictedLatency,
    actualLatencyMs: actualLatency,
    latencyVariance: varianceMetrics(predictedLatency, actualLatency),
    predictedCostIndex,
    actualCostIndex,
    costVariance: varianceMetrics(predictedCostIndex, actualCostIndex),
  }

  const regionMatch = Boolean(predictedRegion) && predictedRegion === payload.execution.actualRegion
  const quality = determineQuality(
    regionMatch,
    comparison.emissionsVariance.pct,
    comparison.latencyVariance.pct,
    payload.status.slaMet
  )

  const learningSignals = buildLearningSignals(quality, comparison)

  const measurementSource = payload.emissions?.measurementSource
    ? measurementMap[payload.emissions.measurementSource]
    : CarbonMeasurementSource.ESTIMATED

  const outcomeRecord = await prisma.$transaction(async (tx: any) => {
    const outcome = await tx.carbonCommandOutcome.create({
      data: {
        commandId: command.id,
        orgId: payload.orgId,
        actualRegion: payload.execution.actualRegion,
        actualStartAt: actualStart,
        actualEndAt: toDate(payload.execution.actualEndAt),
        actualLatencyMs: actualLatency ?? null,
        actualGpuHours: payload.execution.actualGpuHours ?? null,
        actualCpuHours: payload.execution.actualCpuHours ?? null,
        actualMemoryGb: payload.execution.actualMemoryGb ?? null,
        actualCarbonIntensity: payload.emissions?.actualCarbonIntensity ?? null,
        actualEmissionsKgCo2e: actualEmissions,
        actualCostUsd: payload.cost?.actualCostUsd ?? null,
        costIndexObserved: actualCostIndex ?? null,
        measurementSource,
        providerExecutionId: payload.metadata?.providerExecutionId,
        predictedEmissionsKgCo2e: predictedEmissions,
        predictedLatencyMs: predictedLatency,
        predictedCostIndex,
        emissionsVarianceKg: comparison.emissionsVariance.diff,
        emissionsVariancePct: comparison.emissionsVariance.pct,
        latencyVarianceMs: comparison.latencyVariance.diff ? Math.round(comparison.latencyVariance.diff) : null,
        latencyVariancePct: comparison.latencyVariance.pct,
        costVariancePct: comparison.costVariance.pct,
        regionMatch,
        slaMet: payload.status.slaMet ?? null,
        fallbackTriggered: payload.status.fallbackTriggered ?? false,
        completed: payload.status.completed,
        predictionQuality: quality,
        comparisonJson: toInputJson({
          predictedRegion,
          actualRegion: payload.execution.actualRegion,
          predictedStartAt: predictedStartAt?.toISOString(),
          actualStartAt: actualStart.toISOString(),
          startVarianceMinutes: comparison.startVarianceMinutes,
          predictedEmissionsKgCo2e: predictedEmissions,
          actualEmissionsKgCo2e: actualEmissions,
          predictedLatencyMs: predictedLatency,
          actualLatencyMs: actualLatency,
          predictedCostIndex,
          actualCostIndex,
        }),
        learningSignals: toInputJson(learningSignals),
        metadata: toInputJson(payload.metadata ?? {}),
      },
    })

    await tx.carbonCommand.update({
      where: { id: command.id },
      data: { status: CarbonCommandStatus.EXECUTED },
    })

    return outcome
  })

  await updateAccuracyMetrics(
    payload.orgId,
    regionMatch,
    comparison.emissionsVariance.pct,
    comparison.latencyVariance.pct,
    comparison.costVariance.pct,
    quality
  )

  void emitAdaptiveSignals(command, payload, comparison, quality, regionMatch).catch((error) => {
    console.warn('Failed to emit adaptive signals for command', command.id, error)
  })

  return {
    outcomeId: outcomeRecord.id,
    commandId: command.id,
    comparison: {
      predictedRegion,
      actualRegion: payload.execution.actualRegion,
      predictedEmissionsKgCo2e: predictedEmissions,
      actualEmissionsKgCo2e: actualEmissions,
      emissionsVarianceKg: comparison.emissionsVariance.diff,
      emissionsVariancePct: comparison.emissionsVariance.pct,
      predictedLatencyMs: predictedLatency,
      actualLatencyMs: actualLatency,
      latencyVarianceMs: comparison.latencyVariance.diff,
      latencyVariancePct: comparison.latencyVariance.pct,
      predictedCostIndex,
      actualCostIndex,
      costVariancePct: comparison.costVariance.pct,
    },
    verification: {
      regionMatch,
      slaMet: payload.status.slaMet,
      fallbackTriggered: payload.status.fallbackTriggered ?? false,
      predictionQuality: quality,
    },
    learningSignals,
  }
}
