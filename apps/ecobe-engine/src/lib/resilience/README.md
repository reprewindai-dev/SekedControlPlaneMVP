# Resilience Layer for ECOBE API Clients

Production-grade circuit breaker, retry, timeout, and concurrency control for the ECOBE CO₂ Router engine API integrations.

## Overview

The resilience layer provides:

- **Circuit Breaker**: Prevents cascading failures with CLOSED → OPEN → HALF_OPEN state machine
- **Retry with Exponential Backoff**: Configurable retry logic with jitter
- **Timeout Wrapper**: Promise-based timeout enforcement
- **Bulkhead Isolation**: Concurrency limiting with queue management
- **Composite Resilience Wrapper**: Combines all patterns in correct order

## Architecture

### Order of Execution

Each request flows through resilience patterns in this order:

```
User Request
    ↓
Bulkhead Isolation (concurrency limit, queue)
    ↓
Circuit Breaker (state machine, fail-fast)
    ↓
Retry with Backoff (exponential backoff + jitter)
    ↓
Timeout Wrapper (time limit)
    ↓
Actual API Call
    ↓
Response / Error
```

This ordering ensures:
1. Early rejection of overloaded requests (bulkhead)
2. Fast failure when backend is unavailable (circuit)
3. Graceful retry with backoff for transient failures
4. Time-bounded execution to prevent hanging

## Pre-configured Instances

### WattTime Resilience
```typescript
import { wattTimeResilience } from '@/lib/resilience'

// Primary causal routing signal
const moer = await wattTimeResilience.execute(async () => {
  return wattTime.getCurrentMOER('PJM')
})
```

Configuration:
- Timeout: 8s (API typically ≤2-3s)
- Retries: 2 (WattTime is reliable)
- Failure threshold: 3 (fast detection)
- Max concurrent: 5
- Queue size: 50

### Electricity Maps Resilience
```typescript
import { electricityMapsResilience } from '@/lib/resilience'

// Grid intelligence and validation
const intensity = await electricityMapsResilience.execute(async () => {
  return electricityMaps.getCarbonIntensity('US')
})
```

Configuration:
- Timeout: 8s
- Retries: 2
- Failure threshold: 3
- Max concurrent: 5
- Queue size: 50

### Ember Resilience
```typescript
import { emberResilience } from '@/lib/resilience'

// Structural validation, not critical path
const profile = await emberResilience.execute(async () => {
  return ember.getRegionProfile('US')
})
```

Configuration:
- Timeout: 15s (larger responses, slower endpoint)
- Retries: 1 (not time-critical)
- Failure threshold: 5 (more tolerant)
- Max concurrent: 3
- Queue size: 30

### EIA-930 Resilience
```typescript
import { eiaResilience } from '@/lib/resilience'

// Predictive telemetry and grid features
const data = await eiaResilience.execute(async () => {
  return eia.getGridData('us-east-1')
})
```

Configuration:
- Timeout: 12s (larger datasets, parsing)
- Retries: 2
- Failure threshold: 4
- Max concurrent: 4
- Queue size: 40

## Circuit Breaker States

### CLOSED (Normal Operation)
- Requests pass through normally
- Failures counted, success resets counter
- When failures ≥ threshold → transition to OPEN

### OPEN (Failing Backend)
- Requests rejected immediately (fail-fast)
- After reset timeout elapses → transition to HALF_OPEN
- Scheduled reset timer running

### HALF_OPEN (Recovering)
- Limited requests allowed (test recovery)
- Success counts toward recovery
- Failure → go back to OPEN
- N consecutive successes → go to CLOSED

## Health Status

Check API health at any time:

```typescript
import { wattTimeResilience, getAllHealthStatus } from '@/lib/resilience'

// Single instance
const health = wattTimeResilience.getHealthStatus()
console.log(health)
// {
//   name: 'watttime',
//   circuitState: 'CLOSED',
//   failureCount: 0,
//   successCount: 42,
//   queueDepth: 2,
//   activeConcurrent: 1,
//   lastFailureTime: null,
//   lastSuccessTime: <Date>,
//   totalRequests: 42
// }

// All instances
const allStatus = getAllHealthStatus()
```

