import type { RoutingSignal } from '../carbon/provider-router'
import { sha256Canonical } from '../proof/export-chain'
import type { WaterAuthority, WaterDecisionAction, WaterPolicyProfile, WaterSignal } from '../water/types'

export const DECISION_DOCTRINE_VERSION = 'co2_router_doctrine_v1'

export const DETERMINISTIC_CONFLICT_HIERARCHY = [
  'policy_hard_override',
  'water_guardrail',
  'latency_sla_protection',
  'carbon_optimization_within_allowed_envelope',
  'cost_tie_breaker',
] as const

export type DeterministicConflictLayer = (typeof DETERMINISTIC_CONFLICT_HIERARCHY)[number]

export type CandidateExplanation = {
  region: string
  reason: string
}

export type CandidateLike = {
  region: string
  score: number
  carbonIntensity: number
  carbonSourceUsed: string
  carbonDisagreementFlag: boolean
  carbonDisagreementPct: number
  carbonFallbackUsed: boolean
  waterSignal: WaterSignal
  waterImpactLiters: number
  scarcityImpact: number
  guardrailCandidateBlocked: boolean
  guardrailReasons: string[]
  providerSnapshotRef: string
  waterAuthority: WaterAuthority
}

export interface AssuranceStatus {
  operationallyUsable: boolean
  assuranceReady: boolean
  status: 'operational' | 'assurance_ready' | 'degraded'
  issues: string[]
}

export type MSSHealthState = 'HEALTHY' | 'DEGRADED' | 'FAILED'

export interface MSSState {
  snapshotId: string
  carbonProvider: string
  carbonProviderHealth: MSSHealthState
  waterAuthorityHealth: MSSHealthState
  carbonFreshnessSec: number | null
  waterFreshnessSec: number | null
  cacheStatus: 'live' | 'warm' | 'fallback'
  disagreement: {
    flag: boolean
    pct: number
  }
  lastKnownGoodApplied: boolean
  carbonLineage: string[]
  waterLineage: string[]
}

export interface DecisionExplanation {
  hierarchy: readonly DeterministicConflictLayer[]
  whyAction: string
  whyTarget: string
  rejectedAlternatives: CandidateExplanation[]
}

export function resolveBaselineCandidate<T extends { region: string }>(
  preferredRegions: string[],
  candidates: T[],
  selected: T
): T {
  for (const preferredRegion of preferredRegions) {
    const match = candidates.find((candidate) => candidate.region === preferredRegion)
    if (match) return match
  }
  return selected
}

export function buildAssuranceStatus(input: {
  datasetHashesPresent: boolean
  bundleHealthy: boolean
  manifestHealthy: boolean
  waterFallbackUsed: boolean
  carbonFallbackUsed: boolean
  manifestDatasets: Array<{ name: string; file_hash: string | null | undefined }>
}): AssuranceStatus {
  const issues: string[] = []
  const unhashedDatasets = input.manifestDatasets
    .filter((dataset) => !dataset.file_hash || dataset.file_hash === 'unverified')
    .map((dataset) => dataset.name)

  if (!input.bundleHealthy || !input.manifestHealthy) {
    issues.push('water_artifacts_not_healthy')
  }
  if (unhashedDatasets.length > 0) {
    issues.push(`water_dataset_hashes_unverified:${unhashedDatasets.join(',')}`)
  }
  if (input.waterFallbackUsed) {
    issues.push('water_authority_in_fallback_mode')
  }
  if (input.carbonFallbackUsed) {
    issues.push('carbon_signal_in_fallback_mode')
  }

  const operationallyUsable = input.bundleHealthy && input.manifestHealthy
  const assuranceReady = operationallyUsable && input.datasetHashesPresent && !input.waterFallbackUsed && !input.carbonFallbackUsed

  return {
    operationallyUsable,
    assuranceReady,
    status: assuranceReady ? 'assurance_ready' : operationallyUsable ? 'operational' : 'degraded',
    issues,
  }
}

function resolveHealthState(input: {
  confidence: number
  fallbackUsed: boolean
  disagreementPct?: number
  freshnessSec: number | null
  staleAfterSec: number
}): MSSHealthState {
  if (input.fallbackUsed) return 'FAILED'
  if (input.freshnessSec === null) return 'DEGRADED'
  if (input.freshnessSec > input.staleAfterSec) return 'FAILED'
  if (input.confidence < 0.6) return 'DEGRADED'
  if ((input.disagreementPct ?? 0) > 15) return 'DEGRADED'
  return 'HEALTHY'
}

