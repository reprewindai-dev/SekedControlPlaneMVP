/**
 * Scoring Engine — Routing Spec v1
 *
 * Multi-objective scoring with per-class weights.
 * Integrates grid intelligence signals into scoring.
 *
 * Formula:
 *   RankScore =
 *     α * CarbonBenefit
 *   - β * LatencyPenalty
 *   - γ * CostPenalty
 *   - δ * QueuePenalty
 *   - ε * UncertaintyPenalty
 *   - ζ * RetryRiskPenalty
 */

import type { RoutingCandidate } from './candidate-generator'
import type { ScoringWeights } from './job-classifier'

export interface ScoringResult {
  candidates: RoutingCandidate[]
  selected: RoutingCandidate | null
  fallback: RoutingCandidate | null
  baselineCandidate: RoutingCandidate | null
  totalEvaluated: number
  totalFeasible: number
}

/**
 * Score all candidates and select the best one.
 * Grid intelligence signals are factored into the scoring.
 */
export function scoreCandidates(
  candidates: RoutingCandidate[],
  weights: ScoringWeights,
  baselineRegion?: string
): ScoringResult {
  const feasible = candidates.filter(c => c.isFeasible && c.carbonEstimateGPerKwh !== null)

  if (feasible.length === 0) {
    return {
      candidates,
      selected: null,
      fallback: null,
      baselineCandidate: null,
      totalEvaluated: candidates.length,
      totalFeasible: 0,
    }
  }

  // Collect value ranges for normalization
  const carbonValues = feasible.map(c => c.carbonEstimateGPerKwh!).filter(v => v >= 0)
  const latencyValues = feasible.map(c => c.latencyEstimateMs ?? 100)
  const costValues = feasible.map(c => c.costEstimateUsd ?? 0)
  const queueValues = feasible.map(c => c.queueDelayEstimateSec ?? 0)
  const confidenceValues = feasible.map(c => c.confidenceScore ?? 0.5)
  const retryValues = feasible.map(c => c.retryRiskScore ?? 0)

  const carbonRange = getRange(carbonValues)
  const latencyRange = getRange(latencyValues)
  const costRange = getRange(costValues)
  const queueRange = getRange(queueValues)
  const confidenceRange = getRange(confidenceValues)
  const retryRange = getRange(retryValues)

  // Score each feasible candidate
  for (const candidate of feasible) {
    // Normalize each dimension to 0–1
    const carbonNorm = normalizeInverted(candidate.carbonEstimateGPerKwh!, carbonRange)
    const latencyNorm = normalizeInverted(candidate.latencyEstimateMs ?? 100, latencyRange)
    const costNorm = normalizeInverted(candidate.costEstimateUsd ?? 0, costRange)
    const queueNorm = normalizeInverted(candidate.queueDelayEstimateSec ?? 0, queueRange)
    const uncertaintyNorm = normalize(candidate.confidenceScore ?? 0.5, confidenceRange) // Higher confidence = better
    const retryNorm = normalizeInverted(candidate.retryRiskScore ?? 0, retryRange)

    // Apply grid intelligence bonuses/penalties
    let gridBonus = 0

    // Curtailment opportunity: bonus if renewable curtailment likely (cheap clean energy)
    if (candidate.curtailmentProbability && candidate.curtailmentProbability > 0.5) {
      gridBonus += 0.05 * candidate.curtailmentProbability
    }

    // Carbon spike risk: penalty
    if (candidate.carbonSpikeProbability && candidate.carbonSpikeProbability > 0.3) {
      gridBonus -= 0.08 * candidate.carbonSpikeProbability
    }

    // Import leakage: penalty for regions importing dirty power
    if (candidate.importCarbonLeakageScore && candidate.importCarbonLeakageScore > 0.5) {
      gridBonus -= 0.04 * candidate.importCarbonLeakageScore
    }

    // Demand ramp: penalty for rapidly increasing demand (stress)
    if (candidate.demandRampPct && candidate.demandRampPct > 5) {
      gridBonus -= 0.02 * Math.min(candidate.demandRampPct / 20, 1)
    }

    // Compute weighted rank score
    candidate.carbonScore = round4(carbonNorm)
    candidate.latencyScore = round4(latencyNorm)
    candidate.costScore = round4(costNorm)
    candidate.queueScore = round4(queueNorm)
    candidate.uncertaintyScore = round4(uncertaintyNorm)

    candidate.rankScore = round4(
      weights.carbon * carbonNorm +
      weights.latency * latencyNorm +
      weights.cost * costNorm +
      weights.queue * queueNorm +
      weights.uncertainty * uncertaintyNorm +
      weights.retryRisk * retryNorm +
      gridBonus
    )
  }

  // Sort by rank score descending
  feasible.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0))

  // Identify baseline (what would have been used without ECOBE)
  const baselineCandidate = baselineRegion
    ? candidates.find(c => c.region === baselineRegion) ?? null
    : findWorstCarbonCandidate(feasible)

  return {
    candidates,
    selected: feasible[0] ?? null,
    fallback: feasible[1] ?? null,
    baselineCandidate,
    totalEvaluated: candidates.length,
    totalFeasible: feasible.length,
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getRange(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 }
  return { min: Math.min(...values), max: Math.max(...values) }
}

function normalize(value: number, range: { min: number; max: number }): number {
  if (range.max === range.min) return 1
  return Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)))
}

function normalizeInverted(value: number, range: { min: number; max: number }): number {
  return 1 - normalize(value, range)
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function findWorstCarbonCandidate(candidates: RoutingCandidate[]): RoutingCandidate | null {
  if (candidates.length === 0) return null
  return candidates.reduce((worst, c) =>
    (c.carbonEstimateGPerKwh ?? 0) > (worst.carbonEstimateGPerKwh ?? 0) ? c : worst
  )
}
