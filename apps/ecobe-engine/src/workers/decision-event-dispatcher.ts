import cron, { type ScheduledTask } from 'node-cron'

import { env } from '../config/env'
import { processDecisionEventOutboxBatch } from '../lib/ci/decision-events'
import { setWorkerStatus } from '../routes/system'

let dispatchTask: ScheduledTask | null = null
let running = false

export async function runDecisionEventDispatchCycle() {
  if (running) return
  running = true
  const startedAt = new Date()

  try {
    const result = await processDecisionEventOutboxBatch()
    setWorkerStatus('decisionEventDispatcher', {
      running: true,
      lastRun: startedAt.toISOString(),
      nextRun: null,
    })
    if (result.processed > 0) {
      console.log('Decision event dispatcher cycle:', result)
    }
  } catch (error) {
    console.error('Decision event dispatcher cycle failed:', error)
    setWorkerStatus('decisionEventDispatcher', {
      running: false,
      lastRun: startedAt.toISOString(),
      nextRun: null,
    })
  } finally {
    running = false
  }
}

export function startDecisionEventDispatcherWorker() {
  if (!env.DECISION_EVENT_DISPATCH_ENABLED) {
    console.log('Decision event dispatcher disabled')
    setWorkerStatus('decisionEventDispatcher', {
      running: false,
      lastRun: null,
      nextRun: null,
    })
    return
  }

  if (dispatchTask) return

  setWorkerStatus('decisionEventDispatcher', {
    running: true,
    lastRun: null,
    nextRun: null,
  })

  dispatchTask = cron.schedule(env.DECISION_EVENT_DISPATCH_CRON, () => {
    runDecisionEventDispatchCycle().catch((error) => {
      console.error('Decision event dispatch cron failed:', error)
    })
  })

  runDecisionEventDispatchCycle().catch((error) => {
    console.error('Decision event dispatch initial run failed:', error)
  })

  console.log(`Decision event dispatcher scheduled (${env.DECISION_EVENT_DISPATCH_CRON})`)
}

export function stopDecisionEventDispatcherWorker() {
  if (dispatchTask) {
    dispatchTask.stop()
    dispatchTask = null
  }

  setWorkerStatus('decisionEventDispatcher', {
    running: false,
  })
}

