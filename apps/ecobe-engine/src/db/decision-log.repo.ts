import { prisma } from '../lib/db'
import type { RoutingDecision } from '../services/router.service'

/**
 * Save a routing decision to the database
 */
export async function saveDecision(decision: RoutingDecision): Promise<void> {
  await prisma.dashboardRoutingDecision.create({
    data: {
      workloadName: decision.workload_id,
      opName: 'routing-decision',
      baselineRegion: decision.candidate_regions[0] || 'unknown',
      chosenRegion: decision.chosen_region,
      zoneBaseline: decision.candidate_regions[0] || 'unknown',
      zoneChosen: decision.chosen_region,
      carbonIntensityBaselineGPerKwh: decision.worst_value,
      carbonIntensityChosenGPerKwh: decision.winner_value,
      estimatedKwh: 1.0, // Temporary static value
      co2BaselineG: decision.worst_value,
      co2ChosenG: decision.winner_value,
      reason: `Routing decision via ${decision.winner_source}`,
      fallbackUsed: decision.degraded,
      sourceUsed: decision.winner_source,
      meta: {
        decision_id: decision.decision_id,
        workload_id: decision.workload_id,
        candidate_regions: decision.candidate_regions,
        winner_source: decision.winner_source,
        winner_value: decision.winner_value,
        worst_value: decision.worst_value,
        carbon_delta: decision.carbon_delta,
        degraded: decision.degraded,
        routing_type: 'api_v1_route'
      }
    }
  })
}

/**
 * Get recent decisions for dashboard
 */
export async function getRecentDecisions(limit: number = 100): Promise<any[]> {
  const decisions = await prisma.dashboardRoutingDecision.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      workloadName: true,
      opName: true,
      baselineRegion: true,
      chosenRegion: true,
      zoneBaseline: true,
      zoneChosen: true,
      carbonIntensityBaselineGPerKwh: true,
      carbonIntensityChosenGPerKwh: true,
      co2BaselineG: true,
      co2ChosenG: true,
      reason: true,
      fallbackUsed: true,
      sourceUsed: true,
      meta: true
    }
  })

  return decisions.map((decision: any) => ({
    decision_id: decision.id,
    workload_id: decision.workloadName,
    created_at: decision.createdAt,
    chosen_region: decision.chosenRegion,
    baseline_region: decision.baselineRegion,
    carbon_intensity_chosen: decision.carbonIntensityChosenGPerKwh,
    carbon_intensity_baseline: decision.carbonIntensityBaselineGPerKwh,
    co2_saved_g: (decision.co2BaselineG || 0) - (decision.co2ChosenG || 0),
    source_used: decision.sourceUsed,
    fallback_used: decision.fallbackUsed,
    meta: decision.meta
  }))
}

/**
 * Get decisions for a time window (for savings calculations)
 */
export async function getDecisionsInWindow(days: number = 30): Promise<any[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  
  const decisions = await prisma.dashboardRoutingDecision.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: {
      co2BaselineG: true,
      co2ChosenG: true,
      createdAt: true,
      sourceUsed: true,
      fallbackUsed: true
    }
  })

  return decisions
}
