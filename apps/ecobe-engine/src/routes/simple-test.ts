import { Router } from 'express'

const router = Router()

/**
 * GET /api/v1/simple-test
 * Minimal test endpoint
 */
router.get('/', async (req, res) => {
  try {
    res.json({
      message: 'Simple test working',
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
    })
  } catch (error: any) {
    console.error('Simple test error:', error)
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

/**
 * POST /api/v1/simple-test
 * Minimal POST test endpoint
 */
router.post('/', async (req, res) => {
  try {
    res.json({
      message: 'Simple POST test working',
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      body: req.body,
    })
  } catch (error: any) {
    console.error('Simple POST test error:', error)
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

export default router
