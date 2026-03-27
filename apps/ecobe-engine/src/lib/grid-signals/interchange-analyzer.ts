import { GridSignalSnapshot } from './types'
import { providerRouter } from '../carbon/provider-router'

export interface InterchangeFlow {
  fromRegion: string
  toRegion: string
  flowMwh: number
  timestamp: string
}

export interface ImportCarbonLeakage {
  region: string
  balancingAuthority: string | null
  importVolumeMwh: number
  leakageScore: number
  neighborCarbonIntensity: number | null
  localCarbonIntensity: number | null
  timestamp: string
  confidence: 'high' | 'medium' | 'low'
  isHeuristicOnly: boolean // IMPORTANT: This is heuristic-based, not canonical
}

/**
 * INTERCHANGE ANALYZER - HEURISTIC ONLY
 * 
 * ⚠️  WARNING: This implementation uses heuristics and simplified assumptions
 * It should NOT be treated as canonical carbon truth
 * 
 * Current limitations:
 * - Hardcoded region carbon intensity heuristics (California=200, Texas=400, etc.)
 * - Local carbon intensity estimated from fossil ratio as proxy
 * - Simplified import/export assumptions
 * 
 * Future improvements needed:
 * - Consume real local carbon intensity from provider orchestration
 * - Use real neighbor intensity where available from providers
 * - Only fall back to heuristics when provider data is missing
 */
export class InterchangeAnalyzer {
  /**
   * Analyze import carbon leakage from grid snapshots
   */
  static analyzeImportCarbonLeakage(
    snapshots: GridSignalSnapshot[],
    neighborCarbonIntensities: Record<string, number> = {}
  ): ImportCarbonLeakage[] {
    const leakages: ImportCarbonLeakage[] = []

    for (const snapshot of snapshots) {
      const leakage = this.calculateLeakage(snapshot, neighborCarbonIntensities)
      if (leakage.importVolumeMwh > 0) { // Only actual imports
        leakages.push(leakage)
      }
    }

    return leakages.sort((a, b) => b.leakageScore - a.leakageScore)
  }

  /**
   * Calculate carbon leakage for a single snapshot
   */
  private static calculateLeakage(
    snapshot: GridSignalSnapshot,
    neighborCarbonIntensities: Record<string, number>
  ): ImportCarbonLeakage {
    const importVolume = snapshot.netInterchangeMwh ?? 0
    const actualImportVolume = Math.max(0, importVolume) // Positive = imports

    // Get neighbor carbon intensity (simplified - using region mapping)
    const neighborCarbonIntensity = this.estimateNeighborCarbonIntensity(
      snapshot.region,
      neighborCarbonIntensities
    )

    // Get local carbon intensity (would come from carbon intensity data)
    const localCarbonIntensity = this.estimateLocalCarbonIntensity(snapshot)

    const leakageScore = this.calculateLeakageScore(
      actualImportVolume,
      neighborCarbonIntensity,
      localCarbonIntensity
    )

    // Mark as heuristic-only only if real provider data is not available
    const isHeuristicOnly = !neighborCarbonIntensities[snapshot.region]

    return {
      region: snapshot.region,
      balancingAuthority: snapshot.balancingAuthority,
      importVolumeMwh: actualImportVolume,
      leakageScore,
      neighborCarbonIntensity,
      localCarbonIntensity,
      timestamp: snapshot.timestamp,
      confidence: this.determineConfidence(snapshot, neighborCarbonIntensity, localCarbonIntensity),
      isHeuristicOnly
    }
  }

  /**
   * Estimate neighbor carbon intensity (heuristic-only approach)
   * ⚠️ This uses hardcoded heuristics - replace with real provider data when available
   */
  private static estimateNeighborCarbonIntensity(
    region: string,
    neighborIntensities: Record<string, number>
  ): number | null {
    // Try direct lookup first (real data)
    if (neighborIntensities[region]) {
      return neighborIntensities[region]
    }

    // HEURISTIC FALLBACK: Hardcoded region values (not production-ready)
    const regionLower = region.toLowerCase()
    if (regionLower.includes('cal') || regionLower.includes('ciso')) {
      return 200 // California moderate carbon
    } else if (regionLower.includes('texas') || regionLower.includes('ercot')) {
      return 400 // Texas higher carbon
    } else if (regionLower.includes('pjm')) {
      return 350 // PJM moderate-high carbon
    } else if (regionLower.includes('miso')) {
      return 380 // MISO high carbon
    }

    return null
  }

  /**
   * Estimate local carbon intensity (heuristic-only approach)
   * ⚠️ This uses fossil ratio as proxy - replace with real provider data when available
   */
  private static estimateLocalCarbonIntensity(snapshot: GridSignalSnapshot): number | null {
    // HEURISTIC: Simple linear mapping from fossil ratio to carbon intensity
    // This is NOT accurate - replace with WattTime/Electricity Maps data
    if (snapshot.fossilRatio !== null) {
      return 50 + snapshot.fossilRatio * 450 // 50 gCO2/kWh (0% fossil) to 500 gCO2/kWh (100% fossil)
    }

    return null
  }

  /**
   * Calculate leakage score (0-1)
   */
  private static calculateLeakageScore(
    importVolume: number,
    neighborCarbonIntensity: number | null,
    localCarbonIntensity: number | null
  ): number {
    if (neighborCarbonIntensity === null || localCarbonIntensity === null) {
      return 0
    }

    let score = 0

    // Base score from import volume
    score += Math.min(importVolume / 1000, 0.5) // Max 0.5 from volume

    // Carbon differential score
    const differential = neighborCarbonIntensity - localCarbonIntensity
    if (differential > 0) {
      score += Math.min(differential / 500, 0.4) // Max 0.4 from differential
    }

    // Heavy import dependency penalty
    if (importVolume > 500) { // >500MW
      score += 0.1
    }

    return Math.min(1, score)
  }

