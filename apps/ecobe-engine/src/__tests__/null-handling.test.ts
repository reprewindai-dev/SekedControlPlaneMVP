import { GridFeatureEngine } from '../lib/grid-signals/grid-feature-engine'
import { InterchangeAnalyzer } from '../lib/grid-signals/interchange-analyzer'
import { CurtailmentDetector } from '../lib/grid-signals/curtailment-detector'
import { RampDetector } from '../lib/grid-signals/ramp-detector'
import { type GridSignalSnapshot } from '../lib/grid-signals/types'

describe('Null Handling in Grid Signals', () => {
  describe('GridFeatureEngine with null inputs', () => {
    it('should handle all-null snapshot gracefully', () => {
      const snapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: null,
        timestamp: '2024-03-15T12:00Z',
        demandMwh: null,
        demandChangeMwh: null,
        demandChangePct: null,
        netGenerationMwh: null,
        netInterchangeMwh: null,
        renewableRatio: null,
        fossilRatio: null,
        carbonSpikeProbability: null,
        curtailmentProbability: null,
        importCarbonLeakageScore: null,
        signalQuality: 'low',
        estimatedFlag: false,
        syntheticFlag: false,
        source: 'eia930',
        metadata: {}
      }

      const features = GridFeatureEngine.calculateFeatures(snapshot)

      expect(features.demandRampPct).toBeNull()
      expect(features.fossilRatio).toBeNull()
      expect(features.renewableRatio).toBeNull()
      expect(features.carbonSpikeProbability).toBeNull()
      expect(features.curtailmentProbability).toBeNull()
      expect(features.importCarbonLeakageScore).toBeNull()
    })

    it('should calculate features when only some fields are null', () => {
      const snapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: 'PJM',
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 100000,
        demandChangeMwh: 5000,
        demandChangePct: 5,
        netGenerationMwh: 95000,
        netInterchangeMwh: null, // No interchange data
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

      expect(features.demandRampPct).toBe(5)
      expect(features.fossilRatio).toBe(0.7)
      expect(features.renewableRatio).toBe(0.3)
      expect(features.carbonSpikeProbability).not.toBeNull()
      expect(features.curtailmentProbability).not.toBeNull()
      expect(features.importCarbonLeakageScore).toBeNull() // null interchange data → null (no data, not "no imports")
    })

    it('should handle negative interchange values correctly', () => {
      const snapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: 'PJM',
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 100000,
        demandChangeMwh: null,
        demandChangePct: null,
        netGenerationMwh: 110000,
        netInterchangeMwh: -10000, // Exporting
        renewableRatio: 0.4,
        fossilRatio: 0.6,
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

      expect(features.importCarbonLeakageScore).toBe(0) // Export not import
    })

    it('should update snapshots with null feature results', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: null,
          timestamp: '2024-03-15T12:00Z',
          demandMwh: null,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: null,
          netInterchangeMwh: null,
          renewableRatio: null,
          fossilRatio: null,
          carbonSpikeProbability: null,
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'low',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const updated = GridFeatureEngine.updateSnapshotsWithFeatures(snapshots)

      expect(updated[0].carbonSpikeProbability).toBeNull()
      expect(updated[0].curtailmentProbability).toBeNull()
      expect(updated[0].importCarbonLeakageScore).toBeNull()
    })

    it('should handle edge case: zero demand with positive change', () => {
      const snapshot: GridSignalSnapshot = {
        region: 'us-east-1',
        balancingAuthority: null,
        timestamp: '2024-03-15T12:00Z',
        demandMwh: 0,
        demandChangeMwh: 100, // Relative change from zero
        demandChangePct: null, // Can't calculate percentage change from zero
        netGenerationMwh: 100,
        netInterchangeMwh: null,
        renewableRatio: 0.5,
        fossilRatio: 0.5,
        carbonSpikeProbability: null,
        curtailmentProbability: null,
        importCarbonLeakageScore: null,
        signalQuality: 'medium',
        estimatedFlag: false,
        syntheticFlag: false,
        source: 'eia930',
        metadata: {}
      }

      const features = GridFeatureEngine.calculateFeatures(snapshot)

      expect(features.carbonSpikeProbability).toBeNull() // No percentage change
    })
  })

  describe('InterchangeAnalyzer with empty snapshots', () => {
    it('should handle empty snapshot array', () => {
      const leakages = InterchangeAnalyzer.analyzeImportCarbonLeakage([])

      expect(leakages).toEqual([])
    })

    it('should handle snapshots with no imports', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
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
      ]

      const leakages = InterchangeAnalyzer.analyzeImportCarbonLeakage(snapshots)

      expect(leakages).toEqual([]) // No imports
    })

    it('should handle null netInterchangeMwh', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 100000,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: 90000,
          netInterchangeMwh: null, // No data
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

      const leakages = InterchangeAnalyzer.analyzeImportCarbonLeakage(snapshots)

      expect(leakages).toEqual([]) // No import data
    })

    it('should calculate leakage with null neighbor intensities', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 100000,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: 90000,
          netInterchangeMwh: 10000, // Imports
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

      const leakages = InterchangeAnalyzer.analyzeImportCarbonLeakage(snapshots, {}) // Empty neighbor map

      expect(leakages.length).toBeGreaterThan(0)
      expect(leakages[0].isHeuristicOnly).toBe(true) // Should use heuristics
    })

    it('should handle getTopImportLeakages with empty array', () => {
      const tops = InterchangeAnalyzer.getTopImportLeakages([])

      expect(tops).toEqual([])
    })

    it('should handle groupByRegion with empty leakages', () => {
      const grouped = InterchangeAnalyzer.groupByRegion([])

      expect(grouped).toEqual({})
    })

    it('should calculate summary for empty leakages', () => {
      const summary = InterchangeAnalyzer.calculateRegionLeakageSummary([])

      expect(summary.totalImportVolumeMwh).toBe(0)
      expect(summary.averageLeakageScore).toBe(0)
      expect(summary.maxLeakageScore).toBe(0)
      expect(summary.highRiskPeriods).toBe(0)
      expect(summary.totalPeriods).toBe(0)
    })

    it('should handle detectImportTrends with empty snapshots', () => {
      const trends = InterchangeAnalyzer.detectImportTrends([])

      expect(trends).toEqual([])
    })

    it('should handle detectImportTrends with no imports', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 100000,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: 110000,
          netInterchangeMwh: -10000, // Exports only
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

      const trends = InterchangeAnalyzer.detectImportTrends(snapshots)

      expect(trends).toEqual([])
    })
  })

  describe('CurtailmentDetector with no data', () => {
    it('should handle empty snapshot array', () => {
      const windows = CurtailmentDetector.detectCurtailmentWindows([])

      expect(windows).toEqual([])
    })

    it('should handle snapshots with null curtailment probabilities', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 100000,
          demandChangeMwh: null,
          demandChangePct: null,
          netGenerationMwh: 90000,
          netInterchangeMwh: null,
          renewableRatio: 0.5,
          fossilRatio: 0.5,
          carbonSpikeProbability: null,
          curtailmentProbability: null, // No curtailment data
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const windows = CurtailmentDetector.detectCurtailmentWindows(snapshots)

      expect(windows).toEqual([])
    })

    it('should handle curtailment windows with null renewable ratio', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 90000,
          demandChangeMwh: -10000,
          demandChangePct: -10,
          netGenerationMwh: 90000,
          netInterchangeMwh: null,
          renewableRatio: null, // No renewable ratio
          fossilRatio: 0.5,
          carbonSpikeProbability: null,
          curtailmentProbability: 0.7, // High curtailment probability
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const windows = CurtailmentDetector.detectCurtailmentWindows(snapshots)

      expect(windows.length).toBeGreaterThan(0)
      expect(windows[0].renewableRatio).toBeNull()
    })

    it('should handle getTopCurtailmentWindows with empty array', () => {
      const tops = CurtailmentDetector.getTopCurtailmentWindows([])

      expect(tops).toEqual([])
    })

    it('should handle filterByMinDuration with empty windows', () => {
      const filtered = CurtailmentDetector.filterByMinDuration([], 2)

      expect(filtered).toEqual([])
    })

    it('should handle groupByRegion with empty windows', () => {
      const grouped = CurtailmentDetector.groupByRegion([])

      expect(grouped).toEqual({})
    })
  })

  describe('RampDetector with no data', () => {
    it('should handle empty snapshot array', () => {
      const risks = RampDetector.detectCarbonSpikeRisks([])

      expect(risks).toEqual([])
    })

    it('should handle snapshots with null carbonSpikeProbability', () => {
      const snapshots: GridSignalSnapshot[] = [
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
          carbonSpikeProbability: null, // No spike probability
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const risks = RampDetector.detectCarbonSpikeRisks(snapshots)

      expect(risks).toEqual([])
    })

    it('should handle spike risks with null demand ramp', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 100000,
          demandChangeMwh: null,
          demandChangePct: null, // No demand ramp data
          netGenerationMwh: 90000,
          netInterchangeMwh: null,
          renewableRatio: 0.2,
          fossilRatio: 0.8,
          carbonSpikeProbability: 0.75, // High spike probability
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const risks = RampDetector.detectCarbonSpikeRisks(snapshots)

      expect(risks.length).toBeGreaterThan(0)
      expect(risks[0].expectedRampPct).toBeNull()
    })

    it('should handle getTopCarbonSpikeRisks with empty array', () => {
      const tops = RampDetector.getTopCarbonSpikeRisks([])

      expect(tops).toEqual([])
    })

    it('should handle filterByMinDemandRamp with null values', () => {
      const risks = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          carbonSpikeProbability: 0.8,
          expectedRampPct: null, // Null ramp
          confidence: 'high' as const,
          fossilRatio: 0.8,
          demandRampPct: null,
          timestamp: '2024-03-15T12:00Z'
        }
      ]

      const filtered = RampDetector.filterByMinDemandRamp(risks, 3)

      expect(filtered).toEqual([])
    })

    it('should handle filterByMinFossilRatio with null values', () => {
      const risks = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          carbonSpikeProbability: 0.8,
          expectedRampPct: 5,
          confidence: 'high' as const,
          fossilRatio: null, // Null fossil ratio
          demandRampPct: 5,
          timestamp: '2024-03-15T12:00Z'
        }
      ]

      const filtered = RampDetector.filterByMinFossilRatio(risks, 0.5)

      expect(filtered).toEqual([])
    })

    it('should handle groupByRegion with empty risks', () => {
      const grouped = RampDetector.groupByRegion([])

      expect(grouped).toEqual({})
    })

    it('should calculate risk severity with null values', () => {
      const risk = {
        region: 'us-east-1',
        balancingAuthority: 'PJM',
        carbonSpikeProbability: 0.7,
        expectedRampPct: null, // Null ramp
        confidence: 'medium' as const,
        fossilRatio: null, // Null fossil ratio
        demandRampPct: null,
        timestamp: '2024-03-15T12:00Z'
      }

      const severity = RampDetector.calculateRiskSeverity(risk)

      expect(severity).toBeGreaterThanOrEqual(0)
      expect(severity).toBeLessThanOrEqual(1)
    })

    it('should handle detectSustainedRamps with empty snapshots', () => {
      const risks = RampDetector.detectSustainedRamps([])

      expect(risks).toEqual([])
    })

    it('should handle detectSustainedRamps with null demand changes', () => {
      const snapshots: GridSignalSnapshot[] = [
        {
          region: 'us-east-1',
          balancingAuthority: 'PJM',
          timestamp: '2024-03-15T12:00Z',
          demandMwh: 100000,
          demandChangeMwh: null,
          demandChangePct: null, // Null demand change
          netGenerationMwh: 90000,
          netInterchangeMwh: null,
          renewableRatio: 0.3,
          fossilRatio: 0.7,
          carbonSpikeProbability: 0.8,
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
          demandMwh: 105000,
          demandChangeMwh: null,
          demandChangePct: null, // Null demand change
          netGenerationMwh: 92000,
          netInterchangeMwh: null,
          renewableRatio: 0.3,
          fossilRatio: 0.7,
          carbonSpikeProbability: 0.8,
          curtailmentProbability: null,
          importCarbonLeakageScore: null,
          signalQuality: 'high',
          estimatedFlag: false,
          syntheticFlag: false,
          source: 'eia930',
          metadata: {}
        }
      ]

      const risks = RampDetector.detectSustainedRamps(snapshots)

      expect(risks).toEqual([])
    })
  })
})
