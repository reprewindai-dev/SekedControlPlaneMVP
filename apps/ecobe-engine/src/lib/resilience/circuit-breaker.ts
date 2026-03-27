/**
 * Production-grade circuit breaker and resilience layer for ECOBE API clients.
 * Provides state management, retry logic, timeout handling, and concurrency control.
 */

/**
 * Circuit breaker state enumeration
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Configuration for CircuitBreaker
 */
export interface CircuitBreakerConfig {
  failureThreshold?: number
  resetTimeoutMs?: number
  halfOpenMaxAttempts?: number
}

/**
 * Configuration for RetryWithBackoff
 */
export interface RetryConfig {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

/**
 * Configuration for TimeoutWrapper
 */
export interface TimeoutConfig {
  timeoutMs?: number
}

/**
 * Configuration for BulkheadIsolation
 */
export interface BulkheadConfig {
  maxConcurrent?: number
  maxQueueSize?: number
}

/**
 * Configuration for ApiResilienceWrapper
 */
export interface ApiResilienceConfig extends CircuitBreakerConfig, RetryConfig, TimeoutConfig, BulkheadConfig {}

/**
 * Health status returned by ApiResilienceWrapper
 */
export interface HealthStatus {
  name: string
  circuitState: CircuitState
  failureCount: number
  successCount: number
  queueDepth: number
  activeConcurrent: number
  lastFailureTime: Date | null
  lastSuccessTime: Date | null
  totalRequests: number
}

/**
 * Resilience event for logging and monitoring
 */
export interface ResilienceEvent {
  timestamp: Date
  name: string
  eventType: 'CIRCUIT_STATE_CHANGE' | 'RETRY' | 'TIMEOUT' | 'QUEUE_FULL' | 'REQUEST_EXECUTED'
  details: Record<string, unknown>
}

/**
 * Circuit Breaker implementation with configurable state management
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private failureCount: number = 0
  private successCount: number = 0
  private lastFailureTime: Date | null = null
  private lastSuccessTime: Date | null = null
  private resetTimer: NodeJS.Timeout | null = null
  private halfOpenAttempts: number = 0

  readonly failureThreshold: number
  readonly resetTimeoutMs: number
  readonly halfOpenMaxAttempts: number

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5
    this.resetTimeoutMs = config.resetTimeoutMs ?? 30000
    this.halfOpenMaxAttempts = config.halfOpenMaxAttempts ?? 3
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.successCount++
    this.lastSuccessTime = new Date()

    if (this.state === CircuitState.OPEN) {
      // Still open, do nothing yet
      return
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this.transitionTo(CircuitState.CLOSED)
      }
      return
    }

    // CLOSED: reset failure count
    this.failureCount = 0
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    this.failureCount++
    this.lastFailureTime = new Date()

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open goes back to open
      this.transitionTo(CircuitState.OPEN)
      return
    }

    if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
      this.transitionTo(CircuitState.OPEN)
    }
  }

  /**
   * Check if the circuit is available for requests
   */
  canExecute(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true
    }

    if (this.state === CircuitState.OPEN) {
      // Check if reset timeout has elapsed
      if (this.lastFailureTime) {
        const elapsed = Date.now() - this.lastFailureTime.getTime()
        if (elapsed >= this.resetTimeoutMs) {
          this.transitionTo(CircuitState.HALF_OPEN)
          return true
        }
      }
      return false
    }

    // HALF_OPEN: allow single attempts
    return true
  }

  /**
   * Execute an async function with circuit breaker protection
   */
  async execute<T>(fn: () => PromiseLike<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new Error(`Circuit breaker is ${this.state}`)
    }

    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (error) {
      this.recordFailure()
      throw error
    }
  }

  /**
   * Transition to a new state and log it
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state
    this.state = newState
    this.halfOpenAttempts = 0

    if (newState === CircuitState.OPEN) {
      this.scheduleReset()
    } else if (newState === CircuitState.CLOSED) {
      this.failureCount = 0
      if (this.resetTimer) {
        clearTimeout(this.resetTimer)
        this.resetTimer = null
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'CIRCUIT_BREAKER_STATE_CHANGE',
        from: oldState,
        to: newState,
        failureCount: this.failureCount,
      })
    )
  }

  /**
   * Schedule automatic reset after timeout
   */
  private scheduleReset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer)
    }

    this.resetTimer = setTimeout(() => {
      if (this.state === CircuitState.OPEN) {
        this.transitionTo(CircuitState.HALF_OPEN)
      }
    }, this.resetTimeoutMs)
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): {
    state: CircuitState
    failureCount: number
    successCount: number
    lastFailureTime: Date | null
    lastSuccessTime: Date | null
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
    }
  }

  /**
   * Reset circuit to CLOSED state
   */
  reset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer)
      this.resetTimer = null
    }
    this.state = CircuitState.CLOSED
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = null
    this.lastSuccessTime = null
    this.halfOpenAttempts = 0
  }
}

/**
 * Retry with exponential backoff and jitter
 */
export async function retryWithBackoff<T>(
  fn: () => PromiseLike<T>,
  config: RetryConfig = {}
): Promise<T> {
  const maxRetries = config.maxRetries ?? 3
  const baseDelayMs = config.baseDelayMs ?? 1000
  const maxDelayMs = config.maxDelayMs ?? 10000

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === maxRetries) {
        break
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt)
      const jitter = Math.random() * (exponentialDelay * 0.1) // 10% jitter
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs)

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: 'RETRY_WITH_BACKOFF',
          attempt: attempt + 1,
          maxRetries,
          delayMs: Math.round(delay),
          error: error instanceof Error ? error.message : String(error),
        })
      )

      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Timeout wrapper for promises
 */
