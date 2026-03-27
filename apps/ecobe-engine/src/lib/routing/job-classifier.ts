/**
 * Job Classifier — Routing Spec v1
 *
 * Classifies workloads into execution classes that determine
 * scoring weights, time-window strategies, and constraint handling.
 *
 * Classes:
 *   REALTIME     — API inference, sync flows. SLA-first, carbon as tie-breaker.
 *   SOFT_DEADLINE — Reports, async AI. Balanced carbon/cost/latency.
 *   BATCH        — ETL, retraining, backfills. Carbon-first, aggressive time-shifting.
 */

export type JobClass = 'realtime' | 'soft_deadline' | 'batch'

export interface JobClassification {
  jobClass: JobClass
  flexWindowHours: number       // How many hours the job can be shifted
  timeSlotMinutes: number       // Granularity of candidate time slots
  canTimeShift: boolean         // Whether the job can be delayed
  canRegionShift: boolean       // Whether the job can move regions
  weights: ScoringWeights
}

export interface ScoringWeights {
  carbon: number
  latency: number
  cost: number
  queue: number
  uncertainty: number
  retryRisk: number
}

// ── Per-class weight presets ───────────────────────────────────────────────────

const REALTIME_WEIGHTS: ScoringWeights = {
  carbon: 0.20,
  latency: 0.40,
  cost: 0.15,
  queue: 0.15,
  uncertainty: 0.05,
  retryRisk: 0.05,
}

const SOFT_DEADLINE_WEIGHTS: ScoringWeights = {
  carbon: 0.35,
  latency: 0.20,
  cost: 0.15,
  queue: 0.10,
  uncertainty: 0.10,
  retryRisk: 0.10,
}

const BATCH_WEIGHTS: ScoringWeights = {
  carbon: 0.50,
  latency: 0.05,
  cost: 0.15,
  queue: 0.10,
  uncertainty: 0.10,
  retryRisk: 0.10,
}

// ── Classification logic ───────────────────────────────────────────────────────

interface ClassificationInput {
  workloadType?: string
  executionMode?: 'immediate' | 'scheduled' | 'advisory'
  latencySlaMs?: number
  deadlineAt?: string | Date
  estimatedRuntimeSec?: number
  allowTimeShifting?: boolean
  priority?: 'low' | 'medium' | 'high' | 'critical'
  candidateStartWindowHours?: number
}

/**
 * Classify a workload into an execution class.
 * Uses heuristics based on workload characteristics.
 */
export function classifyJob(input: ClassificationInput): JobClassification {
  // Explicit mode overrides
  if (input.executionMode === 'immediate' || input.priority === 'critical') {
    return buildClassification('realtime', input)
  }

  if (input.executionMode === 'scheduled' && (input.candidateStartWindowHours ?? 0) >= 4) {
    return buildClassification('batch', input)
  }

  // Heuristic: strict latency SLA → realtime
  if (input.latencySlaMs && input.latencySlaMs <= 500) {
    return buildClassification('realtime', input)
  }

  // Heuristic: long deadline window → batch
  const deadlineDate = input.deadlineAt ? new Date(input.deadlineAt) : null
  if (deadlineDate) {
    const hoursUntilDeadline = (deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60)
    const runtimeHours = (input.estimatedRuntimeSec ?? 3600) / 3600

    if (hoursUntilDeadline > runtimeHours * 4) {
      // Lots of slack → batch
      return buildClassification('batch', input)
    }
    if (hoursUntilDeadline > runtimeHours * 2) {
      // Some slack → soft_deadline
      return buildClassification('soft_deadline', input)
    }
    // Tight → realtime
    return buildClassification('realtime', input)
  }

  // Heuristic: workload type patterns
  const type = (input.workloadType ?? '').toLowerCase()

  if (['inference', 'api', 'sync', 'realtime', 'chat', 'completion'].some(k => type.includes(k))) {
    return buildClassification('realtime', input)
  }

  if (['etl', 'training', 'retraining', 'backfill', 'embedding', 'batch', 'analytics'].some(k => type.includes(k))) {
    return buildClassification('batch', input)
  }

  if (['report', 'enrichment', 'analysis', 'generation', 'pipeline'].some(k => type.includes(k))) {
    return buildClassification('soft_deadline', input)
  }

  // Heuristic: time shifting preference
  if (input.allowTimeShifting === true) {
    return buildClassification('soft_deadline', input)
  }
  if (input.allowTimeShifting === false) {
    return buildClassification('realtime', input)
  }

  // Default
  return buildClassification('soft_deadline', input)
}

function buildClassification(jobClass: JobClass, input: ClassificationInput): JobClassification {
  switch (jobClass) {
    case 'realtime':
      return {
        jobClass: 'realtime',
        flexWindowHours: 0,
        timeSlotMinutes: 0, // Immediate only
        canTimeShift: false,
        canRegionShift: true,
        weights: { ...REALTIME_WEIGHTS },
      }
    case 'soft_deadline':
      return {
        jobClass: 'soft_deadline',
        flexWindowHours: Math.min(input.candidateStartWindowHours ?? 6, 24),
        timeSlotMinutes: 60, // Hourly slots
        canTimeShift: true,
        canRegionShift: true,
        weights: { ...SOFT_DEADLINE_WEIGHTS },
      }
    case 'batch':
      return {
        jobClass: 'batch',
        flexWindowHours: Math.min(input.candidateStartWindowHours ?? 24, 168),
        timeSlotMinutes: 15, // 15-minute slots for max optimization
        canTimeShift: true,
        canRegionShift: true,
        weights: { ...BATCH_WEIGHTS },
      }
  }
}

/**
 * Override weights for a specific classification.
 * Used by adaptive optimization to tune per-org weights.
 */
export function applyWeightOverrides(
  classification: JobClassification,
  overrides: Partial<ScoringWeights>
): JobClassification {
  const weights = { ...classification.weights }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && key in weights) {
      (weights as any)[key] = value
    }
  }

  // Re-normalize to sum to 1.0
  const total = Object.values(weights).reduce((s, v) => s + v, 0) || 1
  for (const key of Object.keys(weights)) {
    (weights as any)[key] = (weights as any)[key] / total
  }

  return { ...classification, weights }
}
