import { subHours } from 'date-fns'
import { prisma } from './db'
import { redis } from './redis'
import {
  DEFAULT_FORECAST_LOOKBACK_HOURS,
  FORECAST_REFRESH_STATE_KEY,
} from '../constants/forecasting'

export type ForecastRefreshState = {
  timestamp: Date
  totalRegions: number
  totalRecords: number
  totalForecasts: number
  status: 'SUCCESS' | 'FAILURE'
  message?: string | null
}

export type ForecastRefreshSummary = {
  runCount: number
  successCount: number
  failureCount: number
  totalRecords: number
  totalForecasts: number
  lastRunAt: Date | null
  lastStatus: 'SUCCESS' | 'FAILURE' | null
  lastMessage: string | null
}

export async function getLastForecastRefreshState(): Promise<ForecastRefreshState | null> {
  const hash = await redis.hgetall(FORECAST_REFRESH_STATE_KEY)
  if (!hash || Object.keys(hash).length === 0) {
    return null
  }

  const timestamp = hash.timestamp ? new Date(hash.timestamp) : new Date(0)
  return {
    timestamp,
    totalRegions: Number(hash.totalRegions ?? 0),
    totalRecords: Number(hash.totalRecords ?? 0),
    totalForecasts: Number(hash.totalForecasts ?? 0),
    status: (hash.status as 'SUCCESS' | 'FAILURE') ?? 'FAILURE',
    message: hash.message ?? null,
  }
}

export async function getForecastRefreshSummary(
  windowHours: number = DEFAULT_FORECAST_LOOKBACK_HOURS
): Promise<ForecastRefreshSummary> {
  const since = subHours(new Date(), windowHours)
  const runs = await prisma.forecastRefresh.findMany({
    where: { refreshedAt: { gte: since } },
    orderBy: { refreshedAt: 'desc' },
    take: 500,
  })

  if (runs.length === 0) {
    return {
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      totalRecords: 0,
      totalForecasts: 0,
      lastRunAt: null,
      lastStatus: null,
      lastMessage: null,
    }
  }

  const runCount = runs.length
  const successCount = runs.filter((r: any) => r.status === 'SUCCESS').length
  const failureCount = runCount - successCount
  const totalRecords = runs.reduce((sum: number, r: any) => sum + r.recordsIngested, 0)
  const totalForecasts = runs.reduce((sum: number, r: any) => sum + r.forecastsGenerated, 0)
  const lastRun = runs[0]

  return {
    runCount,
    successCount,
    failureCount,
    totalRecords,
    totalForecasts,
    lastRunAt: lastRun?.refreshedAt ?? null,
    lastStatus: (lastRun?.status as 'SUCCESS' | 'FAILURE') ?? null,
    lastMessage: lastRun?.message ?? null,
  }
}
