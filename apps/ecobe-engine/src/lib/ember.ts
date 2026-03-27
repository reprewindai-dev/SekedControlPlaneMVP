import axios from 'axios'
import { env } from '../config/env'
import { recordIntegrationFailure, recordIntegrationSuccess } from './integration-metrics'
import { emberResilience } from './resilience'

export interface EmberCarbonIntensityData {
  entity: string
  entity_code: string
  is_aggregate_entity: boolean
  date: string
  emissions_intensity_gco2_per_kwh: number
}

export interface EmberDemandData {
  entity: string
  entity_code: string
  is_aggregate_entity: boolean
  date: string
  demand_twh: number
  demand_mwh_per_capita?: number
}

export interface EmberGenerationData {
  entity: string
  entity_code: string
  is_aggregate_entity: boolean
  date: string
  series: string
  is_aggregate_series: boolean
  generation_twh: number
  share_of_generation_pct: number
}

export interface EmberCapacityData {
  entity: string
  entity_code: string
  is_aggregate_entity: boolean
  date: string
  series: string
  is_aggregate_series: boolean
  capacity_gw: number
  capacity_w_per_capita?: number
}

export interface RegionStructuralProfile {
  region: string
  entityCode: string | null
  structuralCarbonBaseline: number | null
  carbonTrendDirection: 'up' | 'down' | 'flat' | null
  demandTrendTwh: number | null
  demandPerCapita: number | null
  fossilDependenceScore: number | null
  renewableDependenceScore: number | null
  generationMixProfile: Record<string, number> | null
  windCapacityGw: number | null
  solarCapacityGw: number | null
  windCapacityTrend: number | null
  solarCapacityTrend: number | null
  confidenceRole: 'validation' | 'historical_context'
  source: 'ember'
  updatedAt: string
}

export class EmberClient {
  private baseUrl: string
  private apiKey?: string

  constructor() {
    this.baseUrl = env.EMBER_BASE_URL
    this.apiKey = env.EMBER_API_KEY
  }

  private async logSuccess() {
    try {
      await recordIntegrationSuccess('EMBER')
    } catch (error) {
      console.warn('Failed to record Ember success metric:', error)
    }
  }

  private async logFailure(message: string) {
    try {
      await recordIntegrationFailure('EMBER', message)
    } catch (error) {
      console.warn('Failed to record Ember failure metric:', error)
    }
  }

  private getHeaders() {
    // Ember uses query param auth, not headers — kept for future use
    return {}
  }

  /**
   * Ember authenticates via api_key query parameter (not header)
   */
  private getAuthParams(): Record<string, string> {
    if (!this.apiKey) return {}
    return { api_key: this.apiKey }
  }

  async getCarbonIntensityMonthly(entityCode: string, startDate?: string, endDate?: string): Promise<EmberCarbonIntensityData[]> {
    if (!this.apiKey) {
      await this.logFailure('Missing Ember API key')
      return []
    }

    try {
      const params: any = {
        entity_code: entityCode,
        temporal_resolution: 'monthly',
      }
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate

      const response = await emberResilience.execute('getCarbonIntensityMonthly', () =>
        axios.get<{ data: EmberCarbonIntensityData[] }>(
          `${this.baseUrl}/v1/carbon-intensity/monthly`,
          {
            params: { ...params, ...this.getAuthParams() },
            headers: this.getHeaders(),
            timeout: 15000,
          }
        )
      )

      await this.logSuccess()
      return response.data.data || []
    } catch (error: any) {
      console.error(`Failed to fetch Ember monthly carbon intensity for ${entityCode}:`, error.message)
      await this.logFailure(error.message ?? 'Failed to fetch carbon intensity')
      return []
    }
  }

  async getCarbonIntensityYearly(entityCode: string, startDate?: string, endDate?: string): Promise<EmberCarbonIntensityData[]> {
    if (!this.apiKey) {
      await this.logFailure('Missing Ember API key')
      return []
    }

    try {
      const params: any = {
        entity_code: entityCode,
        temporal_resolution: 'yearly',
      }
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate

      const response = await emberResilience.execute('getCarbonIntensityYearly', () =>
        axios.get<{ data: EmberCarbonIntensityData[] }>(
          `${this.baseUrl}/v1/carbon-intensity/yearly`,
          {
            params: { ...params, ...this.getAuthParams() },
            headers: this.getHeaders(),
            timeout: 15000,
          }
        )
      )

      await this.logSuccess()
      return response.data.data || []
    } catch (error: any) {
      console.error(`Failed to fetch Ember yearly carbon intensity for ${entityCode}:`, error.message)
      await this.logFailure(error.message ?? 'Failed to fetch carbon intensity')
      return []
    }
  }

