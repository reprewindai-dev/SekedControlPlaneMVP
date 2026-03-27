import { Router } from 'express'
import { prisma } from '../lib/db'
import { redis } from '../lib/redis'

const router = Router()

/**
 * GET /api/v1/health
 * Health check endpoint for dashboard
 */
router.get('/', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`

    let redisOk = true
    try {
      await redis.ping()
    } catch {
      redisOk = false
    }

    const ok = redisOk

    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      engine: 'online',
      router: true,
      fingard: true,
      providers: {
        watttime: false,
        eia930: true,
        ember: true,
        static: true
      },
      timestamp: new Date().toISOString(),
      dependencies: {
        database: true,
        redis: redisOk,
      },
    })
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

export default router
