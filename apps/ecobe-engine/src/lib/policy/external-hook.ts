import { z } from 'zod'

import { env } from '../../config/env'
import type { WaterDecisionAction, WaterPolicyProfile } from '../water/types'

const HookResponseSchema = z.object({
  allow: z.boolean().optional(),
  action: z.enum(['run_now', 'reroute', 'delay', 'throttle', 'deny']).optional(),
  reasonCode: z.string().optional(),
  forceRegion: z.string().optional(),
  denyRegions: z.array(z.string()).optional(),
  maxWaterStress: z.number().optional(),
  maxCarbonIntensity: z.number().optional(),
  policyReference: z.string().optional(),
  notes: z.string().optional(),
})

export interface ExternalPolicyHookCandidate {
  region: string
  score: number
  carbonIntensity: number
  waterStressIndex: number
  waterScarcityImpact: number
  guardrailCandidateBlocked: boolean
}

export interface ExternalPolicyHookRequest {
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
  candidates: ExternalPolicyHookCandidate[]
  provisionalDecision: {
    action: WaterDecisionAction
    reasonCode: string
    selectedRegion: string
    baselineRegion: string
  }
  timestamp: string
}

export interface ExternalPolicyHookResult {
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
  response: z.infer<typeof HookResponseSchema> | null
}

function parseStrictProfiles() {
  const raw =
    env.EXTERNAL_POLICY_HOOK_STRICT_PROFILES ??
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

export async function evaluateExternalPolicyHook(
  request: ExternalPolicyHookRequest
): Promise<ExternalPolicyHookResult> {
  const strictProfiles = parseStrictProfiles()
  const strict = strictProfiles.has(request.policyProfile)
  const timeoutMs = Math.max(100, env.EXTERNAL_POLICY_HOOK_TIMEOUT_MS)

  if (!env.EXTERNAL_POLICY_HOOK_ENABLED || !env.EXTERNAL_POLICY_HOOK_URL) {
    return {
      enabled: false,
      strict,
      evaluated: false,
      applied: false,
      hookStatus: 'not_configured',
      reasonCodes: ['EXTERNAL_POLICY_HOOK_DISABLED_OR_UNCONFIGURED'],
      policyReference: null,
      fallbackUsed: false,
      hardFailure: false,
      enforcedFailureAction: null,
      response: null,
    }
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (env.EXTERNAL_POLICY_HOOK_AUTH_TOKEN) {
    headers.authorization = `Bearer ${env.EXTERNAL_POLICY_HOOK_AUTH_TOKEN}`
  }

  try {
    const response = await fetch(env.EXTERNAL_POLICY_HOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`)
    }

    const parsed = HookResponseSchema.parse(await response.json())
    return {
      enabled: true,
      strict,
      evaluated: true,
      applied: true,
      hookStatus: 'success',
      reasonCodes: ['EXTERNAL_POLICY_HOOK_APPLIED'],
      policyReference: parsed.policyReference ?? null,
      fallbackUsed: false,
      hardFailure: false,
      enforcedFailureAction: null,
      response: parsed,
    }
  } catch (error) {
    const failureCode =
      error instanceof Error ? `EXTERNAL_POLICY_HOOK_ERROR_${error.message}` : 'EXTERNAL_POLICY_HOOK_ERROR_UNKNOWN'
    if (strict) {
      return {
        enabled: true,
        strict: true,
        evaluated: true,
        applied: false,
        hookStatus: 'error',
        reasonCodes: [failureCode, 'EXTERNAL_POLICY_HOOK_STRICT_FAILSAFE'],
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
      reasonCodes: [failureCode, 'EXTERNAL_POLICY_HOOK_NON_STRICT_CONTINUE'],
      policyReference: null,
      fallbackUsed: true,
      hardFailure: false,
      enforcedFailureAction: null,
      response: null,
    }
  }
}
