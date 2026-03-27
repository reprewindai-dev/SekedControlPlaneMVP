export interface GridSignalSnapshot {
  region: string
  balancingAuthority: string | null
  timestamp: string
  demandMwh: number | null
  demandChangeMwh: number | null
  demandChangePct: number | null
  netGenerationMwh: number | null
  netInterchangeMwh: number | null
  renewableRatio: number | null
  fossilRatio: number | null
  carbonSpikeProbability: number | null
  curtailmentProbability: number | null
  importCarbonLeakageScore: number | null
  signalQuality: 'high' | 'medium' | 'low'
  estimatedFlag: boolean
  syntheticFlag: boolean
  source: 'eia930'
  metadata: Record<string, unknown>
}

export interface EIABalanceData {
  period: string
  respondent: string
  'respondent-name': string
  type: string
  value: number
  'value-units': string
}

export interface EIAInterchangeData {
  period: string
  'from-ba': string
  'from-ba-name': string
  'to-ba': string
  'to-ba-name': string
  type: string
  value: number
  'value-units': string
}

export interface EIASubregionData {
  period: string
  respondent: string
  'respondent-name': string
  parent: string
  'parent-name': string
  subregion: string
  'subregion-name': string
  type: string
  value: number
  'value-units': string
}

/**
 * GridStatus.io fuel mix hourly data — real per-fuel-type generation in MW
 * Replaces heuristic subregion name matching with measured fuel breakdown
 */
export interface GridStatusFuelMixData {
  interval_start_utc: string
  interval_end_utc: string
  respondent: string
  respondent_name: string
  coal: number | null
  hydro: number | null
  natural_gas: number | null
  nuclear: number | null
  other: number | null
  petroleum: number | null
  solar: number | null
  wind: number | null
  battery_storage: number | null
  pumped_storage: number | null
  solar_with_integrated_battery_storage: number | null
  unknown_energy_storage: number | null
  geothermal: number | null
  other_energy_storage: number | null
  wind_with_integrated_battery_storage: number | null
}

export interface GridFeatures {
  demandRampPct: number | null
  fossilRatio: number | null
  renewableRatio: number | null
  carbonSpikeProbability: number | null
  curtailmentProbability: number | null
  importCarbonLeakageScore: number | null
}
