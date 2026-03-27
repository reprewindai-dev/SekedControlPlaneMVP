import { EIAInterchangeData, GridSignalSnapshot } from './types'

export class InterchangeParser {
  /**
   * Parse EIA-930 INTERCHANGE data to calculate net interchange flows
   */
  static parseInterchangeData(
    rawData: EIAInterchangeData[],
    region: string,
    balancingAuthority: string | null
  ): GridSignalSnapshot[] {
    // Group by period and calculate net interchange
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

  private static groupByPeriod(data: EIAInterchangeData[]): Record<string, EIAInterchangeData[]> {
    const grouped: Record<string, EIAInterchangeData[]> = {}
    
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
    records: EIAInterchangeData[],
    region: string,
    balancingAuthority: string | null
  ): GridSignalSnapshot | null {
    // Calculate net interchange: exports - imports
    let netInterchangeMwh = 0
    let hasData = false

    for (const record of records) {
      hasData = true
      
      // If this BA is the "from" side, it's exporting (negative for net import)
      if (record['from-ba'] === balancingAuthority) {
        netInterchangeMwh -= record.value
      }
      // If this BA is the "to" side, it's importing (positive for net import)
      else if (record['to-ba'] === balancingAuthority) {
        netInterchangeMwh += record.value
      }
    }

    if (!hasData) {
      return null
    }

    return {
      region,
      balancingAuthority,
      timestamp: period,
      demandMwh: null, // Will come from balance data
      demandChangeMwh: null,
      demandChangePct: null,
      netGenerationMwh: null, // Will come from balance data
      netInterchangeMwh,
      renewableRatio: null, // Will be calculated from subregion data
      fossilRatio: null,    // Will be calculated from subregion data
      carbonSpikeProbability: null, // Will be calculated in feature engine
      curtailmentProbability: null, // Will be calculated in feature engine
      importCarbonLeakageScore: null, // Will be calculated in feature engine
      signalQuality: 'high', // EIA-930 is typically high quality measured data
      estimatedFlag: false,
      syntheticFlag: false,
      source: 'eia930',
      metadata: {
        rawRecords: records,
        interchangeFlows: records.map(r => ({
          from: r['from-ba'],
          fromName: r['from-ba-name'],
          to: r['to-ba'],
          toName: r['to-ba-name'],
          value: r.value,
          type: r.type
        })),
        totalFlows: records.length
      }
    }
  }

  /**
   * Merge interchange data into existing snapshots (from balance parser)
   */
  static mergeIntoSnapshots(
    balanceSnapshots: GridSignalSnapshot[],
    interchangeSnapshots: GridSignalSnapshot[]
  ): GridSignalSnapshot[] {
    const interchangeMap = new Map(
      interchangeSnapshots.map(s => [s.timestamp, s])
    )

    return balanceSnapshots.map(snapshot => {
      const interchangeData = interchangeMap.get(snapshot.timestamp)
      if (interchangeData) {
        return {
          ...snapshot,
          netInterchangeMwh: interchangeData.netInterchangeMwh,
          metadata: {
            ...snapshot.metadata,
            ...interchangeData.metadata
          }
        }
      }
      return snapshot
    })
  }
}
