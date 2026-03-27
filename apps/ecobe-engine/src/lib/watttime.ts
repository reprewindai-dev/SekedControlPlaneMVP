import axios from 'axios'
import { env } from '../config/env'
import { recordIntegrationFailure, recordIntegrationSuccess } from './integration-metrics'
import { wattTimeResilience } from './resilience'

interface WattTimeAuthResponse {
  token: string
}

interface MOERData {
  ba: string
  moer: number
  percent: number
  point_time: string
  freq: string
}

interface MOERForecastData {
  ba: string
  point_time: string
  value: number
  version: string
}

export interface WattTimeMOER {
  balancingAuthority: string
  moer: number
  moerPercent: number
  timestamp: string
  frequency: string
}

export interface WattTimeForecast {
  balancingAuthority: string
  timestamp: string
  moer: number
  version: string
}

export interface CleanWindow {
  balancingAuthority: string
  startTime: string
  endTime: string
  avgMoer: number
  confidence: number
}

export class WattTimeClient {
  private baseUrl: string
  private username?: string
  private password?: string
  private token?: string
  private tokenExpiry?: Date

  constructor() {
    this.baseUrl = env.WATTTIME_BASE_URL || 'https://api.watttime.org'
    this.username = env.WATTTIME_USERNAME
    this.password = env.WATTTIME_PASSWORD
  }

  private async authenticate(): Promise<string | null> {
    if (!this.username || !this.password) {
      await this.logFailure('Missing WattTime credentials')
      return null
    }

    // Check if we have a valid token
    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.token
    }