  async getElectricityDemand(entityCode: string, resolution: 'monthly' | 'yearly' = 'yearly', startDate?: string, endDate?: string): Promise<EmberDemandData[]> {
    if (!this.apiKey) {
      await this.logFailure('Missing Ember API key')
      return []
    }

    try {
      const params: any = {
        entity_code: entityCode,
      }
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate

      const response = await emberResilience.execute('getElectricityDemand', () =>
        axios.get<{ data: EmberDemandData[] }>(
          `${this.baseUrl}/v1/electricity-demand/${resolution}`,
          {
            params: { ...params, ...this.getAuthParams() },
            headers: this.getHeaders(),
            timeout: 15000,
          }
        )
      )

      await this.logSuccess()
      return response.data.data || []
    } catch (error: any) {
      console.error(`Failed to fetch Ember electricity demand for ${entityCode}:`, error.message)
      await this.logFailure(error.message ?? 'Failed to fetch electricity demand')
      return []
    }
  }

  async getElectricityGeneration(entityCode: string, resolution: 'monthly' | 'yearly' = 'yearly', startDate?: string, endDate?: string): Promise<EmberGenerationData[]> {
    if (!this.apiKey) {
      await this.logFailure('Missing Ember API key')
      return []
    }

    try {
      const params: any = {
        entity_code: entityCode,
      }
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate

      const response = await emberResilience.execute('getElectricityGeneration', () =>
        axios.get<{ data: EmberGenerationData[] }>(
          `${this.baseUrl}/v1/electricity-generation/${resolution}`,
          {
            params: { ...params, ...this.getAuthParams() },
            headers: this.getHeaders(),
            timeout: 15000,
          }
        )
      )

      await this.logSuccess()
      return response.data.data || []
    } catch (error: any) {
      console.error(`Failed to fetch Ember electricity generation for ${entityCode}:`, error.message)
      await this.logFailure(error.message ?? 'Failed to fetch electricity generation')
      return []
    }
  }

  async getInstalledCapacity(entityCode: string, resolution: 'monthly' | 'yearly' = 'monthly', startDate?: string, endDate?: string): Promise<EmberCapacityData[]> {
    if (!this.apiKey) {
      await this.logFailure('Missing Ember API key')
      return []
    }

    try {
      const params: any = {
        entity_code: entityCode,
      }
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate

      const response = await emberResilience.execute('getInstalledCapacity', () =>
        axios.get<{ data: EmberCapacityData[] }>(
          `${this.baseUrl}/v1/installed-capacity/${resolution}`,
          {
            params: { ...params, ...this.getAuthParams() },
            headers: this.getHeaders(),
            timeout: 15000,
          }
        )
      )

      await this.logSuccess()
      return response.data.data || []
    } catch (error: any) {
      console.error(`Failed to fetch Ember installed capacity for ${entityCode}:`, error.message)
      await this.logFailure(error.message ?? 'Failed to fetch installed capacity')
      return []
    }
  }

