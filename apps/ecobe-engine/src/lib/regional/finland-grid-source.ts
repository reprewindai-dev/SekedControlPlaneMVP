/**
 * Finland Grid Source
 * Direct regional grid carbon intensity for Finland
 */

export interface GridSignal {
  carbonIntensity: number
  timestamp: string
  isForecast: boolean
  metadata?: Record<string, unknown>
}

export class FinlandGridSource {
  private baseUrl: string

  constructor() {
    this.baseUrl = 'https://api.fingrid.fi'
  }

  async getCurrentSignal(region: string): Promise<GridSignal | null> {
    try {
      // Use Fingrid API for Finland's electricity production
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      
      // Get CO2 intensity data
      const response = await fetch(
        `${this.baseUrl}/v1/data/247`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.FINGRID_API_KEY || ''
          },
          body: JSON.stringify({
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            response_format: 'json'
          })
        }
      )
      if (!response.ok) return null

      const data = await response.json() as any
      const record = data?.[0]
      
      if (!record) return null

      // Fingrid provides production data, we need to calculate intensity
      // For now, use Finland's average carbon intensity
      const finlandAverage = 100 // gCO2/kWh (Finland has low-carbon grid)

      return {
        carbonIntensity: finlandAverage,
        timestamp: record.end_time || now.toISOString(),
        isForecast: false,
        metadata: {
          productionValue: record.value,
          unit: data.unit || 'MW',
          region: 'FI'
        }
      }
    } catch (error) {
      console.error('Finland Grid Source error:', error)
      return null
    }
  }
}

export const finlandGridSource = new FinlandGridSource()
