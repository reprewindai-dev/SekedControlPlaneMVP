import { randomUUID } from 'crypto'

export type NormalizedSignal = {
  region: string
  gridZone: string
  carbonValue: number
  signalType: 'moer' | 'average'
  source: 'watttime' | 'eia930' | 'gb' | 'dk' | 'fi' | 'ember' | 'static'
  confidence: number
  freshness: string
  degraded: boolean
}

// Region to grid zone mapping
const REGION_GRID_MAPPING: Record<string, { zone: string; country: string }> = {
  'us-east-1': { zone: 'PJM', country: 'US' },
  'us-west-1': { zone: 'CAISO', country: 'US' },
  'us-west-2': { zone: 'BPA', country: 'US' },
  'us-central-1': { zone: 'ERCOT', country: 'US' },
  'eu-west-1': { zone: 'EI', country: 'IE' },
  'eu-west-2': { zone: 'NG', country: 'GB' },
  'eu-central-1': { zone: 'DE', country: 'DE' },
  'eu-north-1': { zone: 'SE', country: 'SE' },
  'ap-southeast-1': { zone: 'SG', country: 'SG' },
  'ap-northeast-1': { zone: 'JP', country: 'JP' },
}

/**
 * Provider adapter interfaces
 */
interface ProviderAdapter {
  fetchSignal(gridZone: string, country: string): Promise<NormalizedSignal | null>
}

/**
 * Static fallback adapter
 */
class StaticAdapter implements ProviderAdapter {
  async fetchSignal(gridZone: string, country: string): Promise<NormalizedSignal> {
    // Base carbon values by region with realistic variation
    const baseValues: Record<string, number> = {
      'US': 180, 'GB': 150, 'IE': 160, 'DE': 220, 'SE': 40, 'SG': 300, 'JP': 200
    }
    
    const baseValue = baseValues[country] || 200
    const variation = Math.random() * 40 - 20 // ±20g variation
    
    return {
      region: gridZone,
      gridZone,
      carbonValue: Math.round(baseValue + variation),
      signalType: 'average',
      source: 'static',
      confidence: 0.3,
      freshness: new Date().toISOString(),
      degraded: true,
    }
  }
}

/**
 * Mock WattTime adapter (would integrate with real API)
 */
class WattTimeAdapter implements ProviderAdapter {
  async fetchSignal(gridZone: string, country: string): Promise<NormalizedSignal | null> {
    // Simulate API call with realistic MOER values
    await new Promise(resolve => setTimeout(resolve, 50))
    
    const moerValues: Record<string, number> = {
      'PJM': 245, 'CAISO': 124, 'BPA': 89, 'ERCOT': 195
    }
    
    const baseValue = moerValues[gridZone] || 180
    const variation = Math.random() * 30 - 15
    
    return {
      region: gridZone,
      gridZone,
      carbonValue: Math.round(baseValue + variation),
      signalType: 'moer',
      source: 'watttime',
      confidence: 0.92,
      freshness: new Date().toISOString(),
      degraded: false,
    }
  }
}

/**
 * Mock EIA-930 adapter
 */
class EIA930Adapter implements ProviderAdapter {
  async fetchSignal(gridZone: string, country: string): Promise<NormalizedSignal | null> {
    await new Promise(resolve => setTimeout(resolve, 30))
    
    const baseValue = 160 + Math.random() * 40
    return {
      region: gridZone,
      gridZone,
      carbonValue: Math.round(baseValue),
      signalType: 'average',
      source: 'eia930',
      confidence: 0.85,
      freshness: new Date().toISOString(),
      degraded: false,
    }
  }
}

/**
 * Mock Ember adapter
 */
class EmberAdapter implements ProviderAdapter {
  async fetchSignal(gridZone: string, country: string): Promise<NormalizedSignal | null> {
    await new Promise(resolve => setTimeout(resolve, 40))
    
    const emberValues: Record<string, number> = {
      'GB': 150, 'IE': 160, 'DE': 220, 'SE': 40
    }
    
    const baseValue = emberValues[country] || 200
    return {
      region: gridZone,
      gridZone,
      carbonValue: Math.round(baseValue + Math.random() * 20),
      signalType: 'average',
      source: 'ember',
      confidence: 0.78,
      freshness: new Date().toISOString(),
      degraded: false,
    }
  }
}

