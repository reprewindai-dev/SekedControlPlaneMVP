import { sha256Canonical } from '../proof/export-chain'

export type AuthorizationSignalPolicy = 'marginal_first' | 'average_fallback'
export type AuthorizationSignalMode = 'marginal' | 'average' | 'fallback'
export type AuthorizationAccountingMethod = 'marginal' | 'flow-traced' | 'average'
export type AuthorizationDecisionMode = 'runtime_authorization' | 'scenario_planning'
export type AuthorizationCriticality = 'critical' | 'standard' | 'batch'
export type AuthorizationAction = 'run_now' | 'reroute' | 'delay' | 'throttle' | 'deny'

export interface DelayWindowResolutionInput {
  generatedAt: Date
  criticality: AuthorizationCriticality
  allowDelay: boolean
  criticalPath?: boolean
  deadlineAt?: string
  maxDelayMinutes?: number
}

export interface DelayWindowResolution {
  allowed: boolean
  delayMinutes: number | null
  notBefore: string | null
  reason:
    | 'delay_allowed'
    | 'delay_disabled'
    | 'critical_path'
    | 'deadline_exceeded'
    | 'window_exhausted'
}

export function resolveDelayWindow(input: DelayWindowResolutionInput): DelayWindowResolution {
  if (!input.allowDelay) {
    return {
      allowed: false,
      delayMinutes: null,
      notBefore: null,
      reason: 'delay_disabled',
    }
  }

  if (input.criticalPath) {
    return {
      allowed: false,
      delayMinutes: null,
      notBefore: null,
      reason: 'critical_path',
    }
  }

  const defaultDelayMinutes =
    input.criticality === 'batch' ? 30 : input.criticality === 'critical' ? 5 : 15
  const requestedDelayMinutes = input.maxDelayMinutes ?? defaultDelayMinutes

  if (requestedDelayMinutes <= 0) {
    return {
      allowed: false,
      delayMinutes: null,
      notBefore: null,
      reason: 'window_exhausted',
    }
  }

  let effectiveDelayMinutes = requestedDelayMinutes
  if (input.deadlineAt) {
    const deadline = new Date(input.deadlineAt)
    const minutesUntilDeadline = Math.floor((deadline.getTime() - input.generatedAt.getTime()) / 60000)
    if (minutesUntilDeadline <= 0) {
      return {
        allowed: false,
        delayMinutes: null,
        notBefore: null,
        reason: 'deadline_exceeded',
      }
    }
    effectiveDelayMinutes = Math.min(effectiveDelayMinutes, minutesUntilDeadline)
  }

  if (effectiveDelayMinutes <= 0) {
    return {
      allowed: false,
      delayMinutes: null,
      notBefore: null,
      reason: 'window_exhausted',
    }
  }

  return {
    allowed: true,
    delayMinutes: effectiveDelayMinutes,
    notBefore: new Date(input.generatedAt.getTime() + effectiveDelayMinutes * 60 * 1000).toISOString(),
    reason: 'delay_allowed',
  }
}

export function chooseNonDelayFallbackAction(
  criticality: AuthorizationCriticality
): Exclude<AuthorizationAction, 'delay'> {
  return criticality === 'critical' ? 'throttle' : 'deny'
}

export function determineSignalSemantics(input: {
  source: string
  fallbackUsed: boolean
  signalPolicy: AuthorizationSignalPolicy
}): {
  signalMode: AuthorizationSignalMode
  accountingMethod: AuthorizationAccountingMethod
} {
  if (input.fallbackUsed) {
    return {
      signalMode: 'fallback',
      accountingMethod: 'average',
    }
  }

  const source = input.source.toLowerCase()
  if (source.includes('watttime') || source.includes('moer')) {
    return {
      signalMode: 'marginal',
      accountingMethod: 'marginal',
    }
  }

  if (source.includes('electricity_maps') && input.signalPolicy === 'average_fallback') {
    return {
      signalMode: 'average',
      accountingMethod: 'flow-traced',
    }
  }

  return {
    signalMode: 'average',
    accountingMethod: source.includes('electricity_maps') ? 'flow-traced' : 'average',
  }
}

export function buildDecisionProofHash(input: {
  request: Record<string, unknown>
  selected: Record<string, unknown>
  baseline: Record<string, unknown>
  policyTrace: Record<string, unknown>
  enforcementPlan: Record<string, unknown>
  providerSnapshotRefs: string[]
  signalMode: AuthorizationSignalMode
  accountingMethod: AuthorizationAccountingMethod
}): string {
  return sha256Canonical(input)
}
