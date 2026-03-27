import {
  buildDecisionProofHash,
  chooseNonDelayFallbackAction,
  determineSignalSemantics,
  resolveDelayWindow,
} from '../lib/ci/authorization'

describe('ci authorization helpers', () => {
  it('forbids delay for critical-path requests', () => {
    const result = resolveDelayWindow({
      generatedAt: new Date('2026-03-26T10:00:00.000Z'),
      criticality: 'standard',
      allowDelay: true,
      criticalPath: true,
      maxDelayMinutes: 30,
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('critical_path')
  })

  it('bounds delay by deadline', () => {
    const result = resolveDelayWindow({
      generatedAt: new Date('2026-03-26T10:00:00.000Z'),
      criticality: 'batch',
      allowDelay: true,
      deadlineAt: '2026-03-26T10:12:00.000Z',
      maxDelayMinutes: 30,
    })

    expect(result.allowed).toBe(true)
    expect(result.delayMinutes).toBe(12)
    expect(result.notBefore).toBe('2026-03-26T10:12:00.000Z')
  })

  it('classifies watttime as marginal', () => {
    expect(
      determineSignalSemantics({
        source: 'WATTTIME_MOER',
        fallbackUsed: false,
        signalPolicy: 'marginal_first',
      })
    ).toEqual({
      signalMode: 'marginal',
      accountingMethod: 'marginal',
    })
  })

  it('chooses non-delay fallback by criticality', () => {
    expect(chooseNonDelayFallbackAction('critical')).toBe('throttle')
    expect(chooseNonDelayFallbackAction('standard')).toBe('deny')
  })

  it('produces deterministic proof hashes for identical inputs', () => {
    const payload = {
      request: { preferredRegions: ['us-east-1'] },
      selected: { region: 'us-east-1', carbonIntensity: 100 },
      baseline: { region: 'us-west-1', carbonIntensity: 200 },
      policyTrace: { policyVersion: 'v1' },
      enforcementPlan: { mode: 'immediate' },
      providerSnapshotRefs: ['us-east-1:WATTTIME:2026-03-26T10:00:00.000Z'],
      signalMode: 'marginal' as const,
      accountingMethod: 'marginal' as const,
    }

    expect(buildDecisionProofHash(payload)).toBe(buildDecisionProofHash(payload))
  })
})
