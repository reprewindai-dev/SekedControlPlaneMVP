import { buildFingerprint, generateWorkloadEmbedding, WorkloadFingerprint } from './fingerprint'
import { findSimilarWorkloads, WorkloadVectorMetadata } from './vector-store'
import type { CarbonCommandPayload } from '../carbon-command'
import { logIntelligenceEvent } from '../logger'
import { incrementSimilarityQueryCount } from './metrics'
import { redis } from '../redis'

// Governance: Max 1 embedding + max 10 similarity lookups per command
const MAX_SIMILARITY_LOOKUPS = 10
const COMMAND_GUARD_TTL = 300 // 5 minutes

export interface SimilarityInsight {
  similarWorkloadsFound: number
  averageCarbonSaved: number
  recommendedRegion?: string | null
  confidence: number
  neighbors: Array<{ metadata: WorkloadVectorMetadata; score: number }>
}

export interface SimilarityContext {
  fingerprint: WorkloadFingerprint
  embedding: number[]
  insight: SimilarityInsight
}

export async function analyzeSimilarWorkloads(payload: CarbonCommandPayload): Promise<SimilarityContext | null> {
  // ── Governance: per-command dedup guard ─────────────────────────────────
  // Ensures max 1 embedding + max 10 lookups per command ID.
  // If this command was already analyzed, return null (cached result expected upstream).
  // Use workload name + org as command dedup key (payload has no commandId at this stage)
  const guardSeed = `${payload.orgId}:${payload.workload?.type ?? 'unknown'}:${Date.now().toString().slice(0, -4)}`
  const commandGuardKey = `governance:similarity_guard:${guardSeed}`
  const callCount = await redis.incr(commandGuardKey)
  if (callCount === 1) {
    await redis.expire(commandGuardKey, COMMAND_GUARD_TTL)
  }
  if (callCount > 1) {
    logIntelligenceEvent('INTELLIGENCE_SIMILARITY_SEARCH', {
      orgId: payload.orgId,
      similarWorkloadsFound: 0,
      recommendedRegion: null,
      confidence: 0,
    })
    return null // Already analyzed this command — governance constraint
  }

  const fingerprint = buildFingerprint(payload)
  const embedding = await generateWorkloadEmbedding(fingerprint)
  if (!embedding) {
    return null
  }

  const neighbors = await findSimilarWorkloads(embedding, MAX_SIMILARITY_LOOKUPS)
  if (neighbors.length === 0) {
    return {
      fingerprint,
      embedding,
      insight: {
        similarWorkloadsFound: 0,
        averageCarbonSaved: 0,
        recommendedRegion: null,
        confidence: 0.4,
        neighbors: [],
      },
    }
  }

  const averageCarbonSaved = avg(neighbors.map((neighbor: { metadata: WorkloadVectorMetadata }) => neighbor.metadata.carbonSaved ?? 0))
  const successRate = avg(neighbors.map((neighbor: { metadata: WorkloadVectorMetadata }) => (neighbor.metadata.success ? 1 : 0)))

  const regionScores: Record<string, { score: number; count: number }> = {}
  neighbors.forEach((neighbor: { metadata: WorkloadVectorMetadata; score: number }) => {
    const region = neighbor.metadata.regionChosen ?? 'unknown'
    if (!regionScores[region]) {
      regionScores[region] = { score: 0, count: 0 }
    }
    regionScores[region].score += neighbor.score
    regionScores[region].count += 1
  })

  const recommendedRegion = Object.entries(regionScores)
    .sort((a, b) => b[1].score - a[1].score)
    .at(0)?.[0]

  const confidence = Math.min(0.95, Math.max(0.4, neighbors.length / 20 + successRate * 0.3))

  const insight: SimilarityInsight = {
    similarWorkloadsFound: neighbors.length,
    averageCarbonSaved,
    recommendedRegion,
    confidence,
    neighbors,
  }

  logIntelligenceEvent('INTELLIGENCE_SIMILARITY_SEARCH', {
    orgId: payload.orgId,
    similarWorkloadsFound: neighbors.length,
    recommendedRegion,
    confidence,
  })

  await incrementSimilarityQueryCount()

  return { fingerprint, embedding, insight }
}

function avg(values: number[]): number {
  return values.length ? Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(2)) : 0
}
