import { Router } from 'express'
import { z } from 'zod'

import { env } from '../config/env'
import { recordExternalWorkloadOutcome, IntelligenceOutcomeError } from '../lib/intelligence/outcome'
import { getIntelligenceMetrics } from '../lib/intelligence/metrics'
import { intelligenceJobGuard } from '../middleware/intelligence-job-guard'
import { runIntelligenceAccuracyJob, runVectorCleanupJob, runModelCalibrationJob } from '../workers/intelligence-jobs'
import { getJobStatuses, recordJobStatus } from '../lib/intelligence/job-status'
import { getIntegrationMetricsSummary } from '../lib/integration-metrics'
import { getScheduledIntelligenceJobs } from '../workers/intelligence-scheduler'

const router = Router()

const outcomeSchema = z.object({
  workloadId: z.string().min(1, 'workloadId is required'),
  region: z.string().min(1, 'region is required'),
  latency: z.number().nonnegative().optional(),
  carbonIntensity: z.number().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  success: z.boolean(),
})

function intelligenceGuard(req: any, res: any, next: any) {
  if (!env.INTELLIGENCE_JOB_TOKEN) {
    return next()
  }

  const token = req.header('x-ecobe-intel-token') || req.header('x-ecobe-admin-token')
  if (token !== env.INTELLIGENCE_JOB_TOKEN) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid intelligence token',
      },
    })
  }

  return next()
}

router.post('/outcome', intelligenceGuard, async (req, res) => {
  try {
    const payload = outcomeSchema.parse(req.body)
    const carbonSaved = await recordExternalWorkloadOutcome(payload)
    return res.status(201).json({ success: true, carbonSaved })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Request validation failed',
          details: error.errors,
        },
      })
    }

    if (error instanceof IntelligenceOutcomeError) {
      const status = error.code === 'WORKLOAD_NOT_FOUND' ? 404 : 400
      return res.status(status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      })
    }

    console.error('Intelligence outcome error:', error)
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Internal server error',
      },
    })
  }
})

router.get('/metrics', intelligenceGuard, async (_req, res) => {
  try {
    const metrics = await getIntelligenceMetrics()
    return res.json({ success: true, metrics })
  } catch (error) {
    console.error('Intelligence metrics error:', error)
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch intelligence metrics',
      },
    })
  }
})

async function executeJob<T>(job: string, runner: () => Promise<T>) {
  const started = Date.now()
  try {
    const result = await runner()
    await recordJobStatus(job, {
      lastRunAt: new Date().toISOString(),
      success: true,
      durationMs: Date.now() - started,
      details: result as Record<string, unknown>,
      error: null,
    })
    return { ok: true, result }
  } catch (error: any) {
    await recordJobStatus(job, {
      lastRunAt: new Date().toISOString(),
      success: false,
      durationMs: Date.now() - started,
      details: undefined,
      error: error?.message ?? 'Unknown error',
    })
    throw error
  }
}

router.post('/jobs/accuracy', intelligenceJobGuard, async (_req, res) => {
  try {
    const { result } = await executeJob('intelligence-accuracy', runIntelligenceAccuracyJob)
    return res.json({ success: true, result })
  } catch (error: any) {
    console.error('Accuracy job error:', error)
    return res.status(500).json({ success: false, error: { code: 'JOB_FAILED', message: error?.message ?? 'Failed to run accuracy job' } })
  }
})

router.post('/jobs/vector-cleanup', intelligenceJobGuard, async (_req, res) => {
  try {
    const { result } = await executeJob('intelligence-vector-cleanup', runVectorCleanupJob)
    return res.json({ success: true, result })
  } catch (error: any) {
    console.error('Vector cleanup job error:', error)
    return res.status(500).json({ success: false, error: { code: 'JOB_FAILED', message: error?.message ?? 'Failed to run vector cleanup job' } })
  }
})

router.post('/jobs/model-calibration', intelligenceJobGuard, async (_req, res) => {
  try {
    const { result } = await executeJob('intelligence-model-calibration', runModelCalibrationJob)
    return res.json({ success: true, result })
  } catch (error: any) {
    console.error('Model calibration job error:', error)
    return res.status(500).json({ success: false, error: { code: 'JOB_FAILED', message: error?.message ?? 'Failed to run model calibration job' } })
  }
})

router.get('/jobs/status', intelligenceGuard, async (_req, res) => {
  try {
    const statuses = await getJobStatuses()
    return res.json({ success: true, jobs: statuses })
  } catch (error) {
    console.error('Job status error:', error)
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch job status' } })
  }
})

router.get('/jobs/metrics', intelligenceGuard, async (_req, res) => {
  try {
    const metrics = await getIntegrationMetricsSummary()
    return res.json({ success: true, metrics })
  } catch (error) {
    console.error('Job metrics error:', error)
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch job metrics' } })
  }
})

