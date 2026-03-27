import crypto from 'crypto'

import { z } from 'zod'

import { env } from '../../config/env'

export const CanonicalDecisionActionSchema = z.enum(['run_now', 'reroute', 'delay', 'throttle', 'deny'])
export const CanonicalRuntimeSchema = z.enum([
  'http',
  'event',
  'queue',
  'lambda',
  'kubernetes',
  'github_actions',
  'container',
  'scheduler',
  'unknown',
])
export const CanonicalTransportSchema = z.enum([
  'sync_http',
  'cloudevent',
  'queue_dispatch',
  'lambda_invoke',
  'ci_runner',
  'k8s_admission',
  'unknown',
])
export const CanonicalProofPostureSchema = z.enum(['operational', 'assurance_ready', 'degraded'])
export const CanonicalSourceModeSchema = z.enum(['live', 'degraded', 'simulation'])
export const CanonicalEnforcementResultSchema = z.enum(['applied', 'skipped', 'failed'])

export const CanonicalCallerSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['service', 'runtime', 'user', 'system']).default('service'),
  tenantId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  signature: z.string().min(1).optional(),
})

export const CanonicalRuntimeTargetSchema = z.object({
  runtime: CanonicalRuntimeSchema.default('http'),
  provider: z.string().min(1).default('generic'),
  region: z.string().min(1).optional(),
  identifier: z.string().min(1).optional(),
})

export const CanonicalTransportMetadataSchema = z.object({
  runtime: CanonicalRuntimeSchema.default('http'),
  transport: CanonicalTransportSchema.default('sync_http'),
  controlPoint: z.string().min(1).default('gateway_preflight'),
  adapterId: z.string().min(1).default('ecobe.http.decision.v1'),
  adapterVersion: z.string().min(1).default('1.0.0'),
  observedRuntimeTarget: z.string().min(1).optional(),
  enforcementResult: CanonicalEnforcementResultSchema.default('applied'),
})

export const CanonicalTelemetryContextSchema = z.object({
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
})

export const CanonicalDecisionEnvelopeSchema = z.object({
  requestId: z.string().min(1),
  decisionFrameId: z.string().min(1),
  action: CanonicalDecisionActionSchema,
  reasonCode: z.string().min(1),
  selectedTarget: z.object({
    region: z.string().min(1),
    runtime: CanonicalRuntimeSchema,
    runner: z.string().nullable(),
    provider: z.string().min(1),
  }),
  baselineTarget: z.object({
    region: z.string().min(1),
    runtime: CanonicalRuntimeSchema,
    runner: z.string().nullable(),
  }),
  timing: z.object({
    notBefore: z.string().nullable(),
    expiresAt: z.string(),
  }),
  confidence: z.object({
    score: z.number().min(0).max(1),
    mode: CanonicalSourceModeSchema,
  }),
  doctrine: z.object({
    version: z.string().min(1),
    operatingMode: z.enum(['NORMAL', 'STRESS', 'CRISIS']),
    hierarchy: z.array(z.string()).min(1),
  }),
  transport: CanonicalTransportMetadataSchema,
  idempotency: z.object({
    key: z.string().nullable(),
    replayed: z.boolean(),
  }),
})

export const CanonicalProofEnvelopeSchema = z.object({
  posture: CanonicalProofPostureSchema,
  proofHash: z.string().min(1),
  mssSnapshotId: z.string().min(1),
  baseline: z.object({
    region: z.string().min(1),
    carbonIntensity: z.number(),
    waterImpactLiters: z.number(),
    waterScarcityImpact: z.number(),
  }),
  selected: z.object({
    region: z.string().min(1),
    carbonIntensity: z.number(),
    waterImpactLiters: z.number(),
    waterScarcityImpact: z.number(),
  }),
  signalLineage: z.object({
    carbonProvider: z.string().min(1),
    waterAuthorityMode: z.enum(['basin', 'facility_overlay', 'fallback']),
    fallbackUsed: z.boolean(),
    disagreementPct: z.number(),
    datasetVersions: z.record(z.string()),
    providerSnapshotRefs: z.array(z.string()),
  }),
  adapter: z.object({
    transport: CanonicalTransportSchema,
    adapterId: z.string().min(1),
    adapterVersion: z.string().min(1),
    enforcementResult: CanonicalEnforcementResultSchema,
    observedRuntimeTarget: z.string().nullable(),
  }),
})

export const CanonicalDecisionCloudEventSchema = z.object({
  specversion: z.literal('1.0'),
  id: z.string().min(1),
  source: z.string().min(1),
  type: z.literal('dev.ecobe.decision.v1'),
  subject: z.string().min(1),
  time: z.string().min(1),
  datacontenttype: z.literal('application/json'),
  data: z.object({
    decision: CanonicalDecisionEnvelopeSchema,
    proof: CanonicalProofEnvelopeSchema,
    telemetry: CanonicalTelemetryContextSchema.optional(),
  }),
  signature: z.string().min(1),
})

export type CanonicalTransportMetadata = z.infer<typeof CanonicalTransportMetadataSchema>
export type CanonicalTelemetryContext = z.infer<typeof CanonicalTelemetryContextSchema>

function toCanonicalJson(payload: unknown) {
  if (typeof payload === 'string') return payload
  return JSON.stringify(payload)
}

export function signCanonicalPayload(payload: unknown, secret = env.DECISION_API_SIGNATURE_SECRET ?? '') {
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(toCanonicalJson(payload)).digest('hex')
}

