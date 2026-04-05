import { env, engineConfigured } from './env'

type RoutingDecisionResponse = {
  decisionId: string
  selectedProvider: string
  selectedRegion: string
  estimatedLatency: number
  estimatedCost: number
  carbonEstimate: number
  decisionReason: string
  routeMode?: string
  fallbackUsed?: boolean
  proofHash?: string | null
  proofRecord?: Record<string, unknown> | null
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }

  return response.json()
}

export async function createRoutingDecision(payload: Record<string, any>) {
  if (!engineConfigured()) {
    throw new Error('ECOBE engine is not configured. Set ECOBE_ENGINE_URL and ECOBE_ENGINE_INTERNAL_KEY.')
  }

  try {
    const decision = (await fetchJson(`${env.ECOBE_ENGINE_URL}/internal/v1/routing-decisions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
      },
      body: JSON.stringify(payload),
    })) as RoutingDecisionResponse

    return {
      ...decision,
      proofHash: decision.proofHash ?? null,
      proofRecord: decision.proofRecord ?? null,
      proofUnavailableReason:
        decision.proofHash || decision.proofRecord
          ? null
          : 'Internal ECOBE routing contract does not currently return proof material',
    }
  } catch (error) {
    throw new Error(
      `Engine routing decision failed against ${env.ECOBE_ENGINE_URL}/internal/v1/routing-decisions: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export async function executeAllocation(decisionId: string) {
  if (!engineConfigured()) {
    throw new Error('ECOBE engine is not configured. Set ECOBE_ENGINE_URL and ECOBE_ENGINE_INTERNAL_KEY.')
  }

  try {
    return await fetchJson(`${env.ECOBE_ENGINE_URL}/internal/v1/routing-decisions/${decisionId}/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
      },
    })
  } catch (error) {
    throw new Error(
      `Engine allocation failed against ${env.ECOBE_ENGINE_URL}/internal/v1/routing-decisions/${decisionId}/execute: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export async function getEngineHealth() {
  try {
    return await fetchJson(`${env.ECOBE_ENGINE_URL}/internal/v1/health`, {
      headers: {
        authorization: `Bearer ${env.ECOBE_ENGINE_INTERNAL_KEY}`,
      },
    })
  } catch (error) {
    return {
      status: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
