export type WaterPolicyProfile =
  | 'default'
  | 'drought_sensitive'
  | 'eu_data_center_reporting'
  | 'high_water_sensitivity'

export type WaterDecisionAction = 'run_now' | 'reroute' | 'delay' | 'throttle' | 'deny'
export type WaterDecisionMode = 'runtime_authorization' | 'scenario_planning'
export type WaterScenario = 'current' | '2030' | '2050' | '2080'
export type WaterAuthorityMode = 'basin' | 'facility_overlay' | 'fallback'

export interface WaterSupplierProvenance {
  supplier: string
  authorityRole: 'baseline' | 'overlay' | 'facility'
  datasetVersion: string
  fileHash?: string | null
  observedAt?: string | null
}

export interface WaterFacilityOverlay {
  facility_id: string
  water_intensity_l_per_kwh?: number | null
  water_stress_score?: number | null
  scarcity_factor?: number | null
  confidence?: number | null
  telemetry_ref?: string | null
  evidence_refs?: string[]
  observed_at?: string | null
  source?: string[] | null
}

export interface WaterScenarioProjection {
  water_stress_score?: number | null
  water_quality_index?: number | null
  drought_risk_score?: number | null
  scarcity_factor_annual?: number | null
  scarcity_factor_monthly?: Record<string, number>
  confidence?: number | null
  evidence_refs?: string[]
}

export interface WaterBundleRegion {
  water_stress_score: number
  water_quality_index?: number | null
  drought_risk_score?: number | null
  scarcity_factor_annual: number
  scarcity_factor_monthly?: Record<string, number>
  water_intensity_l_per_kwh: number
  confidence: number
  sources: string[]
  dataset_versions: Record<string, string>
  supplier_provenance?: WaterSupplierProvenance[]
  facility_overlays?: Record<string, WaterFacilityOverlay>
  scenario_projections?: Partial<Record<Exclude<WaterScenario, 'current'>, WaterScenarioProjection>>
}

export interface WaterBundleArtifact {
  schema_version: string
  generated_at: string
  suppliers?: Record<string, WaterSupplierProvenance>
  regions: Record<string, WaterBundleRegion>
}

export interface WaterManifestDataset {
  name: string
  source_url: string
  file_hash: string
  downloaded_at: string
  dataset_version: string
}

export interface WaterManifestArtifact {
  built_at: string
  schema_version: string
  datasets: WaterManifestDataset[]
}

export interface WaterSignal {
  region: string
  waterIntensityLPerKwh: number
  waterStressIndex: number
  waterQualityIndex: number | null
  droughtRiskIndex: number | null
  scarcityFactor: number
  source: string[]
  datasetVersions: Record<string, string>
  confidence: number
  fallbackUsed: boolean
  dataQuality: 'high' | 'medium' | 'low'
  signalType: 'average_operational'
  referenceTime: string
  authorityMode: WaterAuthorityMode
  scenario: WaterScenario
  facilityId: string | null
  supplierSet: string[]
  evidenceRefs: string[]
  telemetryRef: string | null
  artifactGeneratedAt: string | null
}

export interface WaterAuthority {
  authorityMode: WaterAuthorityMode
  scenario: WaterScenario
  confidence: number
  supplierSet: string[]
  evidenceRefs: string[]
  facilityId: string | null
  telemetryRef: string | null
  bundleHash: string | null
  manifestHash: string | null
}

export interface WaterArtifactMetadata {
  bundleHash: string | null
  manifestHash: string | null
  bundleGeneratedAt: string | null
  manifestBuiltAt: string | null
  datasetHashesPresent: boolean
  sourceCount: number
  suppliers: string[]
}

export interface WaterProviderStatus {
  provider: string
  authorityRole: 'baseline' | 'overlay' | 'facility'
  datasetVersion: string
  freshnessSec: number | null
  fileHash: string | null
  lastObservedAt: string | null
  authorityStatus: 'authoritative' | 'advisory' | 'fallback'
}

export interface WaterPolicyTrace {
  policyVersion: string
  profile: WaterPolicyProfile
  thresholds: {
    stressDeny: number
    stressDelay: number
    scarcityDeny: number
    scarcityDelay: number
  }
  guardrailTriggered: boolean
  fallbackUsed: boolean
  strictMode: boolean
  reasonCodes: string[]
  externalPolicy?: {
    enabled: boolean
    strict: boolean
    evaluated: boolean
    applied: boolean
    hookStatus: 'not_configured' | 'skipped' | 'success' | 'error'
    reasonCodes: string[]
    policyReference?: string | null
  }
  sekedPolicy?: {
    enabled: boolean
    strict: boolean
    evaluated: boolean
    applied: boolean
    hookStatus: 'not_configured' | 'skipped' | 'success' | 'error'
    reasonCodes: string[]
    policyReference?: string | null
  }
}
