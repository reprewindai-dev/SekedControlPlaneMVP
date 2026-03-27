import { GridSignalSnapshot } from './types'

export interface CurtailmentWindow {
  region: string
  balancingAuthority: string | null
  startTime: string
  endTime: string
  curtailmentProbability: number
  expectedCarbonIntensity: number | null
  confidence: 'high' | 'medium' | 'low'
  renewableRatio: number | null
  demandDropPct: number | null
}

export class CurtailmentDetector {
  /**
   * Detect curtailment windows from grid signal snapshots
   */
  static detectCurtailmentWindows(
    snapshots: GridSignalSnapshot[],
    minProbability: number = 0.6
  ): CurtailmentWindow[] {
    const windows: CurtailmentWindow[] = []
    
    // Sort snapshots by timestamp
    const sortedSnapshots = [...snapshots].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    // Look for sustained curtailment conditions
    let currentWindow: CurtailmentWindow | null = null

    for (const snapshot of sortedSnapshots) {
      const probability = snapshot.curtailmentProbability
      if (probability !== null && probability >= minProbability) {
        if (!currentWindow) {
          // Start new window
          currentWindow = this.createWindowFromSnapshot(snapshot)
        } else {
          // Extend existing window
          currentWindow.endTime = snapshot.timestamp
          // Update probability to the minimum in the window (conservative)
          currentWindow.curtailmentProbability = Math.min(
            currentWindow.curtailmentProbability, 
            probability
          )
        }
      } else {
        // Close current window if it exists
        if (currentWindow) {
          windows.push(currentWindow)
          currentWindow = null
        }
      }
    }

    // Add any open window at the end
    if (currentWindow) {
      windows.push(currentWindow)
    }

    return windows
  }

  /**
   * Create a curtailment window from a single snapshot
   */
  private static createWindowFromSnapshot(snapshot: GridSignalSnapshot): CurtailmentWindow {
    return {
      region: snapshot.region,
      balancingAuthority: snapshot.balancingAuthority,
      startTime: snapshot.timestamp,
      endTime: snapshot.timestamp,
      curtailmentProbability: snapshot.curtailmentProbability ?? 0,
      expectedCarbonIntensity: null, // Will be estimated from carbon intensity data
      confidence: this.determineConfidence(snapshot),
      renewableRatio: snapshot.renewableRatio,
      demandDropPct: this.calculateDemandDropPct(snapshot)
    }
  }

  private static calculateDemandDropPct(snapshot: GridSignalSnapshot): number | null {
    const demandChangePct = snapshot.demandChangePct
    return demandChangePct !== null && demandChangePct < 0 
      ? Math.abs(demandChangePct) 
      : null
  }

  /**
   * Determine confidence level based on data quality
   */
  private static determineConfidence(snapshot: GridSignalSnapshot): 'high' | 'medium' | 'low' {
    if (snapshot.signalQuality === 'high' && 
        snapshot.renewableRatio !== null && 
        snapshot.renewableRatio > 0.5 &&
        snapshot.demandChangePct !== null &&
        snapshot.demandChangePct < -2) {
      return 'high'
    }
    
    if (snapshot.signalQuality === 'medium' || 
        (snapshot.renewableRatio !== null && snapshot.renewableRatio > 0.3)) {
      return 'medium'
    }
    
    return 'low'
  }

  /**
   * Estimate expected carbon intensity during curtailment
   * (typically lower than baseline due to high renewable share)
   */
  static estimateCurtailmentCarbonIntensity(
    window: CurtailmentWindow,
    baselineCarbonIntensity: number
  ): number {
    // Simple heuristic: curtailment reduces carbon intensity proportionally to renewable share
    const renewableDiscount = window.renewableRatio ? window.renewableRatio * 0.3 : 0.1
    return baselineCarbonIntensity * (1 - renewableDiscount)
  }

  /**
   * Get top curtailment windows by probability and duration
   */
  static getTopCurtailmentWindows(
    windows: CurtailmentWindow[],
    limit: number = 5
  ): CurtailmentWindow[] {
    return windows
      .sort((a, b) => {
        // Sort by combined score of probability and duration
        const aDuration = new Date(a.endTime).getTime() - new Date(a.startTime).getTime()
        const bDuration = new Date(b.endTime).getTime() - new Date(b.startTime).getTime()
        
        const aScore = a.curtailmentProbability * (aDuration / (1000 * 60 * 60)) // Hours
        const bScore = b.curtailmentProbability * (bDuration / (1000 * 60 * 60))
        
        return bScore - aScore
      })
      .slice(0, limit)
  }

  /**
   * Filter windows by minimum duration (in hours)
   */
  static filterByMinDuration(
    windows: CurtailmentWindow[],
    minDurationHours: number
  ): CurtailmentWindow[] {
    return windows.filter(window => {
      const duration = new Date(window.endTime).getTime() - new Date(window.startTime).getTime()
      const durationHours = duration / (1000 * 60 * 60)
      return durationHours >= minDurationHours
    })
  }

  /**
   * Group windows by region
   */
  static groupByRegion(windows: CurtailmentWindow[]): Record<string, CurtailmentWindow[]> {
    return windows.reduce((groups, window) => {
      const key = window.region
      if (!groups[key]) {
        groups[key] = []
      }
      groups[key].push(window)
      return groups
    }, {} as Record<string, CurtailmentWindow[]>)
  }
}
