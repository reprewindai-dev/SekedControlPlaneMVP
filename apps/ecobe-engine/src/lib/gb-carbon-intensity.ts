import axios from 'axios'
import { recordIntegrationFailure, recordIntegrationSuccess } from './integration-metrics'

/**
 * GB Carbon Intensity API Adapter
 *
 * Source: https://api.carbonintensity.org.uk
 * Coverage: Great Britain (14 regions)
 * Auth: NONE required (fully open API)
 * Cadence: 30-min updates
 * Forecast: 96+ hours ahead
 * Cost: $0
 *
 * Per locked doctrine: This is a FREE authoritative carbon intensity source
 * for GB regions. Not a replacement for WattTime (US primary) but fills
 * the EU coverage gap where we don't have Electricity Maps.
 */

export interface GBIntensityData {
  from: string
  to: string
  intensity: {
    forecast: number
    actual: number | null
    index: 'very low' | 'low' | 'moderate' | 'high' | 'very high'
  }
}

export interface GBGenerationMix {
  fuel: string
  perc: number
}

export interface GBRegionalIntensity {
  regionid: number
  shortname: string
  intensity: {
    forecast: number
    actual: number | null
    index: string
  }
  generationmix: GBGenerationMix[]
}

export interface GBForecastPoint {
  from: string
  to: string
  intensity: {
    forecast: number
    index: string
  }
}

const BASE_URL = 'https://api.carbonintensity.org.uk'

export class GBCarbonIntensityClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = BASE_URL
  }

  private async logSuccess() {
    try {
      await recordIntegrationSuccess('GB_CARBON' as any)
    } catch { /* ignore */ }
  }

  private async logFailure(message: string) {
    try {
      await recordIntegrationFailure('GB_CARBON' as any, message)
    } catch { /* ignore */ }
  }

  /**
   * Get current national carbon intensity (Great Britain)
   */
  async getCurrentIntensity(): Promise<GBIntensityData | null> {
    try {
      const response = await axios.get<{ data: GBIntensityData[] }>(
        `${this.baseUrl}/intensity`,
        { timeout: 10000 }
      )

      const data = response.data?.data?.[0]
      if (!data) return null

      await this.logSuccess()
      return data
    } catch (error: any) {
      console.error('GB Carbon Intensity current fetch failed:', error.message)
      await this.logFailure(error.message)
      return null
    }
  }

  /**
   * Get 48-hour forward forecast from now
   * Returns array of 30-min forecast points (up to 96 points)
   */
  async getForecast48h(): Promise<GBForecastPoint[]> {
    try {
      const response = await axios.get<{ data: GBForecastPoint[] }>(
        `${this.baseUrl}/intensity/${new Date().toISOString()}/fw48h`,
        { timeout: 15000 }
      )

      const data = response.data?.data || []
      await this.logSuccess()
      return data
    } catch (error: any) {
      console.error('GB Carbon Intensity 48h forecast failed:', error.message)
      await this.logFailure(error.message)
      return []
    }
  }

  /**
   * Get regional intensity breakdown (14 GB regions)
   */
  async getRegionalIntensity(): Promise<GBRegionalIntensity[]> {
    try {
      const response = await axios.get<{ data: Array<{ regions: GBRegionalIntensity[] }> }>(
        `${this.baseUrl}/regional`,
        { timeout: 10000 }
      )

      const regions = response.data?.data?.[0]?.regions || []
      await this.logSuccess()
      return regions
    } catch (error: any) {
      console.error('GB Carbon Intensity regional fetch failed:', error.message)
      await this.logFailure(error.message)
      return []
    }
  }

  /**
   * Get generation mix (current national)
   */
  async getGenerationMix(): Promise<GBGenerationMix[]> {
    try {
      const response = await axios.get<{ data: Array<{ generationmix: GBGenerationMix[] }> }>(
        `${this.baseUrl}/generation`,
        { timeout: 10000 }
      )

      const mix = response.data?.data?.[0]?.generationmix || []
      await this.logSuccess()
      return mix
    } catch (error: any) {
      console.error('GB Carbon Intensity generation mix failed:', error.message)
      await this.logFailure(error.message)
      return []
    }
  }

  /**
   * Find clean windows in the forecast
   * Returns periods where intensity is below threshold
   */
  findCleanWindows(
    forecast: GBForecastPoint[],
    thresholdGCo2: number = 150
  ): Array<{ start: string; end: string; avgIntensity: number; duration_minutes: number }> {
    const windows: Array<{ start: string; end: string; avgIntensity: number; duration_minutes: number }> = []
    let windowStart: string | null = null
    let windowPoints: GBForecastPoint[] = []

    for (const point of forecast) {
      if (point.intensity.forecast <= thresholdGCo2) {
        if (!windowStart) windowStart = point.from
        windowPoints.push(point)
      } else {
        if (windowStart && windowPoints.length > 0) {
          const avg = windowPoints.reduce((s, p) => s + p.intensity.forecast, 0) / windowPoints.length
          windows.push({
            start: windowStart,
            end: windowPoints[windowPoints.length - 1].to,
            avgIntensity: Math.round(avg),
            duration_minutes: windowPoints.length * 30,
          })
        }
        windowStart = null
        windowPoints = []
      }
    }

    // Close any trailing window
    if (windowStart && windowPoints.length > 0) {
      const avg = windowPoints.reduce((s, p) => s + p.intensity.forecast, 0) / windowPoints.length
      windows.push({
        start: windowStart,
        end: windowPoints[windowPoints.length - 1].to,
        avgIntensity: Math.round(avg),
        duration_minutes: windowPoints.length * 30,
      })
    }

    return windows
  }
}

export const gbCarbonIntensity = new GBCarbonIntensityClient()
