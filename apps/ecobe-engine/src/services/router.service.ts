import { randomUUID } from 'crypto'
import { getSignals, type NormalizedSignal } from './fingard.service'
import { saveDecision, getRecentDecisions } from '../db/decision-log.repo'

export interface RouteRequest {
  workloadId: string
  candidateRegions: string[]
  durationMinutes?: number
  workloadType?: 'batch' | 'inference' | 'training'
}

export interface RoutingDecision {
  decision_id: string
  workload_id: string
  chosen_region: string
  candidate_regions: string[]
  winner_source: string
  winner_value: number
  worst_value: number
  carbon_delta: number
  degraded: boolean
  created_at: Date
}

export interface RouteResponse {
  decisionId: string
  chosenRegion: string
  gridZone: string
  source: string
  signalType: string
  carbonValue: number
  confidence: number
  freshness: string
  degraded: boolean
  alternatives: Array<{
    region: string
    carbonValue: number
    source: string
    degraded: boolean
  }>
  carbonDeltaVsWorst: number
}

/**
 * Core routing logic
 * Gets signals for all candidate regions and selects the best one
 */
export async function routeWorkload(request: RouteRequest): Promise<RoutingDecision> {
  const { workloadId, candidateRegions } = request

  // Get signals for all candidate regions
  const signals = await getSignals(candidateRegions)
  
  if (signals.length === 0) {
    throw new Error('No signals available for candidate regions')
  }

  // Find winner (lowest carbon value)
  const winnerSignal = signals.reduce((min, current) => 
    current.carbonValue < min.carbonValue ? current : min
  )

  // Find worst (highest carbon value)
  const worstSignal = signals.reduce((max, current) => 
    current.carbonValue > max.carbonValue ? current : max
  )

  // Create decision record
  const decision: RoutingDecision = {
    decision_id: randomUUID(),
    workload_id: workloadId,
    chosen_region: winnerSignal.region,
    candidate_regions: candidateRegions,
    winner_source: winnerSignal.source,
    winner_value: winnerSignal.carbonValue,
    worst_value: worstSignal.carbonValue,
    carbon_delta: worstSignal.carbonValue - winnerSignal.carbonValue,
    degraded: winnerSignal.degraded,
    created_at: new Date(),
  }

  // Save decision to log
  await saveDecision(decision)

  return decision
}

/**
 * Create route response from decision and signals
 */
export async function createRouteResponse(decision: RoutingDecision): Promise<RouteResponse> {
  // Get all signals for alternatives
  const signals = await getSignals(decision.candidate_regions)
  
  const alternatives = signals
    .filter(signal => signal.region !== decision.chosen_region)
    .map(signal => ({
      region: signal.region,
      carbonValue: signal.carbonValue,
      source: signal.source,
      degraded: signal.degraded,
    }))
    .slice(0, 3) // Top 3 alternatives

  const winnerSignal = signals.find(s => s.region === decision.chosen_region)!

  return {
    decisionId: decision.decision_id,
    chosenRegion: decision.chosen_region,
    gridZone: winnerSignal.gridZone,
    source: decision.winner_source,
    signalType: winnerSignal.signalType,
    carbonValue: decision.winner_value,
    confidence: winnerSignal.confidence,
    freshness: winnerSignal.freshness,
    degraded: decision.degraded,
    alternatives,
    carbonDeltaVsWorst: decision.carbon_delta,
  }
}
