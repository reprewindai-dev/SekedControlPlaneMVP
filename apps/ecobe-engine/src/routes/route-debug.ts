import { Router } from 'express'
import { getSignals } from '../services/fingard.service'

const router = Router()

/**
 * POST /api/v1/route-debug
 * Debug route endpoint without database dependency
 */
router.post('/', async (req, res) => {
  try {
    console.log('Route debug request received:', req.body)
    
    const { workloadId, candidateRegions, durationMinutes, workloadType } = req.body

    // Basic validation
    if (!workloadId || !candidateRegions || !Array.isArray(candidateRegions) || candidateRegions.length === 0) {
      return res.status(400).json({ error: 'Invalid request: workloadId and candidateRegions required' })
    }

    console.log('Getting signals for regions:', candidateRegions)
    
    // Get signals for all candidate regions
    const signals = await getSignals(candidateRegions)
    
    console.log('Signals received:', signals.length)
    
    if (signals.length === 0) {
      return res.status(500).json({ error: 'No signals available for candidate regions' })
    }

    // Find winner (lowest carbon value)
    const winnerSignal = signals.reduce((min, current) => 
      current.carbonValue < min.carbonValue ? current : min
    )

    // Find worst (highest carbon value)
    const worstSignal = signals.reduce((max, current) => 
      current.carbonValue > max.carbonValue ? current : max
    )

    const response = {
      decisionId: `debug-${Date.now()}`,
      chosenRegion: winnerSignal.region,
      gridZone: winnerSignal.gridZone,
      source: winnerSignal.source,
      signalType: winnerSignal.signalType,
      carbonValue: winnerSignal.carbonValue,
      confidence: winnerSignal.confidence,
      freshness: winnerSignal.freshness,
      degraded: winnerSignal.degraded,
      alternatives: signals
        .filter(signal => signal.region !== winnerSignal.region)
        .map(signal => ({
          region: signal.region,
          carbonValue: signal.carbonValue,
          source: signal.source,
          degraded: signal.degraded,
        }))
        .slice(0, 3),
      carbonDeltaVsWorst: worstSignal.carbonValue - winnerSignal.carbonValue,
      debugInfo: {
        totalSignals: signals.length,
        winnerSource: winnerSignal.source,
        worstValue: worstSignal.carbonValue,
        allSignals: signals.map(s => ({
          region: s.region,
          carbonValue: s.carbonValue,
          source: s.source,
          confidence: s.confidence,
          degraded: s.degraded
        }))
      }
    }

    console.log('Route debug successful:', response.chosenRegion, response.carbonValue)
    res.status(201).json(response)
  } catch (error: any) {
    console.error('Route debug error:', error)
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message,
      stack: error.stack
    })
  }
})

export default router