  /**
   * Determine confidence in leakage calculation
   */
  private static determineConfidence(
    snapshot: GridSignalSnapshot,
    neighborCarbonIntensity: number | null,
    localCarbonIntensity: number | null
  ): 'high' | 'medium' | 'low' {
    if (snapshot.signalQuality === 'high' &&
        neighborCarbonIntensity !== null &&
        localCarbonIntensity !== null &&
        snapshot.netInterchangeMwh !== null &&
        Math.abs(snapshot.netInterchangeMwh) > 100) {
      return 'high'
    }

    if (snapshot.signalQuality === 'medium' ||
        (neighborCarbonIntensity !== null && localCarbonIntensity !== null)) {
      return 'medium'
    }

    return 'low'
  }

  /**
   * Get top import carbon leakages
   */
  static getTopImportLeakages(
    leakages: ImportCarbonLeakage[],
    limit: number = 5
  ): ImportCarbonLeakage[] {
    return leakages
      .sort((a, b) => {
        // Sort by combined score of leakage score and volume
        const aScore = a.leakageScore * a.importVolumeMwh
        const bScore = b.leakageScore * b.importVolumeMwh
        return bScore - aScore
      })
      .slice(0, limit)
  }

  /**
   * Group leakages by region
   */
  static groupByRegion(leakages: ImportCarbonLeakage[]): Record<string, ImportCarbonLeakage[]> {
    return leakages.reduce((groups, leakage) => {
      const key = leakage.region
      if (!groups[key]) {
        groups[key] = []
      }
      groups[key].push(leakage)
      return groups
    }, {} as Record<string, ImportCarbonLeakage[]>)
  }

  /**
   * Calculate aggregate leakage metrics for a region
   */
  static calculateRegionLeakageSummary(leakages: ImportCarbonLeakage[]): {
    totalImportVolumeMwh: number
    averageLeakageScore: number
    maxLeakageScore: number
    highRiskPeriods: number
    totalPeriods: number
  } {
    if (leakages.length === 0) {
      return {
        totalImportVolumeMwh: 0,
        averageLeakageScore: 0,
        maxLeakageScore: 0,
        highRiskPeriods: 0,
        totalPeriods: 0
      }
    }

    const totalImportVolume = leakages.reduce((sum, l) => sum + l.importVolumeMwh, 0)
    const averageLeakageScore = leakages.reduce((sum, l) => sum + l.leakageScore, 0) / leakages.length
    const maxLeakageScore = Math.max(...leakages.map(l => l.leakageScore))
    const highRiskPeriods = leakages.filter(l => l.leakageScore > 0.7).length

    return {
      totalImportVolumeMwh: totalImportVolume,
      averageLeakageScore,
      maxLeakageScore,
      highRiskPeriods,
      totalPeriods: leakages.length
    }
  }

  /**
   * Detect increasing import dependency trends
   */
  static detectImportTrends(
    snapshots: GridSignalSnapshot[],
    windowHours: number = 24
  ): {
    region: string
    trend: 'increasing' | 'decreasing' | 'stable'
    trendStrength: number
    averageImportVolume: number
  }[] {
    const sortedSnapshots = [...snapshots].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    const regionTrends: Record<string, {
      volumes: number[]
      timestamps: string[]
    }> = {}

    // Group by region and collect import volumes
    for (const snapshot of sortedSnapshots) {
      if (!regionTrends[snapshot.region]) {
        regionTrends[snapshot.region] = { volumes: [], timestamps: [] }
      }
      
      const importVolume = snapshot.netInterchangeMwh ?? 0
      if (importVolume > 0) { // Only imports
        regionTrends[snapshot.region].volumes.push(importVolume)
        regionTrends[snapshot.region].timestamps.push(snapshot.timestamp)
      }
    }

    // Calculate trends for each region — skip regions with no actual imports
    return Object.entries(regionTrends)
      .filter(([, data]) => data.volumes.length > 0)
      .map(([region, data]) => {
        const trend = this.calculateLinearTrend(data.volumes)
        const averageImportVolume = data.volumes.reduce((sum, v) => sum + v, 0) / data.volumes.length

        return {
          region,
          trend: trend.slope > 0.1 ? 'increasing' : trend.slope < -0.1 ? 'decreasing' : 'stable',
          trendStrength: Math.abs(trend.slope),
          averageImportVolume
        }
      })
  }

  /**
   * Simple linear trend calculation
   */
  private static calculateLinearTrend(values: number[]): { slope: number; intercept: number } {
    const n = values.length
    if (n < 2) return { slope: 0, intercept: values[0] || 0 }

    const x = Array.from({ length: n }, (_, i) => i)
    const xSum = x.reduce((sum, val) => sum + val, 0)
    const ySum = values.reduce((sum, val) => sum + val, 0)
    const xySum = x.reduce((sum, val, i) => sum + val * values[i], 0)
    const x2Sum = x.reduce((sum, val) => sum + val * val, 0)

    const slope = (n * xySum - xSum * ySum) / (n * x2Sum - xSum * xSum)
    const intercept = (ySum - slope * xSum) / n

    return { slope, intercept }
  }
}
