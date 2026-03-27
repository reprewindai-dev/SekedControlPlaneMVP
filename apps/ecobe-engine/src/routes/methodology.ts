import { Router } from 'express'
import { env } from '../config/env'
import { getIntegrationMetricsSummary, computeIntegrationSuccessRate } from '../lib/integration-metrics'

const router = Router()

type ProviderConfig = {
  name: string
  source: string
  enabled: boolean
}

type IntegrationMetricRecord = {
  source: string
  successCount: number
  failureCount: number
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  lastLatencyMs: number | null
  alertActive: boolean
}

const PROVIDERS: ProviderConfig[] = [
  {
    name: 'WattTime',
    source: 'WATTTIME',
    enabled: Boolean(env.WATTTIME_USERNAME && env.WATTTIME_PASSWORD),
  },
  {
    name: 'GridStatus EIA-930',
    source: 'GRIDSTATUS',
    enabled: Boolean(env.GRIDSTATUS_API_KEY || env.EIA_API_KEY),
  },
  {
    name: 'Ember',
    source: 'EMBER',
    enabled: Boolean(env.EMBER_API_KEY),
  },
  {
    name: 'GB Carbon Intensity',
    source: 'GB_CARBON',
    enabled: true,
  },
  {
    name: 'DK Carbon',
    source: 'DK_CARBON',
    enabled: true,
  },
  {
    name: 'FI Carbon',
    source: 'FI_CARBON',
    enabled: Boolean(env.FINGRID_API_KEY),
  },
]

function getProviderStatus(metric?: {
  successCount: number
  failureCount: number
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  alertActive: boolean
}): 'healthy' | 'degraded' | 'offline' {
  if (!metric) return 'offline'

  const successRate = computeIntegrationSuccessRate(metric) ?? 0
  const hasSuccess = metric.successCount > 0

  if (!hasSuccess && metric.failureCount > 0) return 'offline'
  if (metric.alertActive || successRate < 0.8) return 'degraded'
  return 'healthy'
}

/**
 * GET /api/v1/methodology/providers
 * Returns live provider health for the dashboard methodology panel.
 */
router.get('/providers', async (_req, res) => {
  try {
    const metrics = (await getIntegrationMetricsSummary()) as IntegrationMetricRecord[]
    const bySource = new Map<string, IntegrationMetricRecord>(
      metrics.map((metric: IntegrationMetricRecord) => [metric.source, metric])
    )

    const providers = PROVIDERS.map((provider) => {
      const metric = bySource.get(provider.source)
      const status = provider.enabled ? getProviderStatus(metric) : 'offline'

      return {
        name: provider.name,
        status,
        latencyMs: metric?.lastLatencyMs != null ? Math.round(metric.lastLatencyMs) : null,
        lastSuccessAt: metric?.lastSuccessAt?.toISOString() ?? null,
        disagreementPct: null,
      }
    })

    res.json({ providers })
  } catch (error) {
    console.error('Methodology providers error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
