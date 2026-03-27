import {
  buildAssuranceStatus,
  resolveBaselineCandidate,
} from '../lib/ci/doctrine'
import { applyOperatingModePolicy, resolveOperatingMode } from '../lib/ci/operating-mode'

describe('ci doctrine helpers', () => {
  it('uses the first preferred region as the baseline when present', () => {
    const candidates = [
      { region: 'eu-west-1', score: 0.1 },
      { region: 'us-east-1', score: 0.2 },
    ]

    expect(resolveBaselineCandidate(['us-east-1', 'eu-west-1'], candidates, candidates[0])).toEqual(
      candidates[1]
    )
  })

  it('marks assurance as operational but not assurance-ready when dataset hashes are unverified', () => {
    const assurance = buildAssuranceStatus({
      datasetHashesPresent: false,
      bundleHealthy: true,
      manifestHealthy: true,
      waterFallbackUsed: false,
      carbonFallbackUsed: false,
      manifestDatasets: [
        {
          name: 'aqueduct',
          file_hash: 'unverified',
        },
      ],
    })

    expect(assurance.operationallyUsable).toBe(true)
    expect(assurance.assuranceReady).toBe(false)
    expect(assurance.status).toBe('operational')
  })

  it('escalates to crisis mode when signal integrity collapses', () => {
    const mode = resolveOperatingMode({
      signalConfidence: 0.42,
      carbonFallbackUsed: true,
      waterFallbackUsed: false,
      disagreementPct: 26,
      hardWaterBlock: false,
      noSafeRegion: false,
      precedenceProtected: false,
      criticality: 'standard',
      allowDelay: true,
    })

    const result = applyOperatingModePolicy({
      mode,
      decision: 'run_now',
      reasonCode: 'RUN_ALLOWED',
      context: {
        signalConfidence: 0.42,
        carbonFallbackUsed: true,
        waterFallbackUsed: false,
        disagreementPct: 26,
        hardWaterBlock: false,
        noSafeRegion: false,
        precedenceProtected: false,
        criticality: 'standard',
        allowDelay: true,
      },
    })

    expect(mode).toBe('CRISIS')
    expect(result.adjustedAction).toBe('delay')
    expect(result.adjustedReasonCode).toBe('DELAY_CRISIS_MODE_SIGNAL_INTEGRITY')
  })
})
