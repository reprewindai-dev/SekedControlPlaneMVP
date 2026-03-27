import { buildKubernetesEnforcementPlan } from '../lib/enforcement/k8s-policy'

describe('k8s enforcement policy', () => {
  it('builds immediate placement plan for run_now', () => {
    const plan = buildKubernetesEnforcementPlan({
      decisionFrameId: 'df-1',
      decision: 'run_now',
      reasonCode: 'ALLOW',
      selectedRegion: 'us-east-1',
      policyProfile: 'default',
      criticality: 'standard',
      generatedAt: new Date('2026-03-24T00:00:00.000Z'),
    })

    expect(plan.admission.allow).toBe(true)
    expect(plan.execution.mode).toBe('immediate')
    expect(plan.nodeSelector['topology.kubernetes.io/region']).toBe('us-east-1')
    expect(plan.scaling.targetReplicaFactor).toBe(1)
    expect(plan.gatekeeper.parameters.selectedRegion).toBe('us-east-1')
  })

  it('builds deferred plan for delay decision', () => {
    const plan = buildKubernetesEnforcementPlan({
      decisionFrameId: 'df-2',
      decision: 'delay',
      reasonCode: 'DELAY_HIGH_WATER',
      selectedRegion: 'eu-west-1',
      policyProfile: 'drought_sensitive',
      criticality: 'batch',
      delayMinutes: 20,
      generatedAt: new Date('2026-03-24T00:00:00.000Z'),
    })

    expect(plan.execution.mode).toBe('deferred')
    expect(plan.execution.notBefore).toBe('2026-03-24T00:20:00.000Z')
    expect(plan.scaling.targetReplicaFactor).toBe(0)
    expect(plan.annotations['ecobe.io/delay-minutes']).toBe('20')
    expect(plan.gatekeeper.parameters.notBefore).toBe('2026-03-24T00:20:00.000Z')
  })

  it('builds throttled replica limits for throttle decision', () => {
    const plan = buildKubernetesEnforcementPlan({
      decisionFrameId: 'df-3',
      decision: 'throttle',
      reasonCode: 'THROTTLE_HIGH_WATER',
      selectedRegion: 'ap-south-1',
      policyProfile: 'high_water_sensitivity',
      criticality: 'standard',
      throttleFactor: 0.35,
      generatedAt: new Date('2026-03-24T00:00:00.000Z'),
    })

    expect(plan.scaling.mode).toBe('throttled')
    expect(plan.scaling.targetReplicaFactor).toBeCloseTo(0.35, 3)
    expect(plan.execution.mode).toBe('immediate')
    expect(plan.gatekeeper.parameters.minReplicaFactor).toBeCloseTo(0.35, 3)
  })

  it('blocks admission for deny decision', () => {
    const plan = buildKubernetesEnforcementPlan({
      decisionFrameId: 'df-4',
      decision: 'deny',
      reasonCode: 'DENY_EXTREME_WATER',
      selectedRegion: 'ap-south-1',
      policyProfile: 'high_water_sensitivity',
      criticality: 'standard',
      generatedAt: new Date('2026-03-24T00:00:00.000Z'),
    })

    expect(plan.admission.allow).toBe(false)
    expect(plan.execution.mode).toBe('blocked')
    expect(plan.scaling.maxReplicaFactor).toBe(0)
    expect(plan.gatekeeper.parameters.blocked).toBe(true)
  })
})
