import { randomUUID } from 'crypto'
import type { Request, Response } from 'express'
import { Router } from 'express'
import { z } from 'zod'
import { providerRouter } from '../lib/carbon/provider-router'
import { applyLowestDefensibleSignalPenalty } from '../lib/ci/conflict-resolver'
import { CiResponseV2Schema } from '../lib/ci/contracts'
import {
  buildCanonicalDecisionEnvelope,
  buildCanonicalProofEnvelope,
  CanonicalCallerSchema,
  CanonicalRuntimeTargetSchema,
  CanonicalTelemetryContextSchema,
  CanonicalTransportMetadataSchema,
  resolveCanonicalTransportMetadata,
  verifySignatureHeader,
  type CanonicalTelemetryContext,
  type CanonicalTransportMetadata,
} from '../lib/ci/canonical'
import {
  buildIdempotencyCacheKey,
  readIdempotentResponse,
  writeIdempotentResponse,
} from '../lib/ci/idempotency'
import {
  buildDecisionProofHash,
  chooseNonDelayFallbackAction,
  determineSignalSemantics,
  resolveDelayWindow,
  type AuthorizationSignalPolicy,
} from '../lib/ci/authorization'
import {
  buildAssuranceStatus,
  buildDecisionExplanation,
  buildMssState,
  DECISION_DOCTRINE_VERSION,
  DETERMINISTIC_CONFLICT_HIERARCHY,
  resolveBaselineCandidate,
} from '../lib/ci/doctrine'
import {
  buildDecisionEvaluatedEvent,
  enqueueDecisionEvaluatedEvents,
} from '../lib/ci/decision-events'
import { applyOperatingModePolicy, resolveOperatingMode, type OperatingMode } from '../lib/ci/operating-mode'
import { prisma } from '../lib/db'
import { buildGithubActionsEnforcementBundle } from '../lib/enforcement/github-actions-policy'
import { buildKubernetesEnforcementPlan } from '../lib/enforcement/k8s-policy'
import { buildDecisionSpanRecord, exportDecisionSpanRecord } from '../lib/observability/otel'
import { getTelemetrySnapshot, recordTelemetryMetric, telemetryMetricNames } from '../lib/observability/telemetry'
import { loadRegionReliabilityMultipliers } from '../lib/learning/region-reliability'
import { evaluateExternalPolicyHook } from '../lib/policy/external-hook'
import { evaluateSekedPolicyAdapter } from '../lib/policy/seked-policy-adapter'
import { persistExportBatch } from '../lib/proof/export-chain'
import { env } from '../config/env'
import {
  buildWaterAuthority,
  getWaterArtifactMetadata,
  loadWaterArtifacts,
  resolveWaterSignal,
  summarizeWaterProviders,
  validateWaterArtifacts,
} from '../lib/water/bundle'
import { inspectWaterDatasetProvenance } from '../lib/water/provenance'
import { evaluateWaterGuardrail, WATER_POLICY_VERSION } from '../lib/water/policy'
import type {
  WaterAuthority,
  WaterDecisionAction,
  WaterDecisionMode,
  WaterPolicyProfile,
  WaterScenario,
  WaterSignal,
} from '../lib/water/types'
import type { ExternalPolicyHookResult } from '../lib/policy/external-hook'
import type { SekedPolicyAdapterResult } from '../lib/policy/seked-policy-adapter'
import { internalServiceGuard } from '../middleware/internal-auth'

const router = Router()

const RUNNER_REGIONS: Record<string, string[]> = {
  'us-east-1': ['ubuntu-latest', 'windows-latest', 'macos-latest'],
  'us-west-2': ['ubuntu-latest', 'windows-latest'],
  'us-central-1': ['ubuntu-latest'],
  'eu-west-1': ['ubuntu-latest', 'windows-latest'],
  'eu-west-2': ['ubuntu-latest'],
  'eu-central-1': ['ubuntu-latest'],
  'ap-southeast-1': ['ubuntu-latest'],
  'ap-northeast-1': ['ubuntu-latest'],
  'ap-south-1': ['ubuntu-latest'],
}

export const requestSchema = z.object({
  requestId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(60000).optional(),
  caller: CanonicalCallerSchema.optional(),
  runtimeTarget: CanonicalRuntimeTargetSchema.optional(),
  transport: CanonicalTransportMetadataSchema.partial().optional(),
  telemetryContext: CanonicalTelemetryContextSchema.optional(),
  workload: z
    .object({
      name: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
      runtime: z.string().min(1).optional(),
    })
    .optional(),
  preferredRegions: z.array(z.string()).min(1),
  carbonWeight: z.number().min(0).max(1).default(0.7),
  waterWeight: z.number().min(0).max(1).default(0.3),
  latencyWeight: z.number().min(0).max(1).default(0.1),
  costWeight: z.number().min(0).max(1).default(0.1),
  jobType: z.enum(['standard', 'heavy', 'light']).default('standard'),
  criticality: z.enum(['critical', 'standard', 'batch']).default('standard'),
  waterPolicyProfile: z
    .enum(['default', 'drought_sensitive', 'eu_data_center_reporting', 'high_water_sensitivity'])
    .default('default'),
  allowDelay: z.boolean().default(true),
  deadlineAt: z.string().datetime().optional(),
  maxDelayMinutes: z.number().int().positive().max(1440).optional(),
  criticalPath: z.boolean().default(false),
  signalPolicy: z.enum(['marginal_first', 'average_fallback']).default('marginal_first'),
  policyVersion: z.literal(WATER_POLICY_VERSION).default(WATER_POLICY_VERSION),
  decisionMode: z.enum(['runtime_authorization', 'scenario_planning']).default('runtime_authorization'),
  facilityId: z.string().min(1).optional(),
  waterContext: z
    .object({
      basinId: z.string().min(1).optional(),
      telemetryWindowMinutes: z.number().int().positive().max(1440).optional(),
      scenario: z.enum(['current', '2030', '2050', '2080']).default('current'),
    })
    .optional(),
  schedulerHints: z
    .object({
      bottleneckScore: z.number().min(0).max(1).optional(),
      dependencyDepth: z.number().int().min(0).optional(),
      queueDepth: z.number().int().min(0).optional(),
    })
    .optional(),
  timestamp: z.string().optional(),
  estimatedEnergyKwh: z.number().positive().optional(),
  metadata: z.record(z.any()).optional(),
})

type RoutingRequestInput = z.input<typeof requestSchema>
type RoutingRequest = z.infer<typeof requestSchema>

type CandidateEvaluation = {
  region: string
  runner: string
  carbonIntensity: number
  carbonConfidence: number
  carbonSourceUsed: string
  carbonFallbackUsed: boolean
  signalMode: 'marginal' | 'average' | 'fallback'
  accountingMethod: 'marginal' | 'flow-traced' | 'average'
  carbonDisagreementFlag: boolean
  carbonDisagreementPct: number
  waterSignal: WaterSignal
  waterImpactLiters: number
  scarcityImpact: number
  reliabilityMultiplier: number
  score: number
  defensiblePenalty: number
  defensibleReasonCodes: string[]
  guardrailCandidateBlocked: boolean
  guardrailReasons: string[]
  providerSnapshotRef: string
  waterAuthority: WaterAuthority
  cacheStatus: 'live' | 'warm' | 'fallback'
  providerResolutionMs: number
  carbonFreshnessSec: number | null
  waterFreshnessSec: number | null
}

const sloState = {
  totalMs: [] as number[],
  computeMs: [] as number[],
  budget: {
    totalP95Ms: 100,
    computeP95Ms: 50,
  },
}

function resolveRequestId(data: RoutingRequest) {
  return data.requestId?.trim() || randomUUID()
}

function resolveTransport(data: RoutingRequest): CanonicalTransportMetadata {
  const runtime = data.runtimeTarget?.runtime ?? 'http'
  const controlPoint =
    data.transport?.controlPoint ??
    (runtime === 'github_actions'
      ? 'ci_pre_job'
      : runtime === 'kubernetes'
        ? 'scheduler_hint'
        : runtime === 'lambda'
          ? 'lambda_wrapper'
          : runtime === 'queue'
            ? 'dispatcher'
            : runtime === 'event'
              ? 'event_bus'
              : 'gateway_preflight')

  const transport =
    data.transport?.transport ??
    (runtime === 'github_actions'
      ? 'ci_runner'
      : runtime === 'kubernetes'
        ? 'k8s_admission'
        : runtime === 'lambda'
          ? 'lambda_invoke'
          : runtime === 'queue'
            ? 'queue_dispatch'
            : runtime === 'event'
              ? 'cloudevent'
              : 'sync_http')

  const adapterId =
    data.transport?.adapterId ??
    (runtime === 'github_actions'
      ? 'ecobe.github-actions.adapter.v1'
      : runtime === 'kubernetes'
        ? 'ecobe.kubernetes.adapter.v1'
        : runtime === 'lambda'
          ? 'ecobe.lambda.adapter.v1'
          : runtime === 'queue'
            ? 'ecobe.queue.adapter.v1'
            : runtime === 'event'
              ? 'ecobe.cloudevents.adapter.v1'
              : 'ecobe.http.decision.v1')

  return resolveCanonicalTransportMetadata({
    runtime,
    transport,
    controlPoint,
    adapterId,
    adapterVersion: data.transport?.adapterVersion ?? '1.0.0',
    observedRuntimeTarget: data.transport?.observedRuntimeTarget,
    enforcementResult: data.transport?.enforcementResult ?? 'applied',
  })
}

function verifySignedDecisionRequest(req: Request, res: Response) {
  const signatureHeader = req.header('x-ecobe-signature')
  if (!verifySignatureHeader((req as Request & { rawBody?: string }).rawBody, signatureHeader)) {
    res.status(401).json({
      error: 'Invalid request signature',
      code: 'INVALID_REQUEST_SIGNATURE',
    })
    return false
  }

  return true
}

function assuranceToProofPosture(status: 'operational' | 'assurance_ready' | 'degraded') {
  if (status === 'assurance_ready') return 'assurance_ready' as const
  if (status === 'degraded') return 'degraded' as const
  return 'operational' as const
}

