import { GridSignalSnapshot, GridFeatures } from './types'

export class GridFeatureEngine {
  /**
   * Calculate derived grid features from raw snapshot data
   */
  static calculateFeatures(snapshot: GridSignalSnapshot): GridFeatures {
    return {
      demandRampPct: snapshot.demandChangePct,
      fossilRatio: snapshot.fossilRatio,
      renewableRatio: snapshot.renewableRatio,
      carbonSpikeProbability: this.calculateCarbonSpikeProbability(snapshot),
      curtailmentProbability: this.calculateCurtailmentProbability(snapshot),
      importCarbonLeakageScore: this.calculateImportCarbonLeakageScore(snapshot)
    }
  }

  /**
   * Calculate probability of carbon spike in near future
   * 
   * Logic: Rising demand + high fossil ratio + unstable conditions = higher spike risk
   */
  private static calculateCarbonSpikeProbability(snapshot: GridSignalSnapshot): number | null {
    const { demandChangePct, fossilRatio, renewableRatio } = snapshot

    if (demandChangePct === null || fossilRatio === null) {
      return null
    }

    let probability = 0

    // Base probability from demand ramp
    if (demandChangePct > 0) {
      // Positive demand ramp increases spike probability
      probability += Math.min(demandChangePct / 10, 0.4) // Max 0.4 from demand
    }

    // Fossil ratio contribution
    probability += fossilRatio * 0.3 // Max 0.3 from fossil dependency

    // Renewable ratio reduces spike probability
    if (renewableRatio !== null && renewableRatio > 0.3) {
      probability -= renewableRatio * 0.2 // Max -0.2 reduction from renewables
    }

    // Additional factors from metadata if available
    const metadata = snapshot.metadata as any
    if (metadata.providerDisagreement) {
      probability += 0.1
    }

    if (metadata.forecastVolatility) {
      probability += Math.min(metadata.forecastVolatility, 0.2)
    }

    return Math.max(0, Math.min(1, probability))
  }

  /**
   * Calculate probability of curtailment (clean energy oversupply)
   * 
   * Logic: Falling demand + high renewable ratio + export pressure = curtailment risk
   */
  private static calculateCurtailmentProbability(snapshot: GridSignalSnapshot): number | null {
    const { demandChangePct, renewableRatio, netInterchangeMwh } = snapshot

    if (demandChangePct === null || renewableRatio === null) {
      return null
    }

    let probability = 0

    // Negative demand ramp (load drop) increases curtailment probability
    if (demandChangePct < -2) { // More than 2% drop
      probability += Math.min(Math.abs(demandChangePct) / 10, 0.4)
    }

    // High renewable ratio contributes
    if (renewableRatio > 0.5) {
      probability += (renewableRatio - 0.5) * 0.4 // Up to 0.2 from high renewables
    }

    // Export pressure (positive net interchange) suggests potential curtailment
    if (netInterchangeMwh !== null && netInterchangeMwh > 100) { // >100MW exports
      probability += Math.min(netInterchangeMwh / 1000, 0.2) // Max 0.2 from exports
    }

    // Low fossil dependency increases curtailment likelihood
    if (snapshot.fossilRatio !== null && snapshot.fossilRatio < 0.3) {
      probability += 0.1
    }

    return Math.max(0, Math.min(1, probability))
  }

  /**
   * Calculate import carbon leakage score
   * 
   * Logic: Heavy imports + neighbor carbon higher than local = leakage risk
   */
  private static calculateImportCarbonLeakageScore(snapshot: GridSignalSnapshot): number | null {
    const { netInterchangeMwh } = snapshot

    // Governance: null means "no data" — must propagate null, not 0
    if (netInterchangeMwh === null) {
      return null
    }

    // Non-null but no imports (zero or negative = exports) → zero leakage
    if (netInterchangeMwh <= 0) {
      return 0
    }

    let score = 0

    // Base score from import volume
    const importVolume = Math.abs(netInterchangeMwh)
    score += Math.min(importVolume / 1000, 0.5) // Max 0.5 from volume

    // If we have neighbor carbon data (from metadata), calculate leakage differential
    const metadata = snapshot.metadata as any
    if (metadata.neighborCarbonIntensity && metadata.localCarbonIntensity) {
      const differential = metadata.neighborCarbonIntensity - metadata.localCarbonIntensity
      if (differential > 0) {
        score += Math.min(differential / 500, 0.3) // Max 0.3 from differential
      }
    }

    // Growing import dependency trend
    if (metadata.importTrend && metadata.importTrend > 0.1) { // 10%+ growth
      score += 0.1
    }

    return Math.max(0, Math.min(1, score))
  }

  /**
   * Update snapshots with calculated features
   */
  static updateSnapshotsWithFeatures(snapshots: GridSignalSnapshot[]): GridSignalSnapshot[] {
    return snapshots.map(snapshot => {
      const features = this.calculateFeatures(snapshot)
      
      return {
        ...snapshot,
        carbonSpikeProbability: features.carbonSpikeProbability,
        curtailmentProbability: features.curtailmentProbability,
        importCarbonLeakageScore: features.importCarbonLeakageScore
      }
    })
  }

  /**
   * Calculate signal quality tier based on data characteristics
   */
  static calculateSignalQuality(snapshot: GridSignalSnapshot): 'high' | 'medium' | 'low' {
    // EIA-930 data is typically high quality, but we can adjust based on completeness
    let qualityScore = 3 // Start at high

    // Missing critical data reduces quality
    if (snapshot.demandMwh === null) qualityScore -= 1
    if (snapshot.netGenerationMwh === null) qualityScore -= 1
    if (snapshot.fossilRatio === null && snapshot.renewableRatio === null) qualityScore -= 1

    // Estimated or synthetic data reduces quality
    if (snapshot.estimatedFlag) qualityScore -= 1
    if (snapshot.syntheticFlag) qualityScore -= 2

    // Provider disagreement reduces quality
    const metadata = snapshot.metadata as any
    if (metadata.providerDisagreement === 'high') qualityScore -= 1
    if (metadata.providerDisagreement === 'severe') qualityScore -= 2

    if (qualityScore >= 3) return 'high'
    if (qualityScore >= 2) return 'medium'
    return 'low'
  }

  /**
   * Apply quality tier updates to snapshots
   */
  static updateSignalQuality(snapshots: GridSignalSnapshot[]): GridSignalSnapshot[] {
    return snapshots.map(snapshot => ({
      ...snapshot,
      signalQuality: this.calculateSignalQuality(snapshot)
    }))
  }
}