export function verifySignatureHeader(rawBody: string | undefined, headerValue: string | undefined) {
  if (!env.DECISION_API_SIGNATURE_SECRET) return true
  if (!rawBody || !headerValue) return false

  const [version, digest] = headerValue.split('=')
  if (version !== 'v1' || !digest) return false

  const expected = crypto
    .createHmac('sha256', env.DECISION_API_SIGNATURE_SECRET)
    .update(rawBody)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(expected, 'utf8'))
  } catch {
    return false
  }
}

export function buildDecisionSourceMode(input: {
  decisionMode: 'runtime_authorization' | 'scenario_planning'
  fallbackUsed: boolean
}) {
  if (input.decisionMode === 'scenario_planning') return 'simulation' as const
  if (input.fallbackUsed) return 'degraded' as const
  return 'live' as const
}

function computeExpiry(at: Date, timeoutMs?: number) {
  const ttlMs = timeoutMs ? Math.min(Math.max(timeoutMs * 10, 60_000), 3_600_000) : 300_000
  return new Date(at.getTime() + ttlMs).toISOString()
}

export function resolveCanonicalTransportMetadata(input?: Partial<CanonicalTransportMetadata>) {
  return CanonicalTransportMetadataSchema.parse(input ?? {})
}

export function buildCanonicalDecisionEnvelope(input: {
  requestId: string
  decisionFrameId: string
  action: z.infer<typeof CanonicalDecisionActionSchema>
  reasonCode: string
  selectedRegion: string
  selectedRunner: string | null
  baselineRegion: string
  runtime: z.infer<typeof CanonicalRuntimeSchema>
  provider: string
  signalConfidence: number
  decisionMode: 'runtime_authorization' | 'scenario_planning'
  fallbackUsed: boolean
  doctrineVersion: string
  operatingMode: 'NORMAL' | 'STRESS' | 'CRISIS'
  hierarchy: string[]
  transport: CanonicalTransportMetadata
  notBefore: string | null
  timeoutMs?: number
  requestAt: Date
  idempotencyKey?: string | null
  idempotencyReplayed?: boolean
}) {
  return CanonicalDecisionEnvelopeSchema.parse({
    requestId: input.requestId,
    decisionFrameId: input.decisionFrameId,
    action: input.action,
    reasonCode: input.reasonCode,
    selectedTarget: {
      region: input.selectedRegion,
      runtime: input.runtime,
      runner: input.selectedRunner,
      provider: input.provider,
    },
    baselineTarget: {
      region: input.baselineRegion,
      runtime: input.runtime,
      runner: null,
    },
    timing: {
      notBefore: input.notBefore,
      expiresAt: computeExpiry(input.requestAt, input.timeoutMs),
    },
    confidence: {
      score: input.signalConfidence,
      mode: buildDecisionSourceMode({
        decisionMode: input.decisionMode,
        fallbackUsed: input.fallbackUsed,
      }),
    },
    doctrine: {
      version: input.doctrineVersion,
      operatingMode: input.operatingMode,
      hierarchy: input.hierarchy,
    },
    transport: input.transport,
    idempotency: {
      key: input.idempotencyKey ?? null,
      replayed: Boolean(input.idempotencyReplayed),
    },
  })
}

export function buildCanonicalProofEnvelope(input: {
  posture: z.infer<typeof CanonicalProofPostureSchema>
  proofHash: string
  mssSnapshotId: string
  baseline: {
    region: string
    carbonIntensity: number
    waterImpactLiters: number
    waterScarcityImpact: number
  }
  selected: {
    region: string
    carbonIntensity: number
    waterImpactLiters: number
    waterScarcityImpact: number
  }
  carbonProvider: string
  waterAuthorityMode: 'basin' | 'facility_overlay' | 'fallback'
  fallbackUsed: boolean
  disagreementPct: number
  datasetVersions: Record<string, string>
  providerSnapshotRefs: string[]
  transport: CanonicalTransportMetadata
}) {
  return CanonicalProofEnvelopeSchema.parse({
    posture: input.posture,
    proofHash: input.proofHash,
    mssSnapshotId: input.mssSnapshotId,
    baseline: input.baseline,
    selected: input.selected,
    signalLineage: {
      carbonProvider: input.carbonProvider,
      waterAuthorityMode: input.waterAuthorityMode,
      fallbackUsed: input.fallbackUsed,
      disagreementPct: input.disagreementPct,
      datasetVersions: input.datasetVersions,
      providerSnapshotRefs: input.providerSnapshotRefs,
    },
    adapter: {
      transport: input.transport.transport,
      adapterId: input.transport.adapterId,
      adapterVersion: input.transport.adapterVersion,
      enforcementResult: input.transport.enforcementResult,
      observedRuntimeTarget: input.transport.observedRuntimeTarget ?? null,
    },
  })
}

export function buildCanonicalDecisionCloudEvent(input: {
  decision: z.infer<typeof CanonicalDecisionEnvelopeSchema>
  proof: z.infer<typeof CanonicalProofEnvelopeSchema>
  telemetry?: CanonicalTelemetryContext
}) {
  const unsigned = {
    specversion: '1.0' as const,
    id: input.decision.decisionFrameId,
    source: 'ecobe://decision-api/v1',
    type: 'dev.ecobe.decision.v1' as const,
    subject: input.decision.decisionFrameId,
    time: new Date().toISOString(),
    datacontenttype: 'application/json' as const,
    data: {
      decision: input.decision,
      proof: input.proof,
      telemetry: input.telemetry,
    },
  }

  return CanonicalDecisionCloudEventSchema.parse({
    ...unsigned,
    signature: signCanonicalPayload(unsigned) ?? 'unsigned',
  })
}
