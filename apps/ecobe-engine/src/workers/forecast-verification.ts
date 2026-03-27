/**
 * Forecast Verification Worker
 *
 * Runs periodically to verify forecast accuracy by comparing predictions
 * against realized carbon intensity values.
 */

import { verifyForecasts, type ForecastAccuracyResult } from '../lib/forecast-accuracy'
import { prisma } from '../lib/db'

let lastRunAt: Date | null = null
let lastRunResults: number = 0
let isRunning = false

export function getForecastVerificationStatus() {
  return { lastRunAt, lastRunResults, isRunning }
}

export async function runForecastVerification(): Promise<void> {
  if (isRunning) return
  isRunning = true

  try {
    console.log('🔍 Starting forecast accuracy verification...')
    const results = await verifyForecasts(6)

    // Store results in audit trail
    for (const result of results) {
      try {
        await prisma.integrationEvent.create({
          data: {
            source: `FORECAST_ACCURACY_${result.region}`,
            success: result.withinTarget,
            message: JSON.stringify(result),
            createdAt: new Date(),
          },
        })
      } catch (error) {
        console.warn('Failed to store forecast accuracy result:', error)
      }
    }

    const withinTarget = results.filter((r: ForecastAccuracyResult) => r.withinTarget).length
    const withinTargetPct =
      results.length > 0 ? Math.round((withinTarget / results.length) * 1000) / 10 : 0
    console.log(
      `🔍 Forecast verification complete: ${results.length} checked, ${withinTarget} within 12% target (${withinTargetPct}%)`
    )

    lastRunAt = new Date()
    lastRunResults = results.length
  } catch (error) {
    console.error('Forecast verification failed:', error)
  } finally {
    isRunning = false
  }
}

/**
 * Start the forecast verification worker on a schedule.
 * Runs every 30 minutes to check forecasts that have matured.
 */
export function startForecastVerificationWorker(): void {
  console.log('🔍 Forecast verification worker started (every 30 minutes)')

  // Run immediately on startup (after 2 minute delay to let other services warm up)
  setTimeout(() => {
    runForecastVerification().catch((err) =>
      console.error('Initial forecast verification failed:', err)
    )
  }, 120000)

  // Then every 30 minutes
  setInterval(() => {
    runForecastVerification().catch((err) =>
      console.error('Scheduled forecast verification failed:', err)
    )
  }, 30 * 60 * 1000)
}
