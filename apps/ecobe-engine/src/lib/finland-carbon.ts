import axios from 'axios'
import { recordIntegrationFailure, recordIntegrationSuccess } from './integration-metrics'

/**
 * Finland Carbon Intensity — Fingrid Open Data
 *
 * Source: https://data.fingrid.fi/api
 * Coverage: Finland (national)
 * Auth: API key via x-api-key header (free registration)
 * Cadence: Every 3 minutes
 * Cost: $0
 *
 * Dataset IDs:
 *   265 = Emission factor of electricity consumed in Finland (gCO2/kWh) — includes imports/exports
 *   266 = Emission factor of electricity produced in Finland (gCO2/kWh) — production only
 */

export interface FICarbonData {
  zone: 'FI'
  carbonIntensity: number  // gCO2/kWh
  timestamp: string
  isForecast: boolean
  method: 'consumed' | 'produced'
}

const BASE_URL = 'https://data.fingrid.fi/api'

// Dataset 265 = consumed (includes imports), 266 = produced
const CONSUMED_DATASET_ID = 265
const PRODUCED_DATASET_ID = 266

export class FinlandCarbonClient {
  private apiKey?: string

  constructor() {
    this.apiKey = process.env.FINGRID_API_KEY
  }

  private async logSuccess() {
    try { await recordIntegrationSuccess('FI_CARBON' as any) } catch { /* ignore */ }
  }

  private async logFailure(message: string) {
    try { await recordIntegrationFailure('FI_CARBON' as any, message) } catch { /* ignore */ }
  }

  get isAvailable(): boolean {
    return !!this.apiKey
  }

  /**
   * Get current emission factor (consumed in Finland — includes imports/exports)
   */
  async getCurrentIntensity(): Promise<FICarbonData | null> {
    if (!this.apiKey) {
      await this.logFailure('Missing FINGRID_API_KEY')
      return null
    }

    try {
      const now = new Date()
      const start = new Date(now.getTime() - 15 * 60 * 1000) // Last 15 minutes

      const response = await axios.get<{ data: any[] }>(`${BASE_URL}/datasets/${CONSUMED_DATASET_ID}/data`, {
        params: {
          startTime: start.toISOString(),
          endTime: now.toISOString(),
          format: 'json',
          pageSize: 1,
          sortBy: 'startTime',
          sortOrder: 'desc',
        },
        headers: {
          'x-api-key': this.apiKey,
        },
        timeout: 10000,
      })

      const records = response.data?.data || []
      if (records.length === 0) return null

      const latest = records[0]
      await this.logSuccess()

      return {
        zone: 'FI',
        carbonIntensity: latest.value, // gCO2/kWh
        timestamp: latest.startTime,
        isForecast: false,
        method: 'consumed',
      }
    } catch (error: any) {
      console.error('Finland CO2 intensity fetch failed:', error.message)
      await this.logFailure(error.message)
      return null
    }
  }

  /**
   * Get production-based emission factor
   */
  async getProductionIntensity(): Promise<FICarbonData | null> {
    if (!this.apiKey) return null

    try {
      const now = new Date()
      const start = new Date(now.getTime() - 15 * 60 * 1000)

      const response = await axios.get<{ data: any[] }>(`${BASE_URL}/datasets/${PRODUCED_DATASET_ID}/data`, {
        params: {
          startTime: start.toISOString(),
          endTime: now.toISOString(),
          format: 'json',
          pageSize: 1,
          sortBy: 'startTime',
          sortOrder: 'desc',
        },
        headers: {
          'x-api-key': this.apiKey,
        },
        timeout: 10000,
      })

      const records = response.data?.data || []
      if (records.length === 0) return null

      const latest = records[0]
      await this.logSuccess()

      return {
        zone: 'FI',
        carbonIntensity: latest.value,
        timestamp: latest.startTime,
        isForecast: false,
        method: 'produced',
      }
    } catch (error: any) {
      console.error('Finland CO2 production intensity fetch failed:', error.message)
      await this.logFailure(error.message)
      return null
    }
  }
}

export const finlandCarbon = new FinlandCarbonClient()
