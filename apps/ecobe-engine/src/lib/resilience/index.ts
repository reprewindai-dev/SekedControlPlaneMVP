/**
 * Pre-configured resilience wrapper instances for ECOBE API clients.
 * Each instance is tuned for the specific characteristics and SLA requirements of its provider.
 */

import { ApiResilienceWrapper } from './circuit-breaker'

/**
 * WattTime Resilience Wrapper
 * - Provider: WattTime (MOER current + forecast)
 * - Timeout: 8s (API typically responds within 2-3s)
 * - Retries: 2 (WattTime is fairly reliable)
 * - Failure Threshold: 3 (faster detection, shorter feedback loop)
 * - Role: Primary causal routing signal
 */
export const wattTimeResilience = new ApiResilienceWrapper('watttime', {
  timeoutMs: 8000,
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 3000,
  failureThreshold: 3,
  resetTimeoutMs: 20000,
  halfOpenMaxAttempts: 2,
  maxConcurrent: 5,
  maxQueueSize: 50,
})

/**
 * Electricity Maps Resilience Wrapper
 * - Provider: Electricity Maps (carbon intensity, mix, flow)
 * - Timeout: 8s (API typically responds within 2-3s)
 * - Retries: 2 (good reliability)
 * - Failure Threshold: 3 (consistent performance)
 * - Role: Grid intelligence and validation
 */
export const electricityMapsResilience = new ApiResilienceWrapper('electricity_maps', {
  timeoutMs: 8000,
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 3000,
  failureThreshold: 3,
  resetTimeoutMs: 20000,
  halfOpenMaxAttempts: 2,
  maxConcurrent: 5,
  maxQueueSize: 50,
})

/**
 * Ember Resilience Wrapper
 * - Provider: Ember (monthly structural profiles, generation mix trends)
 * - Timeout: 15s (slower endpoint, larger responses)
 * - Retries: 1 (data is not time-critical, lower priority)
 * - Failure Threshold: 5 (more tolerance, structural validation only)
 * - Role: Validation and structural context
 */
export const emberResilience = new ApiResilienceWrapper('ember', {
  timeoutMs: 15000,
  maxRetries: 1,
  baseDelayMs: 1000,
  maxDelayMs: 5000,
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 1,
  maxConcurrent: 3,
  maxQueueSize: 30,
})

/**
 * EIA-930 Resilience Wrapper
 * - Provider: EIA Real-Time Grid Data (BALANCE, INTERCHANGE, SUBREGION)
 * - Timeout: 12s (larger datasets, parsing overhead)
 * - Retries: 2 (good availability but data-heavy)
 * - Failure Threshold: 4 (balanced detection)
 * - Role: Predictive telemetry and grid features
 */
export const eiaResilience = new ApiResilienceWrapper('eia', {
  timeoutMs: 12000,
  maxRetries: 2,
  baseDelayMs: 750,
  maxDelayMs: 4000,
  failureThreshold: 4,
  resetTimeoutMs: 25000,
  halfOpenMaxAttempts: 2,
  maxConcurrent: 4,
  maxQueueSize: 40,
})

/**
 * Export health check utility
 */
export function getAllHealthStatus(): Array<{
  name: string
  isHealthy: boolean
  circuitState: string
  failureCount: number
  totalRequests: number
}> {
  return [
    { ...wattTimeResilience.getHealthStatus(), isHealthy: wattTimeResilience.isHealthy() },
    { ...electricityMapsResilience.getHealthStatus(), isHealthy: electricityMapsResilience.isHealthy() },
    { ...emberResilience.getHealthStatus(), isHealthy: emberResilience.isHealthy() },
    { ...eiaResilience.getHealthStatus(), isHealthy: eiaResilience.isHealthy() },
  ]
}

/**
 * Graceful shutdown: drain all bulkheads and allow pending requests to complete
 */
export async function gracefulShutdown(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'RESILIENCE_SHUTDOWN',
      message: 'Draining all resilience bulkheads',
    })
  )

  wattTimeResilience.drain()
  electricityMapsResilience.drain()
  emberResilience.drain()
  eiaResilience.drain()

  // Allow pending tasks to complete (max 5s)
  await new Promise((resolve) => setTimeout(resolve, 5000))
}

/**
 * Export all instances for direct access if needed
 */
export { ApiResilienceWrapper, CircuitState, CircuitBreaker, BulkheadIsolation, retryWithBackoff, timeoutWrapper } from './circuit-breaker'
export type { HealthStatus, CircuitBreakerConfig, RetryConfig, TimeoutConfig, BulkheadConfig, ApiResilienceConfig } from './circuit-breaker'
