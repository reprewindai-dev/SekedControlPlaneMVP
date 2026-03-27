/**
 * Provider Snapshot Storage — Routing Spec v1
 *
 * Persists provider signal values at decision time for full audit trail.
 * Stores WattTime, Electricity Maps, Ember, and EIA-930 snapshots.
 */

import { prisma } from '../db'

export interface ProviderSignalSnapshot {
  provider: string
  zone: string
  signalType: string
  signalValue: number
  forecastForTs?: Date
  observedAt: Date
  freshnessSec?: number
  confidence?: number
  metadata?: Record<string, unknown>
}

/**
 * Store a provider signal snapshot.
 * Upserts to avoid duplicates.
 */
export async function storeProviderSnapshot(snapshot: ProviderSignalSnapshot): Promise<void> {
  try {
    await prisma.providerSnapshot.upsert({
      where: {
        provider_zone_signalType_observedAt: {
          provider: snapshot.provider,
          zone: snapshot.zone,
          signalType: snapshot.signalType,
          observedAt: snapshot.observedAt,
        },
      },
      create: {
        provider: snapshot.provider,
        zone: snapshot.zone,
        signalType: snapshot.signalType,
        signalValue: snapshot.signalValue,
        forecastForTs: snapshot.forecastForTs ?? null,
        observedAt: snapshot.observedAt,
        freshnessSec: snapshot.freshnessSec ?? null,
        confidence: snapshot.confidence ?? null,
        metadata: snapshot.metadata ?? {},
      },
      update: {
        signalValue: snapshot.signalValue,
        forecastForTs: snapshot.forecastForTs ?? null,
        freshnessSec: snapshot.freshnessSec ?? null,
        confidence: snapshot.confidence ?? null,
        metadata: snapshot.metadata ?? {},
      },
    })
  } catch (error) {
    // Silently ignore duplicates
    console.warn('Provider snapshot store error:', error)
  }
}

/**
 * Store multiple snapshots in batch.
 */
export async function storeProviderSnapshotBatch(snapshots: ProviderSignalSnapshot[]): Promise<void> {
  await Promise.all(snapshots.map(s => storeProviderSnapshot(s)))
}

/**
 * Get latest provider snapshots for a zone.
 */
export async function getLatestSnapshots(zone: string, providers?: string[]) {
  const where: any = { zone }
  if (providers && providers.length > 0) {
    where.provider = { in: providers }
  }

  return prisma.providerSnapshot.findMany({
    where,
    orderBy: { observedAt: 'desc' },
    take: 20,
  })
}

/**
 * Get provider freshness across all zones.
 * Used for dashboard health panel.
 */
export async function getProviderFreshness(): Promise<Array<{
  provider: string
  latestObservedAt: string
  freshnessSec: number
  isStale: boolean
}>> {
  const providers = ['watttime', 'electricity_maps', 'ember', 'eia930']
  const results: Array<{
    provider: string
    latestObservedAt: string
    freshnessSec: number
    isStale: boolean
  }> = []

  for (const provider of providers) {
    const latest = await prisma.providerSnapshot.findFirst({
      where: { provider },
      orderBy: { observedAt: 'desc' },
    })

    if (latest) {
      const freshnessSec = Math.floor((Date.now() - latest.observedAt.getTime()) / 1000)
      const staleThresholds: Record<string, number> = {
        watttime: 600,          // 10 min
        electricity_maps: 600,  // 10 min
        ember: 86400,           // 24 hours (structural data)
        eia930: 1800,           // 30 min
      }

      results.push({
        provider,
        latestObservedAt: latest.observedAt.toISOString(),
        freshnessSec,
        isStale: freshnessSec > (staleThresholds[provider] ?? 3600),
      })
    } else {
      results.push({
        provider,
        latestObservedAt: '',
        freshnessSec: -1,
        isStale: true,
      })
    }
  }

  return results
}

/**
 * Cleanup old snapshots (> 90 days).
 */
export async function cleanupOldSnapshots(retentionDays: number = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const result = await prisma.providerSnapshot.deleteMany({
    where: { observedAt: { lt: cutoff } },
  })
  return result.count
}