  async deriveStructuralProfile(region: string, entityCode?: string): Promise<RegionStructuralProfile> {
    // Default entityCode to region if not provided (e.g. 'USA')
    const code = entityCode ?? region

    const [
      carbonIntensityMonthly,
      carbonIntensityYearly,
      demandYearly,
      generationYearly,
      capacity,
    ] = await Promise.all([
      this.getCarbonIntensityMonthly(code),
      this.getCarbonIntensityYearly(code),
      this.getElectricityDemand(code, 'yearly'),
      this.getElectricityGeneration(code, 'yearly'),
      this.getInstalledCapacity(code, 'monthly'),
    ])

    // Calculate structural baseline (average of last 12 months)
    const recentCarbon = carbonIntensityMonthly.slice(-12)
    const structuralCarbonBaseline = recentCarbon.length > 0
      ? recentCarbon.reduce((sum, d) => sum + d.emissions_intensity_gco2_per_kwh, 0) / recentCarbon.length
      : null

    // Calculate carbon trend (year-over-year)
    let carbonTrendDirection: 'up' | 'down' | 'flat' | null = null
    if (carbonIntensityYearly.length >= 2) {
      const recent = carbonIntensityYearly[carbonIntensityYearly.length - 1].emissions_intensity_gco2_per_kwh
      const previous = carbonIntensityYearly[carbonIntensityYearly.length - 2].emissions_intensity_gco2_per_kwh
      const change = (recent - previous) / previous
      carbonTrendDirection = change > 0.05 ? 'up' : change < -0.05 ? 'down' : 'flat'
    }

    // Calculate demand metrics
    const latestDemand = demandYearly.length > 0 ? demandYearly[demandYearly.length - 1] : null
    const demandTrendTwh = latestDemand?.demand_twh ?? null
    const demandPerCapita = latestDemand?.demand_mwh_per_capita ?? null

    // Calculate generation mix from most recent year
    const latestYear = demandYearly.length > 0 ? demandYearly[demandYearly.length - 1].date : null
    const latestGeneration = latestYear
      ? generationYearly.filter(g => g.date === latestYear && !g.is_aggregate_series)
      : []
    const generationMixProfile: Record<string, number> = {}
    let totalGeneration = 0

    for (const gen of latestGeneration) {
      if (gen.series && gen.generation_twh) {
        generationMixProfile[gen.series] = gen.generation_twh
        totalGeneration += gen.generation_twh
      }
    }

    // Calculate fossil/renewable dependence
    const fossilTypes = ['coal', 'gas', 'oil', 'fossil']
    const renewableTypes = ['wind', 'solar', 'hydro', 'nuclear', 'bioenergy', 'geothermal']

    let fossilGeneration = 0
    let renewableGeneration = 0

    for (const [type, value] of Object.entries(generationMixProfile)) {
      const lower = type.toLowerCase()
      if (fossilTypes.some(f => lower.includes(f))) fossilGeneration += value
      if (renewableTypes.some(r => lower.includes(r))) renewableGeneration += value
    }

    const fossilDependenceScore = totalGeneration > 0 ? fossilGeneration / totalGeneration : null
    const renewableDependenceScore = totalGeneration > 0 ? renewableGeneration / totalGeneration : null

    // Calculate capacity metrics (Ember returns capacity_gw directly)
    const windCapacity = capacity.filter(c => c.series?.toLowerCase().includes('wind'))
    const solarCapacity = capacity.filter(c => c.series?.toLowerCase().includes('solar'))

    const latestWindCapacity = windCapacity.length > 0 ? windCapacity[windCapacity.length - 1] : null
    const latestSolarCapacity = solarCapacity.length > 0 ? solarCapacity[solarCapacity.length - 1] : null

    const windCapacityGw = latestWindCapacity?.capacity_gw ?? null
    const solarCapacityGw = latestSolarCapacity?.capacity_gw ?? null

    // Calculate capacity trends (YoY growth rate)
    let windCapacityTrend: number | null = null
    let solarCapacityTrend: number | null = null

    if (windCapacity.length >= 13) {
      const recent = windCapacity[windCapacity.length - 1].capacity_gw
      const yearAgo = windCapacity[windCapacity.length - 13]?.capacity_gw
      if (yearAgo && yearAgo > 0) windCapacityTrend = (recent - yearAgo) / yearAgo
    }

    if (solarCapacity.length >= 13) {
      const recent = solarCapacity[solarCapacity.length - 1].capacity_gw
      const yearAgo = solarCapacity[solarCapacity.length - 13]?.capacity_gw
      if (yearAgo && yearAgo > 0) solarCapacityTrend = (recent - yearAgo) / yearAgo
    }

    return {
      region,
      entityCode: code,
      structuralCarbonBaseline,
      carbonTrendDirection,
      demandTrendTwh,
      demandPerCapita,
      fossilDependenceScore,
      renewableDependenceScore,
      generationMixProfile: Object.keys(generationMixProfile).length > 0 ? generationMixProfile : null,
      windCapacityGw,
      solarCapacityGw,
      windCapacityTrend,
      solarCapacityTrend,
      confidenceRole: 'validation',
      source: 'ember',
      updatedAt: new Date().toISOString(),
    }
  }
}

export const ember = new EmberClient()
