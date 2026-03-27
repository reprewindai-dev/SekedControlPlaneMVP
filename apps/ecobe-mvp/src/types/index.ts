export interface Region {
  code: string
  name: string
  country: string
  timezone: string
}

export interface CarbonIntensity {
  region: string
  carbonIntensity: number
  timestamp: string
  source?: string
}

export interface RoutingRecommendation {
  region: string
  rank: number
  carbonIntensity: number
  estimatedCO2: number
  estimatedEnergyKwh: number
  score: number
  estimatedLatency?: number
}

export interface EnergyEquationResult {
  routingRecommendation: RoutingRecommendation[]
  regionEstimates: RoutingRecommendation[]
  totalEstimatedCO2: number
  withinBudget: boolean
}

export interface GreenRoutingResult {
  selectedRegion: string
  carbonIntensity: number
  estimatedLatency?: number
  score: number
  alternatives: Array<{
    region: string
    carbonIntensity: number
    score: number
  }>
}

export interface DekesWorkload {
  id: string
  dekesQueryId: string
  queryString: string
  selectedRegion: string
  actualCO2: number
  status: string
  createdAt: string
}

export interface DekesAnalytics {
  totalWorkloads: number
  totalCO2Saved: number
  averageCarbonIntensity: number
  workloads: DekesWorkload[]
}

export interface CarbonForecast {
  region: string
  forecastTime: string
  predictedIntensity: number
  confidence: number
  trend: 'increasing' | 'decreasing' | 'stable'
}

export type CarbonLevel = 'low' | 'medium' | 'high'

export function getCarbonLevel(intensity: number): CarbonLevel {
  if (intensity < 200) return 'low'
  if (intensity < 400) return 'medium'
  return 'high'
}

export function getCarbonColor(level: CarbonLevel): string {
  const colors = {
    low: 'text-carbon-low',
    medium: 'text-carbon-medium',
    high: 'text-carbon-high',
  }
  return colors[level]
}

export function getCarbonBgColor(level: CarbonLevel): string {
  const colors = {
    low: 'bg-carbon-low',
    medium: 'bg-carbon-medium',
    high: 'bg-carbon-high',
  }
  return colors[level]
}
