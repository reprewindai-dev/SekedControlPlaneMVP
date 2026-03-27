import { Router } from 'express'
import { prisma } from '../lib/db'

const router = Router()

/**
 * GET /api/v1/integrations/dks/summary
 * Returns DKS integration summary
 */
router.get('/summary', async (req, res) => {
  try {
    // Get DKS-sourced workloads from decision log
    const dksDecisions = await prisma.dashboardRoutingDecision.findMany({
      where: {
        workloadName: {
          startsWith: 'dks-'
        },
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      },
      select: {
        id: true,
        createdAt: true,
        workloadName: true,
        chosenRegion: true,
        carbonIntensityChosenGPerKwh: true,
        carbonIntensityBaselineGPerKwh: true,
        fallbackUsed: true,
        sourceUsed: true
      },
      orderBy: { createdAt: 'desc' }
    })

    const totalDksWorkloads = dksDecisions.length
    const totalCarbonAvoided = dksDecisions.reduce((sum: number, d: any) => 
      sum + ((d.carbonIntensityBaselineGPerKwh || 0) - (d.carbonIntensityChosenGPerKwh || 0)), 0
    )
    const degradedWorkloads = dksDecisions.filter((d: any) => d.fallbackUsed).length

    // Provider breakdown
    const providerBreakdown = dksDecisions.reduce((acc: Record<string, number>, d: any) => {
      const provider = d.sourceUsed || 'unknown'
      acc[provider] = (acc[provider] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    // Region breakdown
    const regionBreakdown = dksDecisions.reduce((acc: Record<string, number>, d: any) => {
      const region = d.chosenRegion || 'unknown'
      acc[region] = (acc[region] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const summary = {
      integrationName: 'DKS',
      period: '30 days',
      totalWorkloads: totalDksWorkloads,
      totalCarbonAvoidedG: totalCarbonAvoided,
      totalCarbonAvoidedKg: Math.round(totalCarbonAvoided / 1000 * 100) / 100,
      avgCarbonAvoidancePerWorkloadG: totalDksWorkloads > 0 ? Math.round(totalCarbonAvoided / totalDksWorkloads * 100) / 100 : 0,
      degradedWorkloads,
      degradationRate: totalDksWorkloads > 0 ? (degradedWorkloads / totalDksWorkloads) : 0,
      providerBreakdown,
      regionBreakdown,
      lastActivity: dksDecisions.length > 0 ? dksDecisions[0].createdAt.toISOString() : null,
      status: totalDksWorkloads > 0 ? 'active' : 'inactive'
    }

    res.json(summary)
  } catch (error: any) {
    console.error('DKS summary error:', error)
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

/**
 * GET /api/v1/integrations/dks/metrics
 * Returns detailed DKS metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const window = req.query.window as string || '24h'
    const windowHours = window === '24h' ? 24 : window === '7d' ? 168 : 24

    // Get DKS decisions for the time window
    const dksDecisions = await prisma.dashboardRoutingDecision.findMany({
      where: {
        workloadName: {
          startsWith: 'dks-'
        },
        createdAt: {
          gte: new Date(Date.now() - windowHours * 60 * 60 * 1000)
        }
      },
      select: {
        createdAt: true,
        workloadName: true,
        chosenRegion: true,
        carbonIntensityChosenGPerKwh: true,
        carbonIntensityBaselineGPerKwh: true,
        fallbackUsed: true,
        sourceUsed: true,
        meta: true
      },
      orderBy: { createdAt: 'asc' }
    })

    // Calculate time-series metrics
    const timeSeriesData: any[] = []
    const hourlyBuckets = new Map<string, {
      workloads: number
      carbonAvoided: number
      degraded: number
    }>()

    dksDecisions.forEach((decision: any) => {
      const hour = new Date(decision.createdAt).toISOString().slice(0, 13) + ':00:00Z'
      
      if (!hourlyBuckets.has(hour)) {
        hourlyBuckets.set(hour, { workloads: 0, carbonAvoided: 0, degraded: 0 })
      }
      
      const bucket = hourlyBuckets.get(hour)!
      bucket.workloads++
      bucket.carbonAvoided += (decision.carbonIntensityBaselineGPerKwh || 0) - (decision.carbonIntensityChosenGPerKwh || 0)
      if (decision.fallbackUsed) bucket.degraded++
    })

    // Convert to array format
    hourlyBuckets.forEach((value, key) => {
      timeSeriesData.push({
        timestamp: key,
        workloads: value.workloads,
        carbonAvoidedG: Math.round(value.carbonAvoided * 100) / 100,
        degradedWorkloads: value.degraded,
        avgCarbonAvoidancePerWorkloadG: value.workloads > 0 ? Math.round((value.carbonAvoided / value.workloads) * 100) / 100 : 0
      })
    })

    // Performance metrics
    const totalWorkloads = dksDecisions.length
    const totalCarbonAvoided = dksDecisions.reduce((sum: number, d: any) => 
      sum + ((d.carbonIntensityBaselineGPerKwh || 0) - (d.carbonIntensityChosenGPerKwh || 0)), 0
    )
    const degradedWorkloads = dksDecisions.filter((d: any) => d.fallbackUsed).length

    const metrics = {
      window: window as '24h' | '7d',
      windowHours,
      summary: {
        totalWorkloads,
        totalCarbonAvoidedG: Math.round(totalCarbonAvoided * 100) / 100,
        avgCarbonAvoidancePerWorkloadG: totalWorkloads > 0 ? Math.round((totalCarbonAvoided / totalWorkloads) * 100) / 100 : 0,
        degradedWorkloads,
        degradationRate: totalWorkloads > 0 ? (degradedWorkloads / totalWorkloads) : 0,
        successRate: totalWorkloads > 0 ? ((totalWorkloads - degradedWorkloads) / totalWorkloads) : 0
      },
      timeSeriesData,
      recentWorkloads: dksDecisions.slice(-10).map((d: any) => ({
        timestamp: d.createdAt.toISOString(),
        workloadName: d.workloadName,
        chosenRegion: d.chosenRegion,
        carbonAvoidedG: Math.round(((d.carbonIntensityBaselineGPerKwh || 0) - (d.carbonIntensityChosenGPerKwh || 0)) * 100) / 100,
        source: d.sourceUsed,
        degraded: d.fallbackUsed
      }))
    }

    res.json(metrics)
  } catch (error: any) {
    console.error('DKS metrics error:', error)
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

export default router
