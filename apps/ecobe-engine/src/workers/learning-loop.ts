import cron, { type ScheduledTask } from 'node-cron'

import { env } from '../config/env'
import { prisma } from '../lib/db'
import {
  computeRegionReliabilityMultiplier,
  persistRegionReliabilityMultipliers,
} from '../lib/learning/region-reliability'
import { setWorkerStatus } from '../routes/system'

let learningTask: ScheduledTask | null = null
let running = false

export async function refreshRegionReliabilityModel(): Promise<void> {
  if (running) return
  running = true

  const runStart = new Date()

  try {
    const lookbackHours = Math.max(24, env.LEARNING_LOOKBACK_HOURS)
    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000)

    const decisions = await prisma.cIDecision.findMany({
      where: {
        createdAt: { gte: since },
      },
      select: {
        selectedRegion: true,
        decisionAction: true,
        fallbackUsed: true,
        savings: true,
        signalConfidence: true,
      },
    })

    const byRegion = new Map<
      string,
      {
        total: number
        denies: number
        fallbacks: number
        savingsSum: number
        confidenceSum: number
      }
    >()

    for (const decision of decisions) {
      const region = decision.selectedRegion || 'unknown'
      const current = byRegion.get(region) ?? {
        total: 0,
        denies: 0,
        fallbacks: 0,
        savingsSum: 0,
        confidenceSum: 0,
      }

      current.total += 1
      if ((decision.decisionAction ?? '').toLowerCase() === 'deny') current.denies += 1
      if (decision.fallbackUsed) current.fallbacks += 1
      current.savingsSum += Number.isFinite(decision.savings) ? decision.savings : 0
      current.confidenceSum += Number.isFinite(decision.signalConfidence ?? NaN)
        ? Number(decision.signalConfidence)
        : 0

      byRegion.set(region, current)
    }

    const scores: Record<string, number> = {}
    for (const [region, aggregate] of byRegion.entries()) {
      if (aggregate.total < 5) {
        scores[region] = 1
        continue
      }

      scores[region] = computeRegionReliabilityMultiplier({
        total: aggregate.total,
        denyRate: aggregate.denies / aggregate.total,
        fallbackRate: aggregate.fallbacks / aggregate.total,
        avgSavingsPct: aggregate.savingsSum / aggregate.total,
        avgSignalConfidence: aggregate.confidenceSum / aggregate.total,
      })
    }

    await persistRegionReliabilityMultipliers(scores, {
      updatedAt: new Date().toISOString(),
      lookbackHours: String(lookbackHours),
      decisionCount: String(decisions.length),
      regionCount: String(Object.keys(scores).length),
      modelVersion: 'region_reliability_v1',
    })

    setWorkerStatus('learningLoop', {
      running: true,
      lastRun: runStart.toISOString(),
      nextRun: null,
    })
  } catch (error) {
    console.error('Region reliability learning refresh failed:', error)
    setWorkerStatus('learningLoop', {
      running: false,
      lastRun: runStart.toISOString(),
      nextRun: null,
    })
  } finally {
    running = false
  }
}

export function startLearningLoopWorker() {
  if (!env.LEARNING_LOOP_ENABLED) {
    console.log('Learning loop worker disabled')
    setWorkerStatus('learningLoop', {
      running: false,
      lastRun: null,
      nextRun: null,
    })
    return
  }

  if (learningTask) return

  setWorkerStatus('learningLoop', {
    running: true,
    lastRun: null,
    nextRun: null,
  })

  learningTask = cron.schedule(env.LEARNING_LOOP_CRON, () => {
    refreshRegionReliabilityModel().catch((error) => {
      console.error('Learning loop cron run failed:', error)
    })
  })

  refreshRegionReliabilityModel().catch((error) => {
    console.error('Learning loop initial run failed:', error)
  })

  console.log(`Learning loop worker scheduled (${env.LEARNING_LOOP_CRON})`)
}

export function stopLearningLoopWorker() {
  if (learningTask) {
    learningTask.stop()
    learningTask = null
  }
  setWorkerStatus('learningLoop', {
    running: false,
  })
}
