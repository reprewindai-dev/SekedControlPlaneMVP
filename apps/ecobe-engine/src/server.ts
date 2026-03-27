import type { Server } from 'http'

import { env } from './config/env'
import { createApp } from './app'
import { prisma } from './lib/db'
import { assertSchemaReadiness } from './lib/db/schema-readiness'
import { redis } from './lib/redis'
import { warmCacheOnStartup } from './lib/cache-warmer'
import { startEIAIngestionWorker } from './workers/eia-ingestion'
import { startForecastVerificationWorker } from './workers/forecast-verification'
import { startForecastWorker } from './workers/forecast-poller'
import { scheduleIntelligenceJobs } from './workers/intelligence-scheduler'
import { startLearningLoopWorker } from './workers/learning-loop'
import { stopLearningLoopWorker } from './workers/learning-loop'
import { startRuntimeSupervisor, stopRuntimeSupervisor } from './workers/runtime-supervisor'
import { startDecisionEventDispatcherWorker, stopDecisionEventDispatcherWorker } from './workers/decision-event-dispatcher'
import { recoverWaterArtifactsFromLastKnownGood, validateWaterArtifacts } from './lib/water/bundle'

const app = createApp()
let server: Server | null = null
let isShuttingDown = false

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`\n${signal} received. Starting graceful shutdown...`)

  const shutdownTimer = setTimeout(() => {
    console.error('Shutdown timed out after 15s. Forcing exit.')
    process.exit(1)
  }, 15000)
  shutdownTimer.unref()

  try {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => {
          console.log('HTTP server closed')
          resolve()
        })
      })
    }

    console.log('Disconnecting from database...')
    await prisma.$disconnect()

    stopRuntimeSupervisor()
    stopLearningLoopWorker()
    stopDecisionEventDispatcherWorker()

    console.log('Closing Redis connection...')
    await redis.quit().catch(() => undefined)

    clearTimeout(shutdownTimer)
    console.log('Graceful shutdown complete.')
    process.exit(0)
  } catch (error) {
    clearTimeout(shutdownTimer)
    console.error('Error during shutdown:', error)
    process.exit(1)
  }
}

function startBackgroundWorkers() {
  if (!env.ENGINE_BACKGROUND_WORKERS_ENABLED) {
    console.log('  Background workers: disabled')
    return
  }

  console.log('  Background workers: enabled')

  try {
    startForecastWorker()
  } catch (error) {
    console.error('Forecast poller worker failed to start:', error)
  }

  startEIAIngestionWorker().catch((error) => {
    console.error('EIA ingestion worker failed to start:', error)
  })

  scheduleIntelligenceJobs().catch((error) => {
    console.error('Intelligence job scheduling failed to start:', error)
  })

  try {
    startForecastVerificationWorker()
  } catch (error) {
    console.error('Forecast verification worker failed to start:', error)
  }

  warmCacheOnStartup().catch((error) => {
    console.error('Cache warming failed:', error)
  })

  try {
    startLearningLoopWorker()
  } catch (error) {
    console.error('Learning loop worker failed to start:', error)
  }

  try {
    startRuntimeSupervisor()
  } catch (error) {
    console.error('Runtime supervisor failed to start:', error)
  }

  try {
    startDecisionEventDispatcherWorker()
  } catch (error) {
    console.error('Decision event dispatcher failed to start:', error)
  }
}

async function start() {
  try {
    let waterArtifacts = validateWaterArtifacts()
    if (!waterArtifacts.healthy) {
      console.error('Water artifact health check failed at startup:', waterArtifacts)
      const recovery = recoverWaterArtifactsFromLastKnownGood()
      if (recovery.recovered) {
        console.warn('Recovered water artifacts from last-known-good snapshot at startup')
        waterArtifacts = validateWaterArtifacts()
      }
      if (env.NODE_ENV === 'production') {
        if (!waterArtifacts.healthy) {
          process.exit(1)
        }
      }
    }

    await prisma.$connect()
    console.log('Database connected')

    await assertSchemaReadiness()
    console.log('Schema readiness gate passed')

    try {
      await redis.ping()
      console.log('Redis connected')
    } catch (error) {
      console.error('Redis error:', error)
      console.warn('Redis unavailable at startup; continuing without Redis')
    }

    server = app.listen(env.PORT, () => {
      console.log(`ECOBE Engine running on port ${env.PORT}`)
      console.log(`  Environment: ${env.NODE_ENV}`)
      console.log(`  Health: http://localhost:${env.PORT}/health`)
      console.log(`  Internal Health: http://localhost:${env.PORT}/internal/v1/health`)
      console.log(`  Routing API: http://localhost:${env.PORT}/internal/v1/routing-decisions`)

      startBackgroundWorkers()
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
  void gracefulShutdown('uncaughtException')
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})

start()
