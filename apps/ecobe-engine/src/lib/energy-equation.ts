import { prisma } from './db'
import { providerRouter } from './carbon/provider-router'

export interface EnergyRequest {
  requestVolume: number
  workloadType: 'inference' | 'training' | 'batch'
  modelSize?: string
  regionTargets: string[]
  carbonBudget?: number  // gCO2eq
  deadlineWindow?: {
    start: string
    end: string
  }
  hardwareMix?: {
    cpu: number
    gpu: number
    tpu: number
  }
}

export interface EnergyResponse {
  routingRecommendation: Array<{
    region: string
    rank: number
    carbonIntensity: number
    estimatedCO2: number
    estimatedEnergyKwh: number
    score: number
  }>
  regionEstimates: Array<{
    region: string
    carbonIntensity: number
    estimatedCO2: number
    estimatedEnergyKwh: number
  }>
  totalEstimatedCO2: number
  withinBudget: boolean
}

// Energy consumption constants (kWh per 1000 requests)
const ENERGY_PER_1K_REQUESTS = {
  inference: {
    small: 0.05,   // < 10B params
    medium: 0.15,  // 10-50B params
    large: 0.40,   // 50-100B params
    xlarge: 1.20,  // > 100B params
  },
  training: {
    small: 5.0,
    medium: 25.0,
    large: 100.0,
    xlarge: 500.0,
  },
  batch: {
    small: 0.03,
    medium: 0.10,
    large: 0.30,
    xlarge: 0.80,
  },
}

function estimateEnergyKwh(
  requestVolume: number,
  workloadType: string,
  modelSize?: string
): number {
  // Determine model size category
  let sizeCategory: 'small' | 'medium' | 'large' | 'xlarge' = 'medium'

  if (modelSize) {
    const lower = modelSize.toLowerCase()
    if (lower.includes('8b') || lower.includes('7b')) sizeCategory = 'small'
    else if (lower.includes('70b') || lower.includes('65b')) sizeCategory = 'large'
    else if (lower.includes('175b') || lower.includes('mixtral')) sizeCategory = 'xlarge'
  }

  const baseEnergy =
    ENERGY_PER_1K_REQUESTS[workloadType as keyof typeof ENERGY_PER_1K_REQUESTS]?.[sizeCategory] ??
    ENERGY_PER_1K_REQUESTS.inference.medium

  return (requestVolume / 1000) * baseEnergy
}

export async function calculateEnergyEquation(
  request: EnergyRequest
): Promise<EnergyResponse> {
  const { requestVolume, workloadType, modelSize, regionTargets, carbonBudget } = request

  // Estimate energy consumption
  const energyKwh = estimateEnergyKwh(requestVolume, workloadType, modelSize)

  // Get carbon intensity for all regions
  const regionEstimates = await Promise.all(
    regionTargets.map(async (region) => {
      const signal = await providerRouter.getRoutingSignal(region, new Date()).catch(() => null)
      const carbonIntensity = signal?.carbonIntensity ?? 400
      const estimatedCO2 = energyKwh * carbonIntensity  // gCO2eq

      return {
        region,
        carbonIntensity,
        estimatedCO2,
        estimatedEnergyKwh: energyKwh,
      }
    })
  )

  // Score and rank regions
  const scored = regionEstimates.map((r) => {
    // Lower carbon = higher score
    const maxCarbon = Math.max(...regionEstimates.map((x) => x.carbonIntensity))
    const score = 1 - r.carbonIntensity / maxCarbon

    return {
      ...r,
      score,
    }
  })

  scored.sort((a, b) => b.score - a.score)

  const routingRecommendation = scored.map((r, idx) => ({
    region: r.region,
    rank: idx + 1,
    carbonIntensity: r.carbonIntensity,
    estimatedCO2: r.estimatedCO2,
    estimatedEnergyKwh: r.estimatedEnergyKwh,
    score: r.score,
  }))

  // Calculate total if using best region
  const bestRegion = scored[0]
  const totalEstimatedCO2 = bestRegion.estimatedCO2

  const withinBudget = carbonBudget ? totalEstimatedCO2 <= carbonBudget : true

  return {
    routingRecommendation,
    regionEstimates,
    totalEstimatedCO2,
    withinBudget,
  }
}
