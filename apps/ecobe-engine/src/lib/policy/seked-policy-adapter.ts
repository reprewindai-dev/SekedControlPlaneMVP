import { z } from 'zod'

import { env } from '../../config/env'
import type { WaterDecisionAction, WaterPolicyProfile } from '../water/types'

const SekedDirectiveSchema = z.object({
  allow: z.boolean().optional(),
  action: z.enum(['run_now', 'reroute', 'delay', 'throttle', 'deny']).optional(),
  reasonCode: z.string().optional(),
  forceRegion: z.string().optional(),
  denyRegions: z.array(z.string()).optional(),
  maxWaterStress: z.number().optional(),
  maxCarbonIntensity: z.number().optional(),
  policyReference: z.string().optional(),
  rationale: z.string().optional(),
})

export interface SekedPolicyCandidate {
  region: string
  score: number
  carbonIntensity: number
  waterStressIndex: number
  waterScarcityImpact: number
  guardrailCandidateBlocked: boolean
}

export interface SekedPolicyAdapterRequest {
  decisionFrameId: string
  policyProfile: WaterPolicyProfile
  policyVersion: string
  decisionMode: 'runtime_authorization' | 'scenario_planning'
  criticality: 'critical' | 'standard' | 'batch'
  allowDelay: boolean
  facilityId: string | null
  scenario: 'current' | '2030' | '2050' | '2080'
  bottleneckScore: number | null
  preferredRegions: string[]
  waterAuthority: {
    authorityMode: 'basin' | 'facility_overlay' | 'fallback'
    confidence: number
    supplierSet: string[]
    evidenceRefs: string[]
  }
  candidateSupplierProvenance: Array<{
    region: string
    supplierSet: string[]
    evidenceRefs: string[]
    authorityMode: 'basin' | 'facility_overlay' | 'fallback'
  }>
  candidates: SekedPolicyCandidate[]
  provisionalDecision: {
    action: WaterDecisionAction
    reasonCode: string
    selectedRegion: string
    baselineRegion: string
  }
  timestamp: string
}

export interface SekedPolicyAdapterResult {
  enabled: boolean
  strict: boolean
  evaluated: boolean
  applied: boolean
  hookStatus: 'not_configured' | 'skipped' | 'success' | 'error'
  reasonCodes: string[]
  policyReference: string | null
  fallbackUsed: boolean
  hardFailure: boolean
  enforcedFailureAction: WaterDecisionAction | null
  response: z.infer<typeof SekedDirectiveSchema> | null
}

export function parseSekedStrictProfiles() {
  const raw =
    env.SEKED_POLICY_ADAPTER_STRICT_PROFILES ??
    'drought_sensitive,eu_data_center_reporting,high_water_sensitivity'
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )
}

function strictFailureAction(input: { criticality: 'critical' | 'standard' | 'batch'; allowDelay: boolean }) {
  if (input.criticality === 'critical') return 'throttle' as const
  if (input.allowDelay) return 'delay' as const
  return 'deny' as const
}

export async function evaluateSekedPolicyAdapter(
  request: SekedPolicyAdapterRequest
): Promise<SekedPolicyAdapterResult> {
  const strictProfiles = parseSekedStrictProfiles()
  const strict = strictProfiles.has(request.policyProfile)
  const timeoutMs = Math.max(100, env.SEKED_POLICY_ADAPTER_TIMEOUT_MS)

  if (!env.SEKED_POLICY_ADAPTER_ENABLED || !env.SEKED_POLICY_ADAPTER_URL) {
    return {
      enabled: false,
      strict,
      evaluated: false,
      applied: false,
      hookStatus: 'not_configured',
      reasonCodes: ['SEKED_POLICY_ADAPTER_DISABLED_OR_UNCONFIGURED'],
      policyReference: null,
      fallbackUsed: false,
      hardFailure: false,
      enforcedFailureAction: null,
      response: null,
    }
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-ecobe-adapter': 'seked-policy-adapter-v1',
  }
  if (env.SEKED_POLICY_ADAPTER_AUTH_TOKEN) {
    headers.authorization = `Bearer ${env.SEKED_POLICY_ADAPTER_AUTH_TOKEN}`
  }

  try {
    const response = await fetch(env.SEKED_POLICY_ADAPTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`)
    }

    const parsed = SekedDirectiveSchema.parse(await response.json())
    return {
      enabled: true,
      strict,
      evaluated: true,
      applied: true,
      hookStatus: 'success',
      reasonCodes: ['SEKED_POLICY_ADAPTER_APPLIED'],
      policyReference: parsed.policyReference ?? null,
      fallbackUsed: false,
      hardFailure: false,
      enforcedFailureAction: null,
      response: parsed,
    }
  } catch (error) {
    const failureCode =
      error instanceof Error
        ? `SEKED_POLICY_ADAPTER_ERROR_${error.message}`
        : 'SEKED_POLICY_ADAPTER_ERROR_UNKNOWN'
    if (strict) {
      return {
        enabled: true,
        strict: true,
        evaluated: true,
        applied: false,
        hookStatus: 'error',
        reasonCodes: [failureCode, 'SEKED_POLICY_ADAPTER_STRICT_FAILSAFE'],
        policyReference: null,
        fallbackUsed: true,
        hardFailure: true,
        enforcedFailureAction: strictFailureAction({
          criticality: request.criticality,
          allowDelay: request.allowDelay,
        }),
        response: null,
      }
    }

    return {
      enabled: true,
      strict: false,
      evaluated: true,
      applied: false,
      hookStatus: 'error',
      reasonCodes: [failureCode, 'SEKED_POLICY_ADAPTER_NON_STRICT_CONTINUE'],
      policyReference: null,
      fallbackUsed: true,
      hardFailure: false,
      enforcedFailureAction: null,
      response: null,
    }
  }
}
