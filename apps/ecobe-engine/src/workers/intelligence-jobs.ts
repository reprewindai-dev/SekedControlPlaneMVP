import { subDays } from 'date-fns'
import { Prisma } from '@prisma/client'

import { prisma } from '../lib/db'
import { redis } from '../lib/redis'
import { logIntelligenceEvent } from '../lib/logger'
import { deleteWorkloadFingerprints } from '../lib/intelligence/vector-store'

const ACCURACY_WINDOW_DAYS = 7
const VECTOR_RETENTION_DAYS = 90
const CALIBRATION_WINDOW_DAYS = 30

interface AccuracySummary {
  orgId: string
  totalWorkloads: number
  regionMatchRate: number
  avgEmissionsVariancePct: number
  avgLatencyVariancePct: number
  avgCostVariancePct: number
  totalCarbonSaved: number
}

const clamp = (value: number) => Number(Math.max(-0.5, Math.min(0.5, value)).toFixed(4))

export async function runIntelligenceAccuracyJob() {
  const since = subDays(new Date(), ACCURACY_WINDOW_DAYS)
  const outcomes = await prisma.carbonCommandOutcome.findMany({
    where: { createdAt: { gte: since } },
    select: {
      orgId: true,
      regionMatch: true,
      emissionsVariancePct: true,
      latencyVariancePct: true,
      costVariancePct: true,
      predictedEmissionsKgCo2e: true,
      actualEmissionsKgCo2e: true,
    },
  })

  const summaryMap = new Map<string, AccuracySummary>()

  outcomes.forEach((outcome: any) => {
    const current = summaryMap.get(outcome.orgId) ?? {
      orgId: outcome.orgId,
      totalWorkloads: 0,
      regionMatchRate: 0,
      avgEmissionsVariancePct: 0,
      avgLatencyVariancePct: 0,
      avgCostVariancePct: 0,
      totalCarbonSaved: 0,
    }

    current.totalWorkloads += 1
    current.regionMatchRate += outcome.regionMatch ? 1 : 0
    current.avgEmissionsVariancePct += outcome.emissionsVariancePct ?? 0
    current.avgLatencyVariancePct += outcome.latencyVariancePct ?? 0
    current.avgCostVariancePct += outcome.costVariancePct ?? 0

    const predicted = outcome.predictedEmissionsKgCo2e ?? 0
    const actual = outcome.actualEmissionsKgCo2e ?? predicted
    current.totalCarbonSaved += Math.max(predicted - actual, 0)

    summaryMap.set(outcome.orgId, current)
  })

  const summaries: AccuracySummary[] = Array.from(summaryMap.values()).map((row) => {
    const total = row.totalWorkloads || 1
    return {
      orgId: row.orgId,
      totalWorkloads: row.totalWorkloads,
      regionMatchRate: Number((row.regionMatchRate / total).toFixed(4)),
      avgEmissionsVariancePct: Number((row.avgEmissionsVariancePct / total).toFixed(2)),
      avgLatencyVariancePct: Number((row.avgLatencyVariancePct / total).toFixed(2)),
      avgCostVariancePct: Number((row.avgCostVariancePct / total).toFixed(2)),
      totalCarbonSaved: Number(row.totalCarbonSaved.toFixed(3)),
    }
  })

  await redis.set(
    'intelligence:accuracy:last',
    JSON.stringify({
      windowDays: ACCURACY_WINDOW_DAYS,
      generatedAt: new Date().toISOString(),
      organizations: summaries,
    })
  )

  logIntelligenceEvent('INTELLIGENCE_JOB_EXECUTED', {
    job: 'accuracy',
    organizations: summaries.length,
  })

  return { organizations: summaries.length }
}

export async function runVectorCleanupJob() {
  const cutoff = subDays(new Date(), VECTOR_RETENTION_DAYS)
  const batchSize = 200
  let totalRemoved = 0

  let hasMore = true

  while (hasMore) {
    const stale = await prisma.workloadEmbeddingIndex.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { commandId: true },
      take: batchSize,
    })

    if (stale.length === 0) {
      break
    }

    const ids = stale.map((item: any) => item.commandId)
    await deleteWorkloadFingerprints(ids)
    await prisma.workloadEmbeddingIndex.deleteMany({ where: { commandId: { in: ids } } })
    totalRemoved += ids.length

    if (stale.length < batchSize) {
      hasMore = false
    }
  }

  logIntelligenceEvent('INTELLIGENCE_JOB_EXECUTED', {
    job: 'vector-cleanup',
    recordsRemoved: totalRemoved,
  })

  return { recordsRemoved: totalRemoved, retentionDays: VECTOR_RETENTION_DAYS }
}

