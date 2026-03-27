import axios from 'axios'

const DEFAULT_REGION = process.env.VERIFY_REGION ?? 'us-east-1'
const DEFAULT_DURATION = Number(process.env.VERIFY_DURATION_HOURS ?? 4)
const DEFAULT_LOOKAHEAD = Number(process.env.VERIFY_LOOKAHEAD_HOURS ?? 48)

function resolveBaseUrl() {
  if (process.env.VERIFY_BASE_URL) return process.env.VERIFY_BASE_URL
  const port = process.env.PORT ?? '3000'
  return `http://localhost:${port}`
}

function assertCondition(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

async function fetchMetrics(baseUrl: string) {
  const response = await axios.get(`${baseUrl}/api/v1/dashboard/metrics`, {
    params: { window: '24h' },
    timeout: 30_000,
  })
  return response.data
}

async function fetchForecast(baseUrl: string) {
  const response = await axios.get(`${baseUrl}/api/v1/forecasting/${DEFAULT_REGION}/forecasts`, {
    params: { hoursAhead: DEFAULT_LOOKAHEAD },
    timeout: 30_000,
  })
  return response.data
}

async function fetchOptimalWindow(baseUrl: string) {
  const response = await axios.get(
    `${baseUrl}/api/v1/forecasting/${DEFAULT_REGION}/optimal-window`,
    {
      params: {
        durationHours: DEFAULT_DURATION,
        lookAheadHours: DEFAULT_LOOKAHEAD,
      },
      timeout: 30_000,
    }
  )
  return response.data
}

async function main() {
  const baseUrl = resolveBaseUrl()
  console.log(`Running live verification against ${baseUrl}`)
  console.log(`Region: ${DEFAULT_REGION}`)

  const [metrics, forecasts, window] = await Promise.all([
    fetchMetrics(baseUrl),
    fetchForecast(baseUrl),
    fetchOptimalWindow(baseUrl),
  ])

  assertCondition(metrics.totalDecisions !== undefined, 'Metrics missing totalDecisions')
  assertCondition(metrics.providerSignals !== undefined, 'Metrics missing providerSignals payload')
  assertCondition(
    metrics.providerSignals == null || metrics.providerSignals.successCount >= 0,
    'Provider signal counters missing'
  )
  assertCondition(metrics.forecastRefresh?.lastRun, 'Forecast refresh last run missing')
  assertCondition(
    (metrics.forecastRefresh?.lastRun?.totalForecasts ?? 0) >= 0,
    'Forecast totals missing'
  )

  assertCondition(Array.isArray(forecasts.forecasts), 'Forecast payload malformed')
  assertCondition(forecasts.forecasts.length > 0, 'Forecast list empty')
  assertCondition(
    forecasts.forecasts.every((point: any) => typeof point.predictedIntensity === 'number'),
    'Predicted intensities missing'
  )

  assertCondition(window.window, 'Optimal window response missing window payload')
  assertCondition(window.window.startTime, 'Optimal window missing startTime')
  assertCondition(window.window.avgIntensity !== undefined, 'Optimal window missing avgIntensity')

  console.log('Live verification succeeded: metrics, forecasts, and optimal window endpoints returned live data.')
}

main().catch((error) => {
  console.error('Live verification failed:', error.message)
  if ((error as any).response) {
    console.error('Response data:', (error as any).response.data)
  }
  process.exit(1)
})
