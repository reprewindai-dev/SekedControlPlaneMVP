import { GridSignalSnapshot } from './types'

export interface CarbonSpikeRisk {
  region: string
  balancingAuthority: string | null
  carbonSpikeProbability: number
  expectedRampPct: number | null
  confidence: 'high' | 'medium' | 'low'
  fossilRatio: number | null
  demandRampPct: number | null
  timestamp: string
}

export class RampDetector {
  /**
   * Detect carbon spike risks from grid signal snapshots
   */
  static detectCarbonSpikeRisks(
    snapshots: GridSignalSnapshot[],
    minProbability: number = 0.7
  ): CarbonSpikeRisk[] {
    const risks: CarbonSpikeRisk[] = []

    for (const snapshot of snapshots) {
      const probability = snapshot.carbonSpikeProbability
      if (probability !== null && probability >= minProbability) {
        const risk = this.createRiskFromSnapshot(snapshot)
        risks.push(risk)
      }
    }

    return risks.sort((a, b) => b.carbonSpikeProbability - a.carbonSpikeProbability)
  }

  /**
   * Create a carbon spike risk from a single snapshot
   */
  private static createRiskFromSnapshot(snapshot: GridSignalSnapshot): CarbonSpikeRisk {
    return {
      region: snapshot.region,
      balancingAuthority: snapshot.balancingAuthority,
      carbonSpikeProbability: snapshot.carbonSpikeProbability ?? 0,
      expectedRampPct: snapshot.demandChangePct,
      confidence: this.determineConfidence(snapshot),
      fossilRatio: snapshot.fossilRatio,
      demandRampPct: snapshot.demandChangePct,
      timestamp: snapshot.timestamp
    }
  }

  /**
   * Determine confidence level based on data quality and signal strength
   */
  private static determineConfidence(snapshot: GridSignalSnapshot): 'high' | 'medium' | 'low' {
    const probability = snapshot.carbonSpikeProbability
    
    if (snapshot.signalQuality === 'high' && 
        probability !== null && probability >= 0.8 &&
        snapshot.fossilRatio !== null && snapshot.fossilRatio > 0.6 &&
        snapshot.demandChangePct !== null && snapshot.demandChangePct > 3) {
      return 'high'
    }
    
    if (snapshot.signalQuality === 'medium' || 
        (probability !== null && probability >= 0.7) ||
        (snapshot.fossilRatio !== null && snapshot.fossilRatio > 0.4)) {
      return 'medium'
    }
    
    return 'low'
  }

  /**
   * Get top carbon spike risks
   */
  static getTopCarbonSpikeRisks(
    risks: CarbonSpikeRisk[],
    limit: number = 5
  ): CarbonSpikeRisk[] {
    return risks
      .sort((a, b) => {
        // Sort by combined score of probability and demand ramp
        const aScore = a.carbonSpikeProbability * (a.expectedRampPct ?? 1)
        const bScore = b.carbonSpikeProbability * (b.expectedRampPct ?? 1)
        return bScore - aScore
      })
      .slice(0, limit)
  }

  /**
   * Group risks by region
   */
  static groupByRegion(risks: CarbonSpikeRisk[]): Record<string, CarbonSpikeRisk[]> {
    return risks.reduce((groups, risk) => {
      const key = risk.region
      if (!groups[key]) {
        groups[key] = []
      }
      groups[key].push(risk)
      return groups
    }, {} as Record<string, CarbonSpikeRisk[]>)
  }

  /**
   * Filter risks by minimum demand ramp percentage
   */
  static filterByMinDemandRamp(
    risks: CarbonSpikeRisk[],
    minRampPct: number
  ): CarbonSpikeRisk[] {
    return risks.filter(risk => 
      risk.expectedRampPct !== null && risk.expectedRampPct >= minRampPct
    )
  }

  /**
   * Filter risks by fossil ratio threshold
   */
  static filterByMinFossilRatio(
    risks: CarbonSpikeRisk[],
    minFossilRatio: number
  ): CarbonSpikeRisk[] {
    return risks.filter(risk => 
      risk.fossilRatio !== null && risk.fossilRatio >= minFossilRatio
    )
  }

  /**
   * Calculate risk severity score (0-1)
   */
  static calculateRiskSeverity(risk: CarbonSpikeRisk): number {
    let severity = risk.carbonSpikeProbability

    // Increase severity for high demand ramps
    if (risk.expectedRampPct !== null && risk.expectedRampPct > 5) {
      severity += 0.1
    }

    // Increase severity for high fossil dependency
    if (risk.fossilRatio !== null && risk.fossilRatio > 0.7) {
      severity += 0.1
    }

    // Increase severity for medium/high confidence
    if (risk.confidence === 'high') {
      severity += 0.1
    } else if (risk.confidence === 'medium') {
      severity += 0.05
    }

    return Math.min(1, severity)
  }

  /**
   * Get risks with severity scores
   */
  static getRisksWithSeverity(risks: CarbonSpikeRisk[]): Array<CarbonSpikeRisk & { severity: number }> {
    return risks.map(risk => ({
      ...risk,
      severity: this.calculateRiskSeverity(risk)
    }))
  }

  /**
   * Detect sustained ramp conditions (multiple consecutive periods of increasing demand)
   */
  static detectSustainedRamps(
    snapshots: GridSignalSnapshot[],
    minConsecutivePeriods: number = 3
  ): CarbonSpikeRisk[] {
    const sortedSnapshots = [...snapshots].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    const sustainedRamps: CarbonSpikeRisk[] = []
    let rampSequence: GridSignalSnapshot[] = []

    for (const snapshot of sortedSnapshots) {
      const demandChangePct = snapshot.demandChangePct
      
      if (demandChangePct !== null && demandChangePct > 2) {
        // Positive demand ramp
        rampSequence.push(snapshot)
      } else {
        // Check if we had a sustained ramp sequence
        if (rampSequence.length >= minConsecutivePeriods) {
          // Create risk from the last snapshot in the sequence
          const risk = this.createRiskFromSnapshot(rampSequence[rampSequence.length - 1])
          sustainedRamps.push(risk)
        }
        rampSequence = []
      }
    }

    // Check final sequence
    if (rampSequence.length >= minConsecutivePeriods) {
      const risk = this.createRiskFromSnapshot(rampSequence[rampSequence.length - 1])
      sustainedRamps.push(risk)
    }

    return sustainedRamps
  }
}
