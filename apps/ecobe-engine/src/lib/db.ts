import { PrismaClient } from '@prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate'
import { withOptimize } from '@prisma/extension-optimize'
import { env } from '../config/env'

/**
 * Ensure Neon pooler URLs have pgbouncer=true for Prisma compatibility.
 * Neon's pooler uses PgBouncer under the hood; without this flag Prisma's
 * prepared-statement protocol conflicts with PgBouncer's transaction mode,
 * causing "Connection Closed" errors on idle connections.
 */
function ensureNeonPoolerParams(url: string): string {
  if (!url.includes('pooler') && !url.includes('pgbouncer')) return url
  try {
    const parsed = new URL(url)
    if (!parsed.searchParams.has('pgbouncer')) {
      parsed.searchParams.set('pgbouncer', 'true')
    }
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', '5')
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '20')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Prisma Client Factory — Accelerate + Optimize
 *
 * Extension chain order matters (Prisma docs):
 *   1. Optimize (query monitoring / insights)  — applied first
 *   2. Accelerate (connection pooling + cache)  — applied last (takes precedence)
 *
 * Runtime queries flow through Accelerate's global pool via prisma:// URL.
 * Migrations / introspection use DIRECT_DATABASE_URL via prisma.config.ts.
 */
const createPrismaClient = () => {
  const dbUrl = ensureNeonPoolerParams(env.DATABASE_URL)

  const baseClient = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: dbUrl,
      },
    },
  })

  // Build the extension chain: Optimize → Accelerate
  // Both are optional — the engine boots cleanly without either.
  let client: any = baseClient

  // 1. Optimize (query monitoring) — only when API key is present
  if (env.OPTIMIZE_API_KEY) {
    client = client.$extends(
      withOptimize({
        apiKey: env.OPTIMIZE_API_KEY,
      })
    )
  }

  // 2. Accelerate (connection pooling + global cache) — only when using prisma:// or prisma+postgres:// URL
  if (env.DATABASE_URL.startsWith('prisma://') || env.DATABASE_URL.startsWith('prisma+postgres://')) {
    client = client.$extends(withAccelerate())
  }

  return client
}

type PrismaClientWithExtensions = ReturnType<typeof createPrismaClient>

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientWithExtensions | undefined
}

export const prisma: PrismaClientWithExtensions = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