## Error Handling

### Circuit Open
```typescript
try {
  await wattTimeResilience.execute(fn)
} catch (error) {
  if (error.message.includes('Circuit breaker is OPEN')) {
    // Backend is down, try fallback or degraded mode
    return useEmberDataFallback()
  }
  throw error
}
```

### Timeout
```typescript
try {
  await wattTimeResilience.execute(fn)
} catch (error) {
  if (error.message.includes('timeout')) {
    // Request took too long
    return useCachedResult()
  }
  throw error
}
```

### Bulkhead Queue Full
```typescript
try {
  await wattTimeResilience.execute(fn)
} catch (error) {
  if (error.message.includes('queue is full')) {
    // Too many concurrent requests
    return rateLimitResponse()
  }
  throw error
}
```

## Graceful Shutdown

```typescript
import { gracefulShutdown } from '@/lib/resilience'

// On server shutdown
await gracefulShutdown()

// All bulkheads drained
// Pending requests allowed to complete (max 5s)
// Process can exit cleanly
```

## Monitoring & Logging

All events are logged as JSON to stdout:

```json
{
  "ts": "2026-03-15T10:30:00.000Z",
  "event": "CIRCUIT_BREAKER_STATE_CHANGE",
  "from": "CLOSED",
  "to": "OPEN",
  "failureCount": 5
}
```

```json
{
  "ts": "2026-03-15T10:30:05.123Z",
  "event": "RESILIENCE_REQUEST",
  "name": "watttime",
  "durationMs": 342
}
```

```json
{
  "ts": "2026-03-15T10:30:10.456Z",
  "event": "RETRY_WITH_BACKOFF",
  "attempt": 1,
  "maxRetries": 2,
  "delayMs": 1150,
  "error": "Connection timeout"
}
```

## Testing

Tests are in `__tests__/circuit-breaker.test.ts`:

```bash
npm test -- src/lib/resilience/__tests__
```

Coverage includes:
- State transitions (CLOSED → OPEN → HALF_OPEN → CLOSED)
- Success/failure tracking
- Reset timeout behavior
- Retry with exponential backoff and jitter
- Timeout enforcement
- Concurrency limiting with queue
- Health status reporting
- Graceful reset and drain

## Integration with API Clients

### WattTime Example
```typescript
import { wattTimeResilience } from '@/lib/resilience'

class WattTimeClient {
  async getCurrentMOER(ba: string): Promise<MOERData | null> {
    try {
      return await wattTimeResilience.execute(async () => {
        const response = await axios.get(
          `${this.baseUrl}/signal-index`,
          { params: { ba, signal_type: 'co2_moer' } }
        )
        return response.data
      })
    } catch (error) {
      console.error('Failed to fetch MOER:', error)
      return null
    }
  }
}
```

### Grid Signals Example
```typescript
import { eiaResilience } from '@/lib/resilience'

export async function getGridData(region: string) {
  return eiaResilience.execute(async () => {
    return eia930Parser.parse(
      await eiaClient.fetchRealTimeData(region)
    )
  })
}
```

## Configuration Reference

### CircuitBreakerConfig
- `failureThreshold` (default: 5): Failures before opening circuit
- `resetTimeoutMs` (default: 30000): Delay before trying HALF_OPEN
- `halfOpenMaxAttempts` (default: 3): Successes needed to close

### RetryConfig
- `maxRetries` (default: 3): Total retry attempts
- `baseDelayMs` (default: 1000): Base exponential backoff delay
- `maxDelayMs` (default: 10000): Maximum delay between retries

### TimeoutConfig
- `timeoutMs` (default: 10000): Operation timeout

### BulkheadConfig
- `maxConcurrent` (default: 10): Concurrent request limit
- `maxQueueSize` (default: 100): Queue capacity

## Performance Targets

- p99 latency: < 200ms (cross-region)
- Circuit open recovery: < 30s
- Bulkhead queue depth: < 10% of max
- Total request tracking: per-instance

## Security Considerations

- No sensitive data in logs
- Circuit breaker state transitions logged only
- Error messages truncated to 500 chars
- Timeout ensures no hanging connections
- Bulkhead prevents resource exhaustion
