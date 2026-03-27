import { Router, Request, Response } from 'express'
import { redis } from '../lib/redis'
import { prisma } from '../lib/db'
import { GridSignalCache } from '../lib/grid-signals/grid-signal-cache'

const router = Router()

// Track worker status in memory
type WorkerStatusEntry = { running: boolean; lastRun: string | null; nextRun: string | null }
type WorkerRegistry = Record<string, WorkerStatusEntry>

let workerStatus: WorkerRegistry = {
  forecastPoller: { running: false, lastRun: null as string | null, nextRun: null as string | null },
  eiaIngestion: { running: false, lastRun: null as string | null, nextRun: null as string | null },
  intelligenceJobs: { running: false, lastRun: null as string | null, nextRun: null as string | null },
  learningLoop: { running: false, lastRun: null as string | null, nextRun: null as string | null },
  runtimeSupervisor: { running: false, lastRun: null as string | null, nextRun: null as string | null },
  decisionEventDispatcher: { running: false, lastRun: null as string | null, nextRun: null as string | null },
}

export function setWorkerStatus(worker: keyof WorkerRegistry, status: Partial<WorkerStatusEntry>) {
  workerStatus[worker] = { ...(workerStatus[worker] ?? { running: false, lastRun: null, nextRun: null }), ...status }
}

export function getWorkerStatus() {
  return workerStatus
}

/**
 * GET /api/v1/system/status
 * Returns comprehensive system health, worker status, and cache statistics.
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now()

    // Get uptime
    const uptime = process.uptime()
    const uptimeSeconds = Math.floor(uptime)
    const uptimeMinutes = Math.floor(uptime / 60)
    const uptimeHours = Math.floor(uptime / 3600)

    // Get database status
    let dbHealthy = false
    let dbLatency = 0
    try {
      const dbStart = Date.now()
      await prisma.$queryRaw`SELECT 1`
      dbHealthy = true
      dbLatency = Date.now() - dbStart
    } catch (error) {
      dbHealthy = false
      dbLatency = -1
    }

    // Get Redis status
    let redisHealthy = false
    let redisLatency = 0
    try {
      const redisStart = Date.now()
      await redis.ping()
      redisHealthy = true
      redisLatency = Date.now() - redisStart
    } catch (error) {
      redisHealthy = false
      redisLatency = -1
    }

    // Get cache statistics
    let cacheStats = null
    try {
      cacheStats = await GridSignalCache.getCacheStats()
    } catch (error) {
      console.warn('Failed to get cache stats:', error)
    }

    // Get memory usage
    const memUsage = process.memoryUsage()

    // Decision outbox health (best effort)
    let decisionEventOutbox: null | {
      pending: number
      processing: number
      failed: number
      deadLetter: number
      sent: number
    } = null

    if (dbHealthy) {
      try {
        const [pending, processing, failed, deadLetter, sent] = await Promise.all([
          prisma.decisionEventOutbox.count({ where: { status: 'PENDING' } }),
          prisma.decisionEventOutbox.count({ where: { status: 'PROCESSING' } }),
          prisma.decisionEventOutbox.count({ where: { status: 'FAILED' } }),
          prisma.decisionEventOutbox.count({ where: { status: 'DEAD_LETTER' } }),
          prisma.decisionEventOutbox.count({ where: { status: 'SENT' } }),
        ])

        decisionEventOutbox = { pending, processing, failed, deadLetter, sent }
      } catch (error) {
        console.warn('Failed to gather decision outbox health:', error)
      }
    }

    // Overall health
    const isHealthy = dbHealthy && redisHealthy

    const totalTime = Date.now() - startTime

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: uptimeSeconds,
        formatted: `${uptimeHours}h ${Math.floor((uptimeMinutes % 60))}m ${Math.floor(uptime % 60)}s`
      },
      workers: workerStatus,
      dependencies: {
        database: {
          healthy: dbHealthy,
          latencyMs: dbLatency >= 0 ? dbLatency : null
        },
        redis: {
          healthy: redisHealthy,
          latencyMs: redisLatency >= 0 ? redisLatency : null
        }
      },
      cache: cacheStats ? {
        totalKeys: cacheStats.totalKeys,
        keyTypes: cacheStats.keyTypes,
        regionCount: Object.keys(cacheStats.regions).length,
        topRegions: Object.entries(cacheStats.regions)
          .sort(([, a], [, b]) => (b as number) - (a as number))
          .slice(0, 5)
          .map(([region, count]) => ({ region, count }))
      } : null,
      memory: {
        heapUsedMb: Math.round((memUsage.heapUsed as number) / 1024 / 1024),
        heapTotalMb: Math.round((memUsage.heapTotal as number) / 1024 / 1024),
        externalMb: Math.round(((memUsage.external as number) || 0) / 1024 / 1024),
        rssMb: Math.round((memUsage.rss as number) / 1024 / 1024)
      },
      performance: {
        statusCheckMs: totalTime
      },
      decisionEventOutbox,
    })
  } catch (error) {
    console.error('Error in system status endpoint:', error)
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * GET /api/v1/system/workers
 * Returns detailed worker status.
 */
router.get('/workers', (req: Request, res: Response) => {
  res.json({
    timestamp: new Date().toISOString(),
    workers: workerStatus,
    uptime: {
      seconds: Math.floor(process.uptime())
    }
  })
})

/**
 * GET /api/v1/system/cache
 * Returns cache statistics and health.
 */
router.get('/cache', async (req: Request, res: Response) => {
  try {
    const cacheStats = await GridSignalCache.getCacheStats()

    res.json({
      timestamp: new Date().toISOString(),
      cache: {
        totalKeys: cacheStats.totalKeys,
        keyTypes: cacheStats.keyTypes,
        regions: cacheStats.regions,
        regionCount: Object.keys(cacheStats.regions).length
      }
    })
  } catch (error) {
    console.error('Error getting cache stats:', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get cache statistics',
      timestamp: new Date().toISOString()
    })
  }
})

export default router
