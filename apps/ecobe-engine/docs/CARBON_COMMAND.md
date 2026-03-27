---
title: Carbon Command Endpoint Spec
description: Deterministic carbon-aware decision engine contract
---

## Purpose

`POST /api/v1/carbon/command` promotes ECOBE from a routing utility to a carbon-aware compute decision engine. It ingests a fully constrained workload request, evaluates eligible regions and execution windows, selects the optimal plan with a deterministic scoring model, and emits an auditable decision trace that can later be reconciled against actual execution outcomes.

## Request Schema

```jsonc
{
  "orgId": "org_123",
  "workload": {
    "type": "training",
    "modelFamily": "transformer",
    "estimatedGpuHours": 120,
    "estimatedCpuHours": 20,
    "estimatedMemoryGb": 64
  },
  "constraints": {
    "maxLatencyMs": 150,
    "deadlineAt": "2026-03-08T18:00:00Z",
    "mustRunRegions": ["us-east-1", "eu-north-1"],
    "excludedRegions": ["ap-south-1"],
    "carbonPriority": "high",
    "costPriority": "medium",
    "latencyPriority": "high"
  },
  "execution": {
    "mode": "scheduled",
    "candidateStartWindowHours": 24
  },
  "preferences": {
    "allowTimeShifting": true,
    "allowCrossRegionExecution": true,
    "requireCreditCoverage": false
  },
  "metadata": {
    "source": "dashboard",
    "requestId": "req_abc123",
    "projectId": "proj_789"
  }
}
```

Validation rules:

1. At least one of `estimatedGpuHours` or `estimatedCpuHours` must be provided.
2. Constraints must include `maxLatencyMs` and/or `deadlineAt` to avoid vague requests.
3. Excluded regions are removed from consideration before candidate generation.
4. Execution mode defaults to `immediate`; `candidateStartWindowHours` caps to 168 (1 week).

## Response Schema

```jsonc
{
  "success": true,
  "commandId": "cmd_01HXYZ",
  "decisionId": "dec_01HXYZ",
  "recommendation": {
    "region": "eu-north-1",
    "startAt": "2026-03-08T02:00:00Z",
    "mode": "scheduled",
    "expectedCarbonIntensity": 112,
    "expectedLatencyMs": 118,
    "expectedCostIndex": 0.91,
    "estimatedEmissionsKgCo2e": 38.4,
    "estimatedSavingsKgCo2e": 21.7,
    "confidence": 0.86,
    "fallbackRegion": "us-east-1"
  },
  "summary": {
    "reason": "Lowest projected carbon intensity within deadline and latency limits.",
    "tradeoff": "Time-shifted 4h to avoid high-carbon peak while keeping latency < 150ms.",
    "creditCoverageRequired": false
  },
  "decisionTrace": {
    "scoringModel": "carbon-v1",
    "weights": {
      "carbon": 0.45,
      "latency": 0.30,
      "cost": 0.15,
      "deadline": 0.10
    },
    "candidatesEvaluated": 8,
    "selectedCandidateId": "cand_4",
    "rejectedReasons": [
      { "candidateId": "cand_1", "reason": "Exceeded max latency" },
      { "candidateId": "cand_2", "reason": "Missed deadline window" }
    ]
  }
}
```

Failure responses follow the same envelope with `success: false` and structured errors such as `NO_ELIGIBLE_CANDIDATES` or `INVALID_REQUEST`.

## Scoring Model

A deterministic weighted sum ensures auditability:

```
total_score = carbon_score   * carbon_weight
            + latency_score  * latency_weight
            + cost_score     * cost_weight
            + deadline_score * deadline_weight
```

- Component scores are normalized (001) per candidate.
- Priority mapping (`high=0.5`, `medium=0.3`, `low=0.2`) produces raw weights that are re-normalized before scoring.
- Deadline weight defaults to `0.1` when a deadline exists; otherwise `0.0`.