    try {
      const response = await wattTimeResilience.execute('authenticate', () =>
        axios.get<WattTimeAuthResponse>(
          `${this.baseUrl}/login`,
          {
            auth: {
              username: this.username!,
              password: this.password!,
            },
            timeout: 8000,
          }
        )
      )

      this.token = response.data.token
      // Token expires in 25 minutes (reduced from 30 to avoid edge cases)
      this.tokenExpiry = new Date(Date.now() + 25 * 60 * 1000)

      await this.logSuccess()
      return this.token ?? null
    } catch (error: any) {
      console.error('WattTime authentication failed:', error.message)
      await this.logFailure(error.message ?? 'Authentication failed')
      return null
    }
  }

  private async logSuccess() {
    try {
      await recordIntegrationSuccess('WATTTIME')
    } catch (error) {
      console.warn('Failed to record WattTime success metric:', error)
    }
  }

  private async logFailure(message: string) {
    try {
      await recordIntegrationFailure('WATTTIME', message)
    } catch (error) {
      console.warn('Failed to record WattTime failure metric:', error)
    }
  }

  async getCurrentMOER(balancingAuthority: string): Promise<WattTimeMOER | null> {
    const token = await this.authenticate()
    if (!token) {
      return null
    }

    try {
      const response = await wattTimeResilience.execute('getCurrentMOER', () =>
        axios.get<{ data: Array<{ point_time: string; value: number }>; meta: { region: string; signal_type: string; units: string; data_point_period_seconds: number } }>(
          `${this.baseUrl}/v3/signal-index`,
          {
            params: {
              region: balancingAuthority,
              signal_type: 'co2_moer',
            },
            headers: {
              Authorization: `Bearer ${token}`,
            },
            timeout: 8000,
          }
        )
      )

      const dataPoint = response.data.data?.[0]
      if (!dataPoint) {
        return null
      }

      // v3 signal-index returns percentile (0-100), not raw lbs/MWh
      // We normalize: percentile maps to approximate MOER for routing comparisons
      const result: WattTimeMOER = {
        balancingAuthority: response.data.meta.region,
        moer: dataPoint.value, // percentile 0-100 (lower = cleaner)
        moerPercent: dataPoint.value,
        timestamp: dataPoint.point_time,
        frequency: `${response.data.meta.data_point_period_seconds}s`,
      }

      await this.logSuccess()
      return result
    } catch (error: any) {
      console.error(`Failed to fetch MOER for ${balancingAuthority}:`, error.message)
      await this.logFailure(error.message ?? 'Failed to fetch MOER')
      return null
    }
  }

  async getMOERForecast(
    balancingAuthority: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<WattTimeForecast[]> {
    const token = await this.authenticate()
    if (!token) {
      return []
    }

    try {
      const params: any = {
        region: balancingAuthority,
        signal_type: 'co2_moer',
      }

      if (startTime) {
        params.start = startTime.toISOString()
      }
      if (endTime) {
        params.end = endTime.toISOString()
      }

      const response = await wattTimeResilience.execute('getMOERForecast', () =>
        axios.get<{ data: Array<{ point_time: string; value: number }>; meta: { region: string; signal_type: string; model: { date: string } } }>(
          `${this.baseUrl}/v3/forecast`,
          {
            params,
            headers: {
              Authorization: `Bearer ${token}`,
            },
            timeout: 8000,
          }
        )
      )

      const modelVersion = response.data.meta?.model?.date ?? 'unknown'
      const forecasts = (response.data.data || []).map((item) => ({
        balancingAuthority: response.data.meta?.region ?? balancingAuthority,
        timestamp: item.point_time,
        moer: item.value,
        version: modelVersion,
      }))

      await this.logSuccess()
      return forecasts
    } catch (error: any) {
      console.error(`Failed to fetch MOER forecast for ${balancingAuthority}:`, error.message)
      await this.logFailure(error.message ?? 'Failed to fetch MOER forecast')
      return []
    }
  }

  async getPredictedCleanWindows(
    balancingAuthority: string,
    hoursAhead: number = 24
  ): Promise<CleanWindow[]> {
    const forecasts = await this.getMOERForecast(
      balancingAuthority,
      new Date(),
      new Date(Date.now() + hoursAhead * 60 * 60 * 1000)
    )

    if (forecasts.length === 0) {
      return []
    }

    // Sort by MOER value
    const sorted = [...forecasts].sort((a, b) => a.moer - b.moer)
    
    // Find clean windows (bottom 20% MOER values)
    const threshold = sorted[Math.floor(sorted.length * 0.2)].moer
    
    const cleanWindows: CleanWindow[] = []
    let currentWindow: WattTimeForecast[] = []

    for (const forecast of forecasts) {
      if (forecast.moer <= threshold) {
        currentWindow.push(forecast)
      } else if (currentWindow.length > 0) {
        // Window ended
        const avgMoer = currentWindow.reduce((sum, f) => sum + f.moer, 0) / currentWindow.length
        cleanWindows.push({
          balancingAuthority,
          startTime: currentWindow[0].timestamp,
          endTime: currentWindow[currentWindow.length - 1].timestamp,
          avgMoer,
          confidence: 0.8, // High confidence for WattTime
        })
        currentWindow = []
      }
    }

    // Handle last window
    if (currentWindow.length > 0) {
      const avgMoer = currentWindow.reduce((sum, f) => sum + f.moer, 0) / currentWindow.length
      cleanWindows.push({
        balancingAuthority,
        startTime: currentWindow[0].timestamp,
        endTime: currentWindow[currentWindow.length - 1].timestamp,
        avgMoer,
        confidence: 0.8,
      })
    }

    return cleanWindows
  }

  async calculateAvoidedEmissions(
    balancingAuthority: string,
    energyMwh: number,
    executionTime: Date,
    alternativeTime?: Date
  ): Promise<number | null> {
    const [currentMoer, alternativeMoer] = await Promise.all([
      this.getCurrentMOER(balancingAuthority),
      alternativeTime
        ? this.getMOERForecast(balancingAuthority, alternativeTime, alternativeTime)
            .then(forecasts => forecasts[0]?.moer ?? null)
        : null,
    ])

    if (!currentMoer) {
      return null
    }

    const baseMoer = alternativeMoer ?? currentMoer.moer
    const avoidedEmissionsKg = (baseMoer - currentMoer.moer) * energyMwh * 1000

    return avoidedEmissionsKg
  }
}

export const wattTime = new WattTimeClient()
