import { env } from '../../config/env'
import { prisma } from '../db'

const REQUIRED_TABLES = [
  'CIDecision',
  'IntegrationWebhookSink',
  'DecisionEventOutbox',
] as const

const REQUIRED_ENUMS = [
  'IntegrationWebhookSinkStatus',
  'DecisionEventOutboxStatus',
] as const

const REQUIRED_CI_COLUMNS = [
  'decisionAction',
  'reasonCode',
  'signalConfidence',
  'fallbackUsed',
  'waterImpactLiters',
  'waterBaselineLiters',
  'waterScarcityImpact',
  'waterStressIndex',
  'waterConfidence',
  'policyTrace',
  'datasetVersions',
] as const

const REQUIRED_MIGRATIONS = [
  '20260324193000_add_water_control_plane',
  '20260324211500_add_decision_event_outbox',
] as const

type ExistsRow = { exists: boolean }
type ColumnRow = { column_name: string }
type MigrationRow = { migration_name: string; finished_at: Date | null }
type SchemaRow = { schema_name: string | null }

let cachedSchemaName: string | null = null

async function currentSchemaName() {
  if (cachedSchemaName) {
    return cachedSchemaName
  }

  const rows = (await prisma.$queryRawUnsafe(
    'SELECT current_schema() AS schema_name'
  )) as SchemaRow[]

  cachedSchemaName = rows[0]?.schema_name ?? 'public'
  return cachedSchemaName
}

async function tableExists(tableName: string) {
  const schemaName = await currentSchemaName()
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT to_regclass('${schemaName}."${tableName}"') IS NOT NULL AS "exists"`
  )) as ExistsRow[]
  return Boolean(rows[0]?.exists)
}

async function enumExists(enumName: string) {
  const schemaName = await currentSchemaName()
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = '${schemaName}' AND t.typname = '${enumName}'
    ) AS "exists"`
  )) as ExistsRow[]
  return Boolean(rows[0]?.exists)
}

async function prismaMigrationTableExists() {
  const schemaName = await currentSchemaName()
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT to_regclass('${schemaName}."_prisma_migrations"') IS NOT NULL AS "exists"`
  )) as ExistsRow[]
  return Boolean(rows[0]?.exists)
}

export async function assertSchemaReadiness() {
  const failures: string[] = []
  const schemaName = await currentSchemaName()

  for (const table of REQUIRED_TABLES) {
    if (!(await tableExists(table))) {
      failures.push(`Missing required table: ${table}`)
    }
  }

  for (const enumName of REQUIRED_ENUMS) {
    if (!(await enumExists(enumName))) {
      failures.push(`Missing required enum: ${enumName}`)
    }
  }

  if (await tableExists('CIDecision')) {
    const columnRows = (await prisma.$queryRawUnsafe(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = '${schemaName}'
         AND table_name = 'CIDecision'`
    )) as ColumnRow[]
    const columns = new Set(columnRows.map((row: ColumnRow) => row.column_name))
    for (const requiredColumn of REQUIRED_CI_COLUMNS) {
      if (!columns.has(requiredColumn)) {
        failures.push(`Missing CIDecision column: ${requiredColumn}`)
      }
    }
  }

  const hasMigrationTable = await prismaMigrationTableExists()

  if (!hasMigrationTable) {
    if (env.NODE_ENV === 'production') {
      failures.push(`Missing Prisma migration history table in schema ${schemaName}: _prisma_migrations`)
    }
  } else {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at FROM "${schemaName}"."_prisma_migrations"`
    )) as MigrationRow[]
    const finishedMigrations = new Map(
      rows.map((row: MigrationRow) => [row.migration_name, row.finished_at])
    )
    for (const migration of REQUIRED_MIGRATIONS) {
      const finishedAt = finishedMigrations.get(migration)
      if (!finishedAt) {
        failures.push(`Missing or unfinished required migration: ${migration}`)
      }
    }
  }

  if (failures.length > 0) {
    const message = [
      'Schema readiness gate failed.',
      ...failures.map((failure) => `- ${failure}`),
    ].join('\n')
    throw new Error(message)
  }
}
