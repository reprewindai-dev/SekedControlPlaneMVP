import { prisma } from './db'

export type IntegrationSource =
  | 'ELECTRICITY_MAPS'
  | 'WATTTIME'
  | 'EMBER'
  | 'EIA_930'
  | 'GRIDSTATUS'
  | 'OPENAI'
  | 'UPSTASH_VECTOR'
  | 'DEKES_API'
  | 'QSTASH'
  | (string & Record<string, never>)

type IntegrationDetails = {
  latencyMs?: number
  statusCode?: number
  errorCode?: string
  message?: string
}

async function logIntegrationEvent(source: IntegrationSource, success: boolean, details: IntegrationDetails = {}) {
  await prisma.integrationEvent.create({
    data: {
      source,
      success,
      durationMs: details.latencyMs ?? null,
      statusCode: details.statusCode ?? null,
      errorCode: details.errorCode,
      message: details.message,
    },
  })
}

export async function recordIntegrationSuccess(source: IntegrationSource, details: IntegrationDetails = {}) {
  const latencyIncrement = details.latencyMs ?? 0

  await prisma.integrationMetric.upsert({
    where: { source },
    update: {
      successCount: { increment: 1 },
      lastSuccessAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      lastErrorCode: null,
      lastLatencyMs: details.latencyMs ?? null,
      totalLatencyMs: { increment: latencyIncrement },
      latencySamples: latencyIncrement > 0 ? { increment: 1 } : undefined,
      alertActive: false,
      alertMessage: null,
    },
    create: {
      source,
      successCount: 1,
      lastSuccessAt: new Date(),
      lastLatencyMs: details.latencyMs ?? null,
      totalLatencyMs: latencyIncrement,
      latencySamples: latencyIncrement > 0 ? 1 : 0,
    },
  })

  await logIntegrationEvent(source, true, details)
  await updateLatencyP95(source)
}

export async function recordIntegrationFailure(source: IntegrationSource, error?: string, details: IntegrationDetails = {}) {
  const payload = error?.slice(0, 500) ?? null

  await prisma.integrationMetric.upsert({
    where: { source },
    update: {
      failureCount: { increment: 1 },
      lastFailureAt: new Date(),
      lastError: payload,
      lastErrorCode: details.errorCode ?? null,
      lastErrorAt: new Date(),
      alertActive: true,
      alertMessage: payload,
    },
    create: {
      source,
      failureCount: 1,
      lastFailureAt: new Date(),
      lastError: payload,
      lastErrorCode: details.errorCode ?? null,
      lastErrorAt: new Date(),
      alertActive: true,
      alertMessage: payload,
    },
  })

  await logIntegrationEvent(source, false, { ...details, message: payload ?? undefined })
  await updateLatencyP95(source)
}

async function updateLatencyP95(source: IntegrationSource) {
  const samples = await prisma.integrationEvent.findMany({
    where: {
      source,
      durationMs: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { durationMs: true },
  })

  if (samples.length === 0) {
    await prisma.integrationMetric.updateMany({
      where: { source },
      data: { latencyP95Ms: null },
    })
    return
  }

  const sorted = samples
    .map((sample: any) => sample.durationMs ?? 0)
    .sort((a: number, b: number) => a - b)
  const index = Math.floor(0.95 * (sorted.length - 1))
  const value = sorted[index]

  await prisma.integrationMetric.updateMany({
    where: { source },
    data: { latencyP95Ms: Number(value.toFixed(2)) },
  })
}

export async function getIntegrationMetric(source: IntegrationSource) {
  return prisma.integrationMetric.findUnique({ where: { source } })
}

export function computeIntegrationSuccessRate(metric?: { successCount: number; failureCount: number }) {
  if (!metric) return null
  const total = metric.successCount + metric.failureCount
  if (total === 0) return null
  return metric.successCount / total
}

export async function getIntegrationSuccessRate(source: IntegrationSource) {
  const metric = await getIntegrationMetric(source)
  return computeIntegrationSuccessRate(metric ?? undefined)
}

export async function getIntegrationMetricsSummary() {
  return prisma.integrationMetric.findMany({ orderBy: { source: 'asc' }, take: 100 })
}
