import { evaluateWaterGuardrail } from '../lib/water/policy'
import type { WaterSignal } from '../lib/water/types'

const baseSignal: WaterSignal = {
  region: 'us-east-1',
  waterIntensityLPerKwh: 1.2,
  waterStressIndex: 2.5,
  waterQualityIndex: 2.0,
  droughtRiskIndex: 2.0,
  scarcityFactor: 1.5,
  source: ['aqueduct', 'aware'],
  datasetVersions: { aqueduct: 'aqueduct_4_0' },
  confidence: 0.85,
  fallbackUsed: false,
  dataQuality: 'high',
  signalType: 'average_operational',
  referenceTime: new Date().toISOString(),
}

describe('water policy guardrail', () => {
  it('allows run_now under safe water profile', () => {
    const result = evaluateWaterGuardrail({
      profile: 'default',
      selectedWater: baseSignal,
      baselineWater: baseSignal,
      selectedWaterImpactLiters: 2,
      selectedScarcityImpact: 2.4,
      fallbackUsed: false,
      criticality: 'standard',
      allowDelay: true,
    })

    expect(result.action).toBe('run_now')
    expect(result.hardBlock).toBe(false)
    expect(result.trace.policyVersion).toBe('water_policy_v1')
  })

  it('blocks extreme stress under strict profile', () => {
    const stressSignal = { ...baseSignal, waterStressIndex: 4.8 }
    const result = evaluateWaterGuardrail({
      profile: 'high_water_sensitivity',
      selectedWater: stressSignal,
      baselineWater: baseSignal,
      selectedWaterImpactLiters: 5,
      selectedScarcityImpact: 12,
      fallbackUsed: false,
      criticality: 'batch',
      allowDelay: false,
    })

    expect(result.hardBlock).toBe(true)
    expect(result.action).toBe('deny')
    expect(result.reasonCode).toContain('DENY')
  })

  it('uses conservative delay/throttle when fallback in strict mode', () => {
    const fallbackSignal = { ...baseSignal, fallbackUsed: true, confidence: 0.2 }
    const result = evaluateWaterGuardrail({
      profile: 'eu_data_center_reporting',
      selectedWater: fallbackSignal,
      baselineWater: baseSignal,
      selectedWaterImpactLiters: 4,
      selectedScarcityImpact: 4,
      fallbackUsed: true,
      criticality: 'critical',
      allowDelay: true,
    })

    expect(result.trace.fallbackUsed).toBe(true)
    expect(['throttle', 'delay', 'deny']).toContain(result.action)
  })
})
