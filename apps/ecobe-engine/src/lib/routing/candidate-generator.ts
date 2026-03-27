/**
 * Candidate Generator — Routing Spec v1
 *
 * Generates feasible (region, start_time) candidates based on
 * job classification, constraints, and provider forecasts.
 */

import type { JobClassification } from './job-classifier'

export interface RoutingCandidate {
  candidateId: string
  region: string
  startTs: Date

  // Estimates (filled by signal aggregator)
  carbonEstimateGPerKwh: number | null
  latencyEstimateMs: number | null
  queueDelayEstimateSec: number | null
  costEstimateUsd: number | null
  confidenceScore: number | null
  retryRiskScore: number | null

  // Grid intelligence
  balancingAuthority: string | null
  demandRampPct: number | null
  carbonSpikeProbability: number | null
  curtailmentProbability: number | null
  importCarbonLeakageScore: number | null
  estimatedFlag: boolean
  syntheticFlag: boolean

  // Scoring (filled by scoring engine)
  carbonScore: number | null
  latencyScore: number | null
  costScore: number | null
  queueScore: number | null
  uncertaintyScore: number | null
  rankScore: number | null

  // Feasibility
  isFeasible: boolean
  rejectionReason: string | null
}

export interface CandidateGenerationInput {
  classification: JobClassification
  allowedRegions: string[]
  excludedRegions?: string[]
  deadlineTs?: Date
  earliestStartTs?: Date
  estimatedRuntimeSec?: number
  dataResidency?: string[]
  maxCandidates?: number
}

const DEFAULT_REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'ap-southeast-1',
  'ap-northeast-1',
]

/**
 * Generate all feasible (region × time_slot) candidates for routing evaluation.
 */
export function generateCandidates(input: CandidateGenerationInput): RoutingCandidate[] {
  const {
    classification,
    allowedRegions,
    excludedRegions = [],
    deadlineTs,
    earliestStartTs,
    estimatedRuntimeSec = 3600,
    dataResidency,
    maxCandidates = 200,
  } = input

  // Filter regions
  let regions = allowedRegions.length > 0 ? allowedRegions : DEFAULT_REGIONS
  regions = regions.filter(r => !excludedRegions.includes(r))

  // Apply data residency filter
  if (dataResidency && dataResidency.length > 0) {
    regions = regions.filter(r => {
      const regionCountry = extractCountryFromRegion(r)
      return dataResidency.some(dr => dr.toLowerCase() === regionCountry.toLowerCase())
    })
  }

  if (regions.length === 0) {
    return []
  }

  // Generate time slots
  const now = new Date()
  const start = earliestStartTs && earliestStartTs > now ? earliestStartTs : now
  const timeSlots = generateTimeSlots(start, classification, deadlineTs, estimatedRuntimeSec)

  // Build candidate matrix: region × time_slot
  const candidates: RoutingCandidate[] = []
  let candidateIndex = 0

  for (const region of regions) {
    for (const slot of timeSlots) {
      if (candidates.length >= maxCandidates) break

      // Check deadline feasibility
      const estimatedFinish = new Date(slot.getTime() + estimatedRuntimeSec * 1000)
      const deadlineBuffer = estimatedRuntimeSec * 0.1 * 1000 // 10% buffer per spec
      const isFeasible = !deadlineTs || estimatedFinish.getTime() + deadlineBuffer <= deadlineTs.getTime()

      candidates.push({
        candidateId: `cand_${candidateIndex++}`,
        region,
        startTs: slot,

        // To be filled by signal aggregator
        carbonEstimateGPerKwh: null,
        latencyEstimateMs: null,
        queueDelayEstimateSec: null,
        costEstimateUsd: null,
        confidenceScore: null,
        retryRiskScore: null,

        // Grid intelligence (to be filled)
        balancingAuthority: null,
        demandRampPct: null,
        carbonSpikeProbability: null,
        curtailmentProbability: null,
        importCarbonLeakageScore: null,
        estimatedFlag: false,
        syntheticFlag: false,

        // Scoring (to be filled)
        carbonScore: null,
        latencyScore: null,
        costScore: null,
        queueScore: null,
        uncertaintyScore: null,
        rankScore: null,

        // Feasibility
        isFeasible,
        rejectionReason: isFeasible ? null : 'DEADLINE_EXCEEDED',
      })
    }
  }

  return candidates
}

/**
 * Generate time slots based on job classification.
 */
function generateTimeSlots(
  start: Date,
  classification: JobClassification,
  deadline?: Date,
  estimatedRuntimeSec: number = 3600
): Date[] {
  const slots: Date[] = []

  if (!classification.canTimeShift) {
    // Realtime: immediate only
    slots.push(new Date(start))
    return slots
  }

  const slotIntervalMs = classification.timeSlotMinutes * 60 * 1000
  const maxWindowMs = classification.flexWindowHours * 60 * 60 * 1000

  // Cap at deadline if set
  const effectiveEndMs = deadline
    ? Math.min(start.getTime() + maxWindowMs, deadline.getTime() - estimatedRuntimeSec * 1000)
    : start.getTime() + maxWindowMs

  if (effectiveEndMs <= start.getTime()) {
    // No room to shift — immediate only
    slots.push(new Date(start))
    return slots
  }

  // Generate slots
  let current = start.getTime()
  const maxSlots = 96 // Cap at 96 slots to prevent runaway

  while (current <= effectiveEndMs && slots.length < maxSlots) {
    slots.push(new Date(current))
    current += slotIntervalMs
  }

  return slots
}

/**
 * Extract country code from cloud region string.
 */
function extractCountryFromRegion(region: string): string {
  const prefixMap: Record<string, string> = {
    'us-': 'us',
    'eu-': 'eu',
    'ap-': 'ap',
    'ca-': 'ca',
    'sa-': 'sa',
    'me-': 'me',
    'af-': 'af',
  }

  for (const [prefix, code] of Object.entries(prefixMap)) {
    if (region.startsWith(prefix)) return code
  }

  return region.split('-')[0]
}
