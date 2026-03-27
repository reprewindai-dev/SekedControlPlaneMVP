import { redis } from '../../lib/redis'

const JOB_STATUS_KEY = 'intelligence:job-status'

export interface IntelligenceJobStatus {
  job: string
  lastRunAt: string
  success: boolean
  durationMs: number
  details?: Record<string, unknown>
  error?: string | null
}

export async function recordJobStatus(job: string, status: Omit<IntelligenceJobStatus, 'job'>) {
  const payload: IntelligenceJobStatus = { job, ...status }
  await redis.hset(JOB_STATUS_KEY, { [job]: JSON.stringify(payload) })
}

export async function getJobStatuses(): Promise<IntelligenceJobStatus[]> {
  const entries = await redis.hgetall(JOB_STATUS_KEY)
  return Object.values(entries ?? {})
    .map((value) => {
      try {
        return JSON.parse(value) as IntelligenceJobStatus
      } catch {
        return null
      }
    })
    .filter((value): value is IntelligenceJobStatus => Boolean(value))
    .sort((a, b) => new Date(b.lastRunAt).getTime() - new Date(a.lastRunAt).getTime())
}