export async function timeoutWrapper<T>(
  promise: PromiseLike<T>,
  config: TimeoutConfig = {}
): Promise<T> {
  const timeoutMs = config.timeoutMs ?? 10000
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

/**
 * Bulkhead isolation to limit concurrent requests
 */
export class BulkheadIsolation {
  private activeConcurrent: number = 0
  private queue: Array<{
    fn: () => Promise<unknown>
    resolve: (value: unknown) => void
    reject: (reason?: unknown) => void
  }> = []

  readonly maxConcurrent: number
  readonly maxQueueSize: number

  constructor(config: BulkheadConfig = {}) {
    this.maxConcurrent = config.maxConcurrent ?? 10
    this.maxQueueSize = config.maxQueueSize ?? 100
  }

  /**
   * Execute a function with concurrency control
   */
  async execute<T>(fn: () => PromiseLike<T>): Promise<T> {
    if (this.queue.length >= this.maxQueueSize) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: 'BULKHEAD_QUEUE_FULL',
          queueSize: this.queue.length,
          maxQueueSize: this.maxQueueSize,
        })
      )
      throw new Error('Bulkhead queue is full')
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      this.processQueue()
    })
  }

  /**
   * Process queued tasks
   */
  private async processQueue(): Promise<void> {
    if (this.activeConcurrent >= this.maxConcurrent || this.queue.length === 0) {
      return
    }

    const task = this.queue.shift()
    if (!task) {
      return
    }

    this.activeConcurrent++

    try {
      const result = await task.fn()
      task.resolve(result)
    } catch (error) {
      task.reject(error)
    } finally {
      this.activeConcurrent--
      // Process next task
      setImmediate(() => this.processQueue())
    }
  }

  /**
   * Get queue status
   */
  getStatus(): { queueDepth: number; activeConcurrent: number } {
    return {
      queueDepth: this.queue.length,
      activeConcurrent: this.activeConcurrent,
    }
  }

  /**
   * Clear queue
   */
  drain(): void {
    const count = this.queue.length
    for (const task of this.queue) {
      task.reject(new Error('Bulkhead drained'))
    }
    this.queue = []

    if (count > 0) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: 'BULKHEAD_DRAINED',
          tasksDrained: count,
        })
      )
    }
  }
}

/**
 * Comprehensive API resilience wrapper combining all patterns
 */
export class ApiResilienceWrapper {
  private circuitBreaker: CircuitBreaker
  private bulkhead: BulkheadIsolation
  private retryConfig: RetryConfig
  private timeoutConfig: TimeoutConfig
  private totalRequests: number = 0

  readonly name: string

  constructor(name: string, config: ApiResilienceConfig = {}) {
    this.name = name
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: config.failureThreshold,
      resetTimeoutMs: config.resetTimeoutMs,
      halfOpenMaxAttempts: config.halfOpenMaxAttempts,
    })
    this.bulkhead = new BulkheadIsolation({
      maxConcurrent: config.maxConcurrent,
      maxQueueSize: config.maxQueueSize,
    })
    this.retryConfig = {
      maxRetries: config.maxRetries,
      baseDelayMs: config.baseDelayMs,
      maxDelayMs: config.maxDelayMs,
    }
    this.timeoutConfig = {
      timeoutMs: config.timeoutMs,
    }
  }

  /**
   * Execute a function with full resilience chain:
   * bulkhead -> circuit breaker -> timeout -> retry -> actual call
   */
  async execute<T>(fnOrLabel: string | (() => PromiseLike<T>), maybeFn?: () => PromiseLike<T>): Promise<T> {
    const label = typeof fnOrLabel === 'string' ? fnOrLabel : undefined
    const fn = typeof fnOrLabel === 'function' ? fnOrLabel : maybeFn!
    this.totalRequests++

    const startTime = Date.now()

    return this.bulkhead.execute(async () => {
      return this.circuitBreaker.execute(async () => {
        return retryWithBackoff(
          async () => {
            return timeoutWrapper(fn(), this.timeoutConfig)
          },
          this.retryConfig
        )
      })
    }).finally(() => {
      const duration = Date.now() - startTime
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: 'RESILIENCE_REQUEST',
          name: this.name,
          operation: label,
          durationMs: duration,
        })
      )
    })
  }

  /**
   * Get comprehensive health status
   */
  getHealthStatus(): HealthStatus {
    const circuitMetrics = this.circuitBreaker.getMetrics()
    const bulkheadStatus = this.bulkhead.getStatus()

    return {
      name: this.name,
      circuitState: circuitMetrics.state,
      failureCount: circuitMetrics.failureCount,
      successCount: circuitMetrics.successCount,
      queueDepth: bulkheadStatus.queueDepth,
      activeConcurrent: bulkheadStatus.activeConcurrent,
      lastFailureTime: circuitMetrics.lastFailureTime,
      lastSuccessTime: circuitMetrics.lastSuccessTime,
      totalRequests: this.totalRequests,
    }
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.circuitBreaker.reset()
    this.bulkhead.drain()
    this.totalRequests = 0

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'RESILIENCE_WRAPPER_RESET',
        name: this.name,
      })
    )
  }

  /**
   * Check if the API is healthy
   */
  isHealthy(): boolean {
    return this.circuitBreaker.getState() !== CircuitState.OPEN
  }

  /**
   * Drain the bulkhead queue (for graceful shutdown)
   */
  drain(): void {
    this.bulkhead.drain()
  }
}
