import { BalanceParser } from '../lib/grid-signals/balance-parser'
import { InterchangeParser } from '../lib/grid-signals/interchange-parser'
import { GridFeatureEngine } from '../lib/grid-signals/grid-feature-engine'
import { type EIABalanceData, type EIAInterchangeData, type GridSignalSnapshot } from '../lib/grid-signals/types'

describe('EIA-930 Parsing', () => {
  describe('BalanceParser', () => {
    it('should parse balance data correctly', () => {
      const rawData: EIABalanceData[] = [
        {
          period: '2024-03-15T12:00Z',
          respondent: 'PJM',
          'respondent-name': 'PJM Interconnection LLC',
          type: 'D', // Demand
          value: 120000,
          'value-units': 'MW'
        },
        {
          period: '2024-03-15T12:00Z',
          respondent: 'PJM',
          'respondent-name': 'PJM Interconnection LLC',
          type: 'NG', // Net Generation
          value: 100000,
          'value-units': 'MW'
        },
        {
          period: '2024-03-15T12:00Z',
          respondent: 'PJM',
          'respondent-name': 'PJM Interconnection LLC',
          type: 'TI', // Total Interchange
          value: 20000,
          'value-units': 'MW'
        }
      ]

      const snapshots = BalanceParser.parseBalanceData(rawData, 'us-east-1', 'PJM')

      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toHaveProperty('demandMwh', 120000)
      expect(snapshots[0]).toHaveProperty('netGenerationMwh', 100000)
      expect(snapshots[0]).toHaveProperty('netInterchangeMwh', 20000)
      expect(snapshots[0]).toHaveProperty('timestamp')
      expect(snapshots[0].region).toBe('us-east-1')
      expect(snapshots[0].balancingAuthority).toBe('PJM')
    })

    it('should skip records missing demand or net generation', () => {
      const rawData: EIABalanceData[] = [
        {
          period: '2024-03-15T12:00Z',
          respondent: 'PJM',
          'respondent-name': 'PJM Interconnection LLC',
          type: 'D',
          value: 120000,
          'value-units': 'MW'
        }
        // Missing NG record - should not create snapshot
      ]

      const snapshots = BalanceParser.parseBalanceData(rawData, 'us-east-1', 'PJM')

      expect(snapshots).toHaveLength(0)
    })

    it('should calculate demand changes between consecutive snapshots', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 100000,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: 90000,
          netInterchangeMwh: 10000,
          renewableRatio: 0.3,
          fossilRatio: 0.7,
          carbonSpikeProbability: null,
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        },
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T13:00Z',
          demandMwh: 110000,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: 95000,
          netInterchangeMwh: 15000,
          renewableRatio: 0.3,
          fossilRatio: 0.7,
          carbonSpikeProbability: null,
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const updated = BalanceParser.calculateDemandChanges(snapshots)

      expect(updated[1].demandChangeMwh).toBe(10000)
      expect(updated[1].demandChangePct).toBe(10)
    })

    it('should handle null demand values in change calculation', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: null,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: 90000,
          netInterchangeMwh: null,
          renewableRatio: null,
          fossilRatio: null,
          carbonSpikeProbability: null,
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const updated = BalanceParser.calculateDemandChanges(snapshots)

      expect(updated[0].demandChangeMwh).toBeNull()
      expect(updated[0].demandChangePct).toBeNull()
    })
  })

  describe('InterchangeParser', () => {
    it('should parse interchange data correctly', () => {
      const rawData: EIAInterchangeData[] = [
        {
          period: '2024-03-15T12:00Z',
          'from-ba': 'PJM',
          'from-ba-name': 'PJM Interconnection LLC',
          'to-ba': 'MISO',
          'to-ba-name': 'Midcontinent ISO',
          type: 'EXP',
          value: 5000,
          'value-units': 'MW'
        },
        {
          period: '2024-03-15T12:00Z',
          'from-ba': 'MISO',
          'from-ba-name': 'Midcontinent ISO',
          'to-ba': 'PJM',
          'to-ba-name': 'PJM Interconnection LLC',
          type: 'IMP',
          value: 3000,
          'value-units': 'MW'
        }
      ]

      const snapshots = InterchangeParser.parseInterchangeData(rawData, 'us-midwest-1', 'MISO')

      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toHaveProperty('netInterchangeMwh')
      // For MISO: receives 5000 from PJM (import), sends 3000 to PJM (export)
      // Net = 5000 - 3000 = 2000
      expect(snapshots[0].netInterchangeMwh).toBe(2000)
    })

    it('should calculate net interchange correctly for exporting region', () => {
      const rawData: EIAInterchangeData[] = [
        {
          period: '2024-03-15T12:00Z',
          'from-ba': 'CISO',
          'from-ba-name': 'California ISO',
          'to-ba': 'NWPP',
          'to-ba-name': 'Northwest Power Pool',
          type: 'EXP',
          value: 10000,
          'value-units': 'MW'
        }
      ]

      const snapshots = InterchangeParser.parseInterchangeData(rawData, 'us-west-1', 'CISO')

      expect(snapshots[0].netInterchangeMwh).toBe(-10000) // Negative = export
    })

    it('should merge interchange into balance snapshots', () => {
      const balanceSnapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 100000,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: 90000,
          netInterchangeMwh: null,
          renewableRatio: 0.3,
          fossilRatio: 0.7,
          carbonSpikeProbability: null,
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const interchangeSnapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: null,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: null,
          netInterchangeMwh: 10000,
          renewableRatio: null,
          fossilRatio: null,
          carbonSpikeProbability: null,
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: { interchangeFlows: [] }
        }
      ]

      const merged = InterchangeParser.mergeIntoSnapshots(balanceSnapshots, interchangeSnapshots)

      expect(merged[0].netInterchangeMwh).toBe(10000)
      expect(merged[0].demandMwh).toBe(100000) // Original balance data preserved
    })

    it('should handle snapshots without matching interchange data', () => {
      const balanceSnapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 100000,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: 90000,
          netInterchangeMwh: null,
          renewableRatio: 0.3,
          fossilRatio: 0.7,
          carbonSpikeProbability: null,
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const merged = InterchangeParser.mergeIntoSnapshots(balanceSnapshots, [])

      expect(merged[0].netInterchangeMwh).toBeNull()
      expect(merged[0].demandMwh).toBe(100000)
    })
  })

  describe('GridFeatureEngine', () => {
    it('should calculate carbon spike probability from demand ramp and fossil ratio', () => {
      const snapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: 'PJM',
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 110000,
        demandChangeMwh: 10000,
        demandChangePct: 10, // 10% ramp
        netGenerationMwh: 95000,
        netInterchangeMwh: 15000,
        renewableRatio: 0.2,
        fossilRatio: 0.8, // High fossil dependency
        carbonSpikeProbability: null,
        curtailmentProbability: null,
        importCarbonLeakageScore: null,
        signalQuality: 'high',
        estimatedFlag: false,
        syntheticFlag: false,
        source: 'eia930',
        metadata: {}
      }

      const features = GridFeatureEngine.calculateFeatures(snapshot)

      expect(features.carbonSpikeProbability).toBeGreaterThan(0)
      expect(features.carbonSpikeProbability).toBeLessThanOrEqual(1)
    })

    it('should calculate curtailment probability from negative demand ramp and high renewables', () => {
      const snapshot: GridSignalSnapshot = {
        region: 'us-west-1',
        balancingAuthority: 'CISO',
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 90000,
        demandChangeMwh: -10000,
        demandChangePct: -10, // 10% drop
        netGenerationMwh: 85000,
        netInterchangeMwh: 5000,
        renewableRatio: 0.7, // High renewables
        fossilRatio: 0.3,
        carbonSpikeProbability: null,
        curtailmentProbability: null,
        importCarbonLeakageScore: null,
        signalQuality: 'high',
        estimatedFlag: false,
        syntheticFlag: false,
        source: 'eia930',
        metadata: {}
      }

      const features = GridFeatureEngine.calculateFeatures(snapshot)

      expect(features.curtailmentProbability).toBeGreaterThan(0)
      expect(features.curtailmentProbability).toBeLessThanOrEqual(1)
    })

    it('should calculate import carbon leakage score from interchange', () => {
      const snapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: 'PJM',
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 100000,
        demandChangeMwh: null,
        demandChangePct: null,
        netGenerationMwh: 90000,
        netInterchangeMwh: 10000, // 10,000 MW imports
        renewableRatio: 0.3,
        fossilRatio: 0.7,
        carbonSpikeProbability: null,
        curtailmentProbability: null,
        importCarbonLeakageScore: null,
        signalQuality: 'high',
        estimatedFlag: false,
        syntheticFlag: false,
        source: 'eia930',
        metadata: {}
      }

      const features = GridFeatureEngine.calculateFeatures(snapshot)

      expect(features.importCarbonLeakageScore).toBeGreaterThanOrEqual(0)
      expect(features.importCarbonLeakageScore).toBeLessThanOrEqual(1)
    })

    it('should return zero for import leakage when no imports', () => {
      const snapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: 'PJM',
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 100000,
        demandChangeMwh: null,
        demandChangePct: null,
        netGenerationMwh: 110000,
        netInterchangeMwh: -10000, // Exporting
        renewableRatio: 0.3,
        fossilRatio: 0.7,
        carbonSpikeProbability: null,
        curtailmentProbability: null,
        importCarbonLeakageScore: null,
        signalQuality: 'high',
        estimatedFlag: false,
        syntheticFlag: false,
        source: 'eia930',
        metadata: {}
      }

      const features = GridFeatureEngine.calculateFeatures(snapshot)

      expect(features.importCarbonLeakageScore).toBe(0)
    })

    it('should handle null values in feature calculation', () => {
      const snapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: 'PJM',
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 100000,
        demandChangeMwh: null,
        demandChangePct: null,
        netGenerationMwh: 90000,
        netInterchangeMwh: null,
        renewableRatio: null,
        fossilRatio: null,
        carbonSpikeProbability: null,
        curtailmentProbability: null,
        importCarbonLeakageScore: null,
        signalQuality: 'high',
        estimatedFlag: false,
        syntheticFlag: false,
        source: 'eia930',
        metadata: {}
      }

      const features = GridFeatureEngine.calculateFeatures(snapshot)

      expect(features.carbonSpikeProbability).toBeNull()
      expect(features.curtailmentProbability).toBeNull()
      expect(features.importCarbonLeakageScore).toBeNull()
    })

    it('should update snapshots with calculated features', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 110000,
          demandChangeMwh: 10000,
          demandChangePct: 10,
          netGenerationMwh: 95000,
          netInterchangeMwh: 15000,
          renewableRatio: 0.2,
          fossilRatio: 0.8,
          carbonSpikeProbability: null,
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const updated = GridFeatureEngine.updateSnapshotsWithFeatures(snapshots)

      expect(updated[0].carbonSpikeProbability).not.toBeNull()
      expect(updated[0].curtailmentProbability).not.toBeNull()
      expect(updated[0].importCarbonLeakageScore).not.toBeNull()
    })

    it('should calculate signal quality based on completeness', () => {
      const completeSnapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: 'PJM',
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 100000,
        demandChangeMwh: 10000,
        demandChangePct: 10,
        netGenerationMwh: 90000,
        netInterchangeMwh: 10000,
        renewableRatio: 0.3,
        fossilRatio: 0.7,
        carbonSpikeProbability: 0.4,
        curtailmentProbability: 0.2,
        importCarbonLeakageScore: 0.3,
        signalQuality: 'high',
        estimatedFlag: false,
        syntheticFlag: false,
        source: 'eia930',
        metadata: {}
      }

      const quality = GridFeatureEngine.calculateSignalQuality(completeSnapshot)

      expect(quality).toBe('high')
    })

    it('should reduce quality for estimated data', () => {
      const estimatedSnapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: 'PJM',
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 100000,
        demandChangeMwh: 10000,
        demandChangePct: 10,
        netGenerationMwh: 90000,
        netInterchangeMwh: null,
        renewableRatio: 0.3,
        fossilRatio: 0.7,
        carbonSpikeProbability: 0.4,
        curtailmentProbability: 0.2,
        importCarbonLeakageScore: null,
        signalQuality: 'high',
        estimatedFlag: true, // Estimated data
        syntheticFlag: false,
        source: 'eia930',
        metadata: {}
      }

      const quality = GridFeatureEngine.calculateSignalQuality(estimatedSnapshot)

      expect(quality).toBe('medium')
    })

    it('should reduce quality significantly for synthetic data', () => {
      const syntheticSnapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: 'PJM',
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 100000,
        demandChangeMwh: 10000,
        demandChangePct: 10,
        netGenerationMwh: 90000,
        netInterchangeMwh: null,
        renewableRatio: 0.3,
        fossilRatio: 0.7,
        carbonSpikeProbability: 0.4,
        curtailmentProbability: 0.2,
        importCarbonLeakageScore: null,
        signalQuality: 'high',
        estimatedFlag: false,
        syntheticFlag: true, // Synthetic data
        source: 'eia930',
        metadata: {}
      }

      const quality = GridFeatureEngine.calculateSignalQuality(syntheticSnapshot)

      expect(quality).toBe('low')
    })
  })
})