export function buildMssState(input: {
  candidate: CandidateLike
  assurance: AssuranceStatus
  carbonFreshnessSec: number | null
  waterFreshnessSec: number | null
  cacheStatus: 'live' | 'warm' | 'fallback'
}): MSSState {
  const snapshotId = sha256Canonical({
    providerSnapshotRef: input.candidate.providerSnapshotRef,
    bundleHash: input.candidate.waterAuthority.bundleHash,
    manifestHash: input.candidate.waterAuthority.manifestHash,
    authorityMode: input.candidate.waterAuthority.authorityMode,
    scenario: input.candidate.waterAuthority.scenario,
  })

  return {
    snapshotId,
    carbonProvider: input.candidate.carbonSourceUsed,
    carbonProviderHealth: resolveHealthState({
      confidence: input.candidate.carbonFallbackUsed ? 0.05 : 0.85,
      fallbackUsed: input.candidate.carbonFallbackUsed,
      disagreementPct: input.candidate.carbonDisagreementPct,
      freshnessSec: input.carbonFreshnessSec,
      staleAfterSec: 900,
    }),
    waterAuthorityHealth: resolveHealthState({
      confidence: input.candidate.waterSignal.confidence,
      fallbackUsed: input.candidate.waterSignal.fallbackUsed || !input.assurance.operationallyUsable,
      freshnessSec: input.waterFreshnessSec,
      staleAfterSec: 172800,
    }),
    carbonFreshnessSec: input.carbonFreshnessSec,
    waterFreshnessSec: input.waterFreshnessSec,
    cacheStatus: input.cacheStatus,
    disagreement: {
      flag: input.candidate.carbonDisagreementFlag,
      pct: Number(input.candidate.carbonDisagreementPct.toFixed(3)),
    },
    lastKnownGoodApplied:
      input.cacheStatus === 'warm' || input.candidate.carbonFallbackUsed || input.candidate.waterSignal.fallbackUsed,
    carbonLineage: Array.from(new Set([input.candidate.carbonSourceUsed, input.candidate.providerSnapshotRef])),
    waterLineage: Array.from(new Set(input.candidate.waterAuthority.evidenceRefs)),
  }
}

export function buildDecisionExplanation(input: {
  decision: WaterDecisionAction
  reasonCode: string
  selected: CandidateLike
  baseline: CandidateLike
  candidates: CandidateLike[]
  profile: WaterPolicyProfile
}): DecisionExplanation {
  const rejectedAlternatives = input.candidates
    .filter((candidate) => candidate.region !== input.selected.region)
    .slice(0, 6)
    .map((candidate) => {
      if (candidate.guardrailCandidateBlocked) {
        return {
          region: candidate.region,
          reason: `Rejected by water guardrail (${candidate.guardrailReasons.join(', ')})`,
        }
      }
      if (candidate.score > input.selected.score) {
        return {
          region: candidate.region,
          reason: `Higher deterministic score (${candidate.score.toFixed(3)}) than selected target ${input.selected.region}.`,
        }
      }
      if (candidate.carbonDisagreementFlag) {
        return {
          region: candidate.region,
          reason: `Lower defensibility due to provider disagreement (${candidate.carbonDisagreementPct.toFixed(1)}%).`,
        }
      }
      return {
        region: candidate.region,
        reason: 'Not selected after deterministic hierarchy evaluation.',
      }
    })

  const actionMap: Record<WaterDecisionAction, string> = {
    run_now: `Allowed immediately because ${input.selected.region} stayed within policy, water, and SLA constraints under the ${input.profile} doctrine.`,
    reroute: `Rerouted because the selected target offered the safest allowed envelope before execution while preserving binding policy constraints.`,
    delay: `Delayed because no safe immediate execution path beat the active doctrine and delaying preserved environmental and policy integrity.`,
    throttle: `Throttled because the workload remained protected for execution but required a lower-intensity posture under active constraints.`,
    deny: `Denied because the request could not satisfy mandatory pre-execution doctrine without breaching policy or environmental constraints.`,
  }

  const whyTarget =
    input.selected.region === input.baseline.region
      ? `${input.selected.region} remained the default and selected target because no allowed alternative beat it on deterministic score.`
      : `${input.selected.region} beat baseline ${input.baseline.region} after policy, water, latency/SLA, carbon, and cost were evaluated in fixed order.`

  return {
    hierarchy: DETERMINISTIC_CONFLICT_HIERARCHY,
    whyAction: `${actionMap[input.decision]} Reason code: ${input.reasonCode}.`,
    whyTarget,
    rejectedAlternatives,
  }
}

export function deriveSourceMode(input: {
  decisionMode: 'runtime_authorization' | 'scenario_planning'
  fallbackUsed: boolean
}): 'live' | 'simulation' | 'degraded' {
  if (input.decisionMode === 'scenario_planning') return 'simulation'
  if (input.fallbackUsed) return 'degraded'
  return 'live'
}

export function deriveSignalLineage(input: {
  signal: RoutingSignal
  waterSignal: WaterSignal
}): string[] {
  return Array.from(
    new Set([
      input.signal.provenance.sourceUsed,
      ...input.signal.provenance.contributingSources,
      ...input.waterSignal.source,
    ])
  )
}
