/**
 * FINGARD CONTROL LAYER
 * 
 * Sits between providers and routing engine. Handles:
 * - Provider arbitration
 * - Normalization  
 * - Confidence scoring
 * - Fallback enforcement
 * - Freshness tracking
 * - Degraded state handling
 * 
 * LOCKED PROVIDER ORDER:
 * US: WattTime → EIA-930 → Ember → Static
 * EU: GB/Denmark/Finland → Ember → Static  
 * Rest: Ember → Static
 */

import { wattTime } from '../lib/watttime'
import { eia930 } from '../lib/grid-signals/eia-client'
import { ember } from '../lib/ember'
import { GridSignalCache } from '../lib/grid-signals/grid-signal-cache'
import { GridSignalAudit } from '../lib/grid-signals/grid-signal-audit'
import { gbGridSource } from '../lib/regional/gb-grid-source'
import { denmarkGridSource } from '../lib/regional/denmark-grid-source'
import { finlandGridSource } from '../lib/regional/finland-grid-source'

export interface NormalizedSignal {
  carbonIntensity: number // gCO2eq/kWh
  isForecast: boolean
  source: string
  timestamp: string
  estimatedFlag: boolean
  syntheticFlag: boolean
  confidence: number
  provenance: {
    provider: string
    region: string
    referenceTime: string
    fetchedAt: string
    fallbackUsed: boolean
    degraded: boolean
    disagreementDetected: boolean
    trustLevel: 'high' | 'medium' | 'low'
  }
  metadata: Record<string, unknown>
}

export interface FingardDecision {
  signal: NormalizedSignal
  alternatives: NormalizedSignal[]
  providerStatus: Record<string, 'available' | 'degraded' | 'failed'>
  arbitrationLog: string[]
}

export class FingardControlLayer {
  private cache: GridSignalCache
  private audit: GridSignalAudit

  constructor() {
    this.cache = new GridSignalCache()
    this.audit = new GridSignalAudit()
  }

