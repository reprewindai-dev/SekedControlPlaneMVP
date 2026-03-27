import { env, governanceFallbackAllowed } from './env'

export function evaluateConvergeosLocally(input: Record<string, any>) {
  const schemaValid = input !== null && typeof input === 'object'
  const patchCount = schemaValid ? 0 : 1
  const attemptCount = schemaValid ? 1 : 2
  const qualityScore = schemaValid ? 92 : 48

  return {
    attemptCount,
    schemaValid,
    qualityScore,
    finalDecision: schemaValid ? 'accepted' : 'rejected',
    patchHistory: patchCount ? ['Applied schema normalization patch'] : [],
  }
}

export async function evaluateConvergeos(input: Record<string, any>) {
  if (!env.CONVERGEOS_URL) {
    if (!governanceFallbackAllowed()) {
      throw new Error('CONVERGEOS_URL is required when governance fallback is disabled')
    }

    return evaluateConvergeosLocally(input)
  }

  try {
    const response = await fetch(`${env.CONVERGEOS_URL}/v1/converge`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.CONVERGEOS_INTERNAL_KEY
          ? { authorization: `Bearer ${env.CONVERGEOS_INTERNAL_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        payload: input,
      }),
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(await response.text())
    }

    const data = await response.json()
    return {
      attemptCount: data.attempts ?? data.attemptCount ?? 1,
      schemaValid: Boolean(data.schemaValid),
      qualityScore: Number(data.qualityScore ?? 0),
      finalDecision: data.finalDecision ?? 'accepted',
      patchHistory: data.patches ?? [],
    }
  } catch (error) {
    if (!governanceFallbackAllowed()) {
      throw error
    }

    return evaluateConvergeosLocally(input)
  }
}

export async function getConvergeosHealth() {
  if (!env.CONVERGEOS_URL) {
    return { status: governanceFallbackAllowed() ? 'not_configured' : 'missing_dependency' }
  }

  try {
    const response = await fetch(`${env.CONVERGEOS_URL}/health`, {
      cache: 'no-store',
      headers: env.CONVERGEOS_INTERNAL_KEY
        ? { authorization: `Bearer ${env.CONVERGEOS_INTERNAL_KEY}` }
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
