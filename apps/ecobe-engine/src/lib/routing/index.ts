/**
 * Routing Infrastructure Layer — Barrel Export
 *
 * ECOBE Routing Spec v1 implementation:
 *   Job Classifier → Candidate Generator → Feasibility Filter →
 *   Scoring Engine → Capacity Manager → Carbon Ledger
 */

export { classifyJob, applyWeightOverrides } from './job-classifier'
export type { JobClass, JobClassification, ScoringWeights } from './job-classifier'

export { generateCandidates } from './candidate-generator'
export type { RoutingCandidate, CandidateGenerationInput } from './candidate-generator'

export { applyFeasibilityFilter } from './feasibility-filter'
export type { FeasibilityConstraints, FeasibilityResult } from './feasibility-filter'

export { scoreCandidates } from './scoring-engine'
export type { ScoringResult } from './scoring-engine'

export {
  getCapacityBucket,
  hasCapacity,
  reserveCapacity,
  releaseCapacity,
  getCapacityOverview,
  updateCostMultipliers,
} from './capacity-manager'

export {
  recordLedgerEntry,
  verifyLedgerEntry,
  getOrgCarbonSavings,
  generateCarbonReport,
} from './carbon-ledger'

export {
  storeProviderSnapshot,
  storeProviderSnapshotBatch,
  getLatestSnapshots,
  getProviderFreshness,
  cleanupOldSnapshots,
} from './provider-snapshots'
