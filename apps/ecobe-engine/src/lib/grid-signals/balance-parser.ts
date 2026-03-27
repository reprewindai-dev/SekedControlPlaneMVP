import { EIABalanceData, GridSignalSnapshot } from './types'

export class BalanceParser {
  /**
   * Parse EIA-930 BALANCE data into demand and generation metrics
   */
  static parseBalanceData(
    rawData: EIABalanceData[],
    region: string,
    balancingAuthority: string | null
  ): GridSignalSnapshot[] {
    // Group by period and type
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

  private static groupByPeriod(data: EIABalanceData[]): Record<string, EIABalanceData[]> {
    const grouped: Record<string, EIABalanceData[]> = {}
    
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
    records: EIABalanceData[],
    region: string,
    balancingAuthority: string | null
  ): GridSignalSnapshot | null {
    const demandRecord = records.find(r => r.type === 'D')
    const netGenRecord = records.find(r => r.type === 'NG')
    const interchangeRecord = records.find(r => r.type === 'TI')

    if (!demandRecord || !netGenRecord) {
      return null // Require demand and net generation at minimum
    }

    const demandMwh = demandRecord.value
    const netGenerationMwh = netGenRecord.value
    const netInterchangeMwh = interchangeRecord?.value ?? null

    // Calculate demand change (need previous period for accurate calculation)
    const demandChangeMwh = null // Will be calculated in post-processing
    const demandChangePct = null

    return {
      region,
      balancingAuthority,
      timestamp: period,
      demandMwh,
      demandChangeMwh,
      demandChangePct,
      netGenerationMwh,
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
        dataTypes: records.map(r => r.type),
        respondent: demandRecord.respondent,
        respondentName: demandRecord['respondent-name']
      }
    }
  }

  /**
   * Calculate demand changes between consecutive snapshots
   */
  static calculateDemandChanges(snapshots: GridSignalSnapshot[]): GridSignalSnapshot[] {
    const sortedSnapshots = [...snapshots].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    for (let i = 1; i < sortedSnapshots.length; i++) {
      const current = sortedSnapshots[i]
      const previous = sortedSnapshots[i - 1]

      if (current.demandMwh && previous.demandMwh && previous.demandMwh > 0) {
        const change = current.demandMwh - previous.demandMwh
        current.demandChangeMwh = change
        current.demandChangePct = (change / previous.demandMwh) * 100
      }
    }

    return sortedSnapshots
  }
}
