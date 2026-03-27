import { Router } from 'express'
import { z } from 'zod'
import { GridSignalCache } from '../../lib/grid-signals/grid-signal-cache'
import { CurtailmentDetector, type CurtailmentWindow } from '../../lib/grid-signals/curtailment-detector'
import { RampDetector, type CarbonSpikeRisk } from '../../lib/grid-signals/ramp-detector'
import { InterchangeAnalyzer, type ImportCarbonLeakage } from '../../lib/grid-signals/interchange-analyzer'
import { prisma } from '../../lib/db'

const router = Router()

// Response schemas
const GridSummarySchema = z.object({
  timestamp: z.string(),
  regions: z.array(z.object({
    region: z.string(),
    balancingAuthority: z.string().nullable(),
    carbonIntensity: z.number().nullable(),
    source: z.string().nullable(),
    demandRampPct: z.number().nullable(),
    renewableRatio: z.number().nullable(),
    fossilRatio: z.number().nullable(),
    carbonSpikeProbability: z.number().nullable(),
    curtailmentProbability: z.number().nullable(),
    importCarbonLeakageScore: z.number().nullable(),
    signalQuality: z.enum(['high', 'medium', 'low'])
  }))
})

const OpportunitiesSchema = z.object({
  timestamp: z.string(),
  topCurtailmentWindows: z.array(z.object({
    region: z.string(),
    balancingAuthority: z.string().nullable(),
    startTime: z.string(),
    endTime: z.string(),
    curtailmentProbability: z.number(),
    expectedCarbonIntensity: z.number().nullable(),
    confidence: z.enum(['high', 'medium', 'low'])
  })),
  topCarbonSpikeRisks: z.array(z.object({
    region: z.string(),
    balancingAuthority: z.string().nullable(),
    carbonSpikeProbability: z.number(),
    expectedRampPct: z.number().nullable(),
    confidence: z.enum(['high', 'medium', 'low'])
  }))
})

const RegionDetailSchema = z.object({
  region: z.string(),
  balancingAuthority: z.string().nullable(),
  latest: z.object({
    timestamp: z.string(),
    demandRampPct: z.number().nullable(),
    renewableRatio: z.number().nullable(),
    fossilRatio: z.number().nullable(),
    netInterchangeMwh: z.number().nullable(),
    carbonSpikeProbability: z.number().nullable(),
    curtailmentProbability: z.number().nullable(),
    importCarbonLeakageScore: z.number().nullable(),
    signalQuality: z.enum(['high', 'medium', 'low'])
  }),
  history: z.array(z.object({
    timestamp: z.string(),
    demandRampPct: z.number().nullable(),
    renewableRatio: z.number().nullable(),
    fossilRatio: z.number().nullable(),
    carbonSpikeProbability: z.number().nullable(),
    curtailmentProbability: z.number().nullable(),
    importCarbonLeakageScore: z.number().nullable(),
    signalQuality: z.enum(['high', 'medium', 'low'])
  }))
})

const HeroMetricsSchema = z.object({
  timestamp: z.string(),
  carbonReductionMultiplier: z.number(),
  carbonAvoidedKgToday: z.number(),
  carbonAvoidedKgMonth: z.number(),
  highConfidenceDecisionPct: z.number(),
  providerDisagreementRatePct: z.number()
})

// Default cloud regions that the dashboard and cache warmer use
const CLOUD_REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1']

/**
 * GET /api/v1/intelligence/grid/summary
 * Get grid intelligence summary for all regions.
 * Tries EIA GridSignalSnapshot first; falls back to live provider-router signals
 * so the dashboard always has data even without EIA ingestion.
 */