router.get('/jobs/schedules', intelligenceGuard, async (_req, res) => {
  try {
    const schedules = await getScheduledIntelligenceJobs()
    return res.json({ success: true, schedules })
  } catch (error) {
    console.error('Job schedules error:', error)
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch job schedules' } })
  }
})

/**
 * GET /api/v1/intelligence/patterns
 * Returns detected carbon patterns from historical decisions
 */
router.get('/patterns', async (req, res) => {
  try {
    const { prisma } = await import('../lib/db')
    const region = (req.query.region as string) || 'us-east-1'
    const days = parseInt(req.query.days as string) || 7
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    // Get historical decisions to detect patterns
    const decisions = await prisma.dashboardRoutingDecision.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    // Detect hourly patterns
    const hourlyMap = new Map<number, { total: number; count: number }>()
    for (const d of decisions) {
      const hour = new Date(d.createdAt).getHours()
      const existing = hourlyMap.get(hour) || { total: 0, count: 0 }
      existing.total += d.carbonIntensityChosenGPerKwh ?? 0
      existing.count++
      hourlyMap.set(hour, existing)
    }

    const hourlyPatterns = Array.from(hourlyMap.entries())
      .map(([hour, data]: [number, any]) => ({
        hour,
        avgIntensity: data.count > 0 ? Math.round(data.total / data.count) : null,
        sampleCount: data.count,
      }))
      .sort((a, b) => a.hour - b.hour)

    // Find best/worst hours
    const sorted = [...hourlyPatterns]
      .filter((h) => h.avgIntensity !== null)
      .sort((a, b) => (a.avgIntensity ?? 0) - (b.avgIntensity ?? 0))

    return res.json({
      region,
      timeRange: `${days}d`,
      totalDecisions: decisions.length,
      hourlyPatterns,
      bestHours: sorted.slice(0, 3).map((h) => ({ hour: h.hour, avgIntensity: h.avgIntensity })),
      worstHours: sorted
        .slice(-3)
        .reverse()
        .map((h) => ({ hour: h.hour, avgIntensity: h.avgIntensity })),
      recommendations: [
        sorted.length > 0
          ? `Schedule flexible workloads between ${sorted[0]?.hour}:00-${((sorted[0]?.hour ?? 0) + 2) % 24}:00 for lowest carbon`
          : null,
        sorted.length > 2
          ? `Avoid ${sorted[sorted.length - 1]?.hour}:00-${(((sorted[sorted.length - 1]?.hour ?? 0) + 2) % 24)}:00 for carbon-sensitive workloads`
          : null,
      ].filter(Boolean),
    })
  } catch (error) {
    console.error('Intelligence patterns error:', error)
    return res.status(500).json({ error: 'Failed to compute patterns' })
  }
})

/**
 * POST /api/v1/intelligence/best-window
 * Returns optimal execution window based on forecasts
 */
