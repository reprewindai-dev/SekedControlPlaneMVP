import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import type {
  WaterArtifactMetadata,
  WaterAuthority,
  WaterBundleArtifact,
  WaterFacilityOverlay,
  WaterManifestArtifact,
  WaterProviderStatus,
  WaterScenario,
  WaterSignal,
  WaterSupplierProvenance,
} from './types'

const ROOT = path.resolve(process.cwd())
const WATER_BUNDLE_PATH = path.join(ROOT, 'data', 'normalized', 'water', 'water.bundle.json')
const WATER_MANIFEST_PATH = path.join(ROOT, 'data', 'normalized', 'water', 'manifest.json')
const WATER_LKG_DIR = path.join(ROOT, 'data', 'normalized', 'water', '.lkg')
const WATER_LKG_BUNDLE_PATH = path.join(WATER_LKG_DIR, 'water.bundle.json')
const WATER_LKG_MANIFEST_PATH = path.join(WATER_LKG_DIR, 'manifest.json')
const REQUIRED_SCHEMA_VERSION = 'water_bundle_v2'

const supplierProvenanceSchema = z.object({
  supplier: z.string(),
  authorityRole: z.enum(['baseline', 'overlay', 'facility']),
  datasetVersion: z.string(),
  fileHash: z.string().nullable().optional(),
  observedAt: z.string().nullable().optional(),
})

const facilityOverlaySchema = z.object({
  facility_id: z.string(),
  water_intensity_l_per_kwh: z.number().nonnegative().nullable().optional(),
  water_stress_score: z.number().min(0).max(5).nullable().optional(),
  scarcity_factor: z.number().positive().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  telemetry_ref: z.string().nullable().optional(),
  evidence_refs: z.array(z.string()).optional(),
  observed_at: z.string().nullable().optional(),
  source: z.array(z.string()).nullable().optional(),
})

const scenarioProjectionSchema = z.object({
  water_stress_score: z.number().min(0).max(5).nullable().optional(),
  water_quality_index: z.number().min(0).max(5).nullable().optional(),
  drought_risk_score: z.number().min(0).max(5).nullable().optional(),
  scarcity_factor_annual: z.number().positive().nullable().optional(),
  scarcity_factor_monthly: z.record(z.string(), z.number().positive()).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  evidence_refs: z.array(z.string()).optional(),
})

const waterRegionSchemaV2 = z.object({
  water_stress_score: z.number().min(0).max(5),
  water_quality_index: z.number().min(0).max(5).nullable().optional(),
  drought_risk_score: z.number().min(0).max(5).nullable().optional(),
  scarcity_factor_annual: z.number().positive(),
  scarcity_factor_monthly: z.record(z.string(), z.number().positive()).optional(),
  water_intensity_l_per_kwh: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()).min(1),
  dataset_versions: z.record(z.string(), z.string()),
  supplier_provenance: z.array(supplierProvenanceSchema).optional(),
  facility_overlays: z.record(z.string(), facilityOverlaySchema).optional(),
  scenario_projections: z
    .object({
      '2030': scenarioProjectionSchema.optional(),
      '2050': scenarioProjectionSchema.optional(),
      '2080': scenarioProjectionSchema.optional(),
    })
    .partial()
    .optional(),
})

const waterRegionSchemaV1 = z.object({
  water_stress_score: z.number().min(0).max(5),
  water_quality_index: z.number().min(0).max(5).nullable().optional(),
  drought_risk_score: z.number().min(0).max(5).nullable().optional(),
  scarcity_factor_annual: z.number().positive(),
  scarcity_factor_monthly: z.record(z.string(), z.number().positive()).optional(),
  water_intensity_l_per_kwh: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()).min(1),
  dataset_versions: z.record(z.string(), z.string()),
})

const waterBundleSchemaV2 = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  suppliers: z.record(z.string(), supplierProvenanceSchema).optional(),
  regions: z.record(z.string(), waterRegionSchemaV2),
})

const waterBundleSchemaV1 = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  regions: z.record(z.string(), waterRegionSchemaV1),
})

const waterManifestSchema = z.object({
  built_at: z.string(),
  schema_version: z.string(),
  datasets: z.array(
    z.object({
      name: z.string(),
      source_url: z.string(),
      file_hash: z.string(),
      downloaded_at: z.string(),
      dataset_version: z.string(),
    })
  ),
})

