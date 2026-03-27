import {
  CircuitBreaker,
  CircuitState,
  retryWithBackoff,
  timeoutWrapper,
  BulkheadIsolation,
  ApiResilienceWrapper,
} from '../circuit-breaker'

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenMaxAttempts: 2,
    })
  })

  afterEach(() => {
    breaker.reset()
  })

  it('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED)
  })

  it('should allow execution in CLOSED state', async () => {
    const fn = jest.fn().mockResolvedValue('success')
    const result = await breaker.execute(fn)
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should transition to OPEN after threshold failures', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'))

    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(fn)
      } catch {
        // Expected
      }
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN)
  })

  it('should reject execution in OPEN state', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'))

    // Fill failure threshold
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(fn)
      } catch {
        // Expected
      }
    }

    // Should reject without calling function
    await expect(breaker.execute(() => Promise.resolve())).rejects.toThrow(/Circuit breaker is OPEN/)
  })

  it('should transition to HALF_OPEN after reset timeout', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'))

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(fn)
      } catch {
        // Expected
      }
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN)

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Should allow execution and transition to HALF_OPEN
    const successFn = jest.fn().mockResolvedValue('success')
    const result = await breaker.execute(successFn)
    expect(result).toBe('success')
  })

  it('should go back to CLOSED after successful half-open attempts', async () => {
    // Open the circuit
    const failFn = jest.fn().mockRejectedValue(new Error('fail'))
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(failFn)
      } catch {
        // Expected
      }
    }

    // Wait for reset
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Successful attempts should close it
    const successFn = jest.fn().mockResolvedValue('success')
    await breaker.execute(successFn)
    await breaker.execute(successFn)

    expect(breaker.getState()).toBe(CircuitState.CLOSED)
  })

  it('should provide metrics', () => {
    const metrics = breaker.getMetrics()
    expect(metrics).toHaveProperty('state')
    expect(metrics).toHaveProperty('failureCount')
    expect(metrics).toHaveProperty('successCount')
  })

  it('should reset state', () => {
    breaker.recordFailure()
    breaker.recordFailure()
    expect(breaker.getMetrics().failureCount).toBe(2)

    breaker.reset()
    expect(breaker.getMetrics().failureCount).toBe(0)
    expect(breaker.getState()).toBe(CircuitState.CLOSED)
  })
})

describe('retryWithBackoff', () => {
  it('should retry on failure', async () => {
    let attempts = 0
    const fn = jest.fn().mockImplementation(() => {
      attempts++
      if (attempts < 2) {
        return Promise.reject(new Error('fail'))
      }
      return Promise.resolve('success')
    })

    const result = await retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 })
    expect(result).toBe('success')
    expect(attempts).toBe(2)
  })

  it('should eventually throw after max retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fail'))
    await expect(retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 })).rejects.toThrow('always fail')
    expect(fn).toHaveBeenCalledTimes(3) // Initial + 2 retries
  })
})

describe('timeoutWrapper', () => {
  it('should resolve if promise completes before timeout', async () => {
    const promise = Promise.resolve('success')
    const result = await timeoutWrapper(promise, { timeoutMs: 1000 })
    expect(result).toBe('success')
  })

  it('should timeout if promise takes too long', async () => {
    const promise = new Promise<string>(() => {
      // Intentionally never resolves to verify timeout behavior without leaking timers.
    })
    await expect(timeoutWrapper(promise, { timeoutMs: 100 })).rejects.toThrow()
  })
})

describe('BulkheadIsolation', () => {
  it('should limit concurrent execution', async () => {
    const bulkhead = new BulkheadIsolation({ maxConcurrent: 2, maxQueueSize: 10 })
    let concurrent = 0
    let maxConcurrentSeen = 0

    const fn = async () => {
      concurrent++
      maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrent)
      await new Promise((resolve) => setTimeout(resolve, 10))
      concurrent--
    }

    const promises = Array(5)
      .fill(null)
      .map(() => bulkhead.execute(fn))

    await Promise.all(promises)
    expect(maxConcurrentSeen).toBeLessThanOrEqual(2)
  })

  it('should report status', () => {
    const bulkhead = new BulkheadIsolation({ maxConcurrent: 2 })
    const status = bulkhead.getStatus()
    expect(status).toHaveProperty('queueDepth')
    expect(status).toHaveProperty('activeConcurrent')
  })
})

describe('ApiResilienceWrapper', () => {
  it('should execute successfully', async () => {
    const wrapper = new ApiResilienceWrapper('test', { timeoutMs: 5000 })
    const fn = jest.fn().mockResolvedValue('success')

    const result = await wrapper.execute(fn)
    expect(result).toBe('success')
    expect(wrapper.isHealthy()).toBe(true)
  })

  it('should provide health status', async () => {
    const wrapper = new ApiResilienceWrapper('test', { timeoutMs: 5000 })
    const status = wrapper.getHealthStatus()

    expect(status).toHaveProperty('name')
    expect(status).toHaveProperty('circuitState')
    expect(status).toHaveProperty('failureCount')
    expect(status).toHaveProperty('successCount')
    expect(status).toHaveProperty('queueDepth')
    expect(status).toHaveProperty('activeConcurrent')
    expect(status).toHaveProperty('totalRequests')
  })

  it('should reset state', async () => {
    const wrapper = new ApiResilienceWrapper('test', { timeoutMs: 5000 })
    const fn = jest.fn().mockResolvedValue('success')

    await wrapper.execute(fn)
    const statusBefore = wrapper.getHealthStatus()

    wrapper.reset()
    const statusAfter = wrapper.getHealthStatus()

    expect(statusAfter.totalRequests).toBe(0)
    expect(statusAfter.failureCount).toBe(0)
  })

  it('should track total requests', async () => {
    const wrapper = new ApiResilienceWrapper('test', { timeoutMs: 5000 })
    const fn = jest.fn().mockResolvedValue('success')

    await wrapper.execute(fn)
    await wrapper.execute(fn)

    const status = wrapper.getHealthStatus()
    expect(status.totalRequests).toBe(2)
  })
})
