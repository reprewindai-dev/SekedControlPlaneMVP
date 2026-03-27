export const ARCHITECTURE_LAWSET_VERSION = '2026-03-24.b'

export const ARCHITECTURE_LAWS = {
  integrationFirst: true,
  frameworkPluggable: true,
  providerIsolation: true,
  normalizedSignalModel: true,
  policyProviderSeparation: true,
  proofFirstOutputs: true,
  offlineDeterminism: true,
} as const

export const FORBIDDEN_ROUTE_IMPORT_PATTERNS = [
  '/lib/grid-signals/',
  '/lib/watttime',
  '/lib/ember',
  '/lib/denmark-carbon',
  '/lib/finland-carbon',
  '/lib/regional/',
] as const

export const FORBIDDEN_POLICY_IMPORT_PATTERNS = [
  '/lib/grid-signals/',
  '/lib/watttime',
  '/lib/ember',
  '/lib/denmark-carbon',
  '/lib/finland-carbon',
  '/lib/regional/',
  '/lib/carbon/provider-router',
  '/seked/orchestration',
  '/seked/control-plane',
] as const

export const REQUIRED_NORMALIZED_SIGNAL_FILES = [
  'src/lib/carbon/provider-router.ts',
  'src/lib/water/bundle.ts',
  'src/lib/water/types.ts',
  'src/lib/water/policy.ts',
  'src/lib/policy/seked-policy-adapter.ts',
  'src/lib/ci/contracts.ts',
  'src/lib/ci/decision-events.ts',
  'src/lib/db/schema-readiness.ts',
] as const

export const REQUIRED_RUNBOOK_FILES = [
  'src/runbooks/rollback.md',
  'src/runbooks/degraded-mode.md',
  'src/runbooks/provider-outage.md',
  'src/runbooks/stale-water-bundle.md',
  'src/runbooks/hook-timeout.md',
] as const