let cachedBundle: WaterBundleArtifact | null = null
let cachedManifest: WaterManifestArtifact | null = null
let cachedArtifactMetadata: WaterArtifactMetadata | null = null

function sha256FileContents(filePath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  } catch {
    return null
  }
}

function deriveDataQuality(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.6) return 'medium'
  return 'low'
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const tempPath = `${filePath}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tempPath, filePath)
}

function buildSupplierProvenance(
  source: string,
  datasetVersions: Record<string, string>,
  manifest: WaterManifestArtifact
): WaterSupplierProvenance {
  const normalized = source.toLowerCase()
  const datasetName =
    normalized.includes('aqueduct')
      ? 'aqueduct'
      : normalized.includes('wwf')
        ? 'wwf'
        : normalized.includes('aware')
          ? 'aware'
          : normalized.includes('smart_flow') || normalized.includes('scada') || normalized.includes('iot')
            ? 'facility_telemetry'
            : normalized.includes('nrel')
              ? 'nrel'
              : normalized.replace(/[^a-z0-9]+/g, '_')

  const manifestDataset = manifest.datasets.find((dataset) => dataset.name === datasetName)
  return {
    supplier: datasetName,
    authorityRole:
      datasetName === 'aqueduct' ? 'baseline' : datasetName === 'facility_telemetry' ? 'facility' : 'overlay',
    datasetVersion:
      datasetVersions[datasetName] ??
      manifestDataset?.dataset_version ??
      datasetVersions[source] ??
      'unknown',
    fileHash: manifestDataset?.file_hash ?? null,
    observedAt: manifestDataset?.downloaded_at ?? null,
  }
}

function normalizeBundle(
  bundleInput: unknown,
  manifest: WaterManifestArtifact
): WaterBundleArtifact {
  const parsedV2 = waterBundleSchemaV2.safeParse(bundleInput)
  if (parsedV2.success) {
    return {
      ...parsedV2.data,
      schema_version: REQUIRED_SCHEMA_VERSION,
      suppliers:
        parsedV2.data.suppliers ??
        manifest.datasets.reduce<Record<string, WaterSupplierProvenance>>((acc, dataset) => {
          acc[dataset.name] = {
            supplier: dataset.name,
            authorityRole: dataset.name === 'aqueduct' ? 'baseline' : 'overlay',
            datasetVersion: dataset.dataset_version,
            fileHash: dataset.file_hash,
            observedAt: dataset.downloaded_at,
          }
          return acc
        }, {}),
      regions: Object.fromEntries(
        Object.entries(parsedV2.data.regions).map(([region, value]) => [
          region,
          {
            ...value,
            supplier_provenance:
              value.supplier_provenance ??
              value.sources.map((source) => buildSupplierProvenance(source, value.dataset_versions, manifest)),
          },
        ])
      ),
    }
  }

  const parsedV1 = waterBundleSchemaV1.parse(bundleInput)
  return {
    schema_version: REQUIRED_SCHEMA_VERSION,
    generated_at: parsedV1.generated_at,
    suppliers: manifest.datasets.reduce<Record<string, WaterSupplierProvenance>>((acc, dataset) => {
      acc[dataset.name] = {
        supplier: dataset.name,
        authorityRole: dataset.name === 'aqueduct' ? 'baseline' : 'overlay',
        datasetVersion: dataset.dataset_version,
        fileHash: dataset.file_hash,
        observedAt: dataset.downloaded_at,
      }
      return acc
    }, {}),
    regions: Object.fromEntries(
      Object.entries(parsedV1.regions).map(([region, value]) => [
        region,
        {
          ...value,
          supplier_provenance: value.sources.map((source) =>
            buildSupplierProvenance(source, value.dataset_versions, manifest)
          ),
          facility_overlays: {},
          scenario_projections: {},
        },
      ])
    ),
  }
}

function computeArtifactMetadata(
  bundle: WaterBundleArtifact,
  manifest: WaterManifestArtifact
): WaterArtifactMetadata {
  const suppliers = Array.from(
    new Set(
      Object.values(bundle.regions).flatMap((region) =>
        (region.supplier_provenance ?? []).map((provenance) => provenance.supplier)
      )
    )
  ).sort()

  return {
    bundleHash: sha256FileContents(WATER_BUNDLE_PATH),
    manifestHash: sha256FileContents(WATER_MANIFEST_PATH),
    bundleGeneratedAt: bundle.generated_at ?? null,
    manifestBuiltAt: manifest.built_at ?? null,
    datasetHashesPresent: manifest.datasets.every(
      (dataset) => Boolean(dataset.file_hash) && dataset.file_hash !== 'unverified'
    ),
    sourceCount: suppliers.length,
    suppliers,
  }
}

function snapshotWaterArtifactsAsLastKnownGood(
  bundle: WaterBundleArtifact,
  manifest: WaterManifestArtifact
) {
  if (process.env.NODE_ENV === 'test') return
  try {
    ensureDir(WATER_LKG_DIR)
    writeJsonAtomic(WATER_LKG_BUNDLE_PATH, bundle)
    writeJsonAtomic(WATER_LKG_MANIFEST_PATH, manifest)
  } catch (error) {
    console.warn('Failed to update water last-known-good snapshot:', error)
  }
}

export function getWaterArtifactPaths() {
  return {
    bundlePath: WATER_BUNDLE_PATH,
    manifestPath: WATER_MANIFEST_PATH,
    requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
  }
}

export function loadWaterArtifacts(forceReload = false): {
  bundle: WaterBundleArtifact
  manifest: WaterManifestArtifact
} {
  if (!forceReload && cachedBundle && cachedManifest) {
    return { bundle: cachedBundle, manifest: cachedManifest }
  }

  const bundleRaw = fs.readFileSync(WATER_BUNDLE_PATH, 'utf8')
  const manifestRaw = fs.readFileSync(WATER_MANIFEST_PATH, 'utf8')
  const manifest = waterManifestSchema.parse(JSON.parse(manifestRaw))
  const bundle = normalizeBundle(JSON.parse(bundleRaw), manifest)

  cachedBundle = bundle
  cachedManifest = manifest
  cachedArtifactMetadata = computeArtifactMetadata(bundle, manifest)
  snapshotWaterArtifactsAsLastKnownGood(bundle, manifest)

  return { bundle, manifest }
}

export function getWaterArtifactMetadata(forceReload = false): WaterArtifactMetadata {
  if (!forceReload && cachedArtifactMetadata) return cachedArtifactMetadata
  const { bundle, manifest } = loadWaterArtifacts(forceReload)
  cachedArtifactMetadata = computeArtifactMetadata(bundle, manifest)
  return cachedArtifactMetadata
}

export function recoverWaterArtifactsFromLastKnownGood(): {
  recovered: boolean
  reason: string
} {
  try {
    if (!fs.existsSync(WATER_LKG_BUNDLE_PATH) || !fs.existsSync(WATER_LKG_MANIFEST_PATH)) {
      return { recovered: false, reason: 'Last-known-good snapshot missing' }
    }

    const bundleRaw = fs.readFileSync(WATER_LKG_BUNDLE_PATH, 'utf8')
    const manifestRaw = fs.readFileSync(WATER_LKG_MANIFEST_PATH, 'utf8')
    const manifest = waterManifestSchema.parse(JSON.parse(manifestRaw))
    const bundle = normalizeBundle(JSON.parse(bundleRaw), manifest)

    ensureDir(path.dirname(WATER_BUNDLE_PATH))
    writeJsonAtomic(WATER_BUNDLE_PATH, bundle)
    writeJsonAtomic(WATER_MANIFEST_PATH, manifest)
    cachedBundle = bundle
    cachedManifest = manifest
    cachedArtifactMetadata = computeArtifactMetadata(bundle, manifest)

    return { recovered: true, reason: 'Recovered from last-known-good snapshot' }
  } catch (error) {
    return {
      recovered: false,
      reason: error instanceof Error ? error.message : 'Recovery failed',
    }
  }
}

function resolveScenarioProjection(
  regionEntry: WaterBundleArtifact['regions'][string],
  scenario: WaterScenario
) {
  if (scenario === 'current') return null
  return regionEntry.scenario_projections?.[scenario] ?? null
}

function resolveFacilityOverlay(
  regionEntry: WaterBundleArtifact['regions'][string],
  facilityId?: string
): WaterFacilityOverlay | null {
  if (!facilityId) return null
  return regionEntry.facility_overlays?.[facilityId] ?? null
}

export function resolveWaterSignal(
  region: string,
  at = new Date(),
  options: {
    facilityId?: string
    scenario?: WaterScenario
  } = {}
): WaterSignal {
  const referenceTime = at.toISOString()
  const scenario = options.scenario ?? 'current'
  const fallback: WaterSignal = {
    region,
    waterIntensityLPerKwh: 2.0,
    waterStressIndex: 4.0,
    waterQualityIndex: null,
    droughtRiskIndex: null,
    scarcityFactor: 2.5,
    source: ['fallback_conservative'],
    datasetVersions: { fallback: 'conservative_defaults_v1' },
    confidence: 0.35,
    fallbackUsed: true,
    dataQuality: 'low',
    signalType: 'average_operational',
    referenceTime,
    authorityMode: 'fallback',
    scenario,
    facilityId: options.facilityId ?? null,
    supplierSet: ['fallback_conservative'],
    evidenceRefs: ['water:fallback:conservative-defaults'],
    telemetryRef: null,
    artifactGeneratedAt: null,
  }

  try {
    const { bundle } = loadWaterArtifacts()
    const regionEntry = bundle.regions[region]
    if (!regionEntry) return fallback

    const month = String(at.getUTCMonth() + 1).padStart(2, '0')
    const overlay = resolveFacilityOverlay(regionEntry, options.facilityId)
    const projection = resolveScenarioProjection(regionEntry, scenario)
    const baseScarcityFactor =
      projection?.scarcity_factor_monthly?.[month] ??
      projection?.scarcity_factor_annual ??
      regionEntry.scarcity_factor_monthly?.[month] ??
      regionEntry.scarcity_factor_annual

    const supplierProvenance = [
      ...(regionEntry.supplier_provenance ?? []),
      ...(overlay?.source ?? []).map<WaterSupplierProvenance>((source) => ({
        supplier: source,
        authorityRole: 'facility',
        datasetVersion: source,
        fileHash: null,
        observedAt: overlay?.observed_at ?? null,
      })),
    ]
    const evidenceRefs = [
      ...(projection?.evidence_refs ?? []),
      ...(overlay?.evidence_refs ?? []),
      `water-bundle:${bundle.generated_at}:${region}`,
    ]

    const authorityMode = overlay ? 'facility_overlay' : 'basin'
    const confidence = overlay?.confidence ?? projection?.confidence ?? regionEntry.confidence

    return {
      region,
      waterIntensityLPerKwh: overlay?.water_intensity_l_per_kwh ?? regionEntry.water_intensity_l_per_kwh,
      waterStressIndex:
        overlay?.water_stress_score ??
        projection?.water_stress_score ??
        regionEntry.water_stress_score,
      waterQualityIndex: projection?.water_quality_index ?? regionEntry.water_quality_index ?? null,
      droughtRiskIndex: projection?.drought_risk_score ?? regionEntry.drought_risk_score ?? null,
      scarcityFactor: overlay?.scarcity_factor ?? baseScarcityFactor,
      source: Array.from(
        new Set([
          ...regionEntry.sources,
          ...((overlay?.source as string[] | null | undefined) ?? []),
        ])
      ),
      datasetVersions: regionEntry.dataset_versions,
      confidence,
      fallbackUsed: false,
      dataQuality: deriveDataQuality(confidence),
      signalType: 'average_operational',
      referenceTime,
      authorityMode,
      scenario,
      facilityId: overlay?.facility_id ?? options.facilityId ?? null,
      supplierSet: Array.from(new Set(supplierProvenance.map((provenance) => provenance.supplier))),
      evidenceRefs,
      telemetryRef: overlay?.telemetry_ref ?? null,
      artifactGeneratedAt: bundle.generated_at,
    }
  } catch {
    return fallback
  }
}

export function buildWaterAuthority(signal: WaterSignal): WaterAuthority {
  const metadata = getWaterArtifactMetadata()
  return {
    authorityMode: signal.authorityMode,
    scenario: signal.scenario,
    confidence: signal.confidence,
    supplierSet: signal.supplierSet,
    evidenceRefs: signal.evidenceRefs,
    facilityId: signal.facilityId,
    telemetryRef: signal.telemetryRef,
    bundleHash: metadata.bundleHash,
    manifestHash: metadata.manifestHash,
  }
}

export function summarizeWaterProviders(): WaterProviderStatus[] {
  try {
    const { bundle, manifest } = loadWaterArtifacts()
    const metadata = getWaterArtifactMetadata()
    const providerMap = new Map<string, WaterProviderStatus>()

    manifest.datasets.forEach((dataset) => {
      providerMap.set(dataset.name, {
        provider: dataset.name,
        authorityRole: dataset.name === 'aqueduct' ? 'baseline' : 'overlay',
        datasetVersion: dataset.dataset_version,
        freshnessSec: bundle.generated_at
          ? Math.max(0, Math.round((Date.now() - new Date(bundle.generated_at).getTime()) / 1000))
          : null,
        fileHash: dataset.file_hash ?? null,
        lastObservedAt: dataset.downloaded_at ?? null,
        authorityStatus:
          dataset.name === 'aqueduct'
            ? 'authoritative'
            : metadata.datasetHashesPresent
              ? 'advisory'
              : 'fallback',
      })
    })

    Object.values(bundle.regions).forEach((region) => {
      Object.values(region.facility_overlays ?? {}).forEach((overlay) => {
        providerMap.set(`facility:${overlay.facility_id}`, {
          provider: `facility:${overlay.facility_id}`,
          authorityRole: 'facility',
          datasetVersion: overlay.observed_at ?? 'facility_overlay',
          freshnessSec: overlay.observed_at
            ? Math.max(0, Math.round((Date.now() - new Date(overlay.observed_at).getTime()) / 1000))
            : null,
          fileHash: overlay.telemetry_ref ?? null,
          lastObservedAt: overlay.observed_at ?? null,
          authorityStatus: 'authoritative',
        })
      })
    })

    return Array.from(providerMap.values()).sort((a, b) => a.provider.localeCompare(b.provider))
  } catch {
    return [
      {
        provider: 'fallback_conservative',
        authorityRole: 'baseline',
        datasetVersion: 'conservative_defaults_v1',
        freshnessSec: null,
        fileHash: null,
        lastObservedAt: null,
        authorityStatus: 'fallback',
      },
    ]
  }
}

export function getWaterDatasetVersionSummary(): Record<string, string> {
  try {
    const { manifest } = loadWaterArtifacts()
    return manifest.datasets.reduce<Record<string, string>>((acc, dataset) => {
      acc[dataset.name] = dataset.dataset_version
      return acc
    }, {})
  } catch {
    return { fallback: 'conservative_defaults_v1' }
  }
}

export function validateWaterArtifacts(): {
  healthy: boolean
  checks: {
    bundlePresent: boolean
    manifestPresent: boolean
    schemaCompatible: boolean
    regionCount: number
    sourceCount: number
    datasetHashesPresent: boolean
  }
  errors: string[]
} {
  const checks = {
    bundlePresent: fs.existsSync(WATER_BUNDLE_PATH),
    manifestPresent: fs.existsSync(WATER_MANIFEST_PATH),
    schemaCompatible: false,
    regionCount: 0,
    sourceCount: 0,
    datasetHashesPresent: false,
  }
  const errors: string[] = []

  if (!checks.bundlePresent) {
    errors.push('water.bundle.json missing')
  }
  if (!checks.manifestPresent) {
    errors.push('manifest.json missing')
  }

  if (checks.bundlePresent && checks.manifestPresent) {
    try {
      const { bundle, manifest } = loadWaterArtifacts(true)
      const metadata = getWaterArtifactMetadata(true)
      checks.regionCount = Object.keys(bundle.regions).length
      checks.schemaCompatible =
        bundle.schema_version === REQUIRED_SCHEMA_VERSION &&
        manifest.schema_version === REQUIRED_SCHEMA_VERSION
      checks.sourceCount = metadata.sourceCount
      checks.datasetHashesPresent = metadata.datasetHashesPresent

      if (!checks.schemaCompatible) {
        errors.push('water schema version mismatch')
      }
      if (checks.regionCount === 0) {
        errors.push('water bundle has no regions')
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'water artifact parse error')
    }
  }

  return {
    healthy:
      checks.bundlePresent &&
      checks.manifestPresent &&
      checks.schemaCompatible &&
      checks.regionCount > 0,
    checks,
    errors,
  }
}
