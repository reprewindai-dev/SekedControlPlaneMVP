import { Router } from 'express'
import { z } from 'zod'
import { routeGreen } from '../lib/green-routing'
import { prisma } from '../lib/db'
import { env } from '../config/env'

const router = Router()

// Shared secret between DEKES SaaS and ECOBE
const DEKES_API_KEY =
  env.DEKES_API_KEY || process.env.ECOBE_API_KEY || process.env.ECOBE_ENGINE_API_KEY

function requireApiKey(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = auth.slice(7)
  if (token !== DEKES_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

const optimizeRequestSchema = z.object({
  query: z.object({
    id: z.string(),
    query: z.string(),
    estimatedResults: z.number(),
  }),
  carbonBudget: z.number(),
  regions: z.array(z.string()).min(1),
})

router.post('/optimize', requireApiKey, async (req, res) => {
  try {
    const data = optimizeRequestSchema.parse(req.body)

    // Map DEKES request to green routing request
    const routingResult = await routeGreen({
      preferredRegions: data.regions,
      maxCarbonGPerKwh: data.carbonBudget,
      carbonWeight: 0.5,
      latencyWeight: 0.2,
      costWeight: 0.3,
    })

    // Estimate kWh from query characteristics:
    // ~0.001 kWh per estimated result (typical DB + network cost)
    const estimatedKwh = Math.max(0.01, data.query.estimatedResults * 0.001)

    // Return DEKES-compatible response
    const response = {
      selectedRegion: routingResult.selectedRegion,
      estimatedCO2: Math.round(routingResult.carbonIntensity * estimatedKwh * 1000) / 1000, // gCO2eq = gCO2/kWh * kWh
      scheduledTime: new Date().toISOString(),
      score: routingResult.score,
      alternatives: routingResult.alternatives.map((alt) => ({
        region: alt.region,
        estimatedCO2: Math.round(alt.carbonIntensity * estimatedKwh * 1000) / 1000,
        score: alt.score,
      })),
    }

    res.json(response)
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('DEKES optimize error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const reportRequestSchema = z.object({
  queryId: z.string(),
  actualCO2: z.number(),
  timestamp: z.string().optional(),
})

router.post('/report', requireApiKey, async (req, res) => {
  try {
    const data = reportRequestSchema.parse(req.body)

    const reportedAt = data.timestamp ? new Date(data.timestamp) : new Date()

    // Store carbon usage report using DekesWorkload model
    await prisma.dekesWorkload.create({
      data: {
        dekesQueryId: data.queryId,
        actualCO2: data.actualCO2,
        scheduledTime: Number.isNaN(reportedAt.getTime()) ? new Date() : reportedAt,
        status: 'REPORTED',
        estimatedQueries: 1, // Default values for report-only entries
        estimatedResults: 1,
      },
    }).catch(() => {}) // Ignore duplicates

    res.json({ received: true, queryId: data.queryId })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('DEKES report error:', error)
    res.status(500).json({ error: 'Failed to process report' })
  }
})


/**
 * GET /api/v1/dekes/analytics
 * Returns aggregated DEKES analytics
 */
router.get('/analytics', requireApiKey, async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const workloads = await prisma.dekesWorkload.findMany({
      where: { scheduledTime: { gte: since } },
      orderBy: { scheduledTime: 'desc' },
    })

    // Aggregate stats
    const totalWorkloads = workloads.length
    const totalCO2 = workloads.reduce((sum: number, w: any) => sum + (w.actualCO2 ?? 0), 0)
    const totalQueries = workloads.reduce((sum: number, w: any) => sum + (w.estimatedQueries ?? 0), 0)
    const totalResults = workloads.reduce((sum: number, w: any) => sum + (w.estimatedResults ?? 0), 0)

    // Group by status
    const statusMap = new Map<string, number>()
    for (const w of workloads) {
      const status = w.status || 'UNKNOWN'
      statusMap.set(status, (statusMap.get(status) ?? 0) + 1)
    }

    // Calculate CO2 by day
    const dailyMap = new Map<string, number>()
    for (const w of workloads) {
      const day = w.scheduledTime.toISOString().split('T')[0]
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + (w.actualCO2 ?? 0))
    }

    const dailyTrend = Array.from(dailyMap.entries())
      .map(([date, co2]: [string, number]) => ({ date, co2: Math.round(co2 * 1000) / 1000 }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return res.json({
      timeRange: `${days}d`,
      totalWorkloads,
      totalCO2: Math.round(totalCO2 * 1000) / 1000,
      totalQueries,
      totalResults,
      avgCO2PerQuery: totalQueries > 0 ? Math.round((totalCO2 / totalQueries) * 1000) / 1000 : 0,
      statusBreakdown: Object.fromEntries(statusMap),
      dailyTrend,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('DEKES analytics error:', error)
    res.status(500).json({ error: 'Failed to compute analytics' })
  }
})

/**
 * POST /api/v1/dekes/schedule
 * Schedules an array of DEKES queries for optimal carbon execution
 */
router.post('/schedule', requireApiKey, async (req, res) => {
  try {
    const { queries, carbonBudget, preferredRegions } = req.body

    if (!Array.isArray(queries) || queries.length === 0) {
      return res.status(400).json({ error: 'queries array is required and must not be empty' })
    }

    // For each query, route it using the green routing logic
    const { routeGreen } = await import('../lib/green-routing')
    const scheduledQueries = await Promise.all(
      queries.map(async (query: any) => {
        try {
          const routing = await routeGreen({
            preferredRegions: preferredRegions || ['us-east-1', 'us-west-2', 'eu-west-1'],
            maxCarbonGPerKwh: carbonBudget || 500,
            carbonWeight: 0.7,
            latencyWeight: 0.2,
            costWeight: 0.1,
          })

          return {
            queryId: query.id,
            selectedRegion: routing.selectedRegion,
            estimatedCO2: routing.carbonIntensity * (query.estimatedKwh || 0.05),
            score: routing.score,
            recommendations: routing.alternatives.slice(0, 2).map((alt: any) => ({
              region: alt.region,
              estimatedCO2: alt.carbonIntensity * (query.estimatedKwh || 0.05),
            })),
          }
        } catch (error) {
          return { queryId: query.id, error: 'Routing failed' }
        }
      })
    )

    return res.json({
      totalQueries: queries.length,
      scheduled: scheduledQueries.filter((q: any) => !q.error).length,
      failed: scheduledQueries.filter((q: any) => q.error).length,
      queries: scheduledQueries,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('DEKES schedule error:', error)
    res.status(500).json({ error: 'Failed to schedule queries' })
  }
})

export default router