Eligibility filters run **before** scoring and reject any candidate that violates excluded regions, latency ceilings, or hard deadlines. Each rejection captures a reason for the trace.

## Persistence Models

New Prisma entities:

- `CarbonCommand`: captures request payload, org, mode, selection, status, and recommendation snapshot.
- `CarbonCommandTrace`: stores the full decision trace JSON, scoring model version, and environmental metadata (data providers, versions, generation time).
- `CarbonCommandOutcome` (optional now): records actual execution metrics (region, start/end time, observed latency, emissions, delta vs prediction).

These tables enable the predict 8 decide 8 execute 8 verify 8 learn loop.

## Processing Flow

1. **Validate Request** — Zod schema ensures required workload constraints.
2. **Generate Candidates** — Regions derived from must-run list or all enabled regions. Scheduled mode produces time-window candidates within `candidateStartWindowHours`.
3. **Fetch Signals** — Redis-backed cache for current intensity, Electricity Maps forecast for future windows, Region table for latency/cost hints.
4. **Filter & Score** — Remove ineligible candidates; compute normalized component scores and weighted totals.
5. **Select & Persist** — Pick the highest-scoring candidate, choose fallback, persist `CarbonCommand` and `CarbonCommandTrace`.
6. **Respond** — Return recommendation, summary, and trace metadata. Public responses expose summaries; operator responses can include full trace.

## Future Hooks

- `CarbonCommandOutcome` ingestion for actual vs predicted reconciliation.
- Vector intelligence layer referencing decision history to bias scoring with learned insights.
- Workflow automation (credits, alerts) triggered based on command outcomes.

## Accuracy Dashboard

`GET /api/v1/dashboard/accuracy` exposes the proof layer. Query params:

- `orgId` (required)
- `range`: `7d | 30d | 90d | custom` (default `30d`)
- `startDate`, `endDate` (ISO, required if `range=custom`)
- `workloadType`, `region`, `modelFamily` (optional filters)
- `groupBy`: `day | week | month` (default `day`)

### Response contract

```jsonc
{
  "success": true,
  "range": {
    "startDate": "2026-02-01T00:00:00Z",
    "endDate": "2026-03-01T23:59:59Z",
    "groupBy": "day"
  },
  "summary": {
    "totalCommands": 1842,
    "completedCommands": 1760,
    "regionMatchRate": 0.93,
    "slaMetRate": 0.95,
    "avgEmissionsVariancePct": 8.4,
    "avgLatencyVariancePct": 6.1,
    "avgCostVariancePct": 5.7,
    "predictionQuality": {
      "high": 1280,
      "medium": 372,
      "low": 108
    },
    "totalEstimatedSavingsKgCo2e": 18240.5,
    "totalVerifiedSavingsKgCo2e": 16982.2
  },
  "trends": [
    {
      "date": "2026-02-01",
      "commands": 62,
      "regionMatchRate": 0.92,
      "slaMetRate": 0.94,
      "avgEmissionsVariancePct": 7.8,
      "verifiedSavingsKgCo2e": 514.2
    }
  ],
  "breakdowns": {
    "byWorkloadType": [
      {
        "workloadType": "training",
        "commands": 720,
        "completed": 702,
        "avgEmissionsVariancePct": 9.1,
        "verifiedSavingsKgCo2e": 8210.4
      }
    ],
    "byRegion": [
      {
        "region": "eu-north-1",
        "commands": 604,
        "completed": 590,
        "regionMatchRate": 0.96,
        "verifiedSavingsKgCo2e": 6421.7
      }
    ]
  },
  "insights": [
    "Prediction quality remained high for scheduled workloads.",
    "EU North delivered the strongest verified carbon savings."
  ]
}
```

### Required metrics

- Total vs completed commands (commands with outcomes)
- Region match rate, SLA met rate
- Average emissions/latency/cost variance (ignore null values)
- Prediction quality distribution (`HIGH | MEDIUM | LOW` from outcomes)
- Estimated vs verified carbon savings
- Trend rows grouped by day/week/month (commands, rates, variances, verified savings)
- Breakdowns by workload type and by region
- Deterministic insights (e.g., strong accuracy, execution drift, high verified savings)

