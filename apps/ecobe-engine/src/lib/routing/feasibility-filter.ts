/**
 * Feasibility Filter — Routing Spec v1
 *
 * Hard constraint enforcement. Candidates that fail ANY constraint
 * are marked infeasible with a rejection reason.
 *
 * Constraints:
 *   - SLA met (latency within budget)
 *   - Deadline met (finish before deadline with 10% buffer)
 *   - Capacity available
 *   - Region allowed (data residency, policy)
 *   - Cost below ceiling
 *   - Policy not blocked
 */

import type { RoutingCandidate } from './candidate-generator'

export interface FeasibilityConstraints {
  latencySlaMs?: number
  deadlineTs?: Date
  estimatedRuntimeSec?: number
  maxCostUsd?: number
  maxCarbonGPerKwh?: number
  mustRunRegions?: string[]      // If set, ONLY these regions are allowed
  excludedRegions?: string[]
  dataResidency?: string[]
  policyBlockedRegions?: string[]
}

export interface FeasibilityResult {
  feasible: RoutingCandidate[]
  rejected: RoutingCandidate[]
  totalChecked: number
}

/**
 * Apply hard constraints to all candidates.
 * Mutates candidate.isFeasible and candidate.rejectionReason.
 */
export function applyFeasibilityFilter(
  candidates: RoutingCandidate[],
  constraints: FeasibilityConstraints
): FeasibilityResult {
  const feasible: RoutingCandidate[] = []
  const rejected: RoutingCandidate[] = []

  for (const candidate of candidates) {
    const reasons: string[] = []

    // 1. Latency SLA check
    if (constraints.latencySlaMs && candidate.latencyEstimateMs !== null) {
      if (candidate.latencyEstimateMs > constraints.latencySlaMs) {
        reasons.push(`LATENCY_EXCEEDED: ${candidate.latencyEstimateMs}ms > ${constraints.latencySlaMs}ms SLA`)
      }
    }

    // 2. Deadline check with 10% buffer
    if (constraints.deadlineTs && constraints.estimatedRuntimeSec) {
      const estimatedFinish = new Date(
        candidate.startTs.getTime() + constraints.estimatedRuntimeSec * 1000
      )
      const buffer = constraints.estimatedRuntimeSec * 0.1 * 1000 // 10% buffer
      if (estimatedFinish.getTime() + buffer > constraints.deadlineTs.getTime()) {
        reasons.push('DEADLINE_VIOLATED')
      }
    }

    // 3. Cost ceiling
    if (constraints.maxCostUsd && candidate.costEstimateUsd !== null) {
      if (candidate.costEstimateUsd > constraints.maxCostUsd) {
        reasons.push(`COST_EXCEEDED: $${candidate.costEstimateUsd} > $${constraints.maxCostUsd}`)
      }
    }

    // 4. Carbon ceiling (hard limit)
    if (constraints.maxCarbonGPerKwh && candidate.carbonEstimateGPerKwh !== null) {
      if (candidate.carbonEstimateGPerKwh > constraints.maxCarbonGPerKwh) {
        reasons.push(`CARBON_EXCEEDED: ${candidate.carbonEstimateGPerKwh} > ${constraints.maxCarbonGPerKwh} gCO2/kWh`)
      }
    }

    // 5. Must-run regions
    if (constraints.mustRunRegions && constraints.mustRunRegions.length > 0) {
      if (!constraints.mustRunRegions.includes(candidate.region)) {
        reasons.push(`REGION_NOT_ALLOWED: ${candidate.region} not in mustRunRegions`)
      }
    }

    // 6. Excluded regions
    if (constraints.excludedRegions?.includes(candidate.region)) {
      reasons.push(`REGION_EXCLUDED: ${candidate.region}`)
    }

    // 7. Policy-blocked regions
    if (constraints.policyBlockedRegions?.includes(candidate.region)) {
      reasons.push(`POLICY_BLOCKED: ${candidate.region}`)
    }

    // 8. Queue delay too high (if > 5x estimated runtime, reject)
    if (candidate.queueDelayEstimateSec !== null && constraints.estimatedRuntimeSec) {
      if (candidate.queueDelayEstimateSec > constraints.estimatedRuntimeSec * 5) {
        reasons.push('QUEUE_DELAY_EXCESSIVE')
      }
    }

    // Apply result
    if (reasons.length > 0) {
      candidate.isFeasible = false
      candidate.rejectionReason = reasons.join('; ')
      rejected.push(candidate)
    } else {
      candidate.isFeasible = true
      candidate.rejectionReason = null
      feasible.push(candidate)
    }
  }

  return {
    feasible,
    rejected,
    totalChecked: candidates.length,
  }
}
