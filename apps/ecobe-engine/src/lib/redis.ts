import Redis from 'ioredis'

import { env } from '../config/env'

function normalizeRedisUrl(url: string): string {
  const trimmed = url.trim()

  if (trimmed.startsWith('//')) {
    return `rediss:${trimmed}`
  }

  if (!/^rediss?:\/\//i.test(trimmed)) {
    return `rediss://${trimmed.replace(/^\/+/, '')}`
  }

  return trimmed
}

function createDisabledRedisClient() {
  const disabledError = new Error('Redis disabled')

  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'ping') {
          return async () => {
            throw disabledError
          }
        }

        if (prop === 'quit' || prop === 'disconnect') {
          return async () => undefined
        }

        if (prop === 'on' || prop === 'once') {
          return () => undefined
        }

        return async () => null
      },
    }
  ) as Redis
}

const redisDisabled = ['disabled', 'off', 'none', 'false'].includes(env.REDIS_URL.trim().toLowerCase())

export const redis = redisDisabled
  ? createDisabledRedisClient()
  : new Redis(normalizeRedisUrl(env.REDIS_URL), {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 50, 2000)
      },
    })

if (!redisDisabled) {
  redis.on('error', (err) => {
    console.error('Redis error:', err)
  })

  redis.on('connect', () => {
    console.log('Redis connected')
  })
}
