jest.mock('../lib/redis', () => ({
  redis: {
    hgetall: jest.fn().mockResolvedValue({}),
    hset: jest.fn().mockResolvedValue(undefined),
  },
}))

import { computeRegionReliabilityMultiplier } from '../lib/learning/region-reliability'

describe('region reliability learning', () => {
  it('rewards strong outcomes within safety bounds', () => {
    const multiplier = computeRegionReliabilityMultiplier({
      total: 100,
      denyRate: 0.02,
      fallbackRate: 0.01,
      avgSavingsPct: 35,
      avgSignalConfidence: 0.92,
    })

    expect(multiplier).toBeGreaterThan(1)
    expect(multiplier).toBeLessThanOrEqual(1.2)
  })

  it('penalizes unstable outcomes within safety bounds', () => {
    const multiplier = computeRegionReliabilityMultiplier({
      total: 100,
      denyRate: 0.3,
      fallbackRate: 0.25,
      avgSavingsPct: 5,
      avgSignalConfidence: 0.3,
    })

    expect(multiplier).toBeLessThan(1)
    expect(multiplier).toBeGreaterThanOrEqual(0.8)
  })
})
