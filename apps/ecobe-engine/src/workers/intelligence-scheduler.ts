import { Client } from '@upstash/qstash'

import { env } from '../config/env'
import { redis } from '../lib/redis'
import { recordIntegrationFailure, recordIntegrationSuccess } from '../lib/integration-metrics'
import { setWorkerStatus } from '../routes/system'

const JOB_CACHE_KEY = 'intelligence:qstash:schedules'
const JOB_METADATA_KEY = 'intelligence:qstash:schedules:meta'

interface IntelligenceJobDefinition {
  name: string
  cron: string
  path: string
}

const jobDefinitions: IntelligenceJobDefinition[] = [
  { name: 'intelligence-accuracy', cron: env.INTELLIGENCE_ACCURACY_CRON, path: '/api/v1/intelligence/jobs/accuracy' },
  {
    name: 'intelligence-vector-cleanup',
    cron: env.INTELLIGENCE_VECTOR_CLEANUP_CRON,
    path: '/api/v1/intelligence/jobs/vector-cleanup',
  },
  {
    name: 'intelligence-model-calibration',
    cron: env.INTELLIGENCE_CALIBRATION_CRON,
    path: '/api/v1/intelligence/jobs/model-calibration',
  },
]

const qstashClient = env.QSTASH_TOKEN
  ? new Client({ token: env.QSTASH_TOKEN, baseUrl: env.QSTASH_BASE_URL })
  : null

const resolvedQstashBase = env.QSTASH_BASE_URL ?? 'https://qstash.upstash.io'

function buildDestination(path: string) {
  if (!env.ECOBE_ENGINE_URL) return null
  const base = env.ECOBE_ENGINE_URL.replace(/\/$/, '')
  return `${base}${path}`
}

async function publishSchedule(job: IntelligenceJobDefinition, destination: string) {
  if (!qstashClient) {
    throw new Error('QStash client not configured')
  }

  const started = Date.now()
  try {
    await qstashClient.publishJSON({
      url: destination,
      body: { job: job.name },
      cron: job.cron,
      deduplicationId: `intelligence-${job.name}`,
    })
    await recordIntegrationSuccess('QSTASH', { statusCode: 200, latencyMs: Date.now() - started })
  } catch (error: any) {
    const duration = Date.now() - started
    await recordIntegrationFailure('QSTASH', error?.message ?? 'Scheduling failed', {
      latencyMs: duration,
    })
    throw error
  }
}

export async function scheduleIntelligenceJobs() {
  if (!env.QSTASH_TOKEN || !env.ECOBE_ENGINE_URL) {
    console.warn('Skipping intelligence job scheduling; QStash token or ECOBE_ENGINE_URL missing')
    setWorkerStatus('intelligenceJobs', {
      running: false,
      lastRun: new Date().toISOString(),
      nextRun: null
    })
    return
  }

  const startTime = new Date()
  console.log(
    'QStash scheduling check',
    JSON.stringify({
      baseUrl: resolvedQstashBase,
      jobs: jobDefinitions.length,
    })
  )

  let scheduledCount = 0
  for (const job of jobDefinitions) {
    const destination = buildDestination(job.path)
    if (!destination) continue

    const signature = `${job.cron}|${destination}`
    const cached = await redis.hget(JOB_CACHE_KEY, job.name)
    if (cached === signature) {
      continue
    }

    try {
      await publishSchedule(job, destination)
      await redis
        .multi()
        .hset(JOB_CACHE_KEY, job.name, signature)
        .hset(
          JOB_METADATA_KEY,
          job.name,
          JSON.stringify({
            job: job.name,
            cron: job.cron,
            destination,
            qstashBaseUrl: resolvedQstashBase,
            lastScheduledAt: new Date().toISOString(),
          })
        )
        .exec()
      console.log(`✅ Scheduled ${job.name} via QStash (${job.cron})`)
      scheduledCount++
    } catch (error) {
      console.error(`❌ Failed to schedule ${job.name}`, error)
    }
  }

  // Update worker status
  setWorkerStatus('intelligenceJobs', {
    running: true,
    lastRun: startTime.toISOString(),
    nextRun: null
  })
}

export async function getScheduledIntelligenceJobs() {
  const entries = await redis.hgetall(JOB_METADATA_KEY)
  return Object.values(entries ?? {})
    .map((value) => {
      try {
        return JSON.parse(value) as {
          job: string
          cron: string
          destination: string
          qstashBaseUrl: string
          lastScheduledAt: string
        }
      } catch {
        return null
      }
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((a, b) => new Date(b.lastScheduledAt).getTime() - new Date(a.lastScheduledAt).getTime())
}