router.post('/best-window', async (req, res) => {
  try {
    const { prisma } = await import('../lib/db')
    const { region, lookAheadHours = 24, workloadType = 'general' } = req.body || {}
    const targetRegion = region || 'us-east-1'

    // Get forecasts for the region
    const forecasts = await prisma.carbonForecast.findMany({
      where: {
        region: targetRegion,
        forecastTime: { gte: new Date(), lte: new Date(Date.now() + lookAheadHours * 3600000) },
      },
      orderBy: { forecastTime: 'asc' },
    })

    if (forecasts.length === 0) {
      // Fallback: generate synthetic windows based on typical patterns
      const windows = []
      const now = new Date()
      for (let h = 0; h < Math.min(lookAheadHours, 48); h += 2) {
        const windowStart = new Date(now.getTime() + h * 3600000)
        const hour = windowStart.getHours()
        // Typical pattern: low carbon 2-6am, 11am-2pm (solar peak), high carbon 5-9pm
        const typicalIntensity =
          hour >= 2 && hour <= 6
            ? 180 + Math.random() * 40
            : hour >= 11 && hour <= 14
              ? 200 + Math.random() * 60
              : hour >= 17 && hour <= 21
                ? 380 + Math.random() * 80
                : 280 + Math.random() * 60
        windows.push({
          startTime: windowStart.toISOString(),
          endTime: new Date(windowStart.getTime() + 2 * 3600000).toISOString(),
          predictedIntensity: Math.round(typicalIntensity),
          confidence: 0.65,
          source: 'pattern_model',
        })
      }

      windows.sort((a, b) => a.predictedIntensity - b.predictedIntensity)

      return res.json({
        region: targetRegion,
        lookAheadHours,
        bestWindow: windows[0] || null,
        topWindows: windows.slice(0, 5),
        worstWindow: windows[windows.length - 1] || null,
        currentIntensity: windows.find((w) => new Date(w.startTime).getHours() === new Date().getHours())?.predictedIntensity ?? null,
        potentialSavingsPct:
          windows.length > 1 ? Math.round((1 - windows[0].predictedIntensity / windows[windows.length - 1].predictedIntensity) * 100) : null,
        source: 'pattern_model',
        generatedAt: new Date().toISOString(),
      })
    }

    // Use real forecasts
    const windows = forecasts.map((f: any) => ({
      startTime: f.forecastTime.toISOString(),
      endTime: new Date(f.forecastTime.getTime() + (f.horizonMinutes ?? 60) * 60000).toISOString(),
      predictedIntensity: f.predictedIntensity,
      confidence: f.confidence ?? 0.7,
      source: f.model ?? 'forecast_model',
    }))

    windows.sort((a: any, b: any) => a.predictedIntensity - b.predictedIntensity)

    return res.json({
      region: targetRegion,
      lookAheadHours,
      bestWindow: windows[0] || null,
      topWindows: windows.slice(0, 5),
      worstWindow: windows[windows.length - 1] || null,
      currentIntensity: forecasts[0]?.predictedIntensity ?? null,
      potentialSavingsPct:
        windows.length > 1 ? Math.round((1 - windows[0].predictedIntensity / windows[windows.length - 1].predictedIntensity) * 100) : null,
      source: 'forecast_model',
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Best window error:', error)
    return res.status(500).json({ error: 'Failed to compute best window' })
  }
})

/**
 * POST /api/v1/intelligence/predict-opportunity
 * Predicts carbon reduction opportunities
 */
router.post('/predict-opportunity', async (req, res) => {
  try {
    const { prisma } = await import('../lib/db')
    const { region, timeHorizonHours = 12 } = req.body || {}
    const targetRegion = region || 'us-east-1'

    // Get recent grid signals and decisions
    const [recentDecisions, gridStats] = await Promise.all([
      prisma.dashboardRoutingDecision.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 3600000) } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.carbonIntensity.findMany({
        where: { region: targetRegion, timestamp: { gte: new Date(Date.now() - 48 * 3600000) } },
        orderBy: { timestamp: 'desc' },
        take: 48,
      }),
    ])

    // Calculate opportunity metrics
    const avgBaseline =
      recentDecisions.length > 0
        ? recentDecisions.reduce((sum: number, d: any) => sum + (d.carbonIntensityBaselineGPerKwh ?? 0), 0) / recentDecisions.length
        : 350
    const avgChosen =
      recentDecisions.length > 0
        ? recentDecisions.reduce((sum: number, d: any) => sum + (d.carbonIntensityChosenGPerKwh ?? 0), 0) / recentDecisions.length
        : 250

    // Detect trending direction from grid stats
    const recentAvg =
      gridStats.slice(0, 12).reduce((sum: number, s: any) => sum + (s.carbonIntensity ?? 0), 0) / Math.max(gridStats.slice(0, 12).length, 1)
    const olderAvg =
      gridStats.slice(12, 48).reduce((sum: number, s: any) => sum + (s.carbonIntensity ?? 0), 0) / Math.max(gridStats.slice(12, 48).length, 1)
    const trendDirection = recentAvg < olderAvg ? 'improving' : recentAvg > olderAvg ? 'worsening' : 'stable'

    const opportunities = [
      {
        type: 'time_shift',
        description: 'Shift workloads to predicted low-carbon windows',
        estimatedSavingsGPerKwh: Math.round(avgBaseline - avgChosen),
        confidence: 0.75,
        timeframe: `Next ${timeHorizonHours}h`,
        action: 'Schedule flexible workloads during off-peak hours',
      },
      {
        type: 'region_shift',
        description: 'Route to lowest-carbon region available',
        estimatedSavingsGPerKwh: Math.round((avgBaseline - avgChosen) * 0.7),
        confidence: 0.8,
        timeframe: 'Immediate',
        action: 'Enable multi-region routing for carbon optimization',
      },
    ]

    // Add curtailment opportunity if grid conditions favorable
    if (trendDirection === 'improving') {
      opportunities.push({
        type: 'curtailment_window',
        description: 'Grid renewable surplus detected - execute now for near-zero carbon',
        estimatedSavingsGPerKwh: Math.round(avgBaseline * 0.6),
        confidence: 0.6,
        timeframe: 'Next 2-4h',
        action: 'Execute compute-intensive tasks during renewable surplus',
      })
    }

    return res.json({
      region: targetRegion,
      timeHorizonHours,
      trendDirection,
      currentAvgIntensity: Math.round(recentAvg),
      opportunities,
      totalPotentialSavingsGPerKwh: opportunities.reduce((sum: number, o: any) => sum + o.estimatedSavingsGPerKwh, 0),
      recentDecisionCount: recentDecisions.length,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Predict opportunity error:', error)
    return res.status(500).json({ error: 'Failed to predict opportunities' })
  }
})

export default router
