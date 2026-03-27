import { providerRouter } from './carbon/provider-router'
import { GridSignalCache } from './grid-signals/grid-signal-cache'
import { redis } from './redis'

const SUPPORTED_REGIONS = [
  'us-east-1', 'us-west-2', 'eu-west-1',
  'eu-central-1', 'ap-southeast-1', 'ap-northeast-1'
]

export async function warmCacheOnStartup(): Promise<void> {
  try {
    console.log(`🔥 Starting cache warming for ${SUPPORTED_REGIONS.length} regions...`)

    const results = await Promise.allSettled(
      SUPPORTED_REGIONS.map(async (region) => {
        try {
          const timestamp = new Date()
          const signal = await providerRouter.getRoutingSignal(region, timestamp)
          // Cache the routing signal
          await providerRouter.cacheRoutingSignal(region, signal, timestamp)
          return {
            region,
            status: 'ok' as const,
            carbonIntensity: signal.carbonIntensity,
            confidence: signal.confidence,
            source: signal.provenance.sourceUsed,
          }
        } catch (error) {
          return {
            region,
            status: 'failed' as const,
            error: String(error)
          }
        }
      })
    )

    const succeeded = results.filter(r => r.status === 'fulfilled' && (r.value as any).status === 'ok').length
    console.log(`🔥 Cache warming complete: ${succeeded}/${SUPPORTED_REGIONS.length} regions warmed`)

    // Log results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const value = result.value as any
        if (value.status === 'ok') {
          console.log(`   ✓ ${value.region}: ${value.carbonIntensity} gCO2/kWh (confidence: ${(value.confidence * 100).toFixed(0)}%, source: ${value.source})`)
        } else {
          console.log(`   ✗ ${value.region}: ${value.error}`)
        }
      } else {
        console.log(`   ✗ Failed to warm cache: ${String(result.reason)}`)
      }
    }
  } catch (error) {
    console.error('Fatal error during cache warming:', error)
    // Don't throw - allow server to continue even if cache warming fails
  }
}

export async function getCacheHealthStatus(): Promise<{
  isHealthy: boolean
  redisConnected: boolean
  cacheStats: {
    totalKeys: number
    keyTypes: Record<string, number>
    regions: Record<string, number>
  } | null
}> {
  try {
    const redisHealthy = await redis.ping().then(() => true).catch(() => false)

    if (!redisHealthy) {
      return {
        isHealthy: false,
        redisConnected: false,
        cacheStats: null
      }
    }

    const cacheStats = await GridSignalCache.getCacheStats()

    return {
      isHealthy: cacheStats.totalKeys > 0,
      redisConnected: true,
      cacheStats
    }
  } catch (error) {
    console.error('Error getting cache health status:', error)
    return {
      isHealthy: false,
      redisConnected: false,
      cacheStats: null
    }
  }
}