router.get('/summary', async (req, res) => {
  try {
    const regions = req.query.regions as string[] | undefined
    const targetRegions = regions || CLOUD_REGIONS

    const summaryData = await Promise.all(
      targetRegions.map(async (region) => {
        // Map cloud region → balancing authority for EIA lookup
        const { getRegionMapping } = await import('../../lib/grid-signals/region-mapping')
        const mapping = getRegionMapping(region)
        const baCode = mapping?.balancingAuthority ?? null

        // Try EIA snapshots first (cache then DB)
        // Query by BA code (how EIA worker stores data), fallback to cloud region
        const cached = baCode
          ? (await GridSignalCache.getCachedSnapshots(baCode) || await GridSignalCache.getCachedSnapshots(region))
          : await GridSignalCache.getCachedSnapshots(region)
        const snapshots = cached || await prisma.gridSignalSnapshot.findMany({
          where: { region: baCode || region },
          orderBy: { timestamp: 'desc' },
          take: 1
        })

        if (snapshots.length > 0) {
          const latest = snapshots[0]
          return {
            region,  // Always return the cloud region, not the BA code
            balancingAuthority: latest.balancingAuthority || baCode,
            carbonIntensity: null as number | null,
            source: 'eia-930' as string | null,
            demandRampPct: latest.demandChangePct,
            renewableRatio: latest.renewableRatio,
            fossilRatio: latest.fossilRatio,
            carbonSpikeProbability: latest.carbonSpikeProbability,
            curtailmentProbability: latest.curtailmentProbability,
            importCarbonLeakageScore: latest.importCarbonLeakageScore,
            signalQuality: (latest.signalQuality?.toLowerCase() || 'medium') as 'high' | 'medium' | 'low'
          }
        }

        // Fallback: get live routing signal from provider-router (uses cache-warmed data)
        try {
          const { providerRouter } = await import('../../lib/carbon/provider-router')
          const signal = await providerRouter.getRoutingSignal(region, new Date())
          if (signal) {
            return {
              region,
              balancingAuthority: null,
              carbonIntensity: signal.carbonIntensity,
              source: signal.provenance.sourceUsed,
              demandRampPct: null,
              renewableRatio: null,
              fossilRatio: null,
              carbonSpikeProbability: null,
              curtailmentProbability: null,
              importCarbonLeakageScore: null,
              signalQuality: (signal.confidence >= 0.7 ? 'high' : signal.confidence >= 0.4 ? 'medium' : 'low') as 'high' | 'medium' | 'low'
            }
          }
        } catch (err) {
          console.warn(`Grid summary: provider-router fallback failed for ${region}:`, err)
        }

        return null
      })
    )

    const response = {
      timestamp: new Date().toISOString(),
      regions: summaryData.filter((region): region is NonNullable<typeof region> => region !== null)
    }

    const validated = GridSummarySchema.parse(response)
    return res.json(validated)

  } catch (error) {
    console.error('Grid summary error:', error)
    return res.status(500).json({ error: 'Failed to fetch grid summary' })
  }
})

/**
 * GET /api/v1/intelligence/grid/opportunities
 * Get curtailment windows and carbon spike risks
 */
router.get('/opportunities', async (req, res) => {
  try {
    const regions = req.query.regions as string[] | undefined
    const targetRegions = regions || ['PJM', 'ERCOT', 'CAISO', 'MISO', 'NYISO', 'ISO-NE', 'SPP']

    // Fetch recent snapshots for all regions
    const allSnapshots = await Promise.all(
      targetRegions.map(async (region) => {
        const cached = await GridSignalCache.getCachedSnapshots(region)
        return cached || await prisma.gridSignalSnapshot.findMany({
          where: { region },
          orderBy: { timestamp: 'desc' },
          take: 48 // Last 48 hours
        })
      })
    )

    const flatSnapshots = allSnapshots.flat().map(s => ({
      ...s,
      timestamp: typeof s.timestamp === 'string' ? s.timestamp : s.timestamp.toISOString(),
      signalQuality: (s.signalQuality as any)?.toLowerCase?.() || 'medium'
    }))

    // Detect curtailment windows
    const curtailmentWindows = CurtailmentDetector.getTopCurtailmentWindows(
      CurtailmentDetector.detectCurtailmentWindows(flatSnapshots as any, 0.6),
      5
    )

    // Estimate carbon intensity for curtailment windows
    const curtailmentWithIntensity = curtailmentWindows.map(window => ({
      ...window,
      expectedCarbonIntensity: window.confidence === 'high' ? 
        CurtailmentDetector.estimateCurtailmentCarbonIntensity(window, 350) : null
    }))

    // Detect carbon spike risks
    const spikeRisks = RampDetector.getTopCarbonSpikeRisks(
      RampDetector.detectCarbonSpikeRisks(flatSnapshots as any, 0.7),
      5
    )

    const response = {
      timestamp: new Date().toISOString(),
      topCurtailmentWindows: curtailmentWithIntensity,
      topCarbonSpikeRisks: spikeRisks
    }

    const validated = OpportunitiesSchema.parse(response)
    return res.json(validated)

  } catch (error) {
    console.error('Grid opportunities error:', error)
    return res.status(500).json({ error: 'Failed to fetch grid opportunities' })
  }
})

/**
 * GET /api/v1/intelligence/grid/region/:region
 * Get detailed grid intelligence for a specific region
 */
