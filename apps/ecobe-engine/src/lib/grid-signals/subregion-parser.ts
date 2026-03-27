import { EIASubregionData, GridSignalSnapshot } from './types'

export class SubregionParser {
  /**
   * Parse EIA-930 SUBREGION data to calculate fuel mix ratios
   */
  static parseSubregionData(
    rawData: EIASubregionData[],
    region: string,
    balancingAuthority: string | null
  ): GridSignalSnapshot[] {
    // Group by period and aggregate across subregions
    const groupedByPeriod = this.groupByPeriod(rawData)
    const snapshots: GridSignalSnapshot[] = []

    for (const [period, records] of Object.entries(groupedByPeriod)) {
      const snapshot = this.buildSnapshot(period, records, region, balancingAuthority)
      if (snapshot) {
        snapshots.push(snapshot)
      }
    }

    return snapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  private static groupByPeriod(data: EIASubregionData[]): Record<string, EIASubregionData[]> {
    const grouped: Record<string, EIASubregionData[]> = {}
    
    for (const record of data) {
      if (!grouped[record.period]) {
        grouped[record.period] = []
      }
      grouped[record.period].push(record)
    }

    return grouped
  }

  private static buildSnapshot(
    period: string,
    records: EIASubregionData[],
    region: string,
    balancingAuthority: string | null
  ): GridSignalSnapshot | null {
    // Aggregate demand and net generation across all subregions
    const demandRecords = records.filter(r => r.type === 'D')
    const netGenRecords = records.filter(r => r.type === 'NG')

    if (demandRecords.length === 0 || netGenRecords.length === 0) {
      return null
    }

    const totalDemand = demandRecords.reduce((sum, r) => sum + r.value, 0)
    const totalNetGen = netGenRecords.reduce((sum, r) => sum + r.value, 0)

    // Calculate fuel mix ratios from subregion names
    const fuelMix = this.calculateFuelMix(records, totalNetGen)

    return {
      region,
      balancingAuthority,
      timestamp: period,
      demandMwh: totalDemand,
      demandChangeMwh: null, // Will be calculated in post-processing
      demandChangePct: null,
      netGenerationMwh: totalNetGen,
      netInterchangeMwh: null, // Will come from interchange data
      renewableRatio: fuelMix.renewableRatio,
      fossilRatio: fuelMix.fossilRatio,
      carbonSpikeProbability: null, // Will be calculated in feature engine
      curtailmentProbability: null, // Will be calculated in feature engine
      importCarbonLeakageScore: null, // Will be calculated in feature engine
      signalQuality: 'high', // EIA-930 is typically high quality measured data
      estimatedFlag: false,
      syntheticFlag: false,
      source: 'eia930',
      metadata: {
        rawRecords: records,
        subregionCount: records.length,
        fuelMixBreakdown: fuelMix.breakdown,
        subregions: [...new Set(records.map(r => r.subregion))]
      }
    }
  }

  /**
   * Calculate fuel mix ratios from subregion data
   * Note: This is a simplified approach. In production, you'd want actual fuel type data
   */
  private static calculateFuelMix(
    records: EIASubregionData[],
    totalNetGen: number
  ): {
    renewableRatio: number | null
    fossilRatio: number | null
    breakdown: Record<string, number>
  } {
    if (totalNetGen <= 0) {
      return {
        renewableRatio: null,
        fossilRatio: null,
        breakdown: {}
      }
    }

    const breakdown: Record<string, number> = {}
    
    // Aggregate generation by subregion (simplified fuel classification)
    for (const record of records) {
      if (record.type === 'NG') { // Net Generation
        const subregion = record.subregion.toLowerCase()
        let fuelType = 'other'
        
        // Simple heuristic based on common subregion naming patterns
        if (subregion.includes('wind') || subregion.includes('solar') || subregion.includes('hydro')) {
          fuelType = 'renewable'
        } else if (subregion.includes('gas') || subregion.includes('coal') || subregion.includes('oil')) {
          fuelType = 'fossil'
        } else if (subregion.includes('nuclear')) {
          fuelType = 'nuclear'
        }
        
        breakdown[fuelType] = (breakdown[fuelType] || 0) + record.value
      }
    }

    const renewable = breakdown.renewable || 0
    const fossil = breakdown.fossil || 0
    const totalClassified = renewable + fossil

    return {
      renewableRatio: totalClassified > 0 ? renewable / totalClassified : null,
      fossilRatio: totalClassified > 0 ? fossil / totalClassified : null,
      breakdown
    }
  }

  /**
   * Merge subregion data into existing snapshots
   */
  static mergeIntoSnapshots(
    baseSnapshots: GridSignalSnapshot[],
    subregionSnapshots: GridSignalSnapshot[]
  ): GridSignalSnapshot[] {
    const subregionMap = new Map(
      subregionSnapshots.map(s => [s.timestamp, s])
    )

    return baseSnapshots.map(snapshot => {
      const subregionData = subregionMap.get(snapshot.timestamp)
      if (subregionData) {
        return {
          ...snapshot,
          renewableRatio: subregionData.renewableRatio,
          fossilRatio: subregionData.fossilRatio,
          metadata: {
            ...snapshot.metadata,
            ...subregionData.metadata
          }
        }
      }
      return snapshot
    })
  }
}
