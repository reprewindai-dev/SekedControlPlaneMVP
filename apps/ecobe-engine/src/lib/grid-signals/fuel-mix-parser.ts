/**
 * Fuel Mix Parser — REAL per-fuel-type generation from GridStatus.io
 *
 * Replaces the heuristic SubregionParser.calculateFuelMix() which guessed
 * fuel types from subregion names. This parser uses actual MW generation
 * values per fuel type returned by GridStatus's eia_fuel_mix_hourly dataset.
 *
 * EMISSION FACTORS (gCO2/kWh) — used for EIA-930 fallback carbon estimation
 * when primary providers (WattTime, Electricity Maps) are unavailable.
 * Sources: IPCC 2014 median lifecycle estimates
 */

import { GridStatusFuelMixData, GridSignalSnapshot } from './types'

// ── Emission factors (gCO2/kWh) for fallback carbon intensity estimation ──
const EMISSION_FACTORS: Record<string, number> = {
  coal: 820,
  natural_gas: 490,
  petroleum: 650,
  nuclear: 12,
  hydro: 24,
  wind: 11,
  solar: 45,
  geothermal: 38,
  battery_storage: 0,        // Storage dispatch, not generation
  pumped_storage: 0,         // Storage dispatch, not generation
  other: 300,                // Conservative estimate for unknown fuels
}

// Renewable fuel types
const RENEWABLE_FUELS = new Set([
  'hydro', 'wind', 'solar', 'geothermal',
  'solar_with_integrated_battery_storage',
  'wind_with_integrated_battery_storage',
])

// Fossil fuel types
const FOSSIL_FUELS = new Set([
  'coal', 'natural_gas', 'petroleum',
])

export class FuelMixParser {
  /**
   * Parse fuel mix data into GridSignalSnapshots with real renewable/fossil ratios
   */
  static parseFuelMixData(
    rawData: GridStatusFuelMixData[],
    region: string,
    balancingAuthority: string | null
  ): GridSignalSnapshot[] {
    const snapshots: GridSignalSnapshot[] = []

    for (const record of rawData) {
      const snapshot = this.buildSnapshot(record, region, balancingAuthority)
      if (snapshot) {
        snapshots.push(snapshot)
      }
    }

    return snapshots.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
  }

  private static buildSnapshot(
    record: GridStatusFuelMixData,
    region: string,
    balancingAuthority: string | null
  ): GridSignalSnapshot | null {
    const fuelBreakdown = this.extractFuelBreakdown(record)
    const totalGeneration = Object.values(fuelBreakdown).reduce((sum, mw) => sum + mw, 0)

    if (totalGeneration <= 0) {
      return null
    }

    // Calculate real ratios from actual generation data
    let renewableMw = 0
    let fossilMw = 0

    for (const [fuel, mw] of Object.entries(fuelBreakdown)) {
      if (RENEWABLE_FUELS.has(fuel)) renewableMw += mw
      if (FOSSIL_FUELS.has(fuel)) fossilMw += mw
    }

    const renewableRatio = renewableMw / totalGeneration
    const fossilRatio = fossilMw / totalGeneration

    return {
      region,
      balancingAuthority,
      timestamp: record.interval_start_utc,
      demandMwh: null,          // Comes from balance/regional data
      demandChangeMwh: null,
      demandChangePct: null,
      netGenerationMwh: totalGeneration,
      netInterchangeMwh: null,  // Comes from interchange data
      renewableRatio,
      fossilRatio,
      carbonSpikeProbability: null,   // Calculated in feature engine
      curtailmentProbability: null,
      importCarbonLeakageScore: null,
      signalQuality: 'high',    // Real measured generation data
      estimatedFlag: false,
      syntheticFlag: false,
      source: 'eia930',
      metadata: {
        fuelMixSource: 'gridstatus_fuel_mix_hourly',
        fuelBreakdownMw: fuelBreakdown,
        totalGenerationMw: totalGeneration,
        renewableMw,
        fossilMw,
        nuclearMw: fuelBreakdown.nuclear || 0,
        respondent: record.respondent,
        respondentName: record.respondent_name,
      }
    }
  }

  /**
   * Extract non-null fuel values from a GridStatus fuel mix record
   */
  private static extractFuelBreakdown(record: GridStatusFuelMixData): Record<string, number> {
    const breakdown: Record<string, number> = {}

    const fuelFields: Array<[keyof GridStatusFuelMixData, string]> = [
      ['coal', 'coal'],
      ['hydro', 'hydro'],
      ['natural_gas', 'natural_gas'],
      ['nuclear', 'nuclear'],
      ['other', 'other'],
      ['petroleum', 'petroleum'],
      ['solar', 'solar'],
      ['wind', 'wind'],
      ['battery_storage', 'battery_storage'],
      ['pumped_storage', 'pumped_storage'],
      ['solar_with_integrated_battery_storage', 'solar_with_integrated_battery_storage'],
      ['unknown_energy_storage', 'unknown_energy_storage'],
      ['geothermal', 'geothermal'],
      ['other_energy_storage', 'other_energy_storage'],
      ['wind_with_integrated_battery_storage', 'wind_with_integrated_battery_storage'],
    ]

    for (const [field, name] of fuelFields) {
      const val = record[field]
      if (typeof val === 'number' && val > 0) {
        breakdown[name] = val
      }
    }

    return breakdown
  }

  /**
   * Estimate carbon intensity from fuel mix — EIA-930 fallback estimation
   * Used ONLY when primary providers (WattTime, Electricity Maps) are unavailable
   *
   * Formula: Σ(fuel_mw × emission_factor) / Σ(fuel_mw) = weighted avg gCO2/kWh
   */
  static estimateCarbonIntensity(record: GridStatusFuelMixData): number | null {
    const breakdown = this.extractFuelBreakdown(record)
    const totalMw = Object.values(breakdown).reduce((sum, mw) => sum + mw, 0)

    if (totalMw <= 0) return null

    let weightedEmissions = 0
    for (const [fuel, mw] of Object.entries(breakdown)) {
      const factor = EMISSION_FACTORS[fuel] ?? EMISSION_FACTORS.other
      weightedEmissions += mw * factor
    }

    return weightedEmissions / totalMw
  }

  /**
   * Merge fuel mix snapshots into existing balance/interchange snapshots
   * Replaces SubregionParser.mergeIntoSnapshots for GridStatus path
   */
  static mergeIntoSnapshots(
    baseSnapshots: GridSignalSnapshot[],
    fuelMixSnapshots: GridSignalSnapshot[]
  ): GridSignalSnapshot[] {
    const fuelMixMap = new Map(
      fuelMixSnapshots.map(s => [s.timestamp, s])
    )

    return baseSnapshots.map(snapshot => {
      const fuelData = fuelMixMap.get(snapshot.timestamp)
      if (fuelData) {
        return {
          ...snapshot,
          renewableRatio: fuelData.renewableRatio,
          fossilRatio: fuelData.fossilRatio,
          metadata: {
            ...snapshot.metadata,
            ...fuelData.metadata,
          }
        }
      }
      return snapshot
    })
  }
}