### Data sources

- `CarbonCommand` for totals, filters, estimated savings
- `CarbonCommandOutcome` for verification metrics
- `CarbonCommandAccuracyDaily` for future pre-aggregated reads (optional)

Rules: commands without outcomes contribute only to totalCommands, never to accuracy averages. If data is sparse, return empty arrays and an insight such as "No command data available for the selected period." All responses are automatically scoped by `orgId` to preserve tenant isolation.

## Outcome Ingestion (Control-Plane Verification)

`POST /api/v1/carbon/outcome` records what actually happened after a recommendation. Request envelope:

```jsonc
{
  "commandId": "cmd_01HXYZ",
  "orgId": "org_123",
  "execution": {
    "actualRegion": "eu-north-1",
    "actualStartAt": "2026-03-08T02:03:00Z",
    "actualEndAt": "2026-03-08T05:43:00Z",
    "actualLatencyMs": 124,
    "actualGpuHours": 118.7,
    "actualCpuHours": 19.6,
    "actualMemoryGb": 64
  },
  "emissions": {
    "actualCarbonIntensity": 118,
    "actualEmissionsKgCo2e": 40.1,
    "measurementSource": "estimated"
  },
  "cost": {
    "actualCostUsd": 912.14,
    "costIndexObserved": 0.95
  },
  "status": {
    "completed": true,
    "slaMet": true,
    "fallbackTriggered": false
  },
  "metadata": {
    "source": "runtime-agent",
    "providerExecutionId": "job_abc_789",
    "notes": "Executed successfully on scheduled window"
  }
}
```

Rules:

- `commandId`, `orgId`, `execution.actualRegion`, `execution.actualStartAt`, and `status.completed` are required.
- Either `execution.actualEndAt` or enough runtime metrics (GPU/CPU hours) must be provided to derive duration.
- `measurementSource` is constrained to `estimated`, `provider-reported`, or `metered`.
- Endpoint is idempotent via `providerExecutionId` or `(commandId, actualStartAt)` pair.

### Comparison + Response

Response surfaces prediction vs reality:

```jsonc
{
  "success": true,
  "outcomeId": "out_01HXYZ",
  "commandId": "cmd_01HXYZ",
  "comparison": {
    "predictedRegion": "eu-north-1",
    "actualRegion": "eu-north-1",
    "predictedEmissionsKgCo2e": 38.4,
    "actualEmissionsKgCo2e": 40.1,
    "emissionsVarianceKg": 1.7,
    "emissionsVariancePct": 4.43,
    "predictedLatencyMs": 118,
    "actualLatencyMs": 124,
    "latencyVarianceMs": 6,
    "latencyVariancePct": 5.08,
    "predictedCostIndex": 0.91,
    "actualCostIndex": 0.95,
    "costVariancePct": 4.4
  },
  "verification": {
    "regionMatch": true,
    "slaMet": true,
    "fallbackTriggered": false,
    "predictionQuality": "high"
  },
  "learningSignals": {
    "shouldUpdateModel": true,
    "outlier": false,
    "notes": "Prediction remained within acceptable variance thresholds"
  }
}
```

Prediction quality bands:

- **High**: region match, emissions + latency variance ≤ 10%.
- **Medium**: region match, variance ≤ 20%.
- **Low**: variance > 20%, wrong region, or SLA miss.

### Persistence & Accuracy Metrics

- `CarbonCommandOutcome` stores actual metrics, measurement source, comparison JSON, prediction quality, provider execution ID, and metadata.
- `CarbonCommandAccuracyDaily` (recommended) aggregates per-org accuracy: region match rate, average variances, quality band counts.
- Future learning hooks can feed variance signals into vector intelligence and scoring adjustments.

This spec keeps ECOBE honest: every recommendation is explainable, replayable, and ready for outcome verification.
