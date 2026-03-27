import { Router } from 'express'
import { fingard } from '../services/fingard-control'
import { z } from 'zod'

const router = Router()

const regionParamsSchema = z.object({
  region: z.string().min(1)
})

/**
 * Get current carbon intensity for a specific region
 * This endpoint is used by the dashboard to display real-time data
 */
router.get('/regions/:region/current', async (req, res) => {
  try {
    const { region } = regionParamsSchema.parse(req.params)
    
    const fingardDecision = await fingard.getNormalizedSignal(region, new Date())
    const signal = fingardDecision.signal

    // Extract additional grid data if available
    const demand = signal.metadata?.demandRampPct 
      ? `${(signal.metadata.demandRampPct as number * 100).toFixed(1)}%`
      : 'Loading...'
    
    const renewable = signal.metadata?.renewableRatio
      ? `${(signal.metadata.renewableRatio as number * 100).toFixed(1)}%`
      : 'Loading...'

    const response = {
      region,
      carbonIntensity: signal.carbonIntensity,
      demand,
      renewable,
      confidence: signal.confidence,
      source: signal.provenance.provider,
      timestamp: signal.timestamp,
      isForecast: signal.isForecast,
      estimatedFlag: signal.estimatedFlag,
      syntheticFlag: signal.syntheticFlag,
      trustLevel: signal.provenance.trustLevel,
      fallbackUsed: signal.provenance.fallbackUsed,
      degraded: signal.provenance.degraded,
      providerStatus: fingardDecision.providerStatus,
      arbitrationLog: fingardDecision.arbitrationLog
    }

    res.json(response)
  } catch (error) {
    console.error(`Region ${req.params.region} current data error:`, error)
    
    // Return fallback data
    res.json({
      region: req.params.region,
      carbonIntensity: 400,
      demand: 'Unknown',
      renewable: 'Unknown',
      confidence: 0.3,
      source: 'static',
      timestamp: new Date().toISOString(),
      isForecast: false,
      estimatedFlag: false,
      syntheticFlag: true,
      trustLevel: 'low' as const,
      fallbackUsed: true,
      degraded: true,
      providerStatus: { static: 'available' as const },
      arbitrationLog: ['All providers failed, using static fallback']
    })
  }
})

/**
 * Get KPIs for dashboard
 * This endpoint provides the required dashboard KPIs
 */
router.get('/dashboard/kpis', async (req, res) => {
  try {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    // Mock KPI calculations - in production these would come from real analytics
    const kpis = {
      carbonReductionMultiplier: 2.4,
      carbonAvoidedToday: 156.7, // kg CO2
      carbonAvoidedThisMonth: 4852.3, // kg CO2
      highConfidenceDecisionPct: 87.3,
      providerDisagreementRatePct: 8.5,
      forecastAccuracyVsRealized: 88.2,
      curtailmentOpportunityDetection: 12,
      carbonSpikeRisk: 15.3,
      perOrgCommandUsage: {
        'org-1': 145,
        'org-2': 89,
        'org-3': 234
      },
      billingStatus: 'active',
      replayAvailability: 96.7
    }

    res.json(kpis)
  } catch (error) {
    console.error('Dashboard KPIs error:', error)
    res.status(500).json({ error: 'Failed to fetch KPI data' })
  }
})

export default router
