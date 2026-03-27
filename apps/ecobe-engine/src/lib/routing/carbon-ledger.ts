/**
 * Carbon Ledger — Audit-Grade Carbon Accounting
 *
 * Produces verifiable carbon impact records for every routing decision.
 * Separates routing estimates from accounting actuals.
 *
 * Output: audit-grade records proving X grams CO2 avoided per job/company/month.
 */

import { prisma } from '../db'
import type { RoutingCandidate } from './candidate-generator'
import type { ScoringResult } from './scoring-engine'
import type { JobClassification } from './job-classifier'

export interface LedgerEntryInput {
  orgId: string
  commandId?: string
  decisionFrameId: string
  classification: JobClassification
  workloadType?: string
  scoringResult: ScoringResult
  energyEstimateKwh: number
  baselineRegion: string
}

/**
 * Record a routing decision in the carbon ledger.
 * Called immediately after candidate selection, before dispatch.
 */
export async function recordLedgerEntry(input: LedgerEntryInput): Promise<string> {
  const { orgId, commandId, decisionFrameId, classification, workloadType, scoringResult, energyEstimateKwh, baselineRegion } = input

  const selected = scoringResult.selected
  if (!selected) {
    throw new Error('Cannot record ledger entry without selected candidate')
  }

  const baseline = scoringResult.baselineCandidate
  const baselineCarbonGPerKwh = baseline?.carbonEstimateGPerKwh ?? selected.carbonEstimateGPerKwh ?? 450
  const chosenCarbonGPerKwh = selected.carbonEstimateGPerKwh ?? 450

  const baselineCarbonG = baselineCarbonGPerKwh * energyEstimateKwh
  const chosenCarbonG = chosenCarbonGPerKwh * energyEstimateKwh
  const carbonSavedG = Math.max(0, baselineCarbonG - chosenCarbonG)

  const entry = await prisma.carbonLedgerEntry.create({
    data: {
      orgId,
      commandId: commandId ?? null,
      decisionFrameId,
      jobClass: classification.jobClass,
      workloadType: workloadType ?? null,

      baselineRegion,
      chosenRegion: selected.region,
      baselineStartTs: baseline?.startTs ?? null,
      chosenStartTs: selected.startTs,

      baselineCarbonGPerKwh,
      chosenCarbonGPerKwh,
      energyEstimateKwh,
      baselineCarbonG: round3(baselineCarbonG),
      chosenCarbonG: round3(chosenCarbonG),
      carbonSavedG: round3(carbonSavedG),

      accountingMethod: 'flow-traced',

      sourceUsed: null, // Filled from provider signal
      validationSource: null,
      fallbackUsed: selected.syntheticFlag,
      estimatedFlag: selected.estimatedFlag,
      syntheticFlag: selected.syntheticFlag,

      confidenceScore: selected.confidenceScore,
      qualityTier: getQualityTier(selected.confidenceScore ?? 0),
      forecastStability: null,
      disagreementFlag: false,
      disagreementPct: null,

      balancingAuthority: selected.balancingAuthority,
      demandRampPct: selected.demandRampPct,
      carbonSpikeProbability: selected.carbonSpikeProbability,
      curtailmentProbability: selected.curtailmentProbability,
      importCarbonLeakageScore: selected.importCarbonLeakageScore,

      rankScore: selected.rankScore,
      candidatesEvaluated: scoringResult.totalEvaluated,
      feasibleCandidates: scoringResult.totalFeasible,
    },
  })

  // Also persist all candidates for full audit trail
  await persistCandidates(decisionFrameId, scoringResult).catch((err: unknown) => {
    console.warn('Failed to persist routing candidates:', err)
  })

  return entry.id
}

/**
 * Update ledger entry with actual carbon data post-execution.
 */
export async function verifyLedgerEntry(
  decisionFrameId: string,
  actualCarbonGPerKwh: number,
  actualEnergyKwh?: number
): Promise<void> {
  const entry = await prisma.carbonLedgerEntry.findFirst({
    where: { decisionFrameId },
  })

  if (!entry) return

  const energyKwh = actualEnergyKwh ?? entry.energyEstimateKwh
  const actualCarbonG = actualCarbonGPerKwh * energyKwh
  const verifiedSavingsG = Math.max(0, entry.baselineCarbonG - actualCarbonG)

  await prisma.carbonLedgerEntry.update({
    where: { id: entry.id },
    data: {
      actualCarbonGPerKwh,
      actualCarbonG: round3(actualCarbonG),
      actualEnergykWh: energyKwh,
      verifiedSavingsG: round3(verifiedSavingsG),
      verifiedAt: new Date(),
    },
  })
}

/**
 * Get carbon savings summary for an organization.
 */