router.get('/region/:region', async (req, res) => {
  try {
    const { region } = req.params
    const hours = parseInt(req.query.hours as string) || 24

    // Map cloud region → BA code for EIA lookup
    const { getRegionMapping } = await import('../../lib/grid-signals/region-mapping')
    const mapping = getRegionMapping(region)
    const baCode = mapping?.balancingAuthority ?? null
    const queryRegion = baCode || region

    // Fetch latest snapshot (try BA code first, then raw region)
    let latestSnapshot = await prisma.gridSignalSnapshot.findFirst({
      where: { region: queryRegion },
      orderBy: { timestamp: 'desc' }
    })
    if (!latestSnapshot && baCode) {
      latestSnapshot = await prisma.gridSignalSnapshot.findFirst({
        where: { region },
        orderBy: { timestamp: 'desc' }
      })
    }

    if (!latestSnapshot) {
      return res.status(404).json({ error: 'Region not found' })
    }

    // Fetch historical data
    const history = await prisma.gridSignalSnapshot.findMany({
      where: {
        region: queryRegion,
        timestamp: {
          gte: new Date(Date.now() - hours * 60 * 60 * 1000)
        }
      },
      orderBy: { timestamp: 'desc' },
      take: 48
    })

    const response = {
      region,  // Return cloud region, not BA code
      balancingAuthority: latestSnapshot.balancingAuthority,
      latest: {
        timestamp: latestSnapshot.timestamp.toISOString(),
        demandRampPct: latestSnapshot.demandChangePct,
        renewableRatio: latestSnapshot.renewableRatio,
        fossilRatio: latestSnapshot.fossilRatio,
        netInterchangeMwh: latestSnapshot.netInterchangeMwh,
        carbonSpikeProbability: latestSnapshot.carbonSpikeProbability,
        curtailmentProbability: latestSnapshot.curtailmentProbability,
        importCarbonLeakageScore: latestSnapshot.importCarbonLeakageScore,
        signalQuality: latestSnapshot.signalQuality
      },
      history: history.map((snapshot: any) => ({
        timestamp: typeof snapshot.timestamp === 'string' ? snapshot.timestamp : snapshot.timestamp.toISOString(),
        demandRampPct: snapshot.demandChangePct,
        renewableRatio: snapshot.renewableRatio,
        fossilRatio: snapshot.fossilRatio,
        carbonSpikeProbability: snapshot.carbonSpikeProbability,
        curtailmentProbability: snapshot.curtailmentProbability,
        importCarbonLeakageScore: snapshot.importCarbonLeakageScore,
        signalQuality: snapshot.signalQuality
      }))
    }

    const validated = RegionDetailSchema.parse(response)
    return res.json(validated)

  } catch (error) {
    console.error('Region detail error:', error)
    return res.status(500).json({ error: 'Failed to fetch region details' })
  }
})

/**
 * GET /api/v1/intelligence/grid/hero-metrics
 * Get high-level KPIs for dashboard
 */
router.get('/hero-metrics', async (req, res) => {
  try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Calculate carbon reduction metrics
    const [todayCommands, monthCommands, totalCommands] = await Promise.all([
      prisma.carbonCommand.findMany({
        where: {
          createdAt: { gte: todayStart },
          status: 'EXECUTED'
        }
      }),
      prisma.carbonCommand.findMany({
        where: {
          createdAt: { gte: monthStart },
          status: 'EXECUTED'
        }
      }),
      prisma.carbonCommand.findMany({
        where: { status: 'EXECUTED' }
      })
    ])

    const carbonAvoidedToday = todayCommands.reduce((sum: number, cmd: any) =>
      sum + (cmd.estimatedSavingsKgCo2e || 0), 0
    )

    const carbonAvoidedMonth = monthCommands.reduce((sum: number, cmd: any) =>
      sum + (cmd.estimatedSavingsKgCo2e || 0), 0
    )

    // Calculate baseline vs optimized
    const baselineEmissions = totalCommands.reduce((sum: number, cmd: any) => {
      if (cmd.estimatedEmissionsKgCo2e && cmd.estimatedSavingsKgCo2e) {
        return sum + cmd.estimatedEmissionsKgCo2e + cmd.estimatedSavingsKgCo2e
      }
      return sum
    }, 0)

    const optimizedEmissions = totalCommands.reduce((sum: number, cmd: any) =>
      sum + (cmd.estimatedEmissionsKgCo2e || 0), 0
    )

    const carbonReductionMultiplier = baselineEmissions > 0 ? baselineEmissions / optimizedEmissions : 1

    // Calculate confidence metrics
    const highConfidenceCount = totalCommands.filter((cmd: any) =>
      cmd.confidence && cmd.confidence >= 0.8
    ).length

    const highConfidencePct = totalCommands.length > 0 ?
      (highConfidenceCount / totalCommands.length) * 100 : 0

    // Calculate actual provider disagreement rate from recent traces
    const recentTraces = await prisma.carbonCommandTrace.findMany({
      where: {
        createdAt: { gte: monthStart }
      },
      select: { traceJson: true },
      take: 1000,
      orderBy: { createdAt: 'desc' }
    })

    let disagreementCount = 0
    for (const trace of recentTraces) {
      try {
        const traceData = typeof trace.traceJson === 'string'
          ? JSON.parse(trace.traceJson)
          : trace.traceJson
        if (traceData?.provenance?.disagreementFlag === true) {
          disagreementCount++
        }
      } catch { /* ignore parse errors */ }
    }

    const disagreementRate = recentTraces.length > 0
      ? Math.round((disagreementCount / recentTraces.length) * 1000) / 10
      : 0

    const response = {
      timestamp: new Date().toISOString(),
      carbonReductionMultiplier: Math.round(carbonReductionMultiplier * 10) / 10,
      carbonAvoidedKgToday: Math.round(carbonAvoidedToday * 10) / 10,
      carbonAvoidedKgMonth: Math.round(carbonAvoidedMonth * 10) / 10,
      highConfidenceDecisionPct: Math.round(highConfidencePct * 10) / 10,
      providerDisagreementRatePct: disagreementRate
    }

    const validated = HeroMetricsSchema.parse(response)
    return res.json(validated)

  } catch (error) {
    console.error('Hero metrics error:', error)
    return res.status(500).json({ error: 'Failed to fetch hero metrics' })
  }
})

