import { env } from '../config/env'
import { prisma } from '../lib/db'
import { redis } from '../lib/redis'
import { recoverWaterArtifactsFromLastKnownGood, validateWaterArtifacts } from '../lib/water/bundle'
import { getWorkerStatus, setWorkerStatus } from '../routes/system'
import { runForecastRefresh } from './forecast-poller'
import { refreshRegionReliabilityModel } from './learning-loop'
import { scheduleIntelligenceJobs } from './intelligence-scheduler'
import { runDecisionEventDispatchCycle } from './decision-event-dispatcher'

let supervisorTimer: NodeJS.Timeout | null = null
let running = false

function parseIso(iso: string | null): number | null {
  if (!iso) return null
  const ts = new Date(iso).getTime()
  return Number.isFinite(ts) ? ts : null
}

function isWorkerStale(lastRun: string | null, staleMinutes: number): boolean {
  const ts = parseIso(lastRun)
  if (!ts) return true
  return Date.now() - ts > staleMinutes * 60 * 1000
}

async function runSupervisorCycle() {
  if (running) return
  running = true

  const startedAt = new Date()
  const intervalMs = Math.max(10, env.RUNTIME_SUPERVISOR_INTERVAL_SEC) * 1000

  try {
    const workerStatus = getWorkerStatus()

    try {
      await prisma.$queryRaw`SELECT 1`
    } catch (error) {
      console.error('Runtime supervisor: database ping failed', error)
    }

    try {
      await redis.ping()
    } catch (error) {
      console.error('Runtime supervisor: redis ping failed', error)
    }

    const artifactHealth = validateWaterArtifacts()
    if (!artifactHealth.healthy) {
      const recovery = recoverWaterArtifactsFromLastKnownGood()
      if (recovery.recovered) {
        console.warn('Runtime supervisor recovered water artifacts from last-known-good snapshot')
      } else {
        console.error('Runtime supervisor could not recover water artifacts:', recovery.reason)
      }
    }

    if (
      env.FORECAST_REFRESH_ENABLED &&
      isWorkerStale(workerStatus.forecastPoller?.lastRun ?? null, env.SUPERVISOR_FORECAST_STALE_MIN)
    ) {
      console.warn('Runtime supervisor detected stale forecast worker, forcing refresh run')
      await runForecastRefresh()
    }

    if (
      isWorkerStale(
        workerStatus.intelligenceJobs?.lastRun ?? null,
        env.SUPERVISOR_INTELLIGENCE_STALE_MIN
      )
    ) {
      console.warn('Runtime supervisor detected stale intelligence scheduler, re-running schedule sync')
      await scheduleIntelligenceJobs()
    }

    if (
      env.LEARNING_LOOP_ENABLED &&
      isWorkerStale(workerStatus.learningLoop?.lastRun ?? null, env.SUPERVISOR_LEARNING_STALE_MIN)
    ) {
      console.warn('Runtime supervisor detected stale learning loop, forcing refresh run')
      await refreshRegionReliabilityModel()
    }

    if (
      env.DECISION_EVENT_DISPATCH_ENABLED &&
      isWorkerStale(
        workerStatus.decisionEventDispatcher?.lastRun ?? null,
        env.SUPERVISOR_DECISION_EVENT_STALE_MIN
      )
    ) {
      console.warn('Runtime supervisor detected stale decision event dispatcher, forcing cycle')
      await runDecisionEventDispatchCycle()
    }

    setWorkerStatus('runtimeSupervisor', {
      running: true,
      lastRun: startedAt.toISOString(),
      nextRun: new Date(Date.now() + intervalMs).toISOString(),
    })
  } catch (error) {
    console.error('Runtime supervisor cycle failed:', error)
    setWorkerStatus('runtimeSupervisor', {
      running: false,
      lastRun: startedAt.toISOString(),
      nextRun: new Date(Date.now() + intervalMs).toISOString(),
    })
  } finally {
    running = false
  }
}

export function startRuntimeSupervisor() {
  if (!env.RUNTIME_SUPERVISOR_ENABLED) {
    console.log('Runtime supervisor disabled')
    return
  }

  if (supervisorTimer) return

  const intervalMs = Math.max(10, env.RUNTIME_SUPERVISOR_INTERVAL_SEC) * 1000
  console.log(`Runtime supervisor started (every ${Math.round(intervalMs / 1000)}s)`)

  setWorkerStatus('runtimeSupervisor', {
    running: true,
    lastRun: null,
    nextRun: new Date(Date.now() + intervalMs).toISOString(),
  })

  void runSupervisorCycle()
  supervisorTimer = setInterval(() => {
    void runSupervisorCycle()
  }, intervalMs)
}

export function stopRuntimeSupervisor() {
  if (supervisorTimer) {
    clearInterval(supervisorTimer)
    supervisorTimer = null
  }
  setWorkerStatus('runtimeSupervisor', {
    running: false,
    nextRun: null,
  })
}
