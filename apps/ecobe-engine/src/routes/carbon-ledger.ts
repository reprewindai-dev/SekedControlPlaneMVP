/**
 * Carbon Ledger & Reporting API — Routing Spec v1
 *
 * Endpoints:
 *   GET  /api/v1/carbon-ledger/savings/:orgId      — Org carbon savings summary
 *   GET  /api/v1/carbon-ledger/report/:orgId        — Compliance carbon report
 *   GET  /api/v1/carbon-ledger/job/:decisionFrameId — Single job carbon impact
 *   GET  /api/v1/carbon-ledger/candidates/:frameId  — Full candidate audit trail
 *   POST /api/v1/carbon-ledger/verify               — Verify actual vs predicted
 *   GET  /api/v1/carbon-ledger/provider-freshness    — Provider signal health
 *   GET  /api/v1/carbon-ledger/capacity-overview     — Fleet capacity status
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/db'
import {
  getOrgCarbonSavings,
  generateCarbonReport,
  verifyLedgerEntry,
  getProviderFreshness,
  getCapacityOverview,
} from '../lib/routing'

const router = Router()

/**
 * GET /api/v1/carbon-ledger/savings/:orgId
 * Returns carbon savings summary for an organization.
 */
router.get('/savings/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params
    const days = parseInt(req.query.days as string) || 30

    const savings = await getOrgCarbonSavings(orgId, days)

    return res.json({
      orgId,
      period: `${days}d`,
      ...savings,
    })
  } catch (error: any) {
    console.error('Carbon savings error:', error)
    res.status(500).json({ error: 'Failed to compute carbon savings' })
  }
})

/**
 * GET /api/v1/carbon-ledger/report/:orgId
 * Generates a compliance-grade carbon report for ESG/audit.
 */
router.get('/report/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params
    const startDate = req.query.start ? new Date(req.query.start as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const endDate = req.query.end ? new Date(req.query.end as string) : new Date()

    const report = await generateCarbonReport(orgId, startDate, endDate)

    return res.json(report)
  } catch (error: any) {
    console.error('Carbon report error:', error)
    res.status(500).json({ error: 'Failed to generate carbon report' })
  }
})

/**
 * GET /api/v1/carbon-ledger/job/:decisionFrameId
 * Returns the carbon impact for a single routing decision.
 */
router.get('/job/:decisionFrameId', async (req, res) => {
  try {
    const { decisionFrameId } = req.params

    const entry = await prisma.carbonLedgerEntry.findFirst({
      where: { decisionFrameId },
    })

    if (!entry) {
      return res.status(404).json({ error: 'Ledger entry not found' })
    }

    return res.json({
      id: entry.id,
      decisionFrameId: entry.decisionFrameId,
      orgId: entry.orgId,
      jobClass: entry.jobClass,
      workloadType: entry.workloadType,

      routing: {
        baselineRegion: entry.baselineRegion,
        chosenRegion: entry.chosenRegion,
        baselineStartTs: entry.baselineStartTs?.toISOString() ?? null,
        chosenStartTs: entry.chosenStartTs?.toISOString() ?? null,
      },

      carbonAccounting: {
        baselineCarbonGPerKwh: entry.baselineCarbonGPerKwh,
        chosenCarbonGPerKwh: entry.chosenCarbonGPerKwh,
        energyEstimateKwh: entry.energyEstimateKwh,
        baselineCarbonG: entry.baselineCarbonG,
        chosenCarbonG: entry.chosenCarbonG,
        carbonSavedG: entry.carbonSavedG,
        accountingMethod: entry.accountingMethod,
      },

      verified: entry.verifiedAt ? {
        actualCarbonGPerKwh: entry.actualCarbonGPerKwh,
        actualCarbonG: entry.actualCarbonG,
        actualEnergyKwh: entry.actualEnergykWh,
        verifiedSavingsG: entry.verifiedSavingsG,
        verifiedAt: entry.verifiedAt.toISOString(),
      } : null,

      provenance: {
        sourceUsed: entry.sourceUsed,
        validationSource: entry.validationSource,
        fallbackUsed: entry.fallbackUsed,
        estimatedFlag: entry.estimatedFlag,
        syntheticFlag: entry.syntheticFlag,
        confidenceScore: entry.confidenceScore,
        qualityTier: entry.qualityTier,
      },

      gridIntelligence: {
        balancingAuthority: entry.balancingAuthority,
        demandRampPct: entry.demandRampPct,
        carbonSpikeProbability: entry.carbonSpikeProbability,
        curtailmentProbability: entry.curtailmentProbability,
        importCarbonLeakageScore: entry.importCarbonLeakageScore,
      },

      scoring: {
        rankScore: entry.rankScore,
        candidatesEvaluated: entry.candidatesEvaluated,
        feasibleCandidates: entry.feasibleCandidates,
      },

      createdAt: entry.createdAt.toISOString(),
    })
  } catch (error: any) {
    console.error('Job carbon impact error:', error)
    res.status(500).json({ error: 'Failed to fetch job carbon impact' })
  }
})

/**
 * GET /api/v1/carbon-ledger/candidates/:decisionFrameId
 * Returns the full candidate audit trail for a routing decision.
 */