/**
 * Mock GB/DK/FI direct source adapters
 */
class GBAdapter implements ProviderAdapter {
  async fetchSignal(gridZone: string, country: string): Promise<NormalizedSignal | null> {
    if (country !== 'GB') return null
    return {
      region: gridZone,
      gridZone,
      carbonValue: Math.round(150 + Math.random() * 30),
      signalType: 'average',
      source: 'gb',
      confidence: 0.95,
      freshness: new Date().toISOString(),
      degraded: false,
    }
  }
}

class DKAdapter implements ProviderAdapter {
  async fetchSignal(gridZone: string, country: string): Promise<NormalizedSignal | null> {
    if (country !== 'DK') return null
    return {
      region: gridZone,
      gridZone,
      carbonValue: Math.round(130 + Math.random() * 40),
      signalType: 'average',
      source: 'dk',
      confidence: 0.93,
      freshness: new Date().toISOString(),
      degraded: false,
    }
  }
}

class FIAdapter implements ProviderAdapter {
  async fetchSignal(gridZone: string, country: string): Promise<NormalizedSignal | null> {
    if (country !== 'FI') return null
    return {
      region: gridZone,
      gridZone,
      carbonValue: Math.round(80 + Math.random() * 30),
      signalType: 'average',
      source: 'fi',
      confidence: 0.94,
      freshness: new Date().toISOString(),
      degraded: false,
    }
  }
}

/**
 * Fingard service - Provider arbitration and normalization
 */
class FingardService {
  private static adapters: Record<string, ProviderAdapter> = {
    static: new StaticAdapter(),
    watttime: new WattTimeAdapter(),
    eia930: new EIA930Adapter(),
    ember: new EmberAdapter(),
    gb: new GBAdapter(),
    dk: new DKAdapter(),
    fi: new FIAdapter(),
  }

  /**
   * Get provider stack for a given country
   */
  private static getProviderStack(country: string): string[] {
    switch (country) {
      case 'US':
        return ['watttime', 'eia930', 'ember', 'static']
      case 'GB':
      case 'IE':
      case 'DK':
      case 'FI':
        return [country.toLowerCase(), 'ember', 'static']
      default:
        return ['ember', 'static']
    }
  }

  /**
   * Fetch signal with provider fallback
   */
  private static async fetchWithFallback(
    gridZone: string, 
    country: string, 
    providers: string[]
  ): Promise<NormalizedSignal> {
    let lastError: Error | null = null
    
    for (const providerName of providers) {
      try {
        const adapter = this.adapters[providerName]
        if (!adapter) continue
        
        const signal = await adapter.fetchSignal(gridZone, country)
        if (signal) return signal
      } catch (error) {
        lastError = error as Error
        continue
      }
    }
    
    // If all providers fail, this shouldn't happen with static fallback
    throw lastError || new Error('All providers failed')
  }

  /**
   * Get normalized signal for a region
   */
  static async getSignal(region: string): Promise<NormalizedSignal> {
    const mapping = REGION_GRID_MAPPING[region]
    if (!mapping) {
      throw new Error(`No grid mapping found for region: ${region}`)
    }

    const providers = this.getProviderStack(mapping.country)
    return this.fetchWithFallback(mapping.zone, mapping.country, providers)
  }

  /**
   * Get signals for multiple regions
   */
  static async getSignals(regions: string[]): Promise<NormalizedSignal[]> {
    const signals = await Promise.allSettled(
      regions.map(region => this.getSignal(region))
    )
    
    return signals
      .filter((result): result is PromiseFulfilledResult<NormalizedSignal> => 
        result.status === 'fulfilled'
      )
      .map(result => result.value)
  }
}

// Export the service methods
export async function getSignal(region: string): Promise<NormalizedSignal> {
  return FingardService.getSignal(region)
}

export async function getSignals(regions: string[]): Promise<NormalizedSignal[]> {
  return FingardService.getSignals(regions)
}

// Export the mapping for other services
export { REGION_GRID_MAPPING }
