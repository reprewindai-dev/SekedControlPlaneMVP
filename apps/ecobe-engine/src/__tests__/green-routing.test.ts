import { routeGreen } from '../lib/green-routing'

const makeSignal = (carbonIntensity: number, fallback = false) => ({
  carbonIntensity,
  source: fallback ? 'fallback' : 'watttime',
  isForecast: false,
  confidence: fallback ? 0.05 : 0.85,
  provenance: {
    sourceUsed: fallback ? 'STATIC_FALLBACK' : 'WATTTIME_MOER',
    contributingSources: fallback ? [] : ['watttime'],
    referenceTime: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    fallbackUsed: fallback,
    disagreementFlag: false,
    disagreementPct: 0,
  },
})

jest.mock('../services/fingard-control', () => ({
  fingard: {
    getNormalizedSignal: jest.fn(),
  },
}))
jest.mock('../lib/db')
jest.mock('../lib/redis')
jest.mock('../lib/grid-signals/grid-signal-cache')
jest.mock('../lib/grid-signals/grid-signal-audit')

describe('Green Routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const { fingard } = require('../services/fingard-control')
    fingard.getNormalizedSignal.mockResolvedValue({ signal: makeSignal(250) })
  })

  describe('routeGreen', () => {
    it('should select region with lowest carbon intensity', async () => {
      const { fingard } = require('../services/fingard-control')
      fingard.getNormalizedSignal
        .mockResolvedValueOnce({ signal: makeSignal(350) })
        .mockResolvedValueOnce({ signal: makeSignal(200) })
        .mockResolvedValueOnce({ signal: makeSignal(280) })

      const result = await routeGreen({
        preferredRegions: ['FR', 'DE', 'US-CAL-CISO'],
        carbonWeight: 1.0,
        latencyWeight: 0.0,
        costWeight: 0.0,
      })

      expect(result).toHaveProperty('selectedRegion')
      expect(result.selectedRegion).toBe('DE')
      expect(result).toHaveProperty('carbonIntensity')
      expect(result).toHaveProperty('score')
      expect(result.score).toBeGreaterThan(0)
      expect(result.score).toBeLessThanOrEqual(1)
    })

    it('should respect max carbon threshold', async () => {
      const { fingard } = require('../services/fingard-control')
      fingard.getNormalizedSignal
        .mockResolvedValueOnce({ signal: makeSignal(80) })
        .mockResolvedValueOnce({ signal: makeSignal(90) })

      const result = await routeGreen({
        preferredRegions: ['FR', 'DE'],
        maxCarbonGPerKwh: 100,
      })

      expect(result.carbonIntensity).toBeLessThanOrEqual(100)
    })

    it('should balance multiple optimization factors', async () => {
      const { fingard } = require('../services/fingard-control')
      fingard.getNormalizedSignal
        .mockResolvedValueOnce({ signal: makeSignal(300) })
        .mockResolvedValueOnce({ signal: makeSignal(200) })
        .mockResolvedValueOnce({ signal: makeSignal(250) })

      const result = await routeGreen({
        preferredRegions: ['FR', 'DE', 'US-CAL-CISO'],
        carbonWeight: 0.5,
        latencyWeight: 0.3,
        costWeight: 0.2,
        latencyMsByRegion: { FR: 80, DE: 60, 'US-CAL-CISO': 140 },
      })

      expect(result).toHaveProperty('selectedRegion')
      expect(result).toHaveProperty('alternatives')
      expect(Array.isArray(result.alternatives)).toBe(true)
    })

    it('should return alternatives sorted by score', async () => {
      const { fingard } = require('../services/fingard-control')
      fingard.getNormalizedSignal
        .mockResolvedValueOnce({ signal: makeSignal(300) })
        .mockResolvedValueOnce({ signal: makeSignal(180) })
        .mockResolvedValueOnce({ signal: makeSignal(240) })

      const result = await routeGreen({
        preferredRegions: ['FR', 'DE', 'GB'],
      })

      expect(result.alternatives).toBeDefined()
      if (result.alternatives && result.alternatives.length > 1) {
        const scores = result.alternatives.map((a) => a.score)
        const sortedScores = [...scores].sort((a, b) => b - a)
        expect(scores).toEqual(sortedScores)
      }
    })

    it('should handle single region', async () => {
      const { fingard } = require('../services/fingard-control')
      fingard.getNormalizedSignal.mockResolvedValueOnce({ signal: makeSignal(150) })

      const result = await routeGreen({
        preferredRegions: ['FR'],
      })

      expect(result.selectedRegion).toBe('FR')
      expect(result.alternatives).toHaveLength(0)
    })

    it('should throw error with empty regions array', async () => {
      await expect(
        routeGreen({
          preferredRegions: [],
        })
      ).rejects.toThrow()
    })
  })
})
