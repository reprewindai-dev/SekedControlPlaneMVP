import { chooseNonDelayFallbackAction, type AuthorizationCriticality } from './authorization'

export type OperatingMode = 'NORMAL' | 'STRESS' | 'CRISIS'

export interface OperatingModeContext {
  signalConfidence: number
  carbonFallbackUsed: boolean
  waterFallbackUsed: boolean
  disagreementPct: number
  hardWaterBlock: boolean
  noSafeRegion: boolean
  precedenceProtected: boolean
  criticality: AuthorizationCriticality
  allowDelay: boolean
}

export interface OperatingModeDecision {
  mode: OperatingMode
  adjustedAction: 'run_now' | 'reroute' | 'delay' | 'throttle' | 'deny'
  adjustedReasonCode: string
  reasonCodes: string[]
}

function resolveConfiguredMode(): OperatingMode | null {
  const raw = process.env.ECOBE_OPERATING_MODE_OVERRIDE ?? ''
  const normalized = String(raw).trim().toUpperCase()
  if (normalized === 'NORMAL' || normalized === 'STRESS' || normalized === 'CRISIS') {
    return normalized
  }
  return null
}

export function resolveOperatingMode(context: OperatingModeContext): OperatingMode {
  const configured = resolveConfiguredMode()
  if (configured) return configured

  if (
    context.carbonFallbackUsed ||
    context.waterFallbackUsed ||
    context.noSafeRegion ||
    context.disagreementPct >= 25
  ) {
    return 'CRISIS'
  }

  if (
    context.hardWaterBlock ||
    context.disagreementPct >= 10 ||
    context.signalConfidence < 0.7
  ) {
    return 'STRESS'
  }

  return 'NORMAL'
}

export function applyOperatingModePolicy(input: {
  mode: OperatingMode
  decision: 'run_now' | 'reroute' | 'delay' | 'throttle' | 'deny'
  reasonCode: string
  context: OperatingModeContext
}): OperatingModeDecision {
  const reasonCodes = [`OPERATING_MODE_${input.mode}`]

  if (input.mode === 'NORMAL') {
    return {
      mode: input.mode,
      adjustedAction: input.decision,
      adjustedReasonCode: input.reasonCode,
      reasonCodes,
    }
  }

  if (input.mode === 'STRESS') {
    if (
      input.decision === 'run_now' &&
      !input.context.precedenceProtected &&
      input.context.criticality !== 'critical' &&
      input.context.allowDelay
    ) {
      return {
        mode: input.mode,
        adjustedAction: 'delay',
        adjustedReasonCode: 'DELAY_STRESS_MODE_CONSERVATIVE_HOLD',
        reasonCodes: [...reasonCodes, 'STRESS_MODE_CONSERVATIVE_HOLD'],
      }
    }

    return {
      mode: input.mode,
      adjustedAction: input.decision,
      adjustedReasonCode: input.reasonCode,
      reasonCodes,
    }
  }

  if (
    input.decision === 'run_now' &&
    !input.context.precedenceProtected
  ) {
    if (input.context.criticality === 'critical') {
      return {
        mode: input.mode,
        adjustedAction: 'throttle',
        adjustedReasonCode: 'THROTTLE_CRISIS_MODE_PROTECTED_PATH',
        reasonCodes: [...reasonCodes, 'CRISIS_MODE_THROTTLE_PROTECTED_PATH'],
      }
    }

    if (input.context.allowDelay) {
      return {
        mode: input.mode,
        adjustedAction: 'delay',
        adjustedReasonCode: 'DELAY_CRISIS_MODE_SIGNAL_INTEGRITY',
        reasonCodes: [...reasonCodes, 'CRISIS_MODE_DELAY_UNSAFE_EXECUTION'],
      }
    }

    return {
      mode: input.mode,
      adjustedAction: chooseNonDelayFallbackAction(input.context.criticality),
      adjustedReasonCode: 'DENY_CRISIS_MODE_SIGNAL_INTEGRITY',
      reasonCodes: [...reasonCodes, 'CRISIS_MODE_DENY_UNSAFE_EXECUTION'],
    }
  }

  return {
    mode: input.mode,
    adjustedAction: input.decision,
    adjustedReasonCode: input.reasonCode,
    reasonCodes,
  }
}
