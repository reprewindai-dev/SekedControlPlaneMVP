import { Router } from 'express'

const router = Router()

/**
 * POST /api/v1/route-simple
 * Simplified route endpoint for testing - no database dependency
 */
router.post('/', async (req, res) => {
  try {
    const { workloadId, candidateRegions, durationMinutes, workloadType } = req.body

    // Basic validation
    if (!workloadId || !candidateRegions || !Array.isArray(candidateRegions) || candidateRegions.length === 0) {
      return res.status(400).json({ error: 'Invalid request: workloadId and candidateRegions required' })
    }

    // Static mock routing decision
    const decision = {
      decisionId: `decision-${Date.now()}`,
      chosenRegion: candidateRegions[0],
      gridZone: 'PJM',
      source: 'watttime',
      signalType: 'moer',
      carbonValue: 124,
      confidence: 0.92,
      freshness: new Date().toISOString(),
      degraded: false,
      alternatives: candidateRegions.slice(1).map((region: string) => ({
        region,
        carbonValue: 180 + Math.random() * 50,
        source: 'static',
        degraded: true,
      })),
      carbonDeltaVsWorst: 38,
    }

    res.status(201).json(decision)
  } catch (error: any) {
    console.error('Route simple error:', error)
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

export default router