function recordLatency(totalMs: number, computeMs: number) {
  const windowSize = 250
  sloState.totalMs.push(totalMs)
  sloState.computeMs.push(computeMs)
  if (sloState.totalMs.length > windowSize) {
    sloState.totalMs.splice(0, sloState.totalMs.length - windowSize)
  }
  if (sloState.computeMs.length > windowSize) {
    sloState.computeMs.splice(0, sloState.computeMs.length - windowSize)
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function estimateEnergyKwh(jobType: RoutingRequest['jobType'], explicit?: number): number {
  if (explicit && explicit > 0) return explicit
  if (jobType === 'heavy') return 8
  if (jobType === 'light') return 0.8
  return 2.5
}

function computeSignalConfidence(carbonConfidence: number, waterConfidence: number) {
  return Number(Math.max(0.05, Math.min(1, (carbonConfidence + waterConfidence) / 2)).toFixed(3))
}

function computeScore(input: {
  carbonIntensity: number
  waterScarcityImpact: number
  carbonWeight: number
  waterWeight: number
  latencyWeight: number
  costWeight: number
  region: string
}) {
  const totalWeight =
    input.carbonWeight + input.waterWeight + input.latencyWeight + input.costWeight
  const carbonW = input.carbonWeight / totalWeight
  const waterW = input.waterWeight / totalWeight
  const latencyW = input.latencyWeight / totalWeight
  const costW = input.costWeight / totalWeight

  const pseudoLatencyPenalty = input.region.startsWith('eu-') ? 0.18 : 0.1
  const pseudoCostPenalty = input.region.startsWith('ap-') ? 0.2 : 0.12

  return (
    carbonW * input.carbonIntensity +
    waterW * input.waterScarcityImpact * 100 +
    latencyW * pseudoLatencyPenalty * 100 +
    costW * pseudoCostPenalty * 100
  )
}

function getFallbackRegion(preferredRegions: string[]): string {
  for (const region of preferredRegions) {
    if (RUNNER_REGIONS[region]) return region
  }
  return 'us-east-1'
}

function toCacheBucket(timestamp: Date): Date {
  const bucket = new Date(timestamp)
  bucket.setSeconds(0, 0)
  return bucket
}

async function evaluateCandidates(data: RoutingRequest, energyKwh: number, at: Date) {
  const reliabilityByRegion = await loadRegionReliabilityMultipliers(data.preferredRegions)
  const cacheBucket = toCacheBucket(at)
  const candidates = await Promise.all(
    data.preferredRegions.map(async (region) => {
      const providerResolutionStarted = Date.now()
      const cachedSignal = await providerRouter.getCachedRoutingSignal(region, cacheBucket)
      const signal = cachedSignal ?? (await providerRouter.getRoutingSignal(region, at))
      const providerResolutionMs = Date.now() - providerResolutionStarted

      if (!cachedSignal) {
        providerRouter.cacheRoutingSignal(region, signal, cacheBucket).catch((error) => {
          console.warn('Failed to cache routing signal', { region, error })
        })
      }

      const waterSignal = resolveWaterSignal(region, at, {
        facilityId: data.facilityId,
        scenario: (data.waterContext?.scenario ?? 'current') as WaterScenario,
      })
      const waterAuthority = buildWaterAuthority(waterSignal)
      const runner = RUNNER_REGIONS[region]?.[0] ?? 'ubuntu-latest'
      const waterImpactLiters = Number((energyKwh * waterSignal.waterIntensityLPerKwh).toFixed(6))
      const scarcityImpact = Number((waterImpactLiters * waterSignal.scarcityFactor).toFixed(6))
      const signalSemantics = determineSignalSemantics({
        source: signal.provenance.sourceUsed,
        fallbackUsed: signal.provenance.fallbackUsed,
        signalPolicy: data.signalPolicy as AuthorizationSignalPolicy,
      })
      const providerSnapshotRef = `${region}:${signal.provenance.sourceUsed}:${signal.provenance.referenceTime}`
      const freshnessSec = Math.max(
        0,
        Math.round((Date.now() - new Date(signal.provenance.referenceTime).getTime()) / 1000)
      )
      recordTelemetryMetric(telemetryMetricNames.providerFreshnessSeconds, 'gauge', freshnessSec, {
        region,
        source: signal.provenance.sourceUsed,
        signal_mode: signalSemantics.signalMode,
      })
      const waterFreshnessSec = waterSignal.artifactGeneratedAt
        ? Math.max(
            0,
            Math.round((Date.now() - new Date(waterSignal.artifactGeneratedAt).getTime()) / 1000)
          )
        : null
      if (waterFreshnessSec !== null) {
        recordTelemetryMetric(
          telemetryMetricNames.waterAuthorityFreshnessSeconds,
          'gauge',
          waterFreshnessSec,
          {
            region,
            authority_mode: waterAuthority.authorityMode,
            scenario: waterAuthority.scenario,
          }
        )
      }

      const guardrailCheck = evaluateWaterGuardrail({
        profile: data.waterPolicyProfile as WaterPolicyProfile,
        selectedWater: waterSignal,
        baselineWater: waterSignal,
        selectedWaterImpactLiters: waterImpactLiters,
        selectedScarcityImpact: scarcityImpact,
        fallbackUsed: waterSignal.fallbackUsed,
        criticality: data.criticality,
        allowDelay: data.allowDelay,
      })

      const baseScore = computeScore({
        carbonIntensity: signal.carbonIntensity,
        waterScarcityImpact: scarcityImpact,
        carbonWeight: data.carbonWeight,
        waterWeight: data.waterWeight,
        latencyWeight: data.latencyWeight,
        costWeight: data.costWeight,
        region,
      })
      const defensiblePenalty = applyLowestDefensibleSignalPenalty({
        carbonConfidence: signal.confidence,
        carbonFallbackUsed: signal.provenance.fallbackUsed,
        carbonDisagreementFlag: signal.provenance.disagreementFlag,
        carbonDisagreementPct: signal.provenance.disagreementPct,
        waterConfidence: waterSignal.confidence,
        waterFallbackUsed: waterSignal.fallbackUsed,
      })
      const reliabilityMultiplier = reliabilityByRegion[region] ?? 1
      const score = Number(((baseScore / reliabilityMultiplier) + defensiblePenalty.penalty).toFixed(6))

      return {
        region,
        runner,
        carbonIntensity: signal.carbonIntensity,
        carbonConfidence: signal.confidence,
        carbonSourceUsed: signal.provenance.sourceUsed,
        carbonFallbackUsed: signal.provenance.fallbackUsed,
        signalMode: signalSemantics.signalMode,
        accountingMethod: signalSemantics.accountingMethod,
        carbonDisagreementFlag: signal.provenance.disagreementFlag,
        carbonDisagreementPct: signal.provenance.disagreementPct,
        waterSignal,
        waterImpactLiters,
        scarcityImpact,
        reliabilityMultiplier,
        score,
        defensiblePenalty: defensiblePenalty.penalty,
        defensibleReasonCodes: defensiblePenalty.reasonCodes,
        guardrailCandidateBlocked: guardrailCheck.hardBlock,
        guardrailReasons: guardrailCheck.trace.reasonCodes,
        providerSnapshotRef,
        waterAuthority,
        cacheStatus: signal.provenance.fallbackUsed ? 'fallback' : cachedSignal ? 'warm' : 'live',
        providerResolutionMs,
        carbonFreshnessSec: freshnessSec,
        waterFreshnessSec,
      } satisfies CandidateEvaluation
    })
  )

  candidates.sort((a, b) => a.score - b.score)
  return candidates
}

function isPrecedenceProtected(request: RoutingRequest) {
  return Boolean(request.criticalPath) || (request.schedulerHints?.bottleneckScore ?? 0) >= 0.8
}

function buildCiResponse(input: {
  data: RoutingRequest
  requestId: string
  transport: CanonicalTransportMetadata
  doctrineVersion: string
  operatingMode: OperatingMode
  decisionFrameId: string
  decision: WaterDecisionAction
  reasonCode: string
  selected: CandidateEvaluation
  baseline: CandidateEvaluation
  rerouteFrom: CandidateEvaluation | null
  policyTrace: ReturnType<typeof evaluateWaterGuardrail>['trace']
  signalConfidence: number
  fallbackUsed: boolean
  candidateEvaluations: CandidateEvaluation[]
  proofHash: string
  providerSnapshotRefs: string[]
  waterAuthority: WaterAuthority
  precedenceOverrideApplied: boolean
  assurance: ReturnType<typeof buildAssuranceStatus>
  mss: ReturnType<typeof buildMssState>
  decisionExplanation: ReturnType<typeof buildDecisionExplanation>
}) {
  const selectedReductionPct =
    input.baseline.carbonIntensity > 0
      ? ((input.baseline.carbonIntensity - input.selected.carbonIntensity) / input.baseline.carbonIntensity) *
        100
      : 0

  const waterDeltaLiters = input.baseline.waterImpactLiters - input.selected.waterImpactLiters
  const signalsUsed = Array.from(
    new Set([
      input.selected.carbonSourceUsed,
      ...input.selected.waterSignal.source,
    ])
  )
  const kubernetesEnforcement = buildKubernetesEnforcementPlan({
    decisionFrameId: input.decisionFrameId,
    decision: input.decision,
    decisionMode: input.data.decisionMode as WaterDecisionMode,
    reasonCode: input.reasonCode,
    selectedRegion: input.selected.region,
    policyProfile: input.data.waterPolicyProfile,
    criticality: input.data.criticality,
    waterAuthorityMode: input.waterAuthority.authorityMode,
    waterScenario: input.waterAuthority.scenario,
    proofHash: input.proofHash,
    notBefore: input.data.allowDelay && input.decision === 'delay'
      ? resolveDelayWindow({
          generatedAt: new Date(input.data.timestamp ?? new Date().toISOString()),
          criticality: input.data.criticality,
          allowDelay: input.data.allowDelay,
          criticalPath: input.data.criticalPath,
          deadlineAt: input.data.deadlineAt,
          maxDelayMinutes: input.data.maxDelayMinutes,
        }).notBefore
      : null,
    delayMinutes: input.data.maxDelayMinutes,
  })
  const githubActionsEnforcement = buildGithubActionsEnforcementBundle({
    decisionFrameId: input.decisionFrameId,
    decision: input.decision,
    decisionMode: input.data.decisionMode as WaterDecisionMode,
    selectedRegion: input.selected.region,
    preferredRegions: input.data.preferredRegions,
    criticality: input.data.criticality,
    notBefore: kubernetesEnforcement.execution.notBefore,
  })
  const signalSemantics = determineSignalSemantics({
    source: input.selected.carbonSourceUsed,
    fallbackUsed: input.fallbackUsed,
    signalPolicy: input.data.signalPolicy as AuthorizationSignalPolicy,
  })
  const decisionEnvelope = buildCanonicalDecisionEnvelope({
    requestId: input.requestId,
    decisionFrameId: input.decisionFrameId,
    action: input.decision,
    reasonCode: input.reasonCode,
    selectedRegion: input.selected.region,
    selectedRunner: input.selected.runner,
    baselineRegion: input.baseline.region,
    runtime: input.transport.runtime,
    provider: input.data.runtimeTarget?.provider ?? 'generic',
    signalConfidence: input.signalConfidence,
    decisionMode: input.data.decisionMode as WaterDecisionMode,
    fallbackUsed: input.fallbackUsed,
    doctrineVersion: input.doctrineVersion,
    operatingMode: input.operatingMode,
    hierarchy: [...DETERMINISTIC_CONFLICT_HIERARCHY],
    transport: input.transport,
    notBefore: kubernetesEnforcement.execution.notBefore,
    timeoutMs: input.data.timeoutMs,
    requestAt: new Date(input.data.timestamp ?? new Date().toISOString()),
    idempotencyKey: input.data.idempotencyKey ?? null,
  })
  const proofEnvelope = buildCanonicalProofEnvelope({
    posture: assuranceToProofPosture(input.assurance.status),
    proofHash: input.proofHash,
    mssSnapshotId: input.mss.snapshotId,
    baseline: {
      region: input.baseline.region,
      carbonIntensity: input.baseline.carbonIntensity,
      waterImpactLiters: input.baseline.waterImpactLiters,
      waterScarcityImpact: input.baseline.scarcityImpact,
    },
    selected: {
      region: input.selected.region,
      carbonIntensity: input.selected.carbonIntensity,
      waterImpactLiters: input.selected.waterImpactLiters,
      waterScarcityImpact: input.selected.scarcityImpact,
    },
    carbonProvider: input.selected.carbonSourceUsed,
    waterAuthorityMode: input.waterAuthority.authorityMode,
    fallbackUsed: input.fallbackUsed,
    disagreementPct: input.selected.carbonDisagreementPct,
    datasetVersions: input.selected.waterSignal.datasetVersions,
    providerSnapshotRefs: input.providerSnapshotRefs,
    transport: input.transport,
  })

  return {
    decision: input.decision,
    decisionMode: input.data.decisionMode as WaterDecisionMode,
    doctrineVersion: input.doctrineVersion,
    operatingMode: input.operatingMode,
    reasonCode: input.reasonCode,
    decisionFrameId: input.decisionFrameId,
    selectedRunner: input.selected.runner,
    selectedRegion: input.selected.region,
    recommendation: `Decision ${input.decision} under ${input.data.waterPolicyProfile} profile`,
    signalConfidence: input.signalConfidence,
    fallbackUsed: input.fallbackUsed,
    signalMode: signalSemantics.signalMode,
    accountingMethod: signalSemantics.accountingMethod,
    decisionEnvelope,
    proofEnvelope,
    notBefore: kubernetesEnforcement.execution.notBefore,
    proofHash: input.proofHash,
    waterAuthority: input.waterAuthority,
    assurance: input.assurance,
    mss: input.mss,
    decisionExplanation: input.decisionExplanation,
    policyTrace: {
      ...input.policyTrace,
      capabilityId: 'ci.route.authorization',
      authorizationMode: 'pre_action',
      policyPacks: [
        `water.${input.data.waterPolicyProfile}.${WATER_POLICY_VERSION}`,
        'seked.pre_action.v1',
        'external.pre_action.v1',
      ],
      scenarioPlanningActive: input.data.decisionMode === 'scenario_planning',
      reroutedFromRegion: input.rerouteFrom?.region ?? null,
      selectedRegion: input.selected.region,
      baselineRegion: input.baseline.region,
      precedenceProtected: isPrecedenceProtected(input.data),
      precedenceOverrideApplied: input.precedenceOverrideApplied,
      scenario: input.waterAuthority.scenario,
      facilityId: input.waterAuthority.facilityId,
      conflictHierarchy: [...DETERMINISTIC_CONFLICT_HIERARCHY],
      operatingMode: input.operatingMode,
    },
    baseline: {
      region: input.baseline.region,
      carbonIntensity: input.baseline.carbonIntensity,
      waterImpactLiters: input.baseline.waterImpactLiters,
      waterScarcityImpact: input.baseline.scarcityImpact,
    },
    selected: {
      region: input.selected.region,
      carbonIntensity: input.selected.carbonIntensity,
      waterImpactLiters: input.selected.waterImpactLiters,
      waterScarcityImpact: input.selected.scarcityImpact,
    },
    savings: {
      carbonReductionPct: Number(selectedReductionPct.toFixed(4)),
      waterImpactDeltaLiters: Number(waterDeltaLiters.toFixed(6)),
    },
    water: {
      selectedLiters: input.selected.waterImpactLiters,
      baselineLiters: input.baseline.waterImpactLiters,
      selectedScarcityImpact: input.selected.scarcityImpact,
      baselineScarcityImpact: input.baseline.scarcityImpact,
      intensityLPerKwh: input.selected.waterSignal.waterIntensityLPerKwh,
      stressIndex: input.selected.waterSignal.waterStressIndex,
      qualityIndex: input.selected.waterSignal.waterQualityIndex,
      droughtRiskIndex: input.selected.waterSignal.droughtRiskIndex,
      confidence: input.selected.waterSignal.confidence,
      source: input.selected.waterSignal.source,
      datasetVersion: input.selected.waterSignal.datasetVersions,
      guardrailTriggered: input.policyTrace.guardrailTriggered,
      fallbackUsed: input.selected.waterSignal.fallbackUsed,
    },
    kubernetesEnforcement,
    enforcementBundle: {
      kubernetes: kubernetesEnforcement,
      githubActions: githubActionsEnforcement,
    },
    workflowOutputs: {
      decision: input.decision,
      reasonCode: input.reasonCode,
      selectedRegion: input.selected.region,
      selectedRunner: input.selected.runner,
      carbonIntensity: Number(input.selected.carbonIntensity.toFixed(3)),
      carbonBaseline: Number(input.baseline.carbonIntensity.toFixed(3)),
      carbonReductionPct: Number(selectedReductionPct.toFixed(4)),
      waterSelectedLiters: Number(input.selected.waterImpactLiters.toFixed(6)),
      waterBaselineLiters: Number(input.baseline.waterImpactLiters.toFixed(6)),
      waterImpactDeltaLiters: Number(waterDeltaLiters.toFixed(6)),
      waterStressIndex: Number(input.selected.waterSignal.waterStressIndex.toFixed(3)),
      waterScarcityImpact: Number(input.selected.scarcityImpact.toFixed(6)),
      signalConfidence: input.signalConfidence,
      decisionFrameId: input.decisionFrameId,
      waterPolicyVersion: WATER_POLICY_VERSION,
      signalMode: signalSemantics.signalMode,
      accountingMethod: signalSemantics.accountingMethod,
      proofHash: input.proofHash,
      decisionMode: input.data.decisionMode,
      waterAuthorityMode: input.waterAuthority.authorityMode,
      waterScenario: input.waterAuthority.scenario,
      githubActionsExecutable: githubActionsEnforcement.executable,
      githubActionsMaxParallel: githubActionsEnforcement.maxParallel,
      githubActionsEnvironment: githubActionsEnforcement.environment,
      githubActionsNotBefore: githubActionsEnforcement.notBefore,
      kubernetesRegion: kubernetesEnforcement.nodeSelector['topology.kubernetes.io/region'],
      kubernetesDecision: kubernetesEnforcement.admission.allow ? kubernetesEnforcement.scaling.mode : 'blocked',
      kubernetesNotBefore: kubernetesEnforcement.execution.notBefore,
      kubernetesReplicaFactor: kubernetesEnforcement.scaling.targetReplicaFactor,
      selectedRegionReliabilityMultiplier: Number(input.selected.reliabilityMultiplier.toFixed(4)),
    },
    candidateEvaluations: input.candidateEvaluations.map((candidate) => ({
      region: candidate.region,
      score: Number(candidate.score.toFixed(6)),
      carbonIntensity: candidate.carbonIntensity,
      waterImpactLiters: candidate.waterImpactLiters,
      scarcityImpact: candidate.scarcityImpact,
      reliabilityMultiplier: candidate.reliabilityMultiplier,
      defensiblePenalty: candidate.defensiblePenalty,
      defensibleReasonCodes: candidate.defensibleReasonCodes,
      supplierSet: candidate.waterAuthority.supplierSet,
      evidenceRefs: candidate.waterAuthority.evidenceRefs,
      authorityMode: candidate.waterAuthority.authorityMode,
      guardrailCandidateBlocked: candidate.guardrailCandidateBlocked,
      guardrailReasons: candidate.guardrailReasons,
    })),
    proofRecord: {
      job_id: input.decisionFrameId,
      baseline_region: input.baseline.region,
      selected_region: input.selected.region,
      carbon_delta: Number(
        (input.baseline.carbonIntensity - input.selected.carbonIntensity).toFixed(6)
      ),
      water_delta: Number(waterDeltaLiters.toFixed(6)),
      signals_used: signalsUsed,
      timestamp: new Date().toISOString(),
      dataset_versions: input.selected.waterSignal.datasetVersions,
      confidence_score: input.signalConfidence,
      proof_hash: input.proofHash,
      provider_snapshot_refs: input.providerSnapshotRefs,
      mss_snapshot_id: input.mss.snapshotId,
      water_bundle_hash: input.waterAuthority.bundleHash,
      water_manifest_hash: input.waterAuthority.manifestHash,
      supplier_refs: input.waterAuthority.supplierSet,
      facility_telemetry_refs: input.waterAuthority.telemetryRef ? [input.waterAuthority.telemetryRef] : [],
      water_scenario: input.waterAuthority.scenario,
      external_policy_refs: [
        input.policyTrace.externalPolicy?.policyReference ?? null,
        input.policyTrace.sekedPolicy?.policyReference ?? null,
      ].filter((value): value is string => Boolean(value)),
      water_evidence_refs: input.waterAuthority.evidenceRefs,
      transport: input.transport.transport,
      adapter_id: input.transport.adapterId,
      adapter_version: input.transport.adapterVersion,
      enforcement_result: input.transport.enforcementResult,
      observed_runtime_target: input.transport.observedRuntimeTarget ?? null,
    },
    adapterContext: input.transport,
  }
}

type PolicyDirectiveResponse = {
  allow?: boolean
  action?: WaterDecisionAction
  reasonCode?: string
  forceRegion?: string
  denyRegions?: string[]
  maxWaterStress?: number
  maxCarbonIntensity?: number
  policyReference?: string
}

type AppliedPolicyResult = {
  reasonCodes: string[]
}

export async function createDecision(data: RoutingRequestInput) {
  const timestampIso = data.timestamp ?? new Date().toISOString()
  const normalizedRequest = requestSchema.parse({
    ...data,
    policyVersion: data.policyVersion ?? WATER_POLICY_VERSION,
    decisionMode: data.decisionMode ?? 'runtime_authorization',
    timestamp: timestampIso,
  })
  const { manifest } = loadWaterArtifacts()
  const artifactHealth = validateWaterArtifacts()
  const now = new Date(timestampIso)
  const requestId = resolveRequestId(normalizedRequest)
  const transport = resolveTransport(normalizedRequest)
  const energyKwh = estimateEnergyKwh(normalizedRequest.jobType, normalizedRequest.estimatedEnergyKwh)
  const candidateEvaluations = await evaluateCandidates(normalizedRequest, energyKwh, now)
  const precedenceProtected = isPrecedenceProtected(normalizedRequest)
  const delayWindow = resolveDelayWindow({
    generatedAt: now,
    criticality: normalizedRequest.criticality,
    allowDelay: normalizedRequest.allowDelay,
    criticalPath: normalizedRequest.criticalPath,
    deadlineAt: normalizedRequest.deadlineAt,
    maxDelayMinutes: normalizedRequest.maxDelayMinutes,
  })

  const baseline = resolveBaselineCandidate(normalizedRequest.preferredRegions, candidateEvaluations, candidateEvaluations[0])
  const best = candidateEvaluations[0]
  const bestGuardrail = evaluateWaterGuardrail({
    profile: normalizedRequest.waterPolicyProfile as WaterPolicyProfile,
    selectedWater: best.waterSignal,
    baselineWater: baseline.waterSignal,
    selectedWaterImpactLiters: best.waterImpactLiters,
    selectedScarcityImpact: best.scarcityImpact,
    fallbackUsed: best.waterSignal.fallbackUsed || best.carbonConfidence < 0.25,
    criticality: normalizedRequest.criticality,
    allowDelay: normalizedRequest.allowDelay,
  })

  let selected = best
  let decision = bestGuardrail.action
  let reasonCode = bestGuardrail.reasonCode
  let rerouteFrom: CandidateEvaluation | null = null
  let precedenceOverrideApplied = false

  const firstNonBlocked = candidateEvaluations.find((candidate) => !candidate.guardrailCandidateBlocked)
  if (bestGuardrail.hardBlock && firstNonBlocked && firstNonBlocked.region !== best.region) {
    rerouteFrom = best
    selected = firstNonBlocked
    decision = 'reroute'
    reasonCode = 'REROUTE_WATER_GUARDRAIL'
  }

  if (bestGuardrail.hardBlock && !firstNonBlocked) {
    if (delayWindow.allowed) {
      decision = 'delay'
      reasonCode = 'DELAY_NO_SAFE_REGION'
    } else {
      decision = chooseNonDelayFallbackAction(normalizedRequest.criticality)
      reasonCode =
        normalizedRequest.criticality === 'critical'
          ? 'THROTTLE_NO_SAFE_REGION'
          : normalizedRequest.criticalPath
            ? 'DENY_CRITICAL_PATH_NO_SAFE_REGION'
            : 'DENY_NO_SAFE_REGION'
    }
    selected = best
  }

  if (
    precedenceProtected &&
    decision === 'deny' &&
    reasonCode.startsWith('DENY_') &&
    !bestGuardrail.hardBlock
  ) {
    decision = 'throttle'
    reasonCode = 'THROTTLE_PRECEDENCE_PROTECTED_WATER'
    precedenceOverrideApplied = true
  }

  if (
    precedenceProtected &&
    bestGuardrail.hardBlock &&
    firstNonBlocked &&
    selected.region === firstNonBlocked.region &&
    decision !== 'reroute'
  ) {
    rerouteFrom = best
    selected = firstNonBlocked
    decision = 'reroute'
    reasonCode = 'REROUTE_PRECEDENCE_PROTECTED_WATER'
    precedenceOverrideApplied = true
  }

  if (
    decision === 'run_now' &&
    normalizedRequest.criticality === 'critical' &&
    selected.carbonIntensity > 450
  ) {
    decision = 'throttle'
    reasonCode = 'THROTTLE_CARBON_AND_CRITICALITY'
  }

  const decisionFrameId = randomUUID()
  const policyRequest = {
    decisionFrameId,
    policyProfile: normalizedRequest.waterPolicyProfile as WaterPolicyProfile,
    policyVersion: normalizedRequest.policyVersion,
    decisionMode: normalizedRequest.decisionMode as WaterDecisionMode,
    criticality: normalizedRequest.criticality,
    allowDelay: normalizedRequest.allowDelay,
    facilityId: normalizedRequest.facilityId ?? null,
    scenario: (normalizedRequest.waterContext?.scenario ?? 'current') as WaterScenario,
    bottleneckScore: normalizedRequest.schedulerHints?.bottleneckScore ?? null,
    preferredRegions: normalizedRequest.preferredRegions,
    waterAuthority: {
      authorityMode: selected.waterAuthority.authorityMode,
      confidence: selected.waterAuthority.confidence,
      supplierSet: selected.waterAuthority.supplierSet,
      evidenceRefs: selected.waterAuthority.evidenceRefs,
    },
    candidateSupplierProvenance: candidateEvaluations.map((candidate) => ({
      region: candidate.region,
      supplierSet: candidate.waterAuthority.supplierSet,
      evidenceRefs: candidate.waterAuthority.evidenceRefs,
      authorityMode: candidate.waterAuthority.authorityMode,
    })),
    candidates: candidateEvaluations.map((candidate) => ({
      region: candidate.region,
      score: candidate.score,
      carbonIntensity: candidate.carbonIntensity,
      waterStressIndex: candidate.waterSignal.waterStressIndex,
      waterScarcityImpact: candidate.scarcityImpact,
      guardrailCandidateBlocked: candidate.guardrailCandidateBlocked,
    })),
    provisionalDecision: {
      action: decision,
      reasonCode,
      selectedRegion: selected.region,
      baselineRegion: baseline.region,
    },
    timestamp: timestampIso,
  }

  const sekedPolicy = await evaluateSekedPolicyAdapter(policyRequest)
  const externalPolicy = await evaluateExternalPolicyHook(policyRequest)

  const applyPolicyDirectives = (
    policy:
      | Pick<
          ExternalPolicyHookResult,
          'strict' | 'reasonCodes' | 'hardFailure' | 'enforcedFailureAction' | 'response'
        >
      | Pick<
          SekedPolicyAdapterResult,
          'strict' | 'reasonCodes' | 'hardFailure' | 'enforcedFailureAction' | 'response'
        >,
    prefix: 'SEKED_POLICY' | 'EXTERNAL_POLICY'
  ): AppliedPolicyResult => {
    const reasonCodes = [...policy.reasonCodes]

    if (policy.hardFailure && policy.enforcedFailureAction) {
      decision = policy.enforcedFailureAction
      reasonCode = `${prefix}_STRICT_FAILSAFE`
      reasonCodes.push(`${prefix}_ENFORCED_FAILSAFE_ACTION`)
      return { reasonCodes: Array.from(new Set(reasonCodes)) }
    }

    const response = policy.response as PolicyDirectiveResponse | null
    if (!response) {
      return { reasonCodes: Array.from(new Set(reasonCodes)) }
    }

    let constrainedCandidates = candidateEvaluations

    if (response.denyRegions?.length) {
      const denySet = new Set(response.denyRegions)
      constrainedCandidates = constrainedCandidates.filter((candidate) => !denySet.has(candidate.region))
      reasonCodes.push(`${prefix}_DENY_REGIONS_APPLIED`)
    }

    if (response.maxWaterStress !== undefined) {
      constrainedCandidates = constrainedCandidates.filter(
        (candidate) => candidate.waterSignal.waterStressIndex <= response.maxWaterStress!
      )
      reasonCodes.push(`${prefix}_MAX_WATER_STRESS_APPLIED`)
    }

    if (response.maxCarbonIntensity !== undefined) {
      constrainedCandidates = constrainedCandidates.filter(
        (candidate) => candidate.carbonIntensity <= response.maxCarbonIntensity!
      )
      reasonCodes.push(`${prefix}_MAX_CARBON_INTENSITY_APPLIED`)
    }

    if (response.forceRegion) {
      const forced = constrainedCandidates.find((candidate) => candidate.region === response.forceRegion)
      if (forced) {
        if (forced.region !== selected.region) rerouteFrom = selected
        selected = forced
        decision = 'reroute'
        reasonCode = response.reasonCode || `${prefix}_FORCE_REGION`
        reasonCodes.push(`${prefix}_FORCE_REGION_APPLIED`)
      } else if (policy.strict) {
        decision = delayWindow.allowed ? 'delay' : chooseNonDelayFallbackAction(normalizedRequest.criticality)
        reasonCode = `${prefix}_FORCE_REGION_UNAVAILABLE`
        reasonCodes.push(`${prefix}_FORCE_REGION_UNAVAILABLE`)
      }
    } else if (constrainedCandidates.length > 0) {
      const bestConstrained = [...constrainedCandidates].sort((a, b) => a.score - b.score)[0]
      if (bestConstrained.region !== selected.region) {
        rerouteFrom = selected
        selected = bestConstrained
        decision = 'reroute'
        reasonCode = response.reasonCode || `${prefix}_REROUTE`
        reasonCodes.push(`${prefix}_REROUTE_APPLIED`)
      }
    } else if (policy.strict) {
      decision = delayWindow.allowed ? 'delay' : chooseNonDelayFallbackAction(normalizedRequest.criticality)
      reasonCode = `${prefix}_CONSTRAINTS_NO_CANDIDATE`
      reasonCodes.push(`${prefix}_NO_FEASIBLE_CANDIDATE`)
    }

    if (response.action) {
      decision = response.action
      reasonCode = response.reasonCode || `${prefix}_ACTION_OVERRIDE`
      reasonCodes.push(`${prefix}_ACTION_OVERRIDE`)
    } else if (response.allow === false) {
      decision = delayWindow.allowed ? 'delay' : chooseNonDelayFallbackAction(normalizedRequest.criticality)
      reasonCode = response.reasonCode || (decision === 'delay' ? `${prefix}_DELAY` : `${prefix}_DENY`)
      reasonCodes.push(`${prefix}_DENY`)
    }

    return { reasonCodes: Array.from(new Set(reasonCodes)) }
  }

  const sekedApplied = applyPolicyDirectives(sekedPolicy, 'SEKED_POLICY')
  const externalApplied = applyPolicyDirectives(externalPolicy, 'EXTERNAL_POLICY')

  if (decision === 'delay' && !delayWindow.allowed) {
    decision = chooseNonDelayFallbackAction(normalizedRequest.criticality)
    reasonCode =
      delayWindow.reason === 'critical_path'
        ? 'DENY_CRITICAL_PATH_DELAY_FORBIDDEN'
        : delayWindow.reason === 'deadline_exceeded'
          ? 'DENY_DELAY_WINDOW_EXHAUSTED'
          : normalizedRequest.criticality === 'critical'
            ? 'THROTTLE_DELAY_NOT_PERMITTED'
            : 'DENY_DELAY_NOT_PERMITTED'
  }

  const signalConfidence = computeSignalConfidence(
    selected.carbonConfidence,
    selected.waterSignal.confidence
  )
  const assurance = buildAssuranceStatus({
    datasetHashesPresent: manifest.datasets.every(
      (dataset) => Boolean(dataset.file_hash) && dataset.file_hash !== 'unverified'
    ),
    bundleHealthy: artifactHealth.checks.bundlePresent && artifactHealth.checks.schemaCompatible,
    manifestHealthy: artifactHealth.checks.manifestPresent,
    waterFallbackUsed: selected.waterSignal.fallbackUsed || selected.waterAuthority.authorityMode === 'fallback',
    carbonFallbackUsed: selected.carbonFallbackUsed,
    manifestDatasets: manifest.datasets,
  })
  const operatingMode = resolveOperatingMode({
    signalConfidence,
    carbonFallbackUsed: selected.carbonFallbackUsed,
    waterFallbackUsed: selected.waterSignal.fallbackUsed || selected.waterAuthority.authorityMode === 'fallback',
    disagreementPct: selected.carbonDisagreementPct,
    hardWaterBlock: bestGuardrail.hardBlock,
    noSafeRegion: !firstNonBlocked,
    precedenceProtected,
    criticality: normalizedRequest.criticality,
    allowDelay: delayWindow.allowed,
  })
  const operatingModeDecision = applyOperatingModePolicy({
    mode: operatingMode,
    decision,
    reasonCode,
    context: {
      signalConfidence,
      carbonFallbackUsed: selected.carbonFallbackUsed,
      waterFallbackUsed: selected.waterSignal.fallbackUsed || selected.waterAuthority.authorityMode === 'fallback',
      disagreementPct: selected.carbonDisagreementPct,
      hardWaterBlock: bestGuardrail.hardBlock,
      noSafeRegion: !firstNonBlocked,
      precedenceProtected,
      criticality: normalizedRequest.criticality,
      allowDelay: delayWindow.allowed,
    },
  })
  decision = operatingModeDecision.adjustedAction
  reasonCode = operatingModeDecision.adjustedReasonCode
  const mss = buildMssState({
    candidate: selected,
    assurance,
    carbonFreshnessSec: selected.carbonFreshnessSec,
    waterFreshnessSec: selected.waterFreshnessSec,
    cacheStatus: selected.cacheStatus,
  })
  const policyTrace = {
    ...bestGuardrail.trace,
    delayWindow,
    reasonCodes: Array.from(
      new Set([
        ...bestGuardrail.trace.reasonCodes,
        ...sekedApplied.reasonCodes,
        ...externalApplied.reasonCodes,
        ...operatingModeDecision.reasonCodes,
      ])
    ),
    sekedPolicy: {
      enabled: sekedPolicy.enabled,
      strict: sekedPolicy.strict,
      evaluated: sekedPolicy.evaluated,
      applied: sekedPolicy.applied,
      hookStatus: sekedPolicy.hookStatus,
      reasonCodes: sekedApplied.reasonCodes,
      policyReference: sekedPolicy.policyReference,
    },
    externalPolicy: {
      enabled: externalPolicy.enabled,
      strict: externalPolicy.strict,
      evaluated: externalPolicy.evaluated,
      applied: externalPolicy.applied,
      hookStatus: externalPolicy.hookStatus,
      reasonCodes: externalApplied.reasonCodes,
      policyReference: externalPolicy.policyReference,
    },
  }
  const decisionExplanation = buildDecisionExplanation({
    decision,
    reasonCode,
    selected,
    baseline,
    candidates: candidateEvaluations,
    profile: normalizedRequest.waterPolicyProfile as WaterPolicyProfile,
  })
  recordTelemetryMetric(telemetryMetricNames.policyEvaluationCount, 'counter', 1, {
    decision_action: decision,
    criticality: normalizedRequest.criticality,
    critical_path: normalizedRequest.criticalPath,
  })
  recordTelemetryMetric(telemetryMetricNames.authorizationActionCount, 'counter', 1, {
    action: decision,
    runtime: transport.runtime,
    transport: transport.transport,
  })
  recordTelemetryMetric(
    telemetryMetricNames.authorizationDisagreementPct,
    'gauge',
    selected.carbonDisagreementPct,
    {
      action: decision,
      runtime: transport.runtime,
    }
  )
  if (externalPolicy.hardFailure || sekedPolicy.hardFailure || decision === 'deny') {
    recordTelemetryMetric(telemetryMetricNames.authorizationFailClosedCount, 'counter', 1, {
      reason_code: reasonCode,
      criticality: normalizedRequest.criticality,
    })
  }
  const providerSnapshotRefs = Array.from(
    new Set(candidateEvaluations.map((candidate) => candidate.providerSnapshotRef))
  )
  const waterAuthority = selected.waterAuthority
  if (normalizedRequest.decisionMode === 'scenario_planning') {
    recordTelemetryMetric(telemetryMetricNames.waterScenarioPlanningCount, 'counter', 1, {
      scenario: waterAuthority.scenario,
      authority_mode: waterAuthority.authorityMode,
    })
  }
  if (precedenceOverrideApplied) {
    recordTelemetryMetric(telemetryMetricNames.precedenceOverrideCount, 'counter', 1, {
      reason_code: reasonCode,
      scenario: waterAuthority.scenario,
    })
  }
  if (selected.waterSignal.fallbackUsed || waterAuthority.authorityMode === 'fallback') {
    recordTelemetryMetric(telemetryMetricNames.waterSupplierFallbackRate, 'counter', 1, {
      scenario: waterAuthority.scenario,
      region: selected.region,
    })
  }
  if (selected.waterSignal.fallbackUsed || selected.carbonFallbackUsed || waterAuthority.authorityMode === 'fallback') {
    recordTelemetryMetric(telemetryMetricNames.authorizationFallbackCount, 'counter', 1, {
      action: decision,
      runtime: transport.runtime,
    })
  }
  if (policyTrace.guardrailTriggered) {
    recordTelemetryMetric(telemetryMetricNames.waterGuardrailTriggeredCount, 'counter', 1, {
      action: decision,
      profile: normalizedRequest.waterPolicyProfile,
      runtime: transport.runtime,
    })
  }
  const proofHash = buildDecisionProofHash({
    request: normalizedRequest as unknown as Record<string, unknown>,
    selected: {
      region: selected.region,
      runner: selected.runner,
      carbonIntensity: selected.carbonIntensity,
      signalMode: selected.signalMode,
      accountingMethod: selected.accountingMethod,
      waterAuthority,
    },
    baseline: {
      region: baseline.region,
      carbonIntensity: baseline.carbonIntensity,
    },
    policyTrace: policyTrace as unknown as Record<string, unknown>,
    enforcementPlan: buildKubernetesEnforcementPlan({
      decisionFrameId,
      decision,
      reasonCode,
      selectedRegion: selected.region,
      policyProfile: normalizedRequest.waterPolicyProfile,
      criticality: normalizedRequest.criticality,
      notBefore: delayWindow.notBefore,
      delayMinutes: delayWindow.delayMinutes ?? undefined,
    }) as unknown as Record<string, unknown>,
    providerSnapshotRefs,
    signalMode: selected.signalMode,
    accountingMethod: selected.accountingMethod,
  })
  const response = buildCiResponse({
    data: normalizedRequest,
    requestId,
    transport,
    doctrineVersion: DECISION_DOCTRINE_VERSION,
    operatingMode,
    decisionFrameId,
    decision,
    reasonCode,
    selected,
    baseline,
    rerouteFrom,
    policyTrace,
    signalConfidence,
    fallbackUsed:
      selected.waterSignal.fallbackUsed ||
      selected.carbonFallbackUsed ||
      selected.waterAuthority.authorityMode === 'fallback',
    candidateEvaluations,
    proofHash,
    providerSnapshotRefs,
    waterAuthority,
    precedenceOverrideApplied,
    assurance,
    mss,
    decisionExplanation,
  })

  return {
    response,
    persistable: {
      decisionFrameId,
      selected,
      baseline,
      signalConfidence,
      energyKwh,
      request: normalizedRequest,
      candidateEvaluations,
      requestId,
      transport,
    },
  }
}

export async function finalizeCiDecisionResponse(
  result: Awaited<ReturnType<typeof createDecision>>,
  latencyMs?: { total: number; compute: number },
  options?: {
    idempotencyReplayed?: boolean
  }
) {
  const endedAt = new Date()
  const startedAt = latencyMs
    ? new Date(endedAt.getTime() - Math.max(0, latencyMs.total))
    : endedAt
  const span = buildDecisionSpanRecord({
    startedAt,
    endedAt,
    decisionFrameId: result.response.decisionFrameId,
    action: result.response.decision,
    reasonCode: result.response.reasonCode,
    operatingMode: result.response.operatingMode,
    proofHash: result.response.proofHash,
    fallbackUsed: result.response.fallbackUsed,
    runtime: result.response.decisionEnvelope.transport.runtime,
    regionSelected: result.response.selectedRegion,
    adapterId: result.response.decisionEnvelope.transport.adapterId,
    transport: result.response.decisionEnvelope.transport.transport,
    traceId: result.persistable.request.telemetryContext?.traceId,
  })
  const exportState = await exportDecisionSpanRecord(span)

  const responsePayload = {
    ...result.response,
    decisionEnvelope: {
      ...result.response.decisionEnvelope,
      idempotency: {
        ...result.response.decisionEnvelope.idempotency,
        replayed: Boolean(options?.idempotencyReplayed),
      },
    },
    latencyMs: latencyMs
      ? {
          ...latencyMs,
          providerResolution: result.persistable.selected.providerResolutionMs,
          cacheStatus: result.persistable.selected.cacheStatus,
          influencedDecision:
            result.persistable.selected.cacheStatus !== 'live' ||
            result.persistable.selected.carbonFallbackUsed ||
            result.persistable.selected.waterSignal.fallbackUsed,
        }
      : undefined,
    telemetryBridge: {
      spanName: span.spanName,
      serviceName: span.serviceName,
      traceId: span.traceId,
      spanId: span.spanId,
      durationMs: span.durationMs,
      attributes: span.attributes,
      export: {
        enabled: exportState.enabled,
        exported: exportState.exported,
        endpoint: exportState.endpoint ?? null,
        statusCode: 'statusCode' in exportState ? exportState.statusCode : undefined,
        error: 'error' in exportState ? exportState.error : undefined,
      },
    },
  }

  return CiResponseV2Schema.parse(responsePayload)
}

export async function persistCiDecisionResult(
  result: Awaited<ReturnType<typeof createDecision>>,
  latencyMs?: { total: number; compute: number },
  options?: {
    idempotencyReplayed?: boolean
  }
) {
  const validatedResponse = await finalizeCiDecisionResponse(result, latencyMs, options)

  const { manifest } = loadWaterArtifacts()
  const waterArtifacts = getWaterArtifactMetadata()
  await prisma.$transaction(async (tx: any) => {
    const persisted = await tx.cIDecision.create({
      data: {
        decisionFrameId: result.persistable.decisionFrameId,
        selectedRunner: result.persistable.selected.runner,
        selectedRegion: result.persistable.selected.region,
        carbonIntensity: result.persistable.selected.carbonIntensity,
        baseline: result.persistable.baseline.carbonIntensity,
        savings: validatedResponse.savings.carbonReductionPct,
        jobType: result.persistable.request.jobType,
        preferredRegions: result.persistable.request.preferredRegions,
        carbonWeight: result.persistable.request.carbonWeight,
        recommendation: validatedResponse.recommendation,
        decisionAction: validatedResponse.decision,
        decisionMode: validatedResponse.decisionMode,
        reasonCode: validatedResponse.reasonCode,
        signalConfidence: result.persistable.signalConfidence,
        fallbackUsed: validatedResponse.fallbackUsed,
        waterImpactLiters: validatedResponse.water.selectedLiters,
        waterBaselineLiters: validatedResponse.water.baselineLiters,
        waterScarcityImpact: validatedResponse.water.selectedScarcityImpact,
        waterStressIndex: validatedResponse.water.stressIndex,
        waterConfidence: validatedResponse.water.confidence,
        waterAuthorityMode: validatedResponse.waterAuthority.authorityMode,
        waterScenario: validatedResponse.waterAuthority.scenario,
        facilityId: validatedResponse.waterAuthority.facilityId,
        proofHash: validatedResponse.proofHash,
        waterEvidenceRefs: validatedResponse.waterAuthority.evidenceRefs,
        policyTrace: validatedResponse.policyTrace,
        datasetVersions: validatedResponse.water.datasetVersion,
        metadata: {
          request: result.persistable.request,
          response: validatedResponse,
          policyTrace: validatedResponse.policyTrace,
          signalConfidence: result.persistable.signalConfidence,
          datasetProvenance: manifest.datasets,
          waterArtifacts,
          decisionAction: validatedResponse.decision,
          selectedReliabilityMultiplier: result.persistable.selected.reliabilityMultiplier,
          decisionEnvelope: validatedResponse.decisionEnvelope,
          proofEnvelope: validatedResponse.proofEnvelope,
          telemetryBridge: validatedResponse.telemetryBridge,
          adapterContext: validatedResponse.adapterContext,
        },
        createdAt: new Date(),
      },
    })

    const eventPayload = buildDecisionEvaluatedEvent({
      decisionId: persisted.id,
      decisionFrameId: validatedResponse.decisionFrameId,
      action: validatedResponse.decision,
      reasonCode: validatedResponse.reasonCode,
      baseline: validatedResponse.baseline,
      selected: validatedResponse.selected,
      policyTrace: validatedResponse.policyTrace,
      confidence: validatedResponse.signalConfidence,
      signalsUsed: validatedResponse.proofRecord.signals_used,
      datasetVersions: validatedResponse.proofRecord.dataset_versions,
      sourceProvenance: manifest.datasets as unknown as Record<string, unknown>[],
      canonicalDecision: validatedResponse.decisionEnvelope,
      proof: validatedResponse.proofEnvelope,
      adapter: validatedResponse.adapterContext ?? validatedResponse.decisionEnvelope.transport,
      timestamp: validatedResponse.proofRecord.timestamp,
    })

    await enqueueDecisionEvaluatedEvents(tx, eventPayload)

    await tx.waterPolicyEvidence.create({
      data: {
        decisionFrameId: validatedResponse.decisionFrameId,
        proofHash: validatedResponse.proofHash,
        authorityMode: validatedResponse.waterAuthority.authorityMode,
        scenario: validatedResponse.waterAuthority.scenario,
        facilityId: validatedResponse.waterAuthority.facilityId,
        supplierRefs: validatedResponse.waterAuthority.supplierSet,
        evidenceRefs: validatedResponse.waterAuthority.evidenceRefs,
        providerSnapshotRefs: validatedResponse.proofRecord.provider_snapshot_refs,
        externalPolicyRefs: validatedResponse.proofRecord.external_policy_refs ?? [],
        bundleHash: validatedResponse.proofRecord.water_bundle_hash ?? null,
        manifestHash: validatedResponse.proofRecord.water_manifest_hash ?? null,
        metadata: {
          water: validatedResponse.water,
          proofRecord: validatedResponse.proofRecord,
          proofEnvelope: validatedResponse.proofEnvelope,
          adapterContext: validatedResponse.adapterContext,
        },
      },
    })

    await Promise.all(
      validatedResponse.waterAuthority.supplierSet.map((supplier) =>
        tx.waterProviderSnapshot.create({
          data: {
            provider: supplier,
            authorityRole:
              supplier === 'aqueduct'
                ? 'baseline'
                : supplier.startsWith('facility:')
                  ? 'facility'
                  : 'overlay',
            region: validatedResponse.selectedRegion,
            scenario: validatedResponse.waterAuthority.scenario,
            authorityMode: validatedResponse.waterAuthority.authorityMode,
            confidence: validatedResponse.waterAuthority.confidence,
            evidenceRefs: validatedResponse.waterAuthority.evidenceRefs,
            observedAt: new Date(
              validatedResponse.waterAuthority.telemetryRef
                ? new Date().toISOString()
                : waterArtifacts.bundleGeneratedAt ?? new Date().toISOString()
            ),
            metadata: {
              facilityId: validatedResponse.waterAuthority.facilityId,
              bundleHash: waterArtifacts.bundleHash,
              manifestHash: waterArtifacts.manifestHash,
            },
          },
        })
      )
    )

    if (validatedResponse.decisionMode === 'scenario_planning') {
      await tx.waterScenarioRun.create({
        data: {
          decisionFrameId: validatedResponse.decisionFrameId,
          scenario: validatedResponse.waterAuthority.scenario,
          requestPayload: result.persistable.request,
          resultPayload: validatedResponse,
        },
      })
    }

    if (
      validatedResponse.waterAuthority.authorityMode === 'facility_overlay' &&
      validatedResponse.waterAuthority.facilityId
    ) {
      await tx.facilityWaterTelemetry.create({
        data: {
          facilityId: validatedResponse.waterAuthority.facilityId,
          region: validatedResponse.selectedRegion,
          scenario: validatedResponse.waterAuthority.scenario,
          waterIntensityLPerKwh: validatedResponse.water.intensityLPerKwh,
          waterStressIndex: validatedResponse.water.stressIndex,
          scarcityImpact: validatedResponse.water.selectedScarcityImpact,
          confidence: validatedResponse.water.confidence,
          telemetryRef:
            validatedResponse.waterAuthority.telemetryRef ??
            `water-bundle:${validatedResponse.selectedRegion}:${validatedResponse.decisionFrameId}`,
          evidenceRefs: validatedResponse.waterAuthority.evidenceRefs,
        },
      })
    }
  })

  return validatedResponse
}

async function routeDecisionHandler(req: Request, res: Response) {
  const requestStarted = Date.now()

  try {
    if (!verifySignedDecisionRequest(req, res)) return

    const data = requestSchema.parse(req.body)
    const idempotencyCacheKey = data.idempotencyKey
      ? buildIdempotencyCacheKey({
          namespace: 'decision-api-v1',
          callerId: data.caller?.id ?? null,
          idempotencyKey: data.idempotencyKey,
        })
      : null

    if (idempotencyCacheKey) {
      const cached = await readIdempotentResponse<Record<string, unknown>>(idempotencyCacheKey)
      if (cached) {
        const replayed = CiResponseV2Schema.parse({
          ...cached,
          decisionEnvelope: {
            ...(cached.decisionEnvelope as Record<string, unknown>),
            idempotency: {
              ...((cached.decisionEnvelope as any)?.idempotency ?? {}),
              key: data.idempotencyKey ?? null,
              replayed: true,
            },
          },
        })
        recordTelemetryMetric(telemetryMetricNames.idempotencyReplayCount, 'counter', 1, {
          adapter_id: replayed.decisionEnvelope.transport.adapterId,
          transport: replayed.decisionEnvelope.transport.transport,
        })
        return res.json(replayed)
      }
    }

    const computeStarted = Date.now()
    const result = await createDecision(data)
    const computeMs = Date.now() - computeStarted
    const totalMs = Date.now() - requestStarted
    let validatedResponse = await finalizeCiDecisionResponse(result, {
      total: totalMs,
      compute: computeMs,
    })

    try {
      validatedResponse = await persistCiDecisionResult(
        result,
        {
          total: totalMs,
          compute: computeMs,
        },
        {
          idempotencyReplayed: false,
        }
      )
    } catch (dbError) {
      console.warn('Failed to persist CI decision:', dbError)
      validatedResponse.policyTrace.reasonCodes.push('DB_PERSIST_FAILED_LOCAL_RESPONSE_ONLY')
    }

    if (idempotencyCacheKey) {
      await writeIdempotentResponse(idempotencyCacheKey, validatedResponse)
    }

    recordLatency(totalMs, computeMs)
    recordTelemetryMetric(telemetryMetricNames.authorizationDecisionCount, 'counter', 1, {
      action: validatedResponse.decision,
      signal_mode: validatedResponse.signalMode,
      accounting_method: validatedResponse.accountingMethod,
      critical_path: Boolean(req.body?.criticalPath),
    })
    recordTelemetryMetric(telemetryMetricNames.authorizationDecisionLatencyMs, 'histogram', totalMs, {
      action: validatedResponse.decision,
      cache_status: validatedResponse.latencyMs?.cacheStatus ?? 'live',
    })
    return res.json(validatedResponse)
  } catch (error) {
    const fallbackRegion = getFallbackRegion(
      Array.isArray(req.body?.preferredRegions) ? req.body.preferredRegions : ['us-east-1']
    )
    const fallbackDecisionFrameId = `fallback-${Date.now()}`
    const totalMs = Date.now() - requestStarted
    const transport = (() => {
      try {
        return resolveCanonicalTransportMetadata(req.body?.transport)
      } catch {
        return resolveCanonicalTransportMetadata()
      }
    })()
    const providerSnapshotRef = `${fallbackRegion}:STATIC_FALLBACK:${new Date().toISOString()}`
    const fallbackProofHash = buildDecisionProofHash({
      request: req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {},
      selected: { region: fallbackRegion, carbonIntensity: 500 },
      baseline: { region: fallbackRegion, carbonIntensity: 500 },
      policyTrace: {
        policyVersion: WATER_POLICY_VERSION,
        reasonCode: 'FALLBACK_INPUT_OR_RUNTIME_ERROR',
      },
      enforcementPlan: buildKubernetesEnforcementPlan({
        decisionFrameId: fallbackDecisionFrameId,
        decision: 'deny',
        reasonCode: 'FALLBACK_INPUT_OR_RUNTIME_ERROR',
        selectedRegion: fallbackRegion,
        policyProfile: 'default',
        criticality: 'standard',
      }) as unknown as Record<string, unknown>,
      providerSnapshotRefs: [providerSnapshotRef],
      signalMode: 'fallback',
      accountingMethod: 'average',
    })

    recordLatency(totalMs, totalMs)
    recordTelemetryMetric(telemetryMetricNames.authorizationDecisionCount, 'counter', 1, {
      action: 'deny',
      signal_mode: 'fallback',
      accounting_method: 'average',
      critical_path: Boolean(req.body?.criticalPath),
    })
    recordTelemetryMetric(telemetryMetricNames.authorizationFailClosedCount, 'counter', 1, {
      reason_code: 'FALLBACK_INPUT_OR_RUNTIME_ERROR',
      criticality: 'standard',
    })
    recordTelemetryMetric(telemetryMetricNames.authorizationDecisionLatencyMs, 'histogram', totalMs, {
      action: 'deny',
      cache_status: 'fallback',
    })

    return res.status(200).json({
      decision: 'deny',
      decisionMode: 'runtime_authorization',
      doctrineVersion: DECISION_DOCTRINE_VERSION,
      operatingMode: 'CRISIS',
      reasonCode: 'FALLBACK_INPUT_OR_RUNTIME_ERROR',
      decisionFrameId: fallbackDecisionFrameId,
      selectedRunner: RUNNER_REGIONS[fallbackRegion]?.[0] ?? 'ubuntu-latest',
      selectedRegion: fallbackRegion,
      recommendation: 'Conservative fallback path used',
      signalConfidence: 0.05,
      fallbackUsed: true,
      signalMode: 'fallback',
      accountingMethod: 'average',
      decisionEnvelope: buildCanonicalDecisionEnvelope({
        requestId: req.body?.requestId ?? fallbackDecisionFrameId,
        decisionFrameId: fallbackDecisionFrameId,
        action: 'deny',
        reasonCode: 'FALLBACK_INPUT_OR_RUNTIME_ERROR',
        selectedRegion: fallbackRegion,
        selectedRunner: RUNNER_REGIONS[fallbackRegion]?.[0] ?? 'ubuntu-latest',
        baselineRegion: fallbackRegion,
        runtime: transport.runtime,
        provider:
          typeof req.body?.runtimeTarget?.provider === 'string' ? req.body.runtimeTarget.provider : 'generic',
        signalConfidence: 0.05,
        decisionMode: 'runtime_authorization',
        fallbackUsed: true,
        doctrineVersion: DECISION_DOCTRINE_VERSION,
        operatingMode: 'CRISIS',
        hierarchy: [...DETERMINISTIC_CONFLICT_HIERARCHY],
        transport,
        notBefore: null,
        timeoutMs: req.body?.timeoutMs,
        requestAt: new Date(),
        idempotencyKey: req.body?.idempotencyKey ?? null,
      }),
      proofEnvelope: buildCanonicalProofEnvelope({
        posture: 'degraded',
        proofHash: fallbackProofHash,
        mssSnapshotId: `mss-${fallbackDecisionFrameId}`,
        baseline: {
          region: fallbackRegion,
          carbonIntensity: 500,
          waterImpactLiters: 0,
          waterScarcityImpact: 0,
        },
        selected: {
          region: fallbackRegion,
          carbonIntensity: 500,
          waterImpactLiters: 0,
          waterScarcityImpact: 0,
        },
        carbonProvider: 'STATIC_FALLBACK',
        waterAuthorityMode: 'fallback',
        fallbackUsed: true,
        disagreementPct: 0,
        datasetVersions: { fallback: 'conservative_defaults_v1' },
        providerSnapshotRefs: [providerSnapshotRef],
        transport,
      }),
      notBefore: null,
      proofHash: fallbackProofHash,
      waterAuthority: {
        authorityMode: 'fallback',
        scenario: 'current',
        confidence: 0.05,
        supplierSet: ['fallback_conservative'],
        evidenceRefs: ['water:fallback:conservative-defaults'],
        facilityId: null,
        telemetryRef: null,
        bundleHash: null,
        manifestHash: null,
      },
      assurance: {
        operationallyUsable: false,
        assuranceReady: false,
        status: 'degraded',
        issues: ['REQUEST_VALIDATION_OR_RUNTIME_FAILURE'],
      },
      mss: {
        snapshotId: `mss-${fallbackDecisionFrameId}`,
        carbonProvider: 'STATIC_FALLBACK',
        carbonProviderHealth: 'FAILED',
        waterAuthorityHealth: 'FAILED',
        carbonFreshnessSec: null,
        waterFreshnessSec: null,
        cacheStatus: 'fallback',
        disagreement: {
          flag: false,
          pct: 0,
        },
        lastKnownGoodApplied: true,
        carbonLineage: ['STATIC_FALLBACK'],
        waterLineage: ['fallback_conservative'],
      },
      decisionExplanation: {
        hierarchy: [...DETERMINISTIC_CONFLICT_HIERARCHY],
        whyAction: 'The request failed validation or runtime evaluation, so the engine denied execution through the conservative fallback path.',
        whyTarget: `The fallback region ${fallbackRegion} was selected because no validated runtime decision could be produced.`,
        rejectedAlternatives: [],
      },
      policyTrace: {
        capabilityId: 'ci.route.authorization',
        authorizationMode: 'pre_action',
        policyPacks: [`water.default.${WATER_POLICY_VERSION}`],
        scenarioPlanningActive: false,
        policyVersion: WATER_POLICY_VERSION,
        profile: 'default',
        thresholds: {
          stressDeny: 4.7,
          stressDelay: 4.0,
          scarcityDeny: 10,
          scarcityDelay: 6,
        },
        guardrailTriggered: true,
        fallbackUsed: true,
        strictMode: true,
        reasonCodes: [
          'REQUEST_VALIDATION_OR_RUNTIME_FAILURE',
          error instanceof Error ? error.message : 'Unknown error',
        ],
        conflictHierarchy: [...DETERMINISTIC_CONFLICT_HIERARCHY],
        operatingMode: 'CRISIS',
        externalPolicy: {
          enabled: false,
          strict: true,
          evaluated: false,
          applied: false,
          hookStatus: 'skipped',
          reasonCodes: ['EXTERNAL_POLICY_NOT_EVALUATED_FALLBACK_PATH'],
          policyReference: null,
        },
        sekedPolicy: {
          enabled: false,
          strict: true,
          evaluated: false,
          applied: false,
          hookStatus: 'skipped',
          reasonCodes: ['SEKED_POLICY_NOT_EVALUATED_FALLBACK_PATH'],
          policyReference: null,
        },
      },
      baseline: {
        region: fallbackRegion,
        carbonIntensity: 500,
        waterImpactLiters: 0,
        waterScarcityImpact: 0,
      },
      selected: {
        region: fallbackRegion,
        carbonIntensity: 500,
        waterImpactLiters: 0,
        waterScarcityImpact: 0,
      },
      savings: {
        carbonReductionPct: 0,
        waterImpactDeltaLiters: 0,
      },
      water: {
        selectedLiters: 0,
        baselineLiters: 0,
        selectedScarcityImpact: 0,
        baselineScarcityImpact: 0,
        intensityLPerKwh: 2,
        stressIndex: 4,
        qualityIndex: null,
        droughtRiskIndex: null,
        confidence: 0.05,
        source: ['fallback_conservative'],
        datasetVersion: { fallback: 'conservative_defaults_v1' },
        guardrailTriggered: true,
        fallbackUsed: true,
      },
      kubernetesEnforcement: buildKubernetesEnforcementPlan({
        decisionFrameId: fallbackDecisionFrameId,
        decision: 'deny',
        decisionMode: 'runtime_authorization',
        reasonCode: 'FALLBACK_INPUT_OR_RUNTIME_ERROR',
        selectedRegion: fallbackRegion,
        policyProfile: 'default',
        criticality: 'standard',
        waterAuthorityMode: 'fallback',
        waterScenario: 'current',
        proofHash: fallbackProofHash,
      }),
      enforcementBundle: {
        kubernetes: buildKubernetesEnforcementPlan({
          decisionFrameId: fallbackDecisionFrameId,
          decision: 'deny',
          decisionMode: 'runtime_authorization',
          reasonCode: 'FALLBACK_INPUT_OR_RUNTIME_ERROR',
          selectedRegion: fallbackRegion,
          policyProfile: 'default',
          criticality: 'standard',
          waterAuthorityMode: 'fallback',
          waterScenario: 'current',
          proofHash: fallbackProofHash,
        }),
        githubActions: buildGithubActionsEnforcementBundle({
          decisionFrameId: fallbackDecisionFrameId,
          decision: 'deny',
          decisionMode: 'runtime_authorization',
          selectedRegion: fallbackRegion,
          preferredRegions: [fallbackRegion],
          criticality: 'standard',
          notBefore: null,
        }),
      },
      workflowOutputs: {
        decision: 'deny',
        reasonCode: 'FALLBACK_INPUT_OR_RUNTIME_ERROR',
        selectedRegion: fallbackRegion,
        selectedRunner: RUNNER_REGIONS[fallbackRegion]?.[0] ?? 'ubuntu-latest',
        carbonIntensity: 500,
        carbonBaseline: 500,
        carbonReductionPct: 0,
        waterSelectedLiters: 0,
        waterBaselineLiters: 0,
        waterImpactDeltaLiters: 0,
        waterStressIndex: 4,
        waterScarcityImpact: 0,
        signalConfidence: 0.05,
        decisionFrameId: fallbackDecisionFrameId,
        waterPolicyVersion: WATER_POLICY_VERSION,
        signalMode: 'fallback',
        accountingMethod: 'average',
        proofHash: fallbackProofHash,
        decisionMode: 'runtime_authorization',
        waterAuthorityMode: 'fallback',
        waterScenario: 'current',
        githubActionsExecutable: true,
        githubActionsMaxParallel: 0,
        githubActionsEnvironment: 'ecobe-blocked',
        githubActionsNotBefore: null,
        kubernetesRegion: fallbackRegion,
        kubernetesDecision: 'blocked',
        kubernetesNotBefore: null,
        kubernetesReplicaFactor: 0,
        selectedRegionReliabilityMultiplier: 1,
      },
      candidateEvaluations: [
        {
          region: fallbackRegion,
          score: 9999,
          carbonIntensity: 500,
          waterImpactLiters: 0,
          scarcityImpact: 0,
          reliabilityMultiplier: 1,
          defensiblePenalty: 100,
          defensibleReasonCodes: ['FALLBACK_CONSERVATIVE_MODE'],
          supplierSet: ['fallback_conservative'],
          evidenceRefs: ['water:fallback:conservative-defaults'],
          authorityMode: 'fallback',
          guardrailCandidateBlocked: true,
          guardrailReasons: ['FALLBACK_CONSERVATIVE_MODE'],
        },
      ],
      proofRecord: {
        job_id: fallbackDecisionFrameId,
        baseline_region: fallbackRegion,
        selected_region: fallbackRegion,
        carbon_delta: 0,
        water_delta: 0,
        signals_used: ['fallback_conservative'],
        timestamp: new Date().toISOString(),
        dataset_versions: { fallback: 'conservative_defaults_v1' },
        confidence_score: 0.05,
        proof_hash: fallbackProofHash,
        provider_snapshot_refs: [providerSnapshotRef],
        mss_snapshot_id: `mss-${fallbackDecisionFrameId}`,
        water_bundle_hash: null,
        water_manifest_hash: null,
        supplier_refs: ['fallback_conservative'],
        facility_telemetry_refs: [],
        water_scenario: 'current',
        external_policy_refs: [],
        water_evidence_refs: ['water:fallback:conservative-defaults'],
        transport: transport.transport,
        adapter_id: transport.adapterId,
        adapter_version: transport.adapterVersion,
        enforcement_result: transport.enforcementResult,
        observed_runtime_target: transport.observedRuntimeTarget ?? null,
      },
      telemetryBridge: {
        spanName: 'ecobe.decision.authorize',
        serviceName: 'ecobe-engine',
        traceId: req.body?.telemetryContext?.traceId ?? `fallback-${fallbackDecisionFrameId}`,
        spanId: fallbackDecisionFrameId.replace(/-/g, '').slice(0, 16),
        durationMs: totalMs,
        attributes: {
          'ecobe.decision_frame_id': fallbackDecisionFrameId,
          'ecobe.action': 'deny',
          'ecobe.reason_code': 'FALLBACK_INPUT_OR_RUNTIME_ERROR',
          'ecobe.operating_mode': 'CRISIS',
          'ecobe.proof_hash': fallbackProofHash,
          'ecobe.fallback_used': true,
          'ecobe.runtime': transport.runtime,
          'ecobe.region_selected': fallbackRegion,
          'ecobe.adapter_id': transport.adapterId,
          'ecobe.transport': transport.transport,
        },
        export: {
          enabled: false,
          exported: false,
          endpoint: null,
        },
      },
      latencyMs: {
        total: totalMs,
        compute: totalMs,
        providerResolution: 0,
        cacheStatus: 'fallback',
        influencedDecision: true,
      },
      adapterContext: transport,
    })
  }
}

router.post(['/route', '/carbon-route', '/authorize'], routeDecisionHandler)

const k8sEnforcementSchema = z.object({
  decisionFrameId: z.string().min(1),
  decision: z.enum(['run_now', 'reroute', 'delay', 'throttle', 'deny']),
  decisionMode: z.enum(['runtime_authorization', 'scenario_planning']).optional(),
  reasonCode: z.string().min(1),
  selectedRegion: z.string().min(1),
  policyProfile: z.enum(['default', 'drought_sensitive', 'eu_data_center_reporting', 'high_water_sensitivity']),
  criticality: z.enum(['critical', 'standard', 'batch']),
  delayMinutes: z.number().int().positive().max(1440).optional(),
  throttleFactor: z.number().min(0.1).max(1).optional(),
  waterAuthorityMode: z.enum(['basin', 'facility_overlay', 'fallback']).optional(),
  waterScenario: z.enum(['current', '2030', '2050', '2080']).optional(),
  proofHash: z.string().optional(),
})

router.get('/spec', (_req, res) => {
  res.json({
    version: 'DecisionApiV1',
    canonicalPath: '/api/v1/ci/authorize',
    aliases: ['/api/v1/ci/route', '/api/v1/ci/carbon-route'],
    actions: ['run_now', 'reroute', 'delay', 'throttle', 'deny'],
    runtimes: ['http', 'event', 'queue', 'lambda', 'kubernetes', 'github_actions'],
    controlPoints: {
      http: ['gateway_preflight', 'app_middleware', 'orchestrator_pre_dispatch'],
      event: ['event_bus', 'scheduler_ingress', 'workflow_engine'],
      queue: ['dispatcher', 'consumer_wrapper', 'cron_entrypoint'],
      lambda: ['lambda_wrapper', 'lambda_extension'],
      kubernetes: ['admission_controller', 'scheduler_hint', 'operator_metadata'],
      githubActions: ['pre_job', 'runner_wrapper'],
    },
    requestFields: [
      'requestId',
      'idempotencyKey',
      'timeoutMs',
      'caller',
      'runtimeTarget',
      'transport',
      'telemetryContext',
      'preferredRegions',
      'criticality',
      'waterPolicyProfile',
      'signalPolicy',
    ],
    responseFields: [
      'decisionEnvelope',
      'proofEnvelope',
      'telemetryBridge',
      'proofRecord',
      'enforcementBundle',
    ],
  })
})

router.post('/k8s/enforce', internalServiceGuard, (req, res) => {
  try {
    const payload = k8sEnforcementSchema.parse(req.body)
    const plan = buildKubernetesEnforcementPlan({
      decisionFrameId: payload.decisionFrameId,
      decision: payload.decision,
      decisionMode: payload.decisionMode,
      reasonCode: payload.reasonCode,
      selectedRegion: payload.selectedRegion,
      policyProfile: payload.policyProfile,
      criticality: payload.criticality,
      delayMinutes: payload.delayMinutes,
      throttleFactor: payload.throttleFactor,
      waterAuthorityMode: payload.waterAuthorityMode,
      waterScenario: payload.waterScenario,
      proofHash: payload.proofHash,
    })
    recordTelemetryMetric(telemetryMetricNames.enforcementApplicationCount, 'counter', 1, {
      decision: payload.decision,
      criticality: payload.criticality,
    })
    res.json({
      ...plan,
      policyVersion: WATER_POLICY_VERSION,
    })
  } catch (error) {
    res.status(400).json({
      error: 'Invalid Kubernetes enforcement request',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.post('/k8s/enforcement-bundle', internalServiceGuard, (req, res) => {
  try {
    const payload = k8sEnforcementSchema.parse(req.body)
    const plan = buildKubernetesEnforcementPlan({
      decisionFrameId: payload.decisionFrameId,
      decision: payload.decision,
      decisionMode: payload.decisionMode,
      reasonCode: payload.reasonCode,
      selectedRegion: payload.selectedRegion,
      policyProfile: payload.policyProfile,
      criticality: payload.criticality,
      delayMinutes: payload.delayMinutes,
      throttleFactor: payload.throttleFactor,
      waterAuthorityMode: payload.waterAuthorityMode,
      waterScenario: payload.waterScenario,
      proofHash: payload.proofHash,
    })
    const githubActions = buildGithubActionsEnforcementBundle({
      decisionFrameId: payload.decisionFrameId,
      decision: payload.decision,
      decisionMode: payload.decisionMode ?? 'runtime_authorization',
      selectedRegion: payload.selectedRegion,
      preferredRegions: [payload.selectedRegion],
      criticality: payload.criticality,
      notBefore: plan.execution.notBefore,
    })
    recordTelemetryMetric(telemetryMetricNames.enforcementApplicationCount, 'counter', 1, {
      decision: payload.decision,
      criticality: payload.criticality,
      target: 'gatekeeper',
    })
    res.json({
      policyVersion: WATER_POLICY_VERSION,
      enforcement: plan,
      gatekeeper: plan.gatekeeper,
      githubActions,
      workflowOutputs: {
        decisionFrameId: payload.decisionFrameId,
        region: payload.selectedRegion,
        notBefore: plan.execution.notBefore,
        targetReplicaFactor: plan.scaling.targetReplicaFactor,
        githubActionsMaxParallel: githubActions.maxParallel,
        githubActionsEnvironment: githubActions.environment,
      },
    })
  } catch (error) {
    res.status(400).json({
      error: 'Invalid Kubernetes enforcement bundle request',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.get('/health', async (_req, res) => {
  const artifactHealth = validateWaterArtifacts()
  const { manifest } = loadWaterArtifacts()
  const provenance = inspectWaterDatasetProvenance()
  let dbAvailable = true
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    dbAvailable = false
  }

  const unhashedDatasets = manifest.datasets.filter(
    (dataset) => !dataset.file_hash || dataset.file_hash === 'unverified'
  )
  const assuranceReady = artifactHealth.healthy && dbAvailable && unhashedDatasets.length === 0
  const status = artifactHealth.healthy && dbAvailable ? 'healthy' : 'degraded'
  res.status(artifactHealth.healthy && dbAvailable ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    checks: {
      database: dbAvailable,
      waterArtifacts: artifactHealth.checks,
      assuranceReady,
    },
    assurance: {
      operationallyUsable: artifactHealth.healthy && dbAvailable,
      assuranceReady,
      status: assuranceReady ? 'assurance_ready' : artifactHealth.healthy && dbAvailable ? 'operational' : 'degraded',
      unhashedDatasets: unhashedDatasets.map((dataset) => dataset.name),
    },
    provenance: provenance.summary,
    errors: artifactHealth.errors,
    sloBudgetMs: {
      ...sloState.budget,
      totalP95: sloState.budget.totalP95Ms,
      computeP95: sloState.budget.computeP95Ms,
    },
  })
})

router.get('/slo', (_req, res) => {
  const p50Total = percentile(sloState.totalMs, 50)
  const p95Total = percentile(sloState.totalMs, 95)
  const p99Total = percentile(sloState.totalMs, 99)
  const p50Compute = percentile(sloState.computeMs, 50)
  const p95Compute = percentile(sloState.computeMs, 95)
  const p99Compute = percentile(sloState.computeMs, 99)
  const currentTotal = sloState.totalMs[sloState.totalMs.length - 1] ?? 0
  const currentCompute = sloState.computeMs[sloState.computeMs.length - 1] ?? 0
  res.json({
    samples: sloState.totalMs.length,
    p50: {
      totalMs: Number(p50Total.toFixed(3)),
      computeMs: Number(p50Compute.toFixed(3)),
    },
    p95: {
      totalMs: Number(p95Total.toFixed(3)),
      computeMs: Number(p95Compute.toFixed(3)),
    },
    p99: {
      totalMs: Number(p99Total.toFixed(3)),
      computeMs: Number(p99Compute.toFixed(3)),
    },
    current: {
      totalMs: Number(currentTotal.toFixed(3)),
      computeMs: Number(currentCompute.toFixed(3)),
    },
    budget: sloState.budget,
    withinBudget: {
      total: p95Total <= sloState.budget.totalP95Ms,
      compute: p95Compute <= sloState.budget.computeP95Ms,
    },
    budgetMs: {
      totalP95: sloState.budget.totalP95Ms,
      computeP95: sloState.budget.computeP95Ms,
    },
    currentMs: {
      total: {
        p50: Number(p50Total.toFixed(3)),
        p95: Number(p95Total.toFixed(3)),
        p99: Number(p99Total.toFixed(3)),
        current: Number(currentTotal.toFixed(3)),
      },
      compute: {
        p50: Number(p50Compute.toFixed(3)),
        p95: Number(p95Compute.toFixed(3)),
        p99: Number(p99Compute.toFixed(3)),
        current: Number(currentCompute.toFixed(3)),
      },
    },
    counts: {
      totalSamples: sloState.totalMs.length,
      computeSamples: sloState.computeMs.length,
    },
  })
})

router.get('/telemetry', (_req, res) => {
  res.json({
    generatedAt: new Date().toISOString(),
    otel: {
      enabled: env.OTEL_EXPORT_ENABLED,
      endpoint: env.OTEL_EXPORT_ENDPOINT ?? null,
      serviceName: env.OTEL_SERVICE_NAME,
    },
    metrics: getTelemetrySnapshot(),
  })
})

router.get('/regions', async (_req, res) => {
  res.json({
    regions: Object.entries(RUNNER_REGIONS).map(([region, runners]) => {
      const water = resolveWaterSignal(region)
      return {
        region,
        runners,
        defaultRunner: runners[0],
        waterStressIndex: water.waterStressIndex,
        waterIntensityLPerKwh: water.waterIntensityLPerKwh,
        waterConfidence: water.confidence,
      }
    }),
    totalRegions: Object.keys(RUNNER_REGIONS).length,
  })
})

router.get('/decisions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50
    const decisions = await prisma.cIDecision.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        decisionFrameId: true,
        selectedRunner: true,
        selectedRegion: true,
        carbonIntensity: true,
        baseline: true,
        savings: true,
        decisionAction: true,
        decisionMode: true,
        reasonCode: true,
        signalConfidence: true,
        policyTrace: true,
        waterImpactLiters: true,
        waterBaselineLiters: true,
        waterScarcityImpact: true,
        waterStressIndex: true,
        waterConfidence: true,
        waterAuthorityMode: true,
        waterScenario: true,
        facilityId: true,
        proofHash: true,
        waterEvidenceRefs: true,
        fallbackUsed: true,
        jobType: true,
        metadata: true,
        createdAt: true,
      },
    })
    res.json({
      decisions: decisions.map((decision: any) => ({
        ...decision,
        action: decision.decisionAction ?? (decision.metadata as any)?.response?.decision ?? 'run_now',
        decisionMode: decision.decisionMode ?? (decision.metadata as any)?.response?.decisionMode ?? 'runtime_authorization',
        reasonCode: decision.reasonCode ?? (decision.metadata as any)?.response?.reasonCode ?? 'UNKNOWN',
        signalMode: (decision.metadata as any)?.response?.signalMode ?? 'fallback',
        accountingMethod: (decision.metadata as any)?.response?.accountingMethod ?? 'average',
        notBefore: (decision.metadata as any)?.response?.notBefore ?? null,
        proofHash: decision.proofHash ?? (decision.metadata as any)?.response?.proofHash ?? null,
        waterAuthorityMode: decision.waterAuthorityMode ?? (decision.metadata as any)?.response?.waterAuthority?.authorityMode ?? 'fallback',
        waterScenario: decision.waterScenario ?? (decision.metadata as any)?.response?.waterAuthority?.scenario ?? 'current',
        facilityId: decision.facilityId ?? (decision.metadata as any)?.response?.waterAuthority?.facilityId ?? null,
        waterEvidenceRefs: decision.waterEvidenceRefs ?? (decision.metadata as any)?.response?.waterAuthority?.evidenceRefs ?? [],
        latencyMs: (decision.metadata as any)?.response?.latencyMs ?? null,
        decisionEnvelope: (decision.metadata as any)?.response?.decisionEnvelope ?? null,
        proofEnvelope: (decision.metadata as any)?.response?.proofEnvelope ?? null,
        telemetryBridge: (decision.metadata as any)?.response?.telemetryBridge ?? null,
        adapterContext: (decision.metadata as any)?.response?.adapterContext ?? null,
      })),
      total: decisions.length,
      limit,
    })
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch CI decisions',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.get('/decisions/:decisionFrameId/replay', internalServiceGuard, async (req, res) => {
  try {
    const decision = await prisma.cIDecision.findFirst({
      where: { decisionFrameId: req.params.decisionFrameId },
      orderBy: { createdAt: 'desc' },
    })
    if (!decision) {
      return res.status(404).json({
        error: 'Decision not found',
        code: 'DECISION_NOT_FOUND',
      })
    }

    const metadata = (decision.metadata ?? {}) as any
    const requestPayload = metadata.request
    if (!requestPayload) {
      return res.status(422).json({
        error: 'Decision does not contain replay payload',
        code: 'REPLAY_PAYLOAD_MISSING',
      })
    }

    const replayResult = await createDecision(requestSchema.parse(requestPayload))
    const replayResponse = await finalizeCiDecisionResponse(replayResult)
    const mismatches = [
      (metadata.response?.decision ?? null) === replayResponse.decision ? null : 'decision',
      (metadata.response?.selectedRegion ?? null) === replayResponse.selectedRegion ? null : 'selectedRegion',
      (metadata.response?.reasonCode ?? null) === replayResponse.reasonCode ? null : 'reasonCode',
      (metadata.response?.proofHash ?? null) === replayResponse.proofHash ? null : 'proofHash',
    ].filter((value): value is string => Boolean(value))

    if (mismatches.length === 0) {
      recordTelemetryMetric(telemetryMetricNames.replayConsistencyCount, 'counter', 1, {
        decision_frame_id: decision.decisionFrameId,
      })
    } else {
      recordTelemetryMetric(telemetryMetricNames.replayMismatchCount, 'counter', 1, {
        decision_frame_id: decision.decisionFrameId,
        mismatches: mismatches.join(','),
      })
    }

    return res.json({
      decisionFrameId: decision.decisionFrameId,
      storedResponse: metadata.response ?? null,
      replayedResponse: replayResponse,
      persisted: metadata.response ?? null,
      replay: replayResponse,
      consistent: mismatches.length === 0,
      deterministicMatch: mismatches.length === 0,
      mismatches,
      replayedAt: new Date().toISOString(),
    })
  } catch (error) {
    return res.status(500).json({
      error: 'Replay failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.post('/exports/proof', internalServiceGuard, async (req, res) => {
  try {
    const body = z
      .object({
        limit: z.number().int().positive().max(1000).default(100),
      })
      .parse(req.body ?? {})

    const decisions = await prisma.cIDecision.findMany({
      orderBy: { createdAt: 'desc' },
      take: body.limit,
    })

    const payload = {
      exportedAt: new Date().toISOString(),
      count: decisions.length,
      decisions: decisions.map((decision: any) => ({
        decisionFrameId: decision.decisionFrameId,
        selectedRegion: decision.selectedRegion,
        selectedRunner: decision.selectedRunner,
        carbonIntensity: decision.carbonIntensity,
        baselineCarbonIntensity: decision.baseline,
        savings: decision.savings,
        metadata: decision.metadata,
        proofHash: decision.proofHash ?? null,
        waterAuthorityMode: decision.waterAuthorityMode ?? null,
        waterScenario: decision.waterScenario ?? null,
        facilityId: decision.facilityId ?? null,
        waterEvidenceRefs: decision.waterEvidenceRefs ?? [],
        decisionEnvelope: (decision.metadata as any)?.response?.decisionEnvelope ?? null,
        proofEnvelope: (decision.metadata as any)?.response?.proofEnvelope ?? null,
        telemetryBridge: (decision.metadata as any)?.response?.telemetryBridge ?? null,
        adapterContext:
          (decision.metadata as any)?.response?.adapterContext ??
          (decision.metadata as any)?.adapterContext ??
          null,
        executionOutcome:
          (decision.metadata as any)?.executionOutcome ??
          (decision.metadata as any)?.response?.proofEnvelope?.adapter ??
          null,
        createdAt: decision.createdAt.toISOString(),
      })),
      waterArtifactVersion: (() => {
        try {
          const { bundle, manifest } = loadWaterArtifacts()
          const artifacts = getWaterArtifactMetadata()
          return {
            bundleSchema: bundle.schema_version,
            manifestSchema: manifest.schema_version,
            builtAt: manifest.built_at,
            bundleHash: artifacts.bundleHash,
            manifestHash: artifacts.manifestHash,
          }
        } catch {
          return { bundleSchema: 'fallback', manifestSchema: 'fallback', builtAt: null, bundleHash: null, manifestHash: null }
        }
      })(),
    }

    const batchId = `ci-proof-${new Date().toISOString().replace(/[:.]/g, '-')}`
    const chain = persistExportBatch(batchId, payload)
    recordTelemetryMetric(telemetryMetricNames.proofExportCount, 'counter', 1, {
      exported_records: decisions.length,
    })

    return res.json({
      batchId,
      batchHash: chain.batchHash,
      previousBatchHash: chain.previousBatchHash,
      chainPosition: chain.chainPosition,
      exportedRecords: decisions.length,
      batchPath: chain.batchPath,
      createdAt: new Date().toISOString(),
    })
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to export proof batch',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

export default router
