import { Router } from 'express'
import { z } from 'zod'
import { forecastCarbonIntensity, findOptimalWindow } from '../lib/carbon-forecasting'
import { getAccuracyMetrics } from '../lib/forecast-accuracy'

const router = Router()

const regionParamSchema = z.object({
  region: z.string().min(1),
})

const forecastQuerySchema = z.object({
  hoursAhead: z.coerce.number().int().min(1).max(168).default(24),
})

router.get('/:region/forecasts', async (req, res) => {
  try {
    const { region } = regionParamSchema.parse(req.params)
    const { hoursAhead } = forecastQuerySchema.parse(req.query)

    const forecasts = await forecastCarbonIntensity(region, hoursAhead)
    return res.json({ region, hoursAhead, forecasts })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('Forecast route error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

const optimalWindowQuerySchema = z.object({
  durationHours: z.coerce.number().int().min(1).max(72).default(4),
  lookAheadHours: z.coerce.number().int().min(1).max(168).default(48),
})

router.get('/:region/optimal-window', async (req, res) => {
  try {
    const { region } = regionParamSchema.parse(req.params)
    const { durationHours, lookAheadHours } = optimalWindowQuerySchema.parse(req.query)

    const window = await findOptimalWindow(region, durationHours, lookAheadHours)
    return res.json({ region, durationHours, lookAheadHours, window })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('Optimal window route error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

const accuracyQuerySchema = z.object({
  region: z.string().optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
})

/**
 * GET /accuracy
 * Get forecast accuracy metrics over time
 */
router.get('/accuracy', async (req, res) => {
  try {
    const { region, days } = accuracyQuerySchema.parse(req.query)

    const metrics = await getAccuracyMetrics(region, days)
    return res.json({
      timestamp: new Date().toISOString(),
      window: { days, region: region || 'all' },
      metrics,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('Accuracy metrics error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
