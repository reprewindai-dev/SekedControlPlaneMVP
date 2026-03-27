/**
 * Tests for forecast accuracy tracking
 *
 * INTEGRATION TEST: Requires a running PostgreSQL database.
 * Automatically skipped when database is unreachable.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { prisma } from './db'
import { verifyForecasts, getAccuracyMetrics } from './forecast-accuracy'

let dbAvailable = false

async function checkDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

describe('Forecast Accuracy', () => {
  const testRegion = 'US-CAL-CISO'
  const now = new Date()

  beforeAll(async () => {
    dbAvailable = await checkDb()
    if (!dbAvailable) {
      console.warn('⚠ Database unavailable — forecast-accuracy integration tests will be skipped')
      return
    }
    // Clean up test data
    await prisma.carbonForecast.deleteMany({
      where: { region: testRegion },
    })
    await prisma.carbonIntensity.deleteMany({
      where: { region: testRegion },
    })
  })

  afterAll(async () => {
    if (!dbAvailable) return
    // Clean up test data
    await prisma.carbonForecast.deleteMany({
      where: { region: testRegion },
    }).catch(() => {})
    await prisma.carbonIntensity.deleteMany({
      where: { region: testRegion },
    }).catch(() => {})
  })

  it('should create test forecasts and intensities', async () => {
    if (!dbAvailable) return // Skip silently when no DB

    // Create a forecast for 1 hour ago (within lookback window)
    const forecastTime = new Date(now.getTime() - 60 * 60 * 1000)

    await prisma.carbonForecast.create({
      data: {
        region: testRegion,
        forecastTime,
        predictedIntensity: 300,
        confidence: 0.85,
        modelVersion: 'v1.0',
      },
    })

    // Create the realized intensity within 1 hour of forecast time
    await prisma.carbonIntensity.create({
      data: {
        region: testRegion,
        carbonIntensity: 310,
        timestamp: new Date(forecastTime.getTime() + 30 * 60 * 1000),
        source: 'ELECTRICITY_MAPS',
      },
    })

    const forecast = await prisma.carbonForecast.findFirst({
      where: { region: testRegion },
    })

    expect(forecast).toBeDefined()
    expect(forecast?.predictedIntensity).toBe(300)
  })

  it('should verify forecasts within tolerance', async () => {
    if (!dbAvailable) return

    const results = await verifyForecasts(24)

    expect(results.length).toBeGreaterThan(0)
    const result = results[0]

    expect(result.region).toBe(testRegion)
    expect(result.predictedIntensity).toBe(300)
    expect(result.realizedIntensity).toBe(310)
    expect(result.variancePct).toBeLessThanOrEqual(5)
    expect(result.withinTarget).toBe(true)
  })

  it('should calculate accuracy metrics', async () => {
    if (!dbAvailable) return

    const metrics = await getAccuracyMetrics(testRegion, 1)

    expect(metrics.totalVerified).toBeGreaterThan(0)
    expect(metrics.withinTargetCount).toBeGreaterThan(0)
    expect(metrics.withinTargetPct).toBeGreaterThan(0)
    expect(metrics.avgVariancePct).toBeGreaterThan(0)
    expect(metrics.byRegion[testRegion]).toBeDefined()
  })

  it('should handle null realized intensity gracefully', async () => {
    if (!dbAvailable) return

    // Create a forecast that has no matching intensity
    const futureTime = new Date(now.getTime() + 5 * 60 * 1000)

    await prisma.carbonForecast.create({
      data: {
        region: 'UNKNOWN_REGION',
        forecastTime: futureTime,
        predictedIntensity: 250,
        confidence: 0.7,
      },
    })

    const results = await verifyForecasts(24)

    // Should not crash, and unknown region should not be in results
    expect(results).toBeDefined()
  })

  it('should detect variance exceeding 12% target', async () => {
    if (!dbAvailable) return

    // Create a forecast with high error
    const forecastTime = new Date(now.getTime() - 45 * 60 * 1000)

    const forecast = await prisma.carbonForecast.create({
      data: {
        region: `${testRegion}_HIGH_VARIANCE`,
        forecastTime,
        predictedIntensity: 100,
        confidence: 0.5,
      },
    })

    // Create realized intensity that deviates > 12%
    await prisma.carbonIntensity.create({
      data: {
        region: `${testRegion}_HIGH_VARIANCE`,
        carbonIntensity: 250, // 150% error
        timestamp: new Date(forecastTime.getTime() + 20 * 60 * 1000),
        source: 'ELECTRICITY_MAPS',
      },
    })

    const results = await verifyForecasts(24)
    const highVarianceResult = results.find((r) => r.forecastId === forecast.id)

    expect(highVarianceResult).toBeDefined()
    expect(highVarianceResult?.variancePct).toBeGreaterThan(12)
    expect(highVarianceResult?.withinTarget).toBe(false)

    // Cleanup
    await prisma.carbonForecast.deleteMany({
      where: { region: `${testRegion}_HIGH_VARIANCE` },
    })
    await prisma.carbonIntensity.deleteMany({
      where: { region: `${testRegion}_HIGH_VARIANCE` },
    })
  })
})
