import 'dotenv/config'
import { defineConfig } from '@prisma/config'

/**
 * Prisma Config — Accelerate-aware
 *
 * Runtime:    DATABASE_URL (prisma://accelerate...) → connection pooling + cache
 * Migrations: DIRECT_DATABASE_URL (postgresql://...) → direct Neon connection
 *
 * If DIRECT_DATABASE_URL is not set, falls back to DATABASE_URL
 * (which works fine when DATABASE_URL is a direct postgres:// string).
 */
export default defineConfig({
  datasource: {
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '',
  },
})
