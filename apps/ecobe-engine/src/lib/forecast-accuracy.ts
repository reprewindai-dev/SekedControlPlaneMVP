/**
 * Forecast Accuracy Tracking
 *
 * Compares stored forecasts against realized carbon intensity values.
 * Measures variance to validate 12% accuracy target.
 */

import { prisma } from './db'
import { providerRouter } from './carbon/provider-router'

export interface ForecastAccuracyResult {
  region: string
  forecastId: string
  forecastTime: string
  predictedIntensity: number
  realizedIntensity: number
  variancePct: number
  absoluteError: number
  withinTarget: boolean // <= 12% variance
}

export interface AccuracyMetrics {
  totalVerified: number
  withinTargetCount: number
  withinTargetPct: number
  avgVariancePct: number
  medianVariancePct: number
  p95VariancePct: number
  byRegion: Record<string, { count: number; avgVariance: number; withinTarget: number }>
}

/**
 * Compare stored forecasts against realized intensity values.
 * Called by the accuracy verification worker.
 */
export async function verifyForecasts(lookbackHours: number = 6): Promise<ForecastAccuracyResult[]> {
  const cutoff = new Date(Date.now() - lookbackHours * 3600000)
  const now = new Date()

  // Find forecasts whose forecastTime has passed (so we can compare with reality)
  // Only check forecasts we haven't verified yet
  const pendingForecasts = await prisma.carbonForecast.findMany({
    where: {
      forecastTime: { gte: cutoff, lte: now },
    },
    take: 200,
    orderBy: { forecastTime: 'asc' },
  })

  if (pendingForecasts.length === 0) return []

  const results: ForecastAccuracyResult[] = []

  for (const forecast of pendingForecasts) {
    try {
      // Get the realized intensity for this region at the forecast time
      const realized = await getRealizedIntensity(forecast.region, forecast.forecastTime)

      if (realized === null) continue

      const predicted = forecast.predictedIntensity
      const absoluteError = Math.abs(predicted - realized)
      const variancePct = realized > 0 ? (absoluteError / realized) * 100 : 0

      const result: ForecastAccuracyResult = {
        region: forecast.region,
        forecastId: forecast.id,
        forecastTime: forecast.forecastTime.toISOString(),
        predictedIntensity: predicted,
        realizedIntensity: realized,
        variancePct: Math.round(variancePct * 100) / 100,
        absoluteError: Math.round(absoluteError),
        withinTarget: variancePct <= 12,
      }

      results.push(result)

      // Store actual intensity if not already recorded
      await prisma.carbonForecast.update({
        where: { id: forecast.id },
        data: {
          actualIntensity: realized,
          error: Math.round(variancePct * 100) / 100,
        },
      })
    } catch (error) {
      console.warn(`Failed to verify forecast ${forecast.id}:`, error)
    }
  }

  return results
}

/**
 * Get realized carbon intensity for a region at a specific time.
 * Checks local DB first, then falls back to API.
 */
async function getRealizedIntensity(
  region: string,
  timestamp: Date
): Promise<number | null> {
  // Check local DB for a recorded intensity within 60 minutes of the target time
  const windowStart = new Date(timestamp.getTime() - 60 * 60000)
  const windowEnd = new Date(timestamp.getTime() + 60 * 60000)

  const recorded = await prisma.carbonIntensity.findFirst({
    where: {
      region,
      timestamp: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { timestamp: 'desc' },
  })

  if (recorded) return recorded.carbonIntensity

  // Fallback: try to fetch from provider
  try {
    const signal = await providerRouter.getRoutingSignal(region, new Date())
    if (signal) {
      return signal.carbonIntensity
    }
  } catch {
    // Ignore fetch errors
  }

  return null
}

/**
 * Calculate accuracy metrics over a time range for reporting.
 */
export async function getAccuracyMetrics(
  region?: string,
  days: number = 30
): Promise<AccuracyMetrics> {
  const since = new Date(Date.now() - days * 24 * 3600000)

  // Query verified forecasts from the database
  let where: any = {
    actualIntensity: { not: null },
    error: { not: null },
    createdAt: { gte: since },
  }

  if (region) {
    where.region = region
  }

  const forecasts = await prisma.carbonForecast.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5000,
  })

  if (forecasts.length === 0) {
    return {
      totalVerified: 0,
      withinTargetCount: 0,
      withinTargetPct: 0,
      avgVariancePct: 0,
      medianVariancePct: 0,
      p95VariancePct: 0,
      byRegion: {},
    }
  }

  const variances = forecasts
    .map((f: any) => (f.error as number) || 0)
    .sort((a: number, b: number) => a - b)
  const withinTarget = forecasts.filter((f: any) => (f.error || 0) <= 12)

  // Group by region
  const byRegion: Record<string, { count: number; totalVariance: number; withinTarget: number }> =
    {}
  for (const f of forecasts) {
    const reg = f.region || 'unknown'
    if (!byRegion[reg]) byRegion[reg] = { count: 0, totalVariance: 0, withinTarget: 0 }
    byRegion[reg].count++
    byRegion[reg].totalVariance += (f.error as number) || 0
    if ((f.error || 0) <= 12) byRegion[reg].withinTarget++
  }

  const byRegionFormatted: Record<string, { count: number; avgVariance: number; withinTarget: number }> = {}
  for (const [reg, data] of Object.entries(byRegion)) {
    byRegionFormatted[reg] = {
      count: data.count,
      avgVariance: Math.round((data.totalVariance / data.count) * 100) / 100,
      withinTarget: data.withinTarget,
    }
  }

  return {
    totalVerified: forecasts.length,
    withinTargetCount: withinTarget.length,
    withinTargetPct: Math.round((withinTarget.length / forecasts.length) * 1000) / 10,
    avgVariancePct:
      Math.round((variances.reduce((s: number, v: number) => s + v, 0) / variances.length) * 100) /
      100,
    medianVariancePct: variances[Math.floor(variances.length / 2)] || 0,
    p95VariancePct: variances[Math.floor(variances.length * 0.95)] || 0,
    byRegion: byRegionFormatted,
  }
}
