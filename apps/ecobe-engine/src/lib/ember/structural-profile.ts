import { EmberClient, type EmberCarbonIntensityData, type EmberDemandData, type EmberGenerationData, type EmberCapacityData } from '../ember'

export interface EmberData {
  carbonIntensity: Array<{
    year: string
    value: number | null
  }>
  demand: Array<{
    year: string
    value: number | null
  }>
  capacity: Array<{
    year: string
    fuelTech: string
    value: number | null
  }>
}

export interface RegionStructuralProfile {
  region: string
  structuralCarbonBaseline: number // gCO2eq/kWh
  carbonTrendDirection: 'increasing' | 'decreasing' | 'stable'
  demandTrendTwh: number // Annual demand trend in TWh
  demandPerCapita: number // kWh per capita
  fossilDependenceScore: number // 0-1 scale
  renewableDependenceScore: number // 0-1 scale
  generationMixProfile: {
    fossil: number // percentage
    renewable: number // percentage
    nuclear: number // percentage
    other: number // percentage
  }
  windCapacityTrend: number // MW/year trend
  solarCapacityTrend: number // MW/year trend
  dataQuality: 'high' | 'medium' | 'low'
  lastUpdated: string
}

/**
 * Ember Structural Profile Generator
 * 
 * Generates structural carbon profiles from Ember data for validation context only.
 * NOT used for real-time routing decisions.
 */
export class EmberStructuralProfile {
  /**
   * Derive structural profile from Ember data
   * Ember is used ONLY for structural context and validation, NOT real-time routing
   */
  static deriveStructuralProfile(
    emberData: EmberData,
    region: string
  ): RegionStructuralProfile {
    // Calculate structural carbon baseline (multi-year average)
    const structuralCarbonBaseline = this.calculateStructuralBaseline(emberData)
    
    // Determine carbon trend direction
    const carbonTrendDirection = this.calculateCarbonTrend(emberData)
    
    // Calculate demand metrics
    const { demandTrendTwh, demandPerCapita } = this.calculateDemandMetrics(emberData)
    
    // Calculate dependence scores
    const { fossilDependenceScore, renewableDependenceScore } = this.calculateDependenceScores(emberData)
    
    // Generation mix profile
    const generationMixProfile = this.calculateGenerationMix(emberData)
    
    // Capacity trends
    const { windCapacityTrend, solarCapacityTrend } = this.calculateCapacityTrends(emberData)
    
    // Data quality assessment
    const dataQuality = this.assessDataQuality(emberData)

    return {
      region,
      structuralCarbonBaseline,
      carbonTrendDirection,
      demandTrendTwh,
      demandPerCapita,
      fossilDependenceScore,
      renewableDependenceScore,
      generationMixProfile,
      windCapacityTrend,
      solarCapacityTrend,
      dataQuality,
      lastUpdated: new Date().toISOString()
    }
  }

  /**
   * Calculate structural carbon baseline from multi-year data
   */
  private static calculateStructuralBaseline(emberData: EmberData): number {
    // Use 5-year rolling average to smooth out short-term fluctuations
    const recentYears = emberData.carbonIntensity
      .sort((a: any, b: any) => new Date(b.year).getTime() - new Date(a.year).getTime())
      .slice(0, 5)
    
    if (recentYears.length === 0) return 400 // Fallback baseline
    
    const validData = recentYears.filter((year: any) => year.value !== null)
    if (validData.length === 0) return 400
    
    const average = validData.reduce((sum: number, year: any) => sum + year.value!, 0) / validData.length
    return Math.round(average)
  }

  /**
   * Determine carbon intensity trend direction
   */
  private static calculateCarbonTrend(emberData: EmberData): 'increasing' | 'decreasing' | 'stable' {
    const intensityData = emberData.carbonIntensity
      .filter((year: any) => year.value !== null)
      .sort((a: any, b: any) => new Date(a.year).getTime() - new Date(b.year).getTime())
    
    if (intensityData.length < 3) return 'stable'
    
    // Simple linear trend calculation
    const recent = intensityData.slice(-3)
    const trend = (recent[2].value! - recent[0].value!) / 2
    
    if (trend > 5) return 'increasing'
    if (trend < -5) return 'decreasing'
    return 'stable'
  }

  /**
   * Calculate demand metrics
   */
  private static calculateDemandMetrics(emberData: EmberData): {
    demandTrendTwh: number
    demandPerCapita: number
  } {
    const demandData = emberData.demand
      .filter((year: any) => year.value !== null)
      .sort((a: any, b: any) => new Date(a.year).getTime() - new Date(b.year).getTime())
    
    if (demandData.length < 2) {
      return { demandTrendTwh: 0, demandPerCapita: 0 }
    }
    
    // Calculate annual demand trend (TWh/year)
    const recent = demandData.slice(-2)
    const demandTrendTwh = recent[1].value! - recent[0].value!
    
    // Calculate per capita demand (simplified - would need population data)
    const latestDemand = demandData[demandData.length - 1].value!
    const demandPerCapita = latestDemand / 1000000 // Rough estimate
    
    return { demandTrendTwh, demandPerCapita }
  }

