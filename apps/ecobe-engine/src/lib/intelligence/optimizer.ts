import type { SimilarityInsight } from './similarity'
import { logIntelligenceEvent } from '../logger'

interface RegionStats {
  carbonSaved: number
  latency: number
  successRate: number
}

export function buildRegionScores(insight?: SimilarityInsight | null): Record<string, number> {
  if (!insight || insight.similarWorkloadsFound === 0) {
    return {}
  }

  const stats: Record<string, RegionStats & { count: number }> = {}

  insight.neighbors.forEach(({ metadata }) => {
    const region = metadata.regionChosen ?? 'unknown'
    if (!stats[region]) {
      stats[region] = { carbonSaved: 0, latency: 0, successRate: 0, count: 0 }
    }
    stats[region].carbonSaved += metadata.carbonSaved ?? 0
    stats[region].latency += metadata.latency ?? 0
    stats[region].successRate += metadata.success ? 1 : 0
    stats[region].count += 1
  })

  const normalized: Record<string, RegionStats> = {}
  Object.entries(stats).forEach(([region, values]) => {
    normalized[region] = {
      carbonSaved: values.count ? values.carbonSaved / values.count : 0,
      latency: values.count ? values.latency / values.count : 0,
      successRate: values.count ? values.successRate / values.count : 0,
    }
  })

  const carbonRange = range(Object.values(normalized).map((v) => v.carbonSaved))
  const latencyRange = range(Object.values(normalized).map((v) => v.latency))
  const successRange = range(Object.values(normalized).map((v) => v.successRate))

  const scores: Record<string, number> = {}
  Object.entries(normalized).forEach(([region, values]) => {
    const carbonScore = normalize(values.carbonSaved, carbonRange.min, carbonRange.max)
    const latencyScore = normalize(values.latency, latencyRange.min, latencyRange.max, true)
    const successScore = normalize(values.successRate, successRange.min, successRange.max)

    scores[region] = Number((0.5 * carbonScore + 0.3 * latencyScore + 0.2 * successScore).toFixed(4))
  })

  return scores
}

export function applyAdaptiveOptimization<T extends { region: string; scores?: { total: number } }>(
  candidates: T[],
  insight?: SimilarityInsight | null
): T[] {
  const regionScores = buildRegionScores(insight)
  if (Object.keys(regionScores).length === 0) {
    return candidates
  }

  candidates.forEach((candidate) => {
    if (!candidate.scores) return
    const boost = regionScores[candidate.region]
    if (!boost) return
    candidate.scores.total = Number((candidate.scores.total + boost).toFixed(4))
    ;(candidate as any).intelligenceBoost = boost
  })

  logIntelligenceEvent('INTELLIGENCE_OPTIMIZATION_APPLIED', {
    regionsScored: Object.keys(regionScores).length,
  })

  return candidates
}

function range(values: number[]) {
  if (values.length === 0) return { min: 0, max: 0 }
  return { min: Math.min(...values), max: Math.max(...values) }
}

function normalize(value: number, min: number, max: number, inverted = false): number {
  if (max === min) return 0.5
  const normalized = (value - min) / (max - min)
  return inverted ? 1 - normalized : normalized
}
