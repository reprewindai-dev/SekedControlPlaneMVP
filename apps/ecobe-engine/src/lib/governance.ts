/**
 * GOVERNANCE UTILITIES — Single source of truth for governance-critical operations.
 *
 * This module centralizes:
 * - retryAsync: governance-grade retry for audit trail writes
 * - Lease policy: time-bound decision validity based on quality tier
 *
 * Both green-routing.ts and carbon-command.ts must use these shared definitions.
 */

// ── Lease Policy ─────────────────────────────────────────────────────────────
// Defines how long a routing decision remains valid based on signal quality.
// Higher quality signals → longer lease. Lower quality → must revalidate sooner.

export interface LeaseParams {
  leaseMinutes: number
  revalidateMinutes: number
}

const LEASE_POLICY: Record<'high' | 'medium' | 'low', LeaseParams> = {
  high:   { leaseMinutes: 15, revalidateMinutes: 10 },
  medium: { leaseMinutes: 5,  revalidateMinutes: 3 },
  low:    { leaseMinutes: 2,  revalidateMinutes: 1 },
}

export function getLeasePolicy(qualityTier: 'high' | 'medium' | 'low'): LeaseParams {
  return LEASE_POLICY[qualityTier]
}

export function generateLease(qualityTier: 'high' | 'medium' | 'low', decisionFrameId: string) {
  const now = new Date()
  const { leaseMinutes, revalidateMinutes } = getLeasePolicy(qualityTier)
  const leaseId = `lease_${decisionFrameId.slice(0, 8)}_${Date.now()}`

  return {
    lease_id: leaseId,
    lease_expires_at: new Date(now.getTime() + leaseMinutes * 60 * 1000).toISOString(),
    must_revalidate_after: new Date(now.getTime() + revalidateMinutes * 60 * 1000).toISOString(),
    leaseMinutes,
  }
}

// ── retryAsync ───────────────────────────────────────────────────────────────
// Governance-grade async retry. Audit trail data is too important to silently drop.
// Retries up to 3 times with exponential backoff (100ms, 200ms, 400ms).
// Never blocks the routing response — runs detached.

export function retryAsync(fn: () => Promise<unknown>, label: string, maxRetries = 3): void {
  const attempt = async (n: number): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      if (n < maxRetries) {
        const backoff = 100 * Math.pow(2, n - 1)
        await new Promise(r => setTimeout(r, backoff))
        return attempt(n + 1)
      }
      console.error(`[governance] AUDIT FAILURE after ${maxRetries} attempts [${label}]:`, err instanceof Error ? err.message : String(err))
    }
  }
  attempt(1).catch(() => {}) // detach from caller
}
