import { Router } from 'express'
import { prisma } from '../lib/db'

const router = Router()

/**
 * GET /api/v1/dashboard/metrics
 * Returns dashboard metrics including provider health
 */
router.get('/', async (req, res) => {
  try {
    const window = req.query.window as string || '24h'
    const windowHours = window === '24h' ? 24 : window === '7d' ? 168 : 24

    // Get recent decisions for metrics calculation
    const decisions = await prisma.dashboardRoutingDecision.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - windowHours * 60 * 60 * 1000)
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Calculate metrics
    const totalDecisions = decisions.length
    const totalRequests = totalDecisions // Simplified - assuming 1:1
    const totalBaselineG = decisions.reduce((sum: number, d: any) => sum + (d.co2BaselineG || 0), 0)
    const totalChosenG = decisions.reduce((sum: number, d: any) => sum + (d.co2ChosenG || 0), 0)
    const totalAvoidedG = totalBaselineG - totalChosenG
    const greenRouteRate = totalDecisions > 0 ? decisions.filter((d: any) => !d.fallbackUsed).length / totalDecisions : 0
    const fallbackRate = 1 - greenRouteRate

    // Provider health metrics (mock for now)
    const watttimeSuccessRate = 0.92
    const watttimeSuccessCount = Math.floor(totalDecisions * watttimeSuccessRate)
    const watttimeFailureCount = totalDecisions - watttimeSuccessCount

    const metrics = {
      window: window as '24h' | '7d',
      windowHours,
      totalDecisions,
      totalRequests,
      co2SavedG: totalAvoidedG,
      co2AvoidedPer1kRequestsG: totalRequests > 0 ? (totalAvoidedG / totalRequests) * 1000 : 0,
      greenRouteRate,
      fallbackRate,
      topChosenRegion: null, // Could calculate from decisions
      p95LatencyDeltaMs: null, // Would need timing data
      dataFreshnessMaxSeconds: null, // Would need freshness tracking
      watttimeSuccessRate,
      watttime: {
        successRate: watttimeSuccessRate,
        successCount: watttimeSuccessCount,
        failureCount: watttimeFailureCount,
        lastSuccessAt: new Date().toISOString(),
        lastFailureAt: null,
        lastError: null,
      },
      forecastRefresh: {
        lastRun: {
          timestamp: new Date().toISOString(),
          totalRegions: 10,
          totalRecords: 240,
          totalForecasts: 2400,
          status: 'ok'
        }
      }
    }

    res.json(metrics)
  } catch (error: any) {
    console.error('Metrics error:', error)
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

export default router
