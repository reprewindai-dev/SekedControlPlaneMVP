import { redis } from '../redis'
import { GridSignalSnapshot } from './types'

export interface CacheOptions {
  ttl?: number // Time to live in seconds
  keyPrefix?: string
}

export class GridSignalCache {
  private static readonly DEFAULT_TTL = 15 * 60 // 15 minutes
  private static readonly DEFAULT_FEATURE_TTL = 60 * 60 // 1 hour
  private static readonly KEY_PREFIX = 'grid-signal'

  /**
   * Cache grid signal snapshots
   */
  static async cacheSnapshots(
    region: string,
    snapshots: GridSignalSnapshot[],
    options: CacheOptions = {}
  ): Promise<void> {
    const ttl = options.ttl ?? this.DEFAULT_TTL
    const keyPrefix = options.keyPrefix ?? this.KEY_PREFIX

    const key = `${keyPrefix}:snapshots:${region}`
    const value = JSON.stringify(snapshots)

    await redis.setex(key, ttl, value)
  }

  /**
   * Get cached grid signal snapshots
   */
  static async getCachedSnapshots(
    region: string,
    options: CacheOptions = {}
  ): Promise<GridSignalSnapshot[] | null> {
    const keyPrefix = options.keyPrefix ?? this.KEY_PREFIX
    const key = `${keyPrefix}:snapshots:${region}`

    const cached = await redis.get(key)
    if (!cached) return null

    try {
      return JSON.parse(cached) as GridSignalSnapshot[]
    } catch (error) {
      console.warn(`Failed to parse cached snapshots for ${region}:`, error)
      return null
    }
  }

  /**
   * Cache derived features for a region
   */
  static async cacheFeatures(
    region: string,
    features: {
      demandRampPct: number | null
      fossilRatio: number | null
      renewableRatio: number | null
      carbonSpikeProbability: number | null
      curtailmentProbability: number | null
      importCarbonLeakageScore: number | null
    },
    timestamp: string,
    options: CacheOptions = {}
  ): Promise<void> {
    const ttl = options.ttl ?? this.DEFAULT_FEATURE_TTL
    const keyPrefix = options.keyPrefix ?? this.KEY_PREFIX

    const key = `${keyPrefix}:features:${region}:${timestamp}`
    const value = JSON.stringify(features)

    await redis.setex(key, ttl, value)
  }

  /**
   * Get cached derived features
   */
  static async getCachedFeatures(
    region: string,
    timestamp: string,
    options: CacheOptions = {}
  ): Promise<{
    demandRampPct: number | null
    fossilRatio: number | null
    renewableRatio: number | null
    carbonSpikeProbability: number | null
    curtailmentProbability: number | null
    importCarbonLeakageScore: number | null
  } | null> {
    const keyPrefix = options.keyPrefix ?? this.KEY_PREFIX
    const key = `${keyPrefix}:features:${region}:${timestamp}`

    const cached = await redis.get(key)
    if (!cached) return null

    try {
      return JSON.parse(cached)
    } catch (error) {
      console.warn(`Failed to parse cached features for ${region} at ${timestamp}:`, error)
      return null
    }
  }

  /**
   * Cache provider disagreement data
   */
  static async cacheProviderDisagreement(
    region: string,
    timestamp: string,
    disagreement: {
      level: 'none' | 'low' | 'medium' | 'high' | 'severe'
      disagreementPct: number
      providers: string[]
      values: number[]
    },
    options: CacheOptions = {}
  ): Promise<void> {
    const ttl = options.ttl ?? this.DEFAULT_TTL
    const keyPrefix = options.keyPrefix ?? this.KEY_PREFIX

    const key = `${keyPrefix}:disagreement:${region}:${timestamp}`
    const value = JSON.stringify(disagreement)

    await redis.setex(key, ttl, value)
  }

  /**
   * Get cached provider disagreement data
   */
  static async getCachedProviderDisagreement(
    region: string,
    timestamp: string,
    options: CacheOptions = {}
  ): Promise<{
    level: 'none' | 'low' | 'medium' | 'high' | 'severe'
    disagreementPct: number
    providers: string[]
    values: number[]
  } | null> {
    const keyPrefix = options.keyPrefix ?? this.KEY_PREFIX
    const key = `${keyPrefix}:disagreement:${region}:${timestamp}`

    const cached = await redis.get(key)
    if (!cached) return null

    try {
      return JSON.parse(cached)
    } catch (error) {
      console.warn(`Failed to parse cached disagreement for ${region} at ${timestamp}:`, error)
      return null
    }
  }

