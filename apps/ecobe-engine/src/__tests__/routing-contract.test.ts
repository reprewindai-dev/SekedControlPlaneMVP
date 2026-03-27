import { routeGreen } from '../lib/green-routing'

// Mock dependencies
jest.mock('../lib/db')
jest.mock('../lib/redis')
jest.mock('../lib/watttime', () => ({
  wattTime: {
    getPredictedCleanWindows: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('../services/fingard-control', () => ({
  fingard: {
    getNormalizedSignal: jest.fn(),
  },
}))
jest.mock('../lib/grid-signals/grid-signal-cache', () => ({
  GridSignalCache: {
    getCachedSnapshots: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('../lib/grid-signals/grid-signal-audit', () => ({
  GridSignalAudit: {
    recordRoutingDecision: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('../lib/routing', () => ({
  classifyJob: jest.fn().mockReturnValue('immediate'),
  recordLedgerEntry: jest.fn().mockResolvedValue(undefined),
  storeProviderSnapshot: jest.fn().mockResolvedValue(undefined),
}))

describe('Routing Contract', () => {
  const nowIso = () => new Date().toISOString()

  const buildDecision = (region: string, carbonIntensity: number, overrides?: Partial<any>) => ({
    signal: {
      carbonIntensity,
      source: 'electricity_maps',
      isForecast: false,
      estimatedFlag: false,
      syntheticFlag: false,
      confidence: 0.85,
      provenance: {
        sourceUsed: 'ELECTRICITY_MAPS',
        contributingSources: ['electricity_maps'],
        referenceTime: nowIso(),
        fetchedAt: nowIso(),
        fallbackUsed: false,
        disagreementFlag: false,
        disagreementPct: 0,
        trustLevel: 'high',
      },
      ...overrides?.signal,
    },
    alternatives: [],
    providerStatus: {},
    arbitrationLog: [`mock:${region}`],
    ...overrides,
  })

  const setSignalsByRegion = (signals: Record<string, ReturnType<typeof buildDecision>>) => {
    const { fingard } = require('../services/fingard-control')
    fingard.getNormalizedSignal.mockImplementation(async (region: string) => {
      const decision = signals[region]
      if (!decision) throw new Error(`No mock signal for region: ${region}`)
      return decision
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    setSignalsByRegion({
      'us-east-1': buildDecision('us-east-1', 250),
      'us-west-1': buildDecision('us-west-1', 200),
      'eu-west-1': buildDecision('eu-west-1', 220),
    })
  })

  describe('routeGreen response contract', () => {
    it('should return all required fields in routing result', async () => {
      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      // Check all contract fields exist
      expect(result).toHaveProperty('selectedRegion')
      expect(result).toHaveProperty('carbonIntensity')
      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('qualityTier')
      expect(result).toHaveProperty('carbon_delta_g_per_kwh')
      expect(result).toHaveProperty('forecast_stability')
      expect(result).toHaveProperty('provider_disagreement')
      expect(result).toHaveProperty('balancingAuthority')
      expect(result).toHaveProperty('demandRampPct')
      expect(result).toHaveProperty('carbonSpikeProbability')
      expect(result).toHaveProperty('curtailmentProbability')
      expect(result).toHaveProperty('importCarbonLeakageScore')
      expect(result).toHaveProperty('source_used')
      expect(result).toHaveProperty('validation_source')
      expect(result).toHaveProperty('fallback_used')
      expect(result).toHaveProperty('estimatedFlag')
      expect(result).toHaveProperty('syntheticFlag')
      expect(result).toHaveProperty('predicted_clean_window')
      expect(result).toHaveProperty('decisionFrameId')
      expect(result).toHaveProperty('alternatives')
    })

    it('should populate selectedRegion with lowest carbon option', async () => {
      setSignalsByRegion({
        'us-east-1': buildDecision('us-east-1', 300),
        'us-west-1': buildDecision('us-west-1', 150),
      })

      const result = await routeGreen({
        preferredRegions: ['us-east-1', 'us-west-1']
      })

      expect(result.selectedRegion).toBe('us-west-1') // Lower carbon
      expect(result.carbonIntensity).toBe(150)
    })

    it('should set qualityTier from validation result', async () => {
      setSignalsByRegion({
        'us-east-1': buildDecision('us-east-1', 250, {
          signal: {
            confidence: 0.65,
            provenance: {
              sourceUsed: 'ELECTRICITY_MAPS',
              contributingSources: ['electricity_maps'],
              referenceTime: nowIso(),
              fetchedAt: nowIso(),
              fallbackUsed: false,
              disagreementFlag: false,
              disagreementPct: 0,
              trustLevel: 'medium',
            },
          },
        }),
      })

      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      expect(result.qualityTier).toBe('medium')
    })

    it('should include provider disagreement in contract', async () => {
      setSignalsByRegion({
        'us-east-1': buildDecision('us-east-1', 250, {
          signal: {
            confidence: 0.75,
            provenance: {
              sourceUsed: 'ELECTRICITY_MAPS::WATTTIME_30%',
              contributingSources: ['electricity_maps', 'watttime'],
              referenceTime: nowIso(),
              fetchedAt: nowIso(),
              fallbackUsed: false,
              disagreementFlag: true,
              disagreementPct: 15,
              trustLevel: 'high',
            },
          },
        }),
      })

      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      expect(result.provider_disagreement).toHaveProperty('flag')
      expect(result.provider_disagreement).toHaveProperty('pct')
      expect(result.provider_disagreement.flag).toBe(true)
      expect(result.provider_disagreement.pct).toBe(15)
    })

    it('should include grid signals in contract (balancingAuthority, demandRamp, etc)', async () => {
      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      // Grid signals should be null-safe properties
      expect(typeof result.balancingAuthority === 'string' || result.balancingAuthority === null).toBe(true)
      expect(typeof result.demandRampPct === 'number' || result.demandRampPct === null).toBe(true)
      expect(typeof result.carbonSpikeProbability === 'number' || result.carbonSpikeProbability === null).toBe(true)
      expect(typeof result.curtailmentProbability === 'number' || result.curtailmentProbability === null).toBe(true)
      expect(typeof result.importCarbonLeakageScore === 'number' || result.importCarbonLeakageScore === null).toBe(true)
    })

    it('should include source and validation metadata', async () => {
      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      expect(result.source_used).toBe('ELECTRICITY_MAPS')
      expect(result.fallback_used).toBe(false)
      expect(typeof result.estimatedFlag === 'boolean' || result.estimatedFlag === null).toBe(true)
      expect(typeof result.syntheticFlag === 'boolean' || result.syntheticFlag === null).toBe(true)
    })

    it('should include forecast stability in contract', async () => {
      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      expect(['stable', 'medium', 'unstable', null]).toContain(result.forecast_stability)
    })

    it('should include predicted_clean_window in contract', async () => {
      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      expect(result.predicted_clean_window === null || typeof result.predicted_clean_window === 'object').toBe(true)
    })

    it('should include decisionFrameId for audit/replay', async () => {
      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      expect(result.decisionFrameId === null || typeof result.decisionFrameId === 'string').toBe(true)
    })

    it('should include alternatives with scores', async () => {
      setSignalsByRegion({
        'us-east-1': buildDecision('us-east-1', 300),
        'us-west-1': buildDecision('us-west-1', 200),
        'eu-west-1': buildDecision('eu-west-1', 250),
      })

      const result = await routeGreen({
        preferredRegions: ['us-east-1', 'us-west-1', 'eu-west-1']
      })

      expect(Array.isArray(result.alternatives)).toBe(true)
      expect(result.alternatives.length).toBeGreaterThan(0)

      for (const alt of result.alternatives) {
        expect(alt).toHaveProperty('region')
        expect(alt).toHaveProperty('carbonIntensity')
        expect(alt).toHaveProperty('score')
        expect(typeof alt.score).toBe('number')
        expect(alt.score).toBeGreaterThanOrEqual(0)
        expect(alt.score).toBeLessThanOrEqual(1)
      }
    })

    it('should include legacy lease fields for backward compatibility', async () => {
      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      // Lease fields are optional but should be null-safe
      expect(result.lease_id === undefined || typeof result.lease_id === 'string').toBe(true)
      expect(result.lease_expires_at === undefined || typeof result.lease_expires_at === 'string').toBe(true)
      expect(result.must_revalidate_after === undefined || typeof result.must_revalidate_after === 'string').toBe(true)
    })

    it('should calculate score between 0 and 1', async () => {
      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
    })

    it('should preserve null values for unavailable grid signals', async () => {
      setSignalsByRegion({
        'us-east-1': buildDecision('us-east-1', 250, {
          signal: {
            source: 'fallback',
            confidence: 0.05,
            provenance: {
              sourceUsed: 'STATIC_FALLBACK',
              contributingSources: [],
              referenceTime: nowIso(),
              fetchedAt: nowIso(),
              fallbackUsed: true,
              disagreementFlag: false,
              disagreementPct: 0,
              trustLevel: 'low',
            },
          },
        }),
      })

      const result = await routeGreen({
        preferredRegions: ['us-east-1']
      })

      // When using fallback, grid signals should be null
      expect(result.balancingAuthority).toBeNull()
      expect(result.demandRampPct).toBeNull()
      expect(result.carbonSpikeProbability).toBeNull()
      expect(result.curtailmentProbability).toBeNull()
      expect(result.importCarbonLeakageScore).toBeNull()
    })
  })
})