router.get('/candidates/:decisionFrameId', async (req, res) => {
  try {
    const { decisionFrameId } = req.params

    const candidates = await prisma.routingCandidate.findMany({
      where: { decisionFrameId },
      orderBy: { rankScore: 'desc' },
    })

    return res.json({
      decisionFrameId,
      totalCandidates: candidates.length,
      selected: candidates.find((c: any) => c.wasSelected) ?? null,
      candidates: candidates.map((c: any) => ({
        candidateId: c.id,
        region: c.region,
        startTs: c.startTs?.toISOString() ?? null,
        carbonEstimateGPerKwh: c.carbonEstimateGPerKwh,
        latencyEstimateMs: c.latencyEstimateMs,
        costEstimateUsd: c.costEstimateUsd,
        confidenceScore: c.confidenceScore,
        rankScore: c.rankScore,
        wasSelected: c.wasSelected,
        wasFeasible: c.wasFeasible,
        rejectionReason: c.rejectionReason,
        scores: {
          carbon: c.carbonScore,
          latency: c.latencyScore,
          cost: c.costScore,
          queue: c.queueScore,
          uncertainty: c.uncertaintyScore,
        },
      })),
    })
  } catch (error: any) {
    console.error('Candidate audit trail error:', error)
    res.status(500).json({ error: 'Failed to fetch candidate audit trail' })
  }
})

/**
 * POST /api/v1/carbon-ledger/verify
 * Verify actual carbon outcome against predicted.
 */
const verifySchema = z.object({
  decisionFrameId: z.string(),
  actualCarbonGPerKwh: z.number(),
  actualEnergyKwh: z.number().optional(),
})

router.post('/verify', async (req, res) => {
  try {
    const data = verifySchema.parse(req.body)

    await verifyLedgerEntry(
      data.decisionFrameId,
      data.actualCarbonGPerKwh,
      data.actualEnergyKwh
    )

    return res.json({ verified: true, decisionFrameId: data.decisionFrameId })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('Verify error:', error)
    res.status(500).json({ error: 'Failed to verify carbon outcome' })
  }
})

/**
 * GET /api/v1/carbon-ledger/provider-freshness
 * Returns provider signal health status.
 */
router.get('/provider-freshness', async (_req, res) => {
  try {
    const freshness = await getProviderFreshness()
    return res.json({ providers: freshness })
  } catch (error: any) {
    console.error('Provider freshness error:', error)
    res.status(500).json({ error: 'Failed to check provider freshness' })
  }
})

/**
 * GET /api/v1/carbon-ledger/capacity-overview
 * Returns fleet capacity status across all regions.
 */
router.get('/capacity-overview', async (req, res) => {
  try {
    const hoursAhead = parseInt(req.query.hours as string) || 24
    const overview = await getCapacityOverview(hoursAhead)

    return res.json({
      hoursAhead,
      regions: overview,
      generatedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('Capacity overview error:', error)
    res.status(500).json({ error: 'Failed to fetch capacity overview' })
  }
})

/**
 * GET /api/v1/carbon-ledger/global-savings
 * Returns aggregate savings across ALL organizations.
 */
router.get('/global-savings', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const entries = await prisma.carbonLedgerEntry.findMany({
      where: { createdAt: { gte: since } },
      select: {
        carbonSavedG: true,
        verifiedSavingsG: true,
        chosenRegion: true,
        jobClass: true,
        createdAt: true,
        baselineCarbonG: true,
        chosenCarbonG: true,
      },
    })

    const totalRouted = entries.length
    const totalSavedG = entries.reduce((s: number, e: any) => s + e.carbonSavedG, 0)
    const totalVerifiedG = entries.reduce((s: number, e: any) => s + (e.verifiedSavingsG ?? 0), 0)
    const totalBaselineG = entries.reduce((s: number, e: any) => s + e.baselineCarbonG, 0)

    // Daily trend
    const dailyMap = new Map<string, { savedG: number; jobs: number }>()
    for (const e of entries) {
      const date = e.createdAt.toISOString().split('T')[0]
      const ex = dailyMap.get(date) || { savedG: 0, jobs: 0 }
      ex.savedG += e.carbonSavedG
      ex.jobs++
      dailyMap.set(date, ex)
    }

    return res.json({
      period: `${days}d`,
      totalJobsRouted: totalRouted,
      totalCarbonSavedG: Math.round(totalSavedG * 1000) / 1000,
      totalCarbonSavedKg: Math.round(totalSavedG / 1000 * 1000) / 1000,
      totalCarbonSavedTons: Math.round(totalSavedG / 1_000_000 * 1000) / 1000,
      verifiedSavingsG: Math.round(totalVerifiedG * 1000) / 1000,
      averageReductionPct: totalBaselineG > 0 ? Math.round((totalSavedG / totalBaselineG) * 100 * 10) / 10 : 0,
      carbonReductionMultiplier: totalBaselineG > 0 ? Math.round((totalBaselineG / Math.max(totalBaselineG - totalSavedG, 1)) * 100) / 100 : 1,
      dailyTrend: Array.from(dailyMap.entries())
        .map(([date, d]) => ({ date, savedG: Math.round(d.savedG), jobs: d.jobs }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    })
  } catch (error: any) {
    console.error('Global savings error:', error)
    res.status(500).json({ error: 'Failed to compute global savings' })
  }
})

export default router
