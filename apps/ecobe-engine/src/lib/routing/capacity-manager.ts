/**
 * Capacity Bucket Manager — Routing Spec v1
 *
 * Fleet-aware resource management to prevent over-subscription.
 * Tracks per-region hourly capacity and prevents routing pile-ups.
 */

import { prisma } from '../db'

const DEFAULT_CPU_CAPACITY = 1000
const DEFAULT_GPU_CAPACITY = 100
const MAX_COMMANDS_PER_BUCKET = 500 // Safety limit

/**
 * Get or create a capacity bucket for a region + hour.
 */
export async function getCapacityBucket(region: string, targetTime: Date) {
  const bucketStart = roundToHour(targetTime)

  const bucket = await prisma.capacityBucket.upsert({
    where: {
      region_bucketStartTs: { region, bucketStartTs: bucketStart },
    },
    create: {
      region,
      bucketStartTs: bucketStart,
      cpuAvailable: DEFAULT_CPU_CAPACITY,
      gpuAvailable: DEFAULT_GPU_CAPACITY,
      reservedCpu: 0,
      reservedGpu: 0,
      allocatedCommands: 0,
      queueDepth: 0,
      costMultiplier: 1.0,
    },
    update: {},
  })

  return bucket
}

/**
 * Check if a region has capacity at a given time.
 */
export async function hasCapacity(
  region: string,
  targetTime: Date,
  requiredCpu: number = 4,
  requiredGpu: number = 0
): Promise<{ available: boolean; queueDepth: number; costMultiplier: number }> {
  const bucket = await getCapacityBucket(region, targetTime)

  const cpuRemaining = bucket.cpuAvailable - bucket.reservedCpu
  const gpuRemaining = bucket.gpuAvailable - bucket.reservedGpu
  const commandsRemaining = MAX_COMMANDS_PER_BUCKET - bucket.allocatedCommands

  return {
    available: cpuRemaining >= requiredCpu && gpuRemaining >= requiredGpu && commandsRemaining > 0,
    queueDepth: bucket.queueDepth,
    costMultiplier: bucket.costMultiplier,
  }
}

/**
 * Reserve capacity for a routing decision.
 * Call this AFTER selecting a candidate, BEFORE dispatch.
 */
export async function reserveCapacity(
  region: string,
  targetTime: Date,
  cpuUnits: number = 4,
  gpuUnits: number = 0
): Promise<boolean> {
  const bucketStart = roundToHour(targetTime)

  try {
    await prisma.capacityBucket.upsert({
      where: {
        region_bucketStartTs: { region, bucketStartTs: bucketStart },
      },
      create: {
        region,
        bucketStartTs: bucketStart,
        cpuAvailable: DEFAULT_CPU_CAPACITY,
        gpuAvailable: DEFAULT_GPU_CAPACITY,
        reservedCpu: cpuUnits,
        reservedGpu: gpuUnits,
        allocatedCommands: 1,
        queueDepth: 0,
        costMultiplier: 1.0,
      },
      update: {
        reservedCpu: { increment: cpuUnits },
        reservedGpu: { increment: gpuUnits },
        allocatedCommands: { increment: 1 },
      },
    })

    return true
  } catch (error) {
    console.error('Failed to reserve capacity:', error)
    return false
  }
}

/**
 * Release capacity after workload completion.
 */
export async function releaseCapacity(
  region: string,
  targetTime: Date,
  cpuUnits: number = 4,
  gpuUnits: number = 0
): Promise<void> {
  const bucketStart = roundToHour(targetTime)

  try {
    const bucket = await prisma.capacityBucket.findUnique({
      where: { region_bucketStartTs: { region, bucketStartTs: bucketStart } },
    })

    if (bucket) {
      await prisma.capacityBucket.update({
        where: { id: bucket.id },
        data: {
          reservedCpu: { decrement: Math.min(cpuUnits, bucket.reservedCpu) },
          reservedGpu: { decrement: Math.min(gpuUnits, bucket.reservedGpu) },
          allocatedCommands: { decrement: Math.min(1, bucket.allocatedCommands) },
        },
      })
    }
  } catch (error) {
    console.error('Failed to release capacity:', error)
  }
}

/**
 * Get capacity utilization across all regions for a time window.
 * Used by dashboard and queue shaping.
 */
export async function getCapacityOverview(hoursAhead: number = 24) {
  const now = new Date()
  const endTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000)

  const buckets = await prisma.capacityBucket.findMany({
    where: {
      bucketStartTs: {
        gte: roundToHour(now),
        lte: endTime,
      },
    },
    orderBy: { bucketStartTs: 'asc' },
  })

  // Group by region
  const byRegion: Record<string, Array<{
    hour: string
    cpuUtilization: number
    gpuUtilization: number
    commands: number
    queueDepth: number
    costMultiplier: number
  }>> = {}

  for (const bucket of buckets) {
    if (!byRegion[bucket.region]) byRegion[bucket.region] = []
    byRegion[bucket.region].push({
      hour: bucket.bucketStartTs.toISOString(),
      cpuUtilization: bucket.cpuAvailable > 0 ? bucket.reservedCpu / bucket.cpuAvailable : 0,
      gpuUtilization: bucket.gpuAvailable > 0 ? bucket.reservedGpu / bucket.gpuAvailable : 0,
      commands: bucket.allocatedCommands,
      queueDepth: bucket.queueDepth,
      costMultiplier: bucket.costMultiplier,
    })
  }

  return byRegion
}

/**
 * Update cost multiplier for surge pricing.
 * Called periodically based on utilization.
 */
export async function updateCostMultipliers(): Promise<void> {
  const now = new Date()
  const nextHours = new Date(now.getTime() + 6 * 60 * 60 * 1000)

  const buckets = await prisma.capacityBucket.findMany({
    where: {
      bucketStartTs: { gte: roundToHour(now), lte: nextHours },
    },
  })

  for (const bucket of buckets) {
    const utilization = bucket.cpuAvailable > 0 ? bucket.reservedCpu / bucket.cpuAvailable : 0

    // Surge pricing: 1.0x at <50%, up to 2.5x at 90%+
    let multiplier = 1.0
    if (utilization > 0.9) multiplier = 2.5
    else if (utilization > 0.8) multiplier = 2.0
    else if (utilization > 0.7) multiplier = 1.5
    else if (utilization > 0.5) multiplier = 1.2

    if (multiplier !== bucket.costMultiplier) {
      await prisma.capacityBucket.update({
        where: { id: bucket.id },
        data: { costMultiplier: multiplier },
      }).catch(() => {})
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function roundToHour(date: Date): Date {
  const d = new Date(date)
  d.setMinutes(0, 0, 0)
  return d
}
