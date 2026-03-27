interface ConflictResolverInput {
  carbonConfidence: number
  carbonFallbackUsed: boolean
  carbonDisagreementFlag: boolean
  carbonDisagreementPct: number
  waterConfidence: number
  waterFallbackUsed: boolean
}

export interface ConflictResolverResult {
  penalty: number
  reasonCodes: string[]
}

/**
 * Lowest defensible signal doctrine:
 * penalize candidates that rely on lower-confidence or conflicting signals.
 */
export function applyLowestDefensibleSignalPenalty(input: ConflictResolverInput): ConflictResolverResult {
  let penalty = 0
  const reasonCodes: string[] = []

  if (input.carbonFallbackUsed) {
    penalty += 75
    reasonCodes.push('CARBON_FALLBACK_USED')
  }

  if (input.carbonDisagreementFlag) {
    const disagreementPenalty = Math.min(40, Math.max(0, input.carbonDisagreementPct))
    penalty += disagreementPenalty
    reasonCodes.push('CARBON_PROVIDER_DISAGREEMENT')
  }

  if (input.carbonConfidence < 0.5) {
    penalty += (0.5 - input.carbonConfidence) * 100
    reasonCodes.push('CARBON_LOW_CONFIDENCE')
  }

  if (input.waterFallbackUsed) {
    penalty += 60
    reasonCodes.push('WATER_FALLBACK_USED')
  }

  if (input.waterConfidence < 0.6) {
    penalty += (0.6 - input.waterConfidence) * 80
    reasonCodes.push('WATER_LOW_CONFIDENCE')
  }

  return {
    penalty: Number(penalty.toFixed(6)),
    reasonCodes,
  }
}

