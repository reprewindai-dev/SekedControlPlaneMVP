import { prisma } from '../db'
import { redis } from '../redis'

const SIMILARITY_QUERIES_KEY = 'intelligence:similarity_queries'

export async function incrementSimilarityQueryCount() {
  await redis.incr(SIMILARITY_QUERIES_KEY)
}

export async function getSimilarityQueryCount(): Promise<number> {
  const value = await redis.get(SIMILARITY_QUERIES_KEY)
  return value ? Number(value) : 0
}

export async function getIntelligenceMetrics() {
  const [workloadsAnalyzed, vectorRecords, similarityQueries, avgCarbonSaved, routingAccuracy] = await Promise.all([
    prisma.carbonCommand.count(),
    prisma.workloadDecisionOutcome.count(),
    getSimilarityQueryCount(),
    prisma.workloadDecisionOutcome.aggregate({ _avg: { carbonSaved: true } }),
    computeRoutingAccuracy(),
  ])

  return {
    workloadsAnalyzed,
    vectorRecords,
    similarityQueries,
    avgCarbonSaved: Number(avgCarbonSaved._avg.carbonSaved?.toFixed(2) ?? 0),
    routingAccuracy,
  }
}

async function computeRoutingAccuracy(): Promise<number> {
  const total = await prisma.carbonCommandOutcome.count()
  if (total === 0) return 0
  const matches = await prisma.carbonCommandOutcome.count({ where: { regionMatch: true } })
  return Number(((matches / total) * 100).toFixed(2))
}