export async function runModelCalibrationJob() {
  const windowStart = subDays(new Date(), CALIBRATION_WINDOW_DAYS)
  const profiles = await prisma.adaptiveProfile.findMany({ take: 200 })
  let updatedProfiles = 0

  for (const profile of profiles) {
    const where: Prisma.CarbonCommandOutcomeWhereInput = {
      orgId: profile.orgId,
      createdAt: { gte: windowStart },
    }

    if (profile.region) {
      where.actualRegion = profile.region
    }

    const commandFilters: Prisma.CarbonCommandWhereInput = {}
    if (profile.workloadType) {
      commandFilters.workloadType = profile.workloadType
    }
    if (profile.modelFamily) {
      commandFilters.modelFamily = profile.modelFamily
    }

    if (Object.keys(commandFilters).length > 0) {
      where.command = commandFilters
    }

    const stats = await prisma.carbonCommandOutcome.aggregate({
      where,
      _avg: {
        emissionsVariancePct: true,
        latencyVariancePct: true,
        costVariancePct: true,
      },
      _count: { _all: true },
    })

    const total = stats._count?._all ?? 0
    if (total === 0) {
      continue
    }

    const regionMatches = await prisma.carbonCommandOutcome.count({
      where: { ...where, regionMatch: true },
    })

    const matchRate = regionMatches / total

    const weightModifiers = { ...((profile.weightModifiersJson as Record<string, number>) ?? {}) }
    const regionAdjustments = { ...((profile.regionAdjustmentsJson as Record<string, number>) ?? {}) }
    const confidenceModifiers = { ...((profile.confidenceModifiersJson as Record<string, number>) ?? {}) }

    let changed = false

    const adjustWeight = (metric: string, delta: number) => {
      weightModifiers[metric] = clamp((weightModifiers[metric] ?? 0) + delta)
      changed = true
    }

    if ((stats._avg.emissionsVariancePct ?? 0) > 25) {
      adjustWeight('carbon', 0.05)
    } else if ((stats._avg.emissionsVariancePct ?? 0) < 10 && (weightModifiers.carbon ?? 0) > -0.4) {
      adjustWeight('carbon', -0.02)
    }

    if ((stats._avg.latencyVariancePct ?? 0) > 20) {
      adjustWeight('latency', 0.05)
    }

    if ((stats._avg.costVariancePct ?? 0) > 15) {
      adjustWeight('cost', 0.04)
    }

    if (profile.region) {
      const base = regionAdjustments[profile.region] ?? 0
      if (matchRate < 0.8) {
        regionAdjustments[profile.region] = clamp(base - 0.03)
        changed = true
      } else if (matchRate > 0.92) {
        regionAdjustments[profile.region] = clamp(base + 0.02)
        changed = true
      }
    }

    const executionAdjustments = (profile.executionModeAdjustmentsJson as Record<string, number>) || {}
    const confidenceKeys = Object.keys(confidenceModifiers).length
      ? Object.keys(confidenceModifiers)
      : Object.keys(executionAdjustments).length
        ? Object.keys(executionAdjustments)
        : ['DEFAULT']

    confidenceKeys.forEach((key) => {
      const base = confidenceModifiers[key] ?? 0
      if (matchRate < 0.75) {
        confidenceModifiers[key] = clamp(base - 0.02)
        changed = true
      } else if (matchRate > 0.9) {
        confidenceModifiers[key] = clamp(base + 0.01)
        changed = true
      }
    })

    if (!changed) {
      continue
    }

    await prisma.adaptiveProfile.update({
      where: { id: profile.id },
      data: {
        weightModifiersJson: weightModifiers as Prisma.JsonObject,
        regionAdjustmentsJson: regionAdjustments as Prisma.JsonObject,
        confidenceModifiersJson: confidenceModifiers as Prisma.JsonObject,
        lastUpdatedAt: new Date(),
      },
    })

    updatedProfiles += 1
  }

  logIntelligenceEvent('INTELLIGENCE_JOB_EXECUTED', {
    job: 'model-calibration',
    profilesUpdated: updatedProfiles,
  })

  return { profilesUpdated: updatedProfiles, windowDays: CALIBRATION_WINDOW_DAYS }
}
