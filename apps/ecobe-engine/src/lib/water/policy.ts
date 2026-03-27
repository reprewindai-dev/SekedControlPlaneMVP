import type { WaterDecisionAction, WaterPolicyProfile, WaterPolicyTrace, WaterSignal } from './types'

interface PolicyThresholds {
  stressDeny: number
  stressDelay: number
  scarcityDeny: number
  scarcityDelay: number
  strictMode: boolean
}

interface EvaluateWaterPolicyInput {
  profile: WaterPolicyProfile
  selectedWater: WaterSignal
  baselineWater: WaterSignal
  selectedWaterImpactLiters: number
  selectedScarcityImpact: number
  fallbackUsed: boolean
  criticality: 'critical' | 'standard' | 'batch'
  allowDelay: boolean
}

export const WATER_POLICY_VERSION = 'water_policy_v1'

const PROFILE_THRESHOLDS: Record<WaterPolicyProfile, PolicyThresholds> = {
  default: {
    stressDeny: 4.7,
    stressDelay: 4.0,
    scarcityDeny: 10,
    scarcityDelay: 6,
    strictMode: false,
  },
  drought_sensitive: {
    stressDeny: 4.4,
    stressDelay: 3.6,
    scarcityDeny: 8,
    scarcityDelay: 5,
    strictMode: true,
  },
  eu_data_center_reporting: {
    stressDeny: 4.6,
    stressDelay: 3.8,
    scarcityDeny: 9,
    scarcityDelay: 5.5,
    strictMode: true,
  },
  high_water_sensitivity: {
    stressDeny: 4.2,
    stressDelay: 3.3,
    scarcityDeny: 7,
    scarcityDelay: 4.2,
    strictMode: true,
  },
}

export function evaluateWaterGuardrail(input: EvaluateWaterPolicyInput): {
  action: WaterDecisionAction
  reasonCode: string
  trace: WaterPolicyTrace
  hardBlock: boolean
} {
  const thresholds = PROFILE_THRESHOLDS[input.profile]
  const reasonCodes: string[] = []
  let guardrailTriggered = false
  let action: WaterDecisionAction = 'run_now'
  let reasonCode = 'ALLOW'
  let hardBlock = false

  if (input.fallbackUsed) {
    reasonCodes.push('WATER_FALLBACK_CONSERVATIVE')
    if (thresholds.strictMode) {
      guardrailTriggered = true
      hardBlock = true
      if (input.criticality === 'critical') {
        action = 'throttle'
        reasonCode = 'THROTTLE_LOW_CONFIDENCE'
      } else if (input.allowDelay) {
        action = 'delay'
        reasonCode = 'DELAY_LOW_CONFIDENCE'
      } else {
        action = 'deny'
        reasonCode = 'DENY_LOW_CONFIDENCE'
      }
    }
  }

  if (
    input.selectedWater.waterStressIndex >= thresholds.stressDeny ||
    input.selectedScarcityImpact >= thresholds.scarcityDeny
  ) {
    guardrailTriggered = true
    hardBlock = true
    reasonCodes.push('WATER_EXTREME_STRESS')
    if (input.criticality === 'critical') {
      action = 'throttle'
      reasonCode = 'THROTTLE_EXTREME_WATER'
    } else if (input.allowDelay) {
      action = 'delay'
      reasonCode = 'DELAY_EXTREME_WATER'
    } else {
      action = 'deny'
      reasonCode = 'DENY_EXTREME_WATER'
    }
  } else if (
    input.selectedWater.waterStressIndex >= thresholds.stressDelay ||
    input.selectedScarcityImpact >= thresholds.scarcityDelay
  ) {
    guardrailTriggered = true
    reasonCodes.push('WATER_HIGH_STRESS')
    if (input.criticality === 'critical') {
      action = 'throttle'
      reasonCode = 'THROTTLE_HIGH_WATER'
    } else if (input.allowDelay) {
      action = 'delay'
      reasonCode = 'DELAY_HIGH_WATER'
    } else {
      action = 'deny'
      reasonCode = 'DENY_HIGH_WATER'
      hardBlock = true
    }
  }

  if (
    input.baselineWater.waterStressIndex - input.selectedWater.waterStressIndex < -0.8 &&
    action === 'run_now'
  ) {
    reasonCodes.push('WATER_SELECTION_WORSE_THAN_BASELINE')
  }

  return {
    action,
    reasonCode,
    hardBlock,
    trace: {
      policyVersion: WATER_POLICY_VERSION,
      profile: input.profile,
      thresholds: {
        stressDeny: thresholds.stressDeny,
        stressDelay: thresholds.stressDelay,
        scarcityDeny: thresholds.scarcityDeny,
        scarcityDelay: thresholds.scarcityDelay,
      },
      guardrailTriggered,
      fallbackUsed: input.fallbackUsed,
      strictMode: thresholds.strictMode,
      reasonCodes,
    },
  }
}
