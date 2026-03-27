import { Router } from 'express'

const router = Router()

/**
 * POST /api/v1/test-post
 * Minimal POST test endpoint
 */
router.post('/', async (req, res) => {
  try {
    console.log('Request body:', req.body)
    console.log('Request headers:', req.headers)
    
    res.json({
      message: 'POST test working',
      body: req.body,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('Test POST error:', error)
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

export default router
