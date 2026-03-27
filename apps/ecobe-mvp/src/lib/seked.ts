import { env, governanceFallbackAllowed } from './env'

export function evaluateSekedLocally(input: Record<string, any>, rules?: Record<string, any>) {
  const prompt = JSON.stringify(input).toLowerCase()
  const score =
    (prompt.includes('delete all') ? 55 : 0) +
    (prompt.includes('bypass') ? 25 : 0) +
    (prompt.length > 4000 ? 15 : 0) +
    (rules?.strictMode ? 5 : 0)

  const drift = prompt.includes('ignore previous')
  const fracture = prompt.length > 6000
  const blocked = score >= 75
  const requiresApproval = !blocked && score >= 45

  return {
    score,
    drift,
    fracture,
    tier: blocked ? 'critical' : requiresApproval ? 'elevated' : 'standard',
    blocked,
    requiresApproval,
    blockReason: blocked ? 'Policy risk threshold exceeded by Seked' : null,
  }
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
    return {
      score: data.score ?? data.detrimental ?? 0,
      drift: Boolean(data.drift),
      fracture: Boolean(data.fracture),
      tier: data.tier ?? 'standard',
      blocked: Boolean(data.blocked),
      requiresApproval: Boolean(data.requiresApproval),
      blockReason: data.blockReason ?? null,
    }
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
