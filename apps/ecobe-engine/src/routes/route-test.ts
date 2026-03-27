import { Router } from 'express'

const router = Router()

/**
 * POST /api/v1/route-test
 * Simple test endpoint to isolate the issue
 */
router.post('/', async (req, res) => {
  try {
    const { workloadId, candidateRegions } = req.body

    // Basic validation
    if (!workloadId || !candidateRegions || !Array.isArray(candidateRegions) || candidateRegions.length === 0) {
      return res.status(400).json({ error: 'Invalid request: workloadId and candidateRegions required' })
    }

    // Return a simple static response
    res.status(201).json({
      decisionId: 'test-decision-123',
      chosenRegion: candidateRegions[0],
      gridZone: 'TEMP',
      source: 'static',
      signalType: 'average',
      carbonValue: 180,
      confidence: 0.3,
      freshness: new Date().toISOString(),
      degraded: true,
      alternatives: candidateRegions.map(region => ({
        region,
        carbonValue: 180 + Math.random() * 50,
        source: 'static',
        degraded: true,
      })),
      carbonDeltaVsWorst: 25,
    })
  } catch (error: any) {
    console.error('Route test error:', error)
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

export default router
