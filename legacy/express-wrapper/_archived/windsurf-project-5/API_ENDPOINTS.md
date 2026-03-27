# Seked Stability Stack - API Endpoint Specifications

**Version**: 1.0  
**Date**: 2026-02-18  
**Base URL**: http://localhost:3000/api (development)

---

## Authentication

**Demo Mode**: No authentication required  
**Production**: Bearer token required in Authorization header

```
Authorization: Bearer <token>
```

---

## Endpoints

### 1. Execute Request (Full Pipeline)

**POST** /api/execute

Runs a request through the complete Seked → ConvergeOS → ECOBE pipeline.

#### Request Body

```json
{
  "request": "string (required)",
  "context": {
    "userId": "string (optional)",
    "sessionId": "string (optional)"
  },
  "options": {
    "maxAttempts": "number (optional, default: 10)",
    "qualityThreshold": "number (optional, default: 80)",
    "carbonConstraint": "number (optional, max gCO2/kWh)",
    "latencyConstraint": "number (optional, max ms)",
    "costConstraint": "number (optional, max $)"
  }
}
```

#### Response (Success)

```json
{
  "success": true,
  "runId": "run_1234567890_abc123",
  "result": {
    "output": "...",
    "region": "us-west-1"
  },
  "metrics": {
    "tier": 0,
    "fractureScore": 15.5,
    "detrimentalScore": 10.2,
    "driftMagnitude": 5.0,
    "convergenceDepth": 2,
    "qualityScore": 92.5,
    "carbonIntensity": 120,
    "latency": 50,
    "cost": 0.10,
    "endToEndLatency": 1250,
    "carbonSaved": 180
  }
}
```

#### Response (Blocked by Seked)

```json
{
  "success": false,
  "error": "Request blocked: High detrimental score (85/100)",
  "runId": "run_1234567890_abc123",
  "governance": {
    "tier": 2,
    "fractureScore": 75.0,
    "detrimentalScore": 85.0,
    "driftMagnitude": 60.0,
    "approved": false,
    "reason": "Irreversible action with high harm potential"
  }
}
```

#### Response (Convergence Failed)

```json
{
  "success": false,
  "error": "Output failed to converge after 10 attempts",
  "runId": "run_1234567890_abc123",
  "convergence": {
    "convergenceDepth": 10,
    "qualityScore": 65.0,
    "schemaCompliant": false,
    "lastError": "Output does not match required schema"
  }
}
```

---

### 2. Get Metrics

**GET** /api/metrics

Returns aggregated system metrics.

#### Query Parameters

- `period` (optional): hour, day, week, month, all (default: day)
- `groupBy` (optional): tier, region, hour (default: none)

#### Response

```json
{
  "period": "day",
  "totalDecisions": 1250,
  "tierDistribution": {
    "tier0": 1125,
    "tier0Percent": 90.0,
    "tier1": 100,
    "tier1Percent": 8.0,
    "tier2": 25,
    "tier2Percent": 2.0
  },
  "sekedMetrics": {
    "avgFractureScore": 18.5,
    "avgDetrimentalScore": 12.3,
    "avgDriftMagnitude": 8.7,
    "approvalRate": 98.5,
    "blockRate": 1.5
  },
  "convergeosMetrics": {
    "avgConvergenceDepth": 2.3,
    "avgQualityScore": 89.2,
    "convergenceRate": 97.5,
    "failureRate": 2.5,
    "avgCostPerOutput": 0.08
  },
  "ecobeMetrics": {
    "avgCarbonIntensity": 145.0,
    "totalCarbonSaved": 225000,
    "avgLatency": 75.0,
    "totalCost": 125.50,
    "regionDistribution": {
      "us-west-1": 450,
      "us-east-1": 300,
      "eu-west-1": 400,
      "ap-south-1": 100
    }
  },
  "unifiedMetrics": {
    "avgEndToEndLatency": 1150.0,
    "totalCost": 125.50,
    "costPerReliableOutput": 0.10,
    "systemStabilityScore": 94.5
  }
}
```

---

### 3. Get Recent Decisions

**GET** /api/decisions

Returns recent decision logs.

#### Query Parameters

- `limit` (optional): number of decisions to return (default: 50, max: 500)
- `offset` (optional): pagination offset (default: 0)
- `tier` (optional): filter by tier (0, 1, or 2)
- `approved` (optional): filter by approval status (true/false)
- `converged` (optional): filter by convergence status (true/false)

#### Response