/**
 * GET /api/v1/intelligence/grid/import-leakage
 * Get import carbon leakage analysis
 */
router.get('/import-leakage', async (req, res) => {
  try {
    const regions = req.query.regions as string[] | undefined
    const targetRegions = regions || ['PJM', 'ERCOT', 'CAISO', 'MISO', 'NYISO', 'ISO-NE', 'SPP']

    // Fetch recent snapshots for all regions
    const allSnapshots = await Promise.all(
      targetRegions.map(async (region) => {
        const cached = await GridSignalCache.getCachedSnapshots(region)
        return cached || await prisma.gridSignalSnapshot.findMany({
          where: { region },
          orderBy: { timestamp: 'desc' },
          take: 24 // Last 24 hours
        })
      })
    )

    const flatSnapshots = allSnapshots.flat().map(s => ({
      ...s,
      timestamp: typeof s.timestamp === 'string' ? s.timestamp : s.timestamp.toISOString(),
      signalQuality: (s.signalQuality as any)?.toLowerCase?.() || 'medium'
    }))

    // Fetch real provider carbon intensities for neighbor regions
    const { providerRouter } = await import('../../lib/carbon/provider-router')
    const neighborIntensities: Record<string, number> = {}
    await Promise.all(
      targetRegions.map(async (region) => {
        try {
          const signal = await providerRouter.getRoutingSignal(region, new Date())
          if (signal && signal.source !== 'fallback') {
            neighborIntensities[region] = signal.carbonIntensity
          }
        } catch { /* ignore - will use heuristic fallback */ }
      })
    )

    // Analyze import carbon leakage with real provider intensities
    const leakages = InterchangeAnalyzer.analyzeImportCarbonLeakage(flatSnapshots as any, neighborIntensities)
    const topLeakages = InterchangeAnalyzer.getTopImportLeakages(leakages, 10)

    return res.json({
      timestamp: new Date().toISOString(),
      topImportLeakages: topLeakages,
      summary: InterchangeAnalyzer.groupByRegion(leakages)
    })

  } catch (error) {
    console.error('Import leakage error:', error)
    return res.status(500).json({ error: 'Failed to analyze import leakage' })
  }
})

/**
 * GET /api/v1/intelligence/grid/audit/:region
 * Get audit trail for a region
 */
router.get('/audit/:region', async (req, res) => {
  try {
    const { region } = req.params
    const hours = parseInt(req.query.hours as string) || 24

    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000)
    const endTime = new Date()

    const auditHistory = await prisma.integrationEvent.findMany({
      where: {
        source: `GRID_SIGNAL_${region}`,
        createdAt: { gte: startTime, lte: endTime }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    })

    const auditRecords = auditHistory
      .map((event: any) => {
        try {
          return JSON.parse(event.message || '{}')
        } catch {
          return null
        }
      })
      .filter((record: any): record is any => record !== null)

    return res.json({
      region,
      timeRange: { start: startTime.toISOString(), end: endTime.toISOString() },
      records: auditRecords,
      totalRecords: auditRecords.length
    })

  } catch (error) {
    console.error('Audit trail error:', error)
    return res.status(500).json({ error: 'Failed to fetch audit trail' })
  }
})

/**
 * GET /api/v1/intelligence/grid/structural-profile/:region
 * Get Ember structural profile for a region
 */
router.get('/structural-profile/:region', async (req, res) => {
  try {
    const { region } = req.params
    const { providerRouter } = await import('../../lib/carbon/provider-router')

    const profile = await providerRouter.getStructuralProfile(region)

    if (!profile) {
      return res.json({
        region,
        available: false,
        message: 'No Ember structural data available for this region',
      })
    }

    res.json({
      region,
      available: true,
      profile,
    })
  } catch (error) {
    console.error('Structural profile error:', error)
    res.status(500).json({ error: 'Failed to get structural profile' })
  }
})

export default router
