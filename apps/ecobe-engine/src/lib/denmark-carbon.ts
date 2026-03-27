import axios from 'axios'
import { recordIntegrationFailure, recordIntegrationSuccess } from './integration-metrics'

/**
 * Denmark Carbon Intensity — Energi Data Service
 *
 * Source: https://www.energidataservice.dk
 * Coverage: Denmark (DK1 West / DK2 East)
 * Auth: NONE required (fully open API)
 * Cadence: 5-min to hourly depending on dataset
 * Forecast: CO2 forecast (co2emisprog) + realtime (co2emis)
 * Cost: $0
 */

export interface DKCarbonData {
  zone: 'DK1' | 'DK2'
  carbonIntensity: number  // gCO2/kWh
  timestamp: string
  isForecast: boolean
}

const BASE_URL = 'https://api.energidataservice.dk/dataset'

export class DenmarkCarbonClient {
  private async logSuccess() {
    try { await recordIntegrationSuccess('DK_CARBON' as any) } catch { /* ignore */ }
  }

  private async logFailure(message: string) {
    try { await recordIntegrationFailure('DK_CARBON' as any, message) } catch { /* ignore */ }
  }

  /**
   * Get realtime CO2 emissions intensity (co2emis dataset)
   * Returns most recent data points for DK1 and DK2
   */
  async getCurrentIntensity(zone?: 'DK1' | 'DK2'): Promise<DKCarbonData[]> {
    try {
      const filter = zone ? `{"PriceArea":"${zone}"}` : '{}'
      const response = await axios.get<{ records: any[] }>(`${BASE_URL}/CO2Emis`, {
        params: {
          limit: zone ? 1 : 2,
          sort: 'Minutes5UTC desc',
          filter,
        },
        timeout: 10000,
      })

      const records = response.data?.records || []
      await this.logSuccess()

      return records.map((r: any) => ({
        zone: r.PriceArea as 'DK1' | 'DK2',
        carbonIntensity: r.CO2Emission, // gCO2/kWh
        timestamp: r.Minutes5UTC,
        isForecast: false,
      }))
    } catch (error: any) {
      console.error('Denmark CO2 realtime fetch failed:', error.message)
      await this.logFailure(error.message)
      return []
    }
  }

  /**
   * Get CO2 emission forecast (co2emisprog dataset)
   * Based on day-ahead trade; uses last year's emissions per kWh
   * Typical deviation <10 gCO2/kWh per Energinet docs
   */
  async getForecast(zone?: 'DK1' | 'DK2', hoursAhead: number = 48): Promise<DKCarbonData[]> {
    try {
      const now = new Date()
      const end = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000)
      const filter = zone ? `{"PriceArea":"${zone}"}` : '{}'

      const response = await axios.get<{ records: any[] }>(`${BASE_URL}/CO2EmisProg`, {
        params: {
          start: now.toISOString().slice(0, 19),
          end: end.toISOString().slice(0, 19),
          filter,
          sort: 'Minutes5UTC asc',
          limit: 1000,
        },
        timeout: 15000,
      })

      const records = response.data?.records || []
      await this.logSuccess()

      return records.map((r: any) => ({
        zone: r.PriceArea as 'DK1' | 'DK2',
        carbonIntensity: r.CO2Emission, // gCO2/kWh
        timestamp: r.Minutes5UTC,
        isForecast: true,
      }))
    } catch (error: any) {
      console.error('Denmark CO2 forecast fetch failed:', error.message)
      await this.logFailure(error.message)
      return []
    }
  }
}

export const denmarkCarbon = new DenmarkCarbonClient()