```json
{
  "decisions": [
    {
      "id": "clx1234567890",
      "timestamp": "2026-02-18T13:45:30.000Z",
      "runId": "run_1234567890_abc123",
      "tier": 0,
      "fractureScore": 15.5,
      "detrimentalScore": 10.2,
      "driftMagnitude": 5.0,
      "approved": true,
      "convergenceDepth": 2,
      "qualityScore": 92.5,
      "converged": true,
      "executionRegion": "us-west-1",
      "carbonIntensity": 120,
      "latency": 50,
      "cost": 0.10,
      "endToEndLatency": 1250,
      "carbonSaved": 180,
      "success": true
    }
  ],
  "total": 1250,
  "limit": 50,
  "offset": 0
}
```

---

### 4. Get Signal Field State

**GET** /api/signal-field

Returns current Signal Field state.

#### Response

```json
{
  "timestamp": "2026-02-18T13:45:30.000Z",
  "referenceStars": [
    "Maintain user privacy",
    "Minimize harm",
    "Preserve system stability",
    "Operate within legal bounds"
  ],
  "intentVectors": [
    {
      "direction": "improve_efficiency",
      "magnitude": 75,
      "source": "user_feedback"
    }
  ],
  "trustWeights": {
    "user_input": 0.8,
    "external_api": 0.5,
    "internal_model": 0.9
  },
  "fractureMap": [
    {
      "timestamp": "2026-02-18T12:30:00.000Z",
      "score": 45.0,
      "description": "Conflict between efficiency and privacy"
    }
  ],
  "driftLedger": [
    {
      "timestamp": "2026-02-18T11:15:00.000Z",
      "magnitude": 35.0,
      "request": "Bypass privacy check for analytics"
    }
  ],
  "smokeRelay": [
    {
      "timestamp": "2026-02-18T10:00:00.000Z",
      "summary": "System maintained stability through 500 decisions",
      "keyBeliefs": ["Privacy is non-negotiable", "Efficiency within bounds"],
      "changes": ["Increased trust in internal model"]
    }
  ]
}
```

---

### 5. Update Signal Field

**POST** /api/signal-field/update

Manually update Signal Field (admin only).

#### Request Body

```json
{
  "action": "add_reference_star | remove_reference_star | update_trust_weight",
  "data": {
    "referenceStar": "string (for add/remove)",
    "source": "string (for trust weight)",
    "weight": "number 0-1 (for trust weight)"
  }
}
```

#### Response

```json
{
  "success": true,
  "message": "Signal Field updated",
  "newState": { /* full Signal Field state */ }
}
```

---

### 6. Get ECOBE Regions

**GET** /api/ecobe/regions

Returns available execution regions with current metrics.

#### Response

```json
{
  "regions": [
    {
      "region": "us-west-1",
      "carbonIntensity": 120,
      "latency": 50,
      "cost": 0.10,
      "available": true,
      "lastUpdated": "2026-02-18T13:45:00.000Z"
    },
    {
      "region": "us-east-1",
      "carbonIntensity": 200,
      "latency": 30,
      "cost": 0.08,
      "available": true,
      "lastUpdated": "2026-02-18T13:45:00.000Z"
    }
  ]
}
```

---

### 7. Get Collapse Events

**GET** /api/collapse-events

Returns empire collapse pattern detections.

#### Query Parameters

- `pattern` (optional): filter by pattern type
- `resolved` (optional): filter by resolution status (true/false)
- `limit` (optional): number of events to return (default: 50)

#### Response

```json
{
  "events": [
    {
      "id": "clx9876543210",
      "timestamp": "2026-02-18T12:00:00.000Z",
      "pattern": "overreach",
      "severity": 65,
      "description": "System attempting actions beyond verification capacity",
      "mitigationTaken": "Throttled decision rate by 30%",
      "resolved": true
    }
  ],
  "total": 15,
  "unresolved": 2
}
```

---

### 8. Health Check

**GET** /api/health

Returns system health status.

#### Response

```json
{
  "status": "healthy",
  "timestamp": "2026-02-18T13:45:30.000Z",
  "components": {
    "database": "healthy",
    "seked": "healthy",
    "convergeos": "healthy",
    "ecobe": "healthy"
  },
  "metrics": {
    "uptime": 86400,
    "requestsPerMinute": 25,
    "avgResponseTime": 1150,
    "errorRate": 0.02
  }
}
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing/invalid token |
| 403 | Forbidden - Request blocked by Seked |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable - System overloaded |

---

## Rate Limits

- **Demo Mode**: 100 requests/hour
- **Production**: Configurable per client

---

## Webhooks (Optional)

Configure webhooks to receive notifications for:

- High-severity collapse events
- Tier 2 decisions requiring review
- Convergence failures
- System health alerts

### POST /api/webhooks/configure

```json
{
  "url": "https://your-domain.com/webhook",
  "events": ["collapse_event", "tier2_decision", "convergence_failure"],
  "secret": "your_webhook_secret"
}
```

---

*End of API Specifications*
