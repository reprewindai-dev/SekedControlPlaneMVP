/**
 * Great Britain Grid Source
 * Direct regional grid carbon intensity for UK
 */

export interface GridSignal {
  carbonIntensity: number
  timestamp: string
  isForecast: boolean
  metadata?: Record<string, unknown>
}

export class GBGridSource {
  private baseUrl: string

  constructor() {
    this.baseUrl = 'https://api.carbonintensity.org.uk'
  }

  async getCurrentSignal(region: string): Promise<GridSignal | null> {
    try {
      // Use National Grid ESO Carbon Intensity API
      const response = await fetch(`${this.baseUrl}/intensity/${new Date().toISOString().split('T')[0]}/fw48h/postcode/EC1A`) // London postcode as default
      if (!response.ok) return null

      const data: any = await response.json()
      const current = data.data?.[0]
      
      if (!current) return null

      return {
        carbonIntensity: current.intensity.actual || current.intensity.forecast,
        timestamp: current.from,
        isForecast: !current.intensity.actual,
        metadata: {
          index: current.index,
          region: 'GB'
        }
      }
    } catch (error) {
      console.error('GB Grid Source error:', error)
      return null
    }
  }
}

export const gbGridSource = new GBGridSource()