export async function getOrgCarbonSavings(
  orgId: string,
  periodDays: number = 30
): Promise<{
  totalJobsRouted: number
  totalCarbonSavedG: number
  totalCarbonSavedKg: number
  totalCarbonSavedTons: number
  avgCarbonSavedPerJob: number
  avgLatencyPenaltyMs: number
  avgCostIncreasePct: number
  verifiedSavingsG: number
  verificationRate: number
  byJobClass: Record<string, { jobs: number; savedG: number }>
  byRegion: Record<string, { jobs: number; savedG: number }>
  dailyTrend: Array<{ date: string; savedG: number; jobs: number }>
}> {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)

  const entries = await prisma.carbonLedgerEntry.findMany({
    where: {
      orgId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'asc' },
  })

  const totalJobsRouted = entries.length
  const totalCarbonSavedG = entries.reduce((sum: number, e: any) => sum + e.carbonSavedG, 0)
  const verifiedEntries = entries.filter((e: any) => e.verifiedSavingsG !== null)
  const verifiedSavingsG = verifiedEntries.reduce((sum: number, e: any) => sum + (e.verifiedSavingsG ?? 0), 0)

  // By job class
  const byJobClass: Record<string, { jobs: number; savedG: number }> = {}
  for (const e of entries) {
    const cls = e.jobClass || 'unknown'
    if (!byJobClass[cls]) byJobClass[cls] = { jobs: 0, savedG: 0 }
    byJobClass[cls].jobs++
    byJobClass[cls].savedG += e.carbonSavedG
  }

  // By region
  const byRegion: Record<string, { jobs: number; savedG: number }> = {}
  for (const e of entries) {
    const reg = e.chosenRegion
    if (!byRegion[reg]) byRegion[reg] = { jobs: 0, savedG: 0 }
    byRegion[reg].jobs++
    byRegion[reg].savedG += e.carbonSavedG
  }

  // Daily trend
  const dailyMap = new Map<string, { savedG: number; jobs: number }>()
  for (const e of entries) {
    const date = e.createdAt.toISOString().split('T')[0]
    const existing = dailyMap.get(date) || { savedG: 0, jobs: 0 }
    existing.savedG += e.carbonSavedG
    existing.jobs++
    dailyMap.set(date, existing)
  }

  const dailyTrend = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, savedG: round3(data.savedG), jobs: data.jobs }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    totalJobsRouted,
    totalCarbonSavedG: round3(totalCarbonSavedG),
    totalCarbonSavedKg: round3(totalCarbonSavedG / 1000),
    totalCarbonSavedTons: round3(totalCarbonSavedG / 1_000_000),
    avgCarbonSavedPerJob: totalJobsRouted > 0 ? round3(totalCarbonSavedG / totalJobsRouted) : 0,
    avgLatencyPenaltyMs: 0, // TODO: compute from outcome data
    avgCostIncreasePct: 0,  // TODO: compute from outcome data
    verifiedSavingsG: round3(verifiedSavingsG),
    verificationRate: totalJobsRouted > 0 ? round3(verifiedEntries.length / totalJobsRouted) : 0,
    byJobClass,
    byRegion,
    dailyTrend,
  }
}

/**
 * Generate a carbon report for compliance / ESG export.
 */
export async function generateCarbonReport(
  orgId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  organization: string
  reportPeriod: { start: string; end: string }
  summary: {
    totalJobsRouted: number
    totalCarbonAvoidedKg: number
    verifiedCarbonAvoidedKg: number
    averageReductionPct: number
    topRegions: Array<{ region: string; savedKg: number }>
  }
  methodology: string
  generatedAt: string
}> {
  const entries = await prisma.carbonLedgerEntry.findMany({
    where: {
      orgId,
      createdAt: { gte: startDate, lte: endDate },
    },
  })

  const totalBaseline = entries.reduce((s: number, e: any) => s + e.baselineCarbonG, 0)
  const totalChosen = entries.reduce((s: number, e: any) => s + e.chosenCarbonG, 0)
  const totalSaved = entries.reduce((s: number, e: any) => s + e.carbonSavedG, 0)
  const totalVerified = entries.reduce((s: number, e: any) => s + (e.verifiedSavingsG ?? 0), 0)

  // Top regions
  const regionMap = new Map<string, number>()
  for (const e of entries) {
    regionMap.set(e.chosenRegion, (regionMap.get(e.chosenRegion) ?? 0) + e.carbonSavedG)
  }

  const topRegions = Array.from(regionMap.entries())
    .map(([region, savedG]) => ({ region, savedKg: round3(savedG / 1000) }))
    .sort((a, b) => b.savedKg - a.savedKg)
    .slice(0, 5)

  return {
    organization: orgId,
    reportPeriod: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    },
    summary: {
      totalJobsRouted: entries.length,
      totalCarbonAvoidedKg: round3(totalSaved / 1000),
      verifiedCarbonAvoidedKg: round3(totalVerified / 1000),
      averageReductionPct: totalBaseline > 0 ? round3((totalSaved / totalBaseline) * 100) : 0,
      topRegions,
    },
    methodology: 'Flow-traced carbon intensity via Electricity Maps (primary) + WattTime MOER (marginal amplifier) + Ember (structural validation). Energy estimates based on workload GPU/CPU hours. Baseline: default region carbon intensity at routing time.',
    generatedAt: new Date().toISOString(),
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function persistCandidates(
  decisionFrameId: string,
  scoringResult: ScoringResult
): Promise<void> {
  const candidateData = scoringResult.candidates
    .filter(c => c.carbonEstimateGPerKwh !== null)
    .slice(0, 20) // Cap at 20 for storage
    .map(c => ({
      decisionFrameId,
      region: c.region,
      startTs: c.startTs,
      carbonEstimateGPerKwh: c.carbonEstimateGPerKwh,
      latencyEstimateMs: c.latencyEstimateMs,
      queueDelayEstimateSec: c.queueDelayEstimateSec,
      costEstimateUsd: c.costEstimateUsd,
      confidenceScore: c.confidenceScore,
      retryRiskScore: c.retryRiskScore,
      carbonScore: c.carbonScore,
      latencyScore: c.latencyScore,
      costScore: c.costScore,
      queueScore: c.queueScore,
      uncertaintyScore: c.uncertaintyScore,
      rankScore: c.rankScore,
      wasSelected: c === scoringResult.selected,
      wasFeasible: c.isFeasible,
      rejectionReason: c.rejectionReason,
    }))

  if (candidateData.length > 0) {
    await prisma.routingCandidate.createMany({ data: candidateData })
  }
}

function getQualityTier(confidence: number): string {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.5) return 'medium'
  return 'low'
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
