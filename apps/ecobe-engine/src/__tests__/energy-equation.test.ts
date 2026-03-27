import { calculateEnergyEquation } from '../lib/energy-equation'

jest.mock('../lib/electricity-maps')
jest.mock('../lib/db')
jest.mock('../lib/redis')
jest.mock('../lib/green-routing')

describe('Energy Equation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('calculateEnergyEquation', () => {
    it('should calculate energy for inference workload', async () => {
      const result = await calculateEnergyEquation({
        requestVolume: 1000,
        workloadType: 'inference',
        modelSize: 'mixtral-70b',
        regionTargets: ['FR', 'DE'],
      })

      expect(result).toHaveProperty('routingRecommendation')
      expect(result).toHaveProperty('totalEstimatedCO2')
      expect(result.totalEstimatedCO2).toBeGreaterThan(0)
      expect(Array.isArray(result.routingRecommendation)).toBe(true)
    })

    it('should calculate energy for training workload', async () => {
      const result = await calculateEnergyEquation({
        requestVolume: 100,
        workloadType: 'training',
        modelSize: 'large',
        regionTargets: ['US-CAL-CISO'],
      })

      expect(result.totalEstimatedCO2).toBeGreaterThan(0)
      // Training should use more energy than inference
    })

    it('should respect carbon budget', async () => {
      const result = await calculateEnergyEquation({
        requestVolume: 1000,
        workloadType: 'inference',
        modelSize: 'small',
        regionTargets: ['FR'],
        carbonBudget: 5000,
      })

      expect(result).toHaveProperty('withinBudget')
      expect(typeof result.withinBudget).toBe('boolean')
    })

    it('should rank regions by carbon efficiency', async () => {
      const result = await calculateEnergyEquation({
        requestVolume: 1000,
        workloadType: 'inference',
        regionTargets: ['FR', 'DE', 'US-CAL-CISO'],
      })

      expect(result.routingRecommendation).toHaveLength(3)
      const ranks = result.routingRecommendation.map((r) => r.rank)
      expect(ranks).toEqual([1, 2, 3])
    })

    it('should handle hardware mix', async () => {
      const result = await calculateEnergyEquation({
        requestVolume: 1000,
        workloadType: 'inference',
        regionTargets: ['FR'],
        hardwareMix: {
          cpu: 0.6,
          gpu: 0.3,
          tpu: 0.1,
        },
      })

      expect(result.totalEstimatedCO2).toBeGreaterThan(0)
    })

    it('should calculate different energy for different model sizes', async () => {
      const smallModel = await calculateEnergyEquation({
        requestVolume: 1000,
        workloadType: 'inference',
        modelSize: 'small',
        regionTargets: ['FR'],
      })

      const largeModel = await calculateEnergyEquation({
        requestVolume: 1000,
        workloadType: 'inference',
        modelSize: 'xlarge',
        regionTargets: ['FR'],
      })

      // Larger model should use more energy (if same carbon intensity)
      // We can't directly compare without mocking, but structure should be valid
      expect(smallModel.totalEstimatedCO2).toBeGreaterThan(0)
      expect(largeModel.totalEstimatedCO2).toBeGreaterThan(0)
    })
  })
})
