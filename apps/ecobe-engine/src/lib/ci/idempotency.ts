import { env } from '../../config/env'
import { redis } from '../redis'

const MEMORY_PREFIX = 'ecobe:idempotency:'
const memoryStore = new Map<string, { expiresAt: number; payload: string }>()

function memoryKey(key: string) {
  return `${MEMORY_PREFIX}${key}`
}

function purgeExpiredMemoryEntries() {
  const now = Date.now()
  for (const [key, value] of memoryStore.entries()) {
    if (value.expiresAt <= now) {
      memoryStore.delete(key)
    }
  }
}

export function buildIdempotencyCacheKey(input: {
  namespace: string
  callerId?: string | null
  idempotencyKey: string
}) {
  const caller = input.callerId?.trim() || 'anonymous'
  return `${input.namespace}:${caller}:${input.idempotencyKey.trim()}`
}

export async function readIdempotentResponse<T>(key: string) {
  purgeExpiredMemoryEntries()

  try {
    const cached = await redis.get(memoryKey(key))
    if (cached) return JSON.parse(cached) as T
  } catch {
    const cached = memoryStore.get(memoryKey(key))
    if (cached && cached.expiresAt > Date.now()) {
      return JSON.parse(cached.payload) as T
    }
  }

  const cached = memoryStore.get(memoryKey(key))
  if (cached && cached.expiresAt > Date.now()) {
    return JSON.parse(cached.payload) as T
  }

  return null
}

export async function writeIdempotentResponse(key: string, payload: unknown, ttlSec = env.DECISION_API_IDEMPOTENCY_TTL_SEC) {
  const serialized = JSON.stringify(payload)
  const expiresAt = Date.now() + ttlSec * 1000
  memoryStore.set(memoryKey(key), { expiresAt, payload: serialized })

  try {
    await redis.set(memoryKey(key), serialized, 'EX', ttlSec)
  } catch {
    // Memory fallback already captured above.
  }
}
