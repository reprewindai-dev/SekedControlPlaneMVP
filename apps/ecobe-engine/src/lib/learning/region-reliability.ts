import { redis } from '../redis'

export const REGION_RELIABILITY_HASH_KEY = 'ci:region-reliability:v1'
export const REGION_RELIABILITY_META_KEY = 'ci:region-reliability:meta:v1'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export interface RegionLearningStats {
  total: number
  denyRate: number
  fallbackRate: number
  avgSavingsPct: number
  avgSignalConfidence: number
}

export function computeRegionReliabilityMultiplier(stats: RegionLearningStats): number {
  // Baseline multiplier at 1.0 with bounded adaptive adjustments.
  const savingsSignal = stats.avgSavingsPct / 100 // 0.0 .. ~1.0
  const confidenceSignal = stats.avgSignalConfidence - 0.5 // -0.5 .. +0.5

  const adjusted =
    1 +
    savingsSignal * 0.25 +
    confidenceSignal * 0.15 -
    stats.denyRate * 0.35 -
    stats.fallbackRate * 0.25

  return Number(clamp(adjusted, 0.8, 1.2).toFixed(4))
}

export async function loadRegionReliabilityMultipliers(
  regions: string[]
): Promise<Record<string, number>> {
  try {
    const hash = await redis.hgetall(REGION_RELIABILITY_HASH_KEY)
    const map: Record<string, number> = {}
    for (const region of regions) {
      const raw = hash?.[region]
      const parsed = raw !== undefined ? Number(raw) : NaN
      map[region] = Number.isFinite(parsed) && parsed > 0 ? parsed : 1
    }
    return map
  } catch {
    return regions.reduce<Record<string, number>>((acc, region) => {
      acc[region] = 1
      return acc
    }, {})
  }
}

export async function persistRegionReliabilityMultipliers(
  scores: Record<string, number>,
  metadata: Record<string, string>
): Promise<void> {
  const entries = Object.entries(scores)
  if (entries.length === 0) return

  await redis.hset(
    REGION_RELIABILITY_HASH_KEY,
    Object.fromEntries(entries.map(([k, v]) => [k, v.toString()]))
  )
  await redis.hset(REGION_RELIABILITY_META_KEY, metadata)
}

export async function getRegionReliabilityMetadata(): Promise<Record<string, string>> {
  try {
    return (await redis.hgetall(REGION_RELIABILITY_META_KEY)) ?? {}
  } catch {
    return {}
  }
}

