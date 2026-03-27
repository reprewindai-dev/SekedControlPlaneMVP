import { CiResponseV2Schema } from '../lib/ci/contracts'

describe('CiResponseV2 contract freeze', () => {
  it('keeps top-level deterministic contract keys stable', () => {
    const keys = Object.keys(CiResponseV2Schema.shape).sort()
    expect(keys).toEqual(
      [
        'accountingMethod',
        'assurance',
        'baseline',
        'candidateEvaluations',
        'decision',
        'decisionEnvelope',
        'decisionExplanation',
        'decisionMode',
        'decisionFrameId',
        'doctrineVersion',
        'enforcementBundle',
        'fallbackUsed',
        'kubernetesEnforcement',
        'latencyMs',
        'mss',
        'notBefore',
        'operatingMode',
        'policyTrace',
        'proofEnvelope',
        'proofHash',
        'proofRecord',
        'reasonCode',
        'recommendation',
        'savings',
        'selected',
        'selectedRegion',
        'selectedRunner',
        'signalConfidence',
        'signalMode',
        'telemetryBridge',
        'water',
        'waterAuthority',
        'workflowOutputs',
        'adapterContext',
      ].sort()
    )
  })

  it('keeps policy trace sub-contracts for external and SEKED adapters', () => {
    const policyTraceShape = CiResponseV2Schema.shape.policyTrace.shape
    expect(policyTraceShape).toHaveProperty('externalPolicy')
    expect(policyTraceShape).toHaveProperty('sekedPolicy')
    expect(policyTraceShape).toHaveProperty('conflictHierarchy')
    expect(policyTraceShape).toHaveProperty('operatingMode')
  })

  it('keeps water proof fields required for assurance exports', () => {
    const waterShape = CiResponseV2Schema.shape.water.shape
    expect(Object.keys(waterShape)).toEqual(
      expect.arrayContaining([
        'selectedLiters',
        'baselineLiters',
        'selectedScarcityImpact',
        'baselineScarcityImpact',
        'intensityLPerKwh',
        'stressIndex',
        'qualityIndex',
        'droughtRiskIndex',
        'confidence',
        'source',
        'datasetVersion',
        'guardrailTriggered',
        'fallbackUsed',
      ])
    )
  })

  it('keeps canonical decision and proof envelopes available for adapter callers', () => {
    expect(CiResponseV2Schema.shape).toHaveProperty('decisionEnvelope')
    expect(CiResponseV2Schema.shape).toHaveProperty('proofEnvelope')
    expect(CiResponseV2Schema.shape).toHaveProperty('telemetryBridge')
  })
})