  /**
   * Calculate fossil and renewable dependence scores
   */
  private static calculateDependenceScores(emberData: EmberData): {
    fossilDependenceScore: number
    renewableDependenceScore: number
  } {
    const latestYear = Math.max(...emberData.capacity.map((c: any) => parseInt(c.year)))
    const capacityData = emberData.capacity.filter((c: any) => parseInt(c.year) === latestYear)
    
    let fossilCapacity = 0
    let renewableCapacity = 0
    let totalCapacity = 0
    
    for (const capacity of capacityData) {
      const value = capacity.value || 0
      totalCapacity += value
      
      // Classify fuel type (simplified)
      const fuelType = capacity.fuelTech.toLowerCase()
      if (fuelType.includes('coal') || fuelType.includes('gas') || fuelType.includes('oil')) {
        fossilCapacity += value
      } else if (fuelType.includes('wind') || fuelType.includes('solar') || fuelType.includes('hydro')) {
        renewableCapacity += value
      }
    }
    
    const fossilDependenceScore = totalCapacity > 0 ? fossilCapacity / totalCapacity : 0
    const renewableDependenceScore = totalCapacity > 0 ? renewableCapacity / totalCapacity : 0
    
    return { fossilDependenceScore, renewableDependenceScore }
  }

  /**
   * Calculate generation mix profile
   */
  private static calculateGenerationMix(emberData: EmberData): {
    fossil: number
    renewable: number
    nuclear: number
    other: number
  } {
    const latestYear = Math.max(...emberData.capacity.map((c: any) => parseInt(c.year)))
    const capacityData = emberData.capacity.filter((c: any) => parseInt(c.year) === latestYear)
    
    let fossil = 0
    let renewable = 0
    let nuclear = 0
    let other = 0
    let total = 0
    
    for (const capacity of capacityData) {
      const value = capacity.value || 0
      total += value
      
      const fuelType = capacity.fuelTech.toLowerCase()
      if (fuelType.includes('coal') || fuelType.includes('gas') || fuelType.includes('oil')) {
        fossil += value
      } else if (fuelType.includes('wind') || fuelType.includes('solar') || fuelType.includes('hydro')) {
        renewable += value
      } else if (fuelType.includes('nuclear')) {
        nuclear += value
      } else {
        other += value
      }
    }
    
    const totalValid = total || 1
    return {
      fossil: (fossil / totalValid) * 100,
      renewable: (renewable / totalValid) * 100,
      nuclear: (nuclear / totalValid) * 100,
      other: (other / totalValid) * 100
    }
  }

  /**
   * Calculate capacity trends for wind and solar
   */
  private static calculateCapacityTrends(emberData: EmberData): {
    windCapacityTrend: number
    solarCapacityTrend: number
  } {
    const windData = emberData.capacity
      .filter((c: any) => c.fuelTech.toLowerCase().includes('wind'))
      .sort((a: any, b: any) => new Date(a.year).getTime() - new Date(b.year).getTime())
    
    const solarData = emberData.capacity
      .filter((c: any) => c.fuelTech.toLowerCase().includes('solar'))
      .sort((a: any, b: any) => new Date(a.year).getTime() - new Date(b.year).getTime())
    
    const windTrend = this.calculateCapacityTrendForFuel(windData)
    const solarTrend = this.calculateCapacityTrendForFuel(solarData)
    
    return { windCapacityTrend: windTrend, solarCapacityTrend: solarTrend }
  }

  private static calculateCapacityTrendForFuel(capacityData: any[]): number {
    if (capacityData.length < 2) return 0
    
    const recent = capacityData.slice(-2)
    const trend = (recent[1].value || 0) - (recent[0].value || 0)
    return trend
  }

  /**
   * Assess data quality based on completeness and recency
   */
  private static assessDataQuality(emberData: EmberData): 'high' | 'medium' | 'low' {
    let score = 3 // Start at high
    
    // Check data completeness
    if (emberData.carbonIntensity.filter((c: any) => c.value !== null).length < 3) score -= 1
    if (emberData.demand.filter((c: any) => c.value !== null).length < 3) score -= 1
    if (emberData.capacity.length < 10) score -= 1
    
    // Check data recency
    const latestYear = Math.max(...emberData.carbonIntensity.map((c: any) => parseInt(c.year)))
    const currentYear = new Date().getFullYear()
    if (currentYear - latestYear > 2) score -= 1
    
    if (score >= 3) return 'high'
    if (score >= 2) return 'medium'
    return 'low'
  }

  /**
   * Validate that profile meets minimum quality requirements
   */
  static validateProfile(profile: RegionStructuralProfile): {
    isValid: boolean
    warnings: string[]
  } {
    const warnings: string[] = []
    
    if (profile.structuralCarbonBaseline < 0 || profile.structuralCarbonBaseline > 2000) {
      warnings.push('Structural carbon baseline outside reasonable range')
    }
    
    if (profile.fossilDependenceScore < 0 || profile.fossilDependenceScore > 1) {
      warnings.push('Fossil dependence score outside 0-1 range')
    }
    
    if (profile.renewableDependenceScore < 0 || profile.renewableDependenceScore > 1) {
      warnings.push('Renewable dependence score outside 0-1 range')
    }
    
    if (profile.dataQuality === 'low') {
      warnings.push('Low data quality - structural profile may be unreliable')
    }
    
    const isValid = warnings.length === 0
    
    return { isValid, warnings }
  }

  /**
   * Get structural profile for validation purposes only
   * This is NOT used for real-time routing decisions
   */
  static async getStructuralProfile(region: string): Promise<RegionStructuralProfile | null> {
    // This would fetch Ember data and derive profile
    // For now, return null to indicate not implemented
    return null
  }
}
