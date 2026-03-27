# ECOBE MVP to Engine Interface

## Authentication

- Header: `Authorization: Bearer <ECOBE_INTERNAL_API_KEY>`
- Alternate header: `x-ecobe-internal-key`
- All internal endpoints reject requests when `ECOBE_INTERNAL_API_KEY` is unset.

## Create routing decision

- `POST /internal/v1/routing-decisions`

Request:

```json
{
  "runId": "run_123",
  "orgId": "org_123",
  "projectId": "proj_123",
  "providerConstraints": {
    "preferredRegions": ["US-CAL-CISO", "US-EAST-1", "FR"],
    "providers": ["openai", "anthropic"]
  },
  "latencyCeiling": 250,
  "costCeiling": 0.08,
  "carbonPolicy": {
    "maxCarbonGPerKwh": 300
  },
  "executionMetadata": {
    "model": "gpt-4.1",
    "tokenCount": 12000,
    "operation": "chat.completions"
  }
}
```

Response:

```json
{
  "decisionId": "dec_123",
  "selectedProvider": "openai",
  "selectedRegion": "FR",
  "estimatedLatency": 180,
  "estimatedCost": 0.012,
  "carbonEstimate": 150,
  "decisionReason": "Routed to FR with high confidence.",
  "satisfiable": true
}
```

## Get routing decision

- `GET /internal/v1/routing-decisions/:decisionId`

Returns the stored decision plus trace metadata for audit and debugging.

## Execute allocation

- `POST /internal/v1/routing-decisions/:decisionId/execute`

Response:

```json
{
  "executionReference": "alloc_123",
  "status": "allocated",
  "provider": "openai",
  "region": "FR"
}
```

## Health

- `GET /internal/v1/health`

Returns engine status, dependency health, and provider readiness summary.