  /**
   * Cache signal quality assessment
   */
  static async cacheSignalQuality(
    region: string,
    timestamp: string,
    quality: {
      tier: 'high' | 'medium' | 'low'
      reasons: string[]
      estimatedFlag: boolean
      syntheticFlag: boolean
      stalenessMinutes: number
    },
    options: CacheOptions = {}
  ): Promise<void> {
    const ttl = options.ttl ?? this.DEFAULT_TTL
    const keyPrefix = options.keyPrefix ?? this.KEY_PREFIX

    const key = `${keyPrefix}:quality:${region}:${timestamp}`
    const value = JSON.stringify(quality)

    await redis.setex(key, ttl, value)
  }

  /**
   * Get cached signal quality assessment
   */
  static async getCachedSignalQuality(
    region: string,
    timestamp: string,
    options: CacheOptions = {}
  ): Promise<{
    tier: 'high' | 'medium' | 'low'
    reasons: string[]
    estimatedFlag: boolean
    syntheticFlag: boolean
    stalenessMinutes: number
  } | null> {
    const keyPrefix = options.keyPrefix ?? this.KEY_PREFIX
    const key = `${keyPrefix}:quality:${region}:${timestamp}`

    const cached = await redis.get(key)
    if (!cached) return null

    try {
      return JSON.parse(cached)
    } catch (error) {
      console.warn(`Failed to parse cached quality for ${region} at ${timestamp}:`, error)
      return null
    }
  }

  /**
   * Invalidate all cache entries for a region
   */
  static async invalidateRegion(region: string, keyPrefix: string = this.KEY_PREFIX): Promise<void> {
    const pattern = `${keyPrefix}:*:${region}:*`
    const keys = await redis.keys(pattern)

    if (keys.length > 0) {
      await redis.del(...keys)
    }
  }

  /**
   * Invalidate all cache entries older than a certain timestamp
   */
  static async invalidateOlderThan(
    cutoffTimestamp: string,
    keyPrefix: string = this.KEY_PREFIX
  ): Promise<void> {
    const pattern = `${keyPrefix}:*:*`
    const keys = await redis.keys(pattern)

    const keysToDelete: string[] = []

    for (const key of keys) {
      const parts = key.split(':')
      if (parts.length >= 4) {
        const timestamp = parts[parts.length - 2] || parts[parts.length - 1]
        if (timestamp < cutoffTimestamp) {
          keysToDelete.push(key)
        }
      }
    }

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete)
    }
  }

  /**
   * Get cache statistics
   */
  static async getCacheStats(keyPrefix: string = this.KEY_PREFIX): Promise<{
    totalKeys: number
    keyTypes: Record<string, number>
    regions: Record<string, number>
  }> {
    const pattern = `${keyPrefix}:*`
    const keys = await redis.keys(pattern)

    const keyTypes: Record<string, number> = {}
    const regions: Record<string, number> = {}

    for (const key of keys) {
      const parts = key.split(':')
      
      // Count by key type
      const keyType = parts[1] || 'unknown'
      keyTypes[keyType] = (keyTypes[keyType] || 0) + 1

      // Count by region
      const region = parts[2] || 'unknown'
      regions[region] = (regions[region] || 0) + 1
    }

    return {
      totalKeys: keys.length,
      keyTypes,
      regions
    }
  }

  /**
   * Warm cache with recent data for commonly accessed regions
   */
  static async warmCache(
    regions: string[],
    snapshots: Map<string, GridSignalSnapshot[]>
  ): Promise<void> {
    const promises = regions.map(async (region) => {
      const regionSnapshots = snapshots.get(region)
      if (regionSnapshots && regionSnapshots.length > 0) {
        await this.cacheSnapshots(region, regionSnapshots)
        
        // Cache features for the most recent snapshot
        const latest = regionSnapshots[0]
        if (latest) {
          await this.cacheFeatures(region, {
            demandRampPct: latest.demandChangePct,
            fossilRatio: latest.fossilRatio,
            renewableRatio: latest.renewableRatio,
            carbonSpikeProbability: latest.carbonSpikeProbability,
            curtailmentProbability: latest.curtailmentProbability,
            importCarbonLeakageScore: latest.importCarbonLeakageScore
          }, latest.timestamp)
        }
      }
    })

    await Promise.allSettled(promises)
  }

  /**
   * Batch cache operations for multiple regions
   */
  static async batchCache(
    operations: Array<{
      type: 'snapshots' | 'features' | 'disagreement' | 'quality'
      region: string
      timestamp?: string
      data: any
    }>,
    options: CacheOptions = {}
  ): Promise<void> {
    const promises = operations.map(async (op) => {
      switch (op.type) {
        case 'snapshots':
          await this.cacheSnapshots(op.region, op.data, options)
          break
        case 'features':
          await this.cacheFeatures(op.region, op.data, op.timestamp!, options)
          break
        case 'disagreement':
          await this.cacheProviderDisagreement(op.region, op.timestamp!, op.data, options)
          break
        case 'quality':
          await this.cacheSignalQuality(op.region, op.timestamp!, op.data, options)
          break
      }
    })

    await Promise.allSettled(promises)
  }
}
