import axios from 'axios'
import { env } from '../config/env'
import { recordIntegrationFailure, recordIntegrationSuccess } from './integration-metrics'
import { electricityMapsResilience } from './resilience'

interface LatestCarbonIntensityResponse {
  zone: string
  carbonIntensity: number
  datetime: string
  fossilFuelPercentage?: number
  renewablePercentage?: number
}

interface HistoryPoint {
  zone: string
  carbonIntensity: number
  datetime: string
  fossilFuelPercentage?: number
  renewablePercentage?: number
}

interface HistoryResponse {
  history: HistoryPoint[]
}

interface ForecastPoint {
  zone: string
  carbonIntensity: number
  datetime: string
}

interface ForecastResponse {
  forecast: ForecastPoint[]
}

export interface CarbonIntensityData {
  zone: string
  carbonIntensity: number  // gCO2eq/kWh
  datetime: string
  fossilFuelPercentage?: number
  renewablePercentage?: number
}

export class ElectricityMapsClient {
  private baseUrl: string
  private apiKey?: string

  constructor() {
    this.baseUrl = env.ELECTRICITY_MAPS_BASE_URL
    this.apiKey = env.ELECTRICITY_MAPS_API_KEY
  }

  private async logSuccess() {
    try {
      await recordIntegrationSuccess('ELECTRICITY_MAPS')
    } catch (error) {
      console.warn('Failed to record Electricity Maps success metric:', error)
    }
  }

  private async logFailure(message: string) {
    try {
      await recordIntegrationFailure('ELECTRICITY_MAPS', message)
    } catch (error) {
      console.warn('Failed to record Electricity Maps failure metric:', error)
    }
  }

  async getCarbonIntensity(zone: string): Promise<CarbonIntensityData | null> {
    if (!this.apiKey) {
      // No fake data — return null so the router correctly falls through to WattTime
      await this.logFailure('Missing Electricity Maps API key')
      return null
    }

    try {
      const response = await electricityMapsResilience.execute('getCarbonIntensity', () =>
        axios.get<LatestCarbonIntensityResponse>(`${this.baseUrl}/v3/carbon-intensity/latest`, {
          params: { zone },
          headers: { 'auth-token': this.apiKey },
          timeout: 8000,
        })
      )

      const result = {
        zone: response.data.zone,
        carbonIntensity: response.data.carbonIntensity,
        datetime: response.data.datetime,
        fossilFuelPercentage: response.data.fossilFuelPercentage,
        renewablePercentage: response.data.renewablePercentage,
      }
      await this.logSuccess()
      return result
    } catch (error: any) {
      console.error(`Failed to fetch carbon intensity for ${zone}:`, error.message)
      await this.logFailure(error.message ?? 'Unknown Electricity Maps error')
      return null
    }
  }

  async getCarbonIntensityHistory(
    zone: string,
    start: Date,
    end: Date
  ): Promise<CarbonIntensityData[]> {
    if (!this.apiKey) {
      await this.logFailure('Missing Electricity Maps API key')
      return []
    }

    try {
      const response = await electricityMapsResilience.execute('getCarbonIntensityHistory', () =>
        axios.get<HistoryResponse>(`${this.baseUrl}/v3/carbon-intensity/history`, {
          params: {
            zone,
            start: start.toISOString(),
            end: end.toISOString(),
          },
          headers: { 'auth-token': this.apiKey },
          timeout: 8000,
        })
      )

      const history = response.data.history.map((item) => ({
        zone: item.zone,
        carbonIntensity: item.carbonIntensity,
        datetime: item.datetime,
        fossilFuelPercentage: item.fossilFuelPercentage,
        renewablePercentage: item.renewablePercentage,
      }))
      await this.logSuccess()
      return history
    } catch (error: any) {
      console.error(`Failed to fetch carbon history for ${zone}:`, error.message)
      await this.logFailure(error.message ?? 'Unknown Electricity Maps history error')
      return []
    }
  }

  async getForecast(zone: string): Promise<CarbonIntensityData[]> {
    if (!this.apiKey) {
      await this.logFailure('Missing Electricity Maps API key')
      return []
    }

    try {
      const response = await electricityMapsResilience.execute('getForecast', () =>
        axios.get<ForecastResponse>(`${this.baseUrl}/v3/carbon-intensity/forecast`, {
          params: { zone },
          headers: { 'auth-token': this.apiKey },
          timeout: 8000,
        })
      )

      const forecast = response.data.forecast.map((item) => ({
        zone: item.zone,
        carbonIntensity: item.carbonIntensity,
        datetime: item.datetime,
      }))
      await this.logSuccess()
      return forecast
    } catch (error: any) {
      console.error(`Failed to fetch forecast for ${zone}:`, error.message)
      await this.logFailure(error.message ?? 'Unknown Electricity Maps forecast error')
      return []
    }
  }
}

export const electricityMaps = new ElectricityMapsClient()
