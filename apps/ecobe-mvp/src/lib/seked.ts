import { env, governanceFallbackAllowed } from './env'

export type SekedDirectiveAction = 'EXECUTE' | 'HALT' | 'REQUIRE_APPROVAL' | 'CLARIFY'

export type SekedDirective = {
  action: SekedDirectiveAction
  reason: string
}

export type SekedEvaluation = {
  score: number
  drift: boolean
  fracture: boolean
  tier: string
  blocked: boolean
  requiresApproval: boolean
  blockReason: string | null
  directive: SekedDirective
}

const VALID_DIRECTIVE_ACTIONS = new Set<SekedDirectiveAction>([
  'EXECUTE',
  'HALT',
  'REQUIRE_APPROVAL',
  'CLARIFY',
])

function clampScore(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function isDirectiveAction(value: unknown): value is SekedDirectiveAction {
  return typeof value === 'string' && VALID_DIRECTIVE_ACTIONS.has(value as SekedDirectiveAction)
}

function mapDirective(input: {
  score: number
  drift: boolean
  fracture: boolean
  blocked: boolean
  requiresApproval: boolean
  blockReason: string | null
}): SekedDirective {
  if (input.blocked) {
    return {
      action: 'HALT',
      reason: input.blockReason ?? 'Policy risk threshold exceeded by Seked',
    }
  }

  if (input.fracture) {
    return {
      action: 'CLARIFY',
      reason: 'Input integrity fracture detected; clarification required before execution',
    }
  }

  if (input.drift) {
    return {
      action: 'REQUIRE_APPROVAL',
      reason: 'Instruction drift detected; human approval required before execution',
    }
  }

  if (input.score >= env.SEKED_CLARIFY_SCORE_THRESHOLD) {
    return {
      action: 'CLARIFY',
      reason: `Risk score ${input.score} crossed clarify threshold ${env.SEKED_CLARIFY_SCORE_THRESHOLD}`,
    }
  }

  if (input.requiresApproval) {
    return {
      action: 'REQUIRE_APPROVAL',
      reason: 'Risk score requires human approval before execution',
    }
  }

  return {
    action: 'EXECUTE',
    reason: 'Governance checks passed for execution',
  }
}

export function normalizeSekedEvaluation(input: {
  score?: unknown
  drift?: unknown
  fracture?: unknown
  tier?: unknown
  blocked?: unknown
  requiresApproval?: unknown
  blockReason?: unknown
  directive?: unknown
}): SekedEvaluation {
  const score = clampScore(input.score)
  const drift = Boolean(input.drift)
  const fracture = Boolean(input.fracture)
  const blocked = Boolean(input.blocked)
  const requiresApprovalFromSource = Boolean(input.requiresApproval)
  const blockReason = input.blockReason ? String(input.blockReason) : null

  const providedDirective =
    input.directive && typeof input.directive === 'object'
      ? (input.directive as { action?: unknown; reason?: unknown })
      : null

  const computedDirective = mapDirective({
    score,
    drift,
    fracture,
    blocked,
    requiresApproval: requiresApprovalFromSource,
    blockReason,
  })

  const directive =
    providedDirective && isDirectiveAction(providedDirective.action)
      ? {
          action: providedDirective.action,
          reason: providedDirective.reason ? String(providedDirective.reason) : computedDirective.reason,
        }
      : computedDirective

  const requiresApproval =
    directive.action === 'REQUIRE_APPROVAL' ||
    directive.action === 'CLARIFY' ||
    (!blocked && requiresApprovalFromSource)

  const normalizedBlocked = directive.action === 'HALT' || blocked

  return {
    score,
    drift,
    fracture,
    tier: input.tier ? String(input.tier) : normalizedBlocked ? 'critical' : requiresApproval ? 'elevated' : 'standard',
    blocked: normalizedBlocked,
    requiresApproval,
    blockReason: normalizedBlocked ? blockReason ?? directive.reason : null,
    directive,
  }
}

export function evaluateSekedLocally(input: Record<string, any>, rules?: Record<string, any>) {
  const transcript = typeof input.transcript === 'string' ? input.transcript.trim() : ''
  const promptText = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  const governanceText = `${promptText}\n${transcript}`.trim().toLowerCase()
  const serializedInput = JSON.stringify(input).toLowerCase()
  const inspectionTarget = governanceText || serializedInput
  const score =
    (inspectionTarget.includes('delete all') ? 55 : 0) +
    (inspectionTarget.includes('bypass') ? 25 : 0) +
    (inspectionTarget.length > 4000 ? 15 : 0) +
    (rules?.strictMode ? 5 : 0)

  const drift = inspectionTarget.includes('ignore previous')
  const fracture = transcript
    ? transcript.length > 12000
    : promptText
      ? promptText.length > 12000
      : serializedInput.length > 24000
  const blocked = score >= 75
  const requiresApproval = !blocked && score >= 45

  return normalizeSekedEvaluation({
    score,
    drift,
    fracture,
    tier: blocked ? 'critical' : requiresApproval ? 'elevated' : 'standard',
    blocked,
    requiresApproval,
    blockReason: blocked ? 'Policy risk threshold exceeded by Seked' : null,
  })
}

export async function evaluateSeked(input: Record<string, any>, rules?: Record<string, any>) {
  if (!env.SEKED_URL) {
    if (!governanceFallbackAllowed()) {
      throw new Error('SEKED_URL is required when governance fallback is disabled')
    }

    return evaluateSekedLocally(input, rules)
  }

  try {
    const response = await fetch(`${env.SEKED_URL}/v1/governance/evaluate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.SEKED_INTERNAL_KEY
          ? { authorization: `Bearer ${env.SEKED_INTERNAL_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        input,
        rules,
      }),
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(await response.text())
    }

    const data = await response.json()
    return normalizeSekedEvaluation({
      score: data.score ?? data.detrimental ?? 0,
      drift: data.drift,
      fracture: data.fracture,
      tier: data.tier ?? 'standard',
      blocked: data.blocked,
      requiresApproval: data.requiresApproval,
      blockReason: data.blockReason ?? null,
      directive: data.directive,
    })
  } catch (error) {
    if (!governanceFallbackAllowed()) {
      throw error
    }

    return evaluateSekedLocally(input, rules)
  }
}

export async function getSekedHealth() {
  if (!env.SEKED_URL) {
    return { status: governanceFallbackAllowed() ? 'not_configured' : 'missing_dependency' }
  }

  try {
    const response = await fetch(`${env.SEKED_URL}/health`, {
      cache: 'no-store',
      headers: env.SEKED_INTERNAL_KEY
        ? { authorization: `Bearer ${env.SEKED_INTERNAL_KEY}` }
        : undefined,
    })
    return {
      status: response.ok ? 'healthy' : 'degraded',
    }
  } catch (error) {
    return {
      status: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
