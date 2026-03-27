/**
 * Denmark Grid Source
 * Direct regional grid carbon intensity for Denmark
 */

export interface GridSignal {
  carbonIntensity: number
  timestamp: string
  isForecast: boolean
  metadata?: Record<string, unknown>
}

export class DenmarkGridSource {
  private baseUrl: string

  constructor() {
    this.baseUrl = 'https://api.energidataservice.dk'
  }

  async getCurrentSignal(region: string): Promise<GridSignal | null> {
    try {
      // Use Danish Energy Agency API
      const now = new Date()
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
      
      const response = await fetch(
        `${this.baseUrl}/dataset/CO2Emis?start=${fiveMinutesAgo.toISOString()}&end=${now.toISOString()}&limit=1`
      )
      if (!response.ok) return null

      const data = await response.json() as any
      const record = data.records?.[0]
      
      if (!record) return null

      return {
        carbonIntensity: Math.round(record.CO2Emission),
        timestamp: record.Minutes5UTC,
        isForecast: false,
        metadata: {
          priceArea: record.PriceArea || 'DK2',
          region: 'DK'
        }
      }
    } catch (error) {
      console.error('Denmark Grid Source error:', error)
      return null
    }
  }
}

export const denmarkGridSource = new DenmarkGridSource()