  /**
   * Get normalized signal following locked provider hierarchy
   * NO PROVIDER AVERAGING - preserve provenance and trust flags
   */
  async getNormalizedSignal(region: string, timestamp: Date): Promise<FingardDecision> {
    const arbitrationLog: string[] = []
    const providerStatus: Record<string, 'available' | 'degraded' | 'failed'> = {}
    const alternatives: NormalizedSignal[] = []

    // Determine provider hierarchy based on region
    const hierarchy = this.getProviderHierarchy(region)
    arbitrationLog.push(`Region ${region} using hierarchy: ${hierarchy.join(' → ')}`)

    // Try providers in order - NO AVERAGING
    for (const provider of hierarchy) {
      try {
        const signal = await this.queryProvider(provider, region, timestamp)
        
        if (signal) {
          providerStatus[provider] = 'available'
          const normalized = this.normalizeSignal(signal, provider, region, timestamp)
          
          // First available provider wins (no averaging)
          if (alternatives.length === 0) {
            arbitrationLog.push(`Primary signal from ${provider}: ${signal.carbonIntensity} gCO2/kWh`)
            return {
              signal: normalized,
              alternatives,
              providerStatus,
              arbitrationLog
            }
          } else {
            alternatives.push(normalized)
          }
        } else {
          providerStatus[provider] = 'failed'
          arbitrationLog.push(`${provider} returned null signal`)
        }
      } catch (error) {
        providerStatus[provider] = 'degraded'
        arbitrationLog.push(`${provider} degraded: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // All providers failed - use static fallback
    arbitrationLog.push('All providers failed, using static fallback')
    const fallbackSignal = this.getStaticFallback(region, timestamp)
    providerStatus['static'] = 'available'

    return {
      signal: this.normalizeSignal(fallbackSignal, 'static', region, timestamp),
      alternatives,
      providerStatus,
      arbitrationLog
    }
  }

  /**
   * Get locked provider hierarchy for region
   */
  private getProviderHierarchy(region: string): string[] {
    // US regions
    if (region.startsWith('US-')) {
      return ['watttime', 'eia930', 'ember', 'static']
    }
    
    // EU regions
    if (['GB', 'DK', 'FI'].includes(region)) {
      return [`${region.toLowerCase()}-grid`, 'ember', 'static']
    }
    
    if (['FR', 'DE', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'PL', 'CZ'].includes(region)) {
      return ['ember', 'static']
    }
    
    // Rest of world
    return ['ember', 'static']
  }

  /**
   * Query specific provider
   */
  private async queryProvider(provider: string, region: string, timestamp: Date) {
    switch (provider) {
      case 'watttime': {
        const moer = await wattTime.getCurrentMOER(region)
        if (moer) return { carbonIntensity: moer.moer, timestamp: moer.timestamp, isForecast: false }
        const forecast = await wattTime.getMOERForecast(region)
        return forecast?.[0] ? { carbonIntensity: forecast[0].moer, timestamp: forecast[0].timestamp, isForecast: true } : null
      }

      case 'eia930': {
        // EIA-930 uses getBalance as closest proxy for current signal
        const balance = await eia930.getBalance(region)
        const latest = balance?.[0]
        return latest ? { carbonIntensity: latest.value ?? 0, timestamp: latest.period ?? new Date().toISOString(), isForecast: false } : null
      }

      case 'gb-grid':
        return await gbGridSource.getCurrentSignal(region)

      case 'dk-grid':
        return await denmarkGridSource.getCurrentSignal(region)

      case 'fi-grid':
        return await finlandGridSource.getCurrentSignal(region)

      case 'ember': {
        const structural = await ember.deriveStructuralProfile(region)
        return structural ? { carbonIntensity: structural.structuralCarbonBaseline, timestamp: structural.updatedAt, isForecast: false } : null
      }

      default:
        throw new Error(`Unknown provider: ${provider}`)
    }
  }

  /**
   * Normalize signal to standard format with provenance
   */
  private normalizeSignal(rawSignal: any, provider: string, region: string, timestamp: Date): NormalizedSignal {
    const now = new Date()
    const age = now.getTime() - new Date(rawSignal.timestamp).getTime()
    const staleThresholds: Record<string, number> = { watttime: 600000, eia930: 1800000, ember: 86400000, 'gb-grid': 300000, 'dk-grid': 300000, 'fi-grid': 300000, static: 0 }
    const threshold = staleThresholds[provider] || 600000
    const isStale = age > threshold

    return {
      carbonIntensity: rawSignal.carbonIntensity,
      isForecast: rawSignal.isForecast || false,
      source: provider,
      timestamp: rawSignal.timestamp,
      estimatedFlag: provider === 'eia930' || rawSignal.isForecast,
      syntheticFlag: provider === 'static',
      confidence: this.calculateConfidence(provider, rawSignal, isStale),
      provenance: {
        provider,
        region,
        referenceTime: timestamp.toISOString(),
        fetchedAt: now.toISOString(),
        fallbackUsed: provider === 'static',
        degraded: isStale,
        disagreementDetected: false, // No averaging = no disagreement
        trustLevel: this.getTrustLevel(provider, isStale)
      },
      metadata: {
        ...rawSignal.metadata,
        ageMs: age,
        staleThreshold: threshold
      }
    }
  }

  /**
   * Calculate confidence based on provider and signal quality
   */
  private calculateConfidence(provider: string, signal: any, isStale: boolean): number {
    let base = 1.0

    // Provider-specific base confidence
    switch (provider) {
      case 'watttime': base = 0.95; break
      case 'eia930': base = 0.85; break
      case 'gb-grid': case 'dk-grid': case 'fi-grid': base = 0.90; break
      case 'ember': base = 0.70; break // Validation only
      case 'static': base = 0.30; break
    }

    // Staleness penalty
    if (isStale) base *= 0.7

    // Forecast penalty
    if (signal.isForecast) base *= 0.8

    return Math.max(0.1, Math.min(1.0, base))
  }

  /**
   * Get trust level for provider
   */
  private getTrustLevel(provider: string, isStale: boolean): 'high' | 'medium' | 'low' {
    if (provider === 'static') return 'low'
    if (isStale) return 'medium'
    if (['watttime', 'gb-grid', 'dk-grid', 'fi-grid'].includes(provider)) return 'high'
    return 'medium'
  }

  /**
   * Static fallback as last resort
   */
  private getStaticFallback(region: string, timestamp: Date) {
    const staticValues: Record<string, number> = {
      'US': 450, 'GB': 200, 'FR': 80, 'DE': 300, 'DK': 150, 'FI': 100,
      'IT': 250, 'ES': 180, 'NL': 350, 'BE': 200, 'AT': 200, 'CH': 50,
      'SE': 40, 'NO': 30, 'PL': 600, 'CZ': 400
    }

    const country = region.split('-')[0] || region
    const carbonIntensity = staticValues[country] || 400

    return {
      carbonIntensity,
      timestamp: timestamp.toISOString(),
      isForecast: false,
      metadata: { source: 'static_fallback', region }
    }
  }
}

// Singleton instance
export const fingard = new FingardControlLayer()
