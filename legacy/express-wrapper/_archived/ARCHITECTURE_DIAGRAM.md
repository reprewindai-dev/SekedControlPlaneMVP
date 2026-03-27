# Seked Control Plane – Implemented Architecture

## Three-Plane Flow Diagram

```text
Client Request
    ↓
┌─────────────────────────────────────┐
│     Seked Control Plane Gateway     │
│         (Express + Auth)            │
└─────────────┬───────────────────────┘
              │
              v
┌─────────────────────────────────────┐
│   1️⃣ Seked Governance Plane        │
│   src/services/seked.ts            │
│   • Detrimental scoring            │
│   • Escalation engine (0/1/2)     │
│   • Fracture detection            │
│   • Drift detection                │
│   • Signal field persistence       │
└─────────────┬───────────────────────┘
              │ SekedScore + RunEvent
              v
┌─────────────────────────────────────┐
│   2️⃣ ConvergeOS Reliability Plane  │
│   src/services/convergeos.ts       │
│   • JSON schema validation         │
│   • Deterministic retry loop        │
│   • Prompt patching                 │
│   • Quality scoring                 │
│   • ConvergenceAttempt audit trail  │
└─────────────┬───────────────────────┘
              │ ConvergenceRun + Events
              v
┌─────────────────────────────────────┐
│   3️⃣ ECOBE Infrastructure Plane     │
│   src/services/ecobe.ts             │
│   • Multi-cloud routing             │
│   • Carbon intensity optimization   │
│   • Cost/latency constraints        │
│   • Weighted region selection       │
│   • RoutingDecision trace          │
└─────────────┬───────────────────────┘
              │ Provider + Region
              v
┌─────────────────────────────────────┐
│           Execution                 │
│    (Provider API Call)              │
└─────────────┬───────────────────────┘
              │
              v
┌─────────────────────────────────────┐
│      Full Audit Log + Return         │
│   RunEvent ledger + finalOutputJson  │
└─────────────────────────────────────┘
```

---

## Data Flow & Persistence

### Database: SEKED_PLATFORM_SCHEMA.prisma

#### Multi-Tenancy Core
- Organization, Project, ApiKey (hashed), User

#### Runs + Events
- Run (correlationId, status, finalOutputJson)
- RunEvent (type, ts, data, dataHash)

#### Seked Governance Store
- SignalField (scope: org/project)
- ReferenceStar, IntentVector, TrustWeight
- DriftLogEntry, FractureMap, DetrimentalScore
- SekedScore (run-level result)

#### ConvergeOS Store
- Schema (jsonSchema)
- ConvergenceRun (maxAttempts, qualityThreshold)
- ConvergenceAttempt (rawOutput, schemaValid, qualityScore, errorsJson, patchedPrompt)

#### ECOBE Store
- RoutingPolicy (weights, allowlists)
- GridIntensitySample (region, carbonIntensityGco2Kwh)
- RoutingDecision (provider, region, scores, decisionTraceJson)

#### Billing & Usage
- BillingAccount, Invoice
- UsageRecord (metric, quantity, unit, unitCost, totalCost, timestamp)

---

## Service Layer

| Service | File | Key Functions | DB Models |
|---------|------|---------------|-----------|
| Seked | src/services/seked.ts | evaluateSeked, calculateDetrimentalScore, detectFractures, calculateDrift | SignalField*, SekedScore |
| ConvergeOS | src/services/convergeos.ts | runConvergence, executeWithProvider, validateAgainstSchema | Schema, ConvergenceRun, ConvergenceAttempt |
| ECOBE | src/services/ecobe.ts | routeEcobe, score candidates, apply constraints | RoutingPolicy, GridIntensitySample, RoutingDecision |
| Pipeline | src/services/pipeline.ts | executeThreePlanePipeline (orchestrates all three) | Run, RunEvent, plus per-plane models |

---

## API Surface (src/routes/)

- /health – public ping
- /runs – POST creates Run, triggers pipeline; GET status/events; GET /usage
- /policies – POST/GET Policy (sekedConfig/convergeConfig/ecobeConfig)
- /keys – POST (admin only) creates hashed API key; GET list
- /billing/webhook – Stripe signature verification, BillingAccount creation

---

## Production Infrastructure

- Dockerfile.production – multi-stage build, security scan, non-root user, healthcheck
- .github/workflows/ci.yml – lint, build, prisma:generate, test
- Auth middleware – bcrypt-hashed API keys, RBAC (admin/developer/readonly)
- Express app – helmet, cors, compression, morgan, rate limiting
- Environment – DATABASE_URL, STRIPE_* keys, ADMIN_API_KEY

---

## End-to-End Flow

1) Client POST /runs with task, policy, schema, constraints
2) Auth middleware validates bearer token, attaches orgId/role
3) Run created (queued), UsageRecord recorded
4) Pipeline runs asynchronously:
   - Seked evaluates → SekedScore + RunEvent SEKED_SCORED
   - ConvergeOS retries → ConvergenceRun/Attempts + RunEvent CONVERGE_PASSED/FAILED
   - ECOBE routes → RoutingDecision + RunEvent ECOBE_ROUTED
5) Run status updated to completed/failed; finalOutputJson set on success
6) Client polls GET /runs/{id} or GET /runs/{id}/events for audit trail

All steps persist to PostgreSQL via Prisma, ensuring full auditability and governance traceability.
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Architecture

```text
Input Signal → Acoustic Listener → Signal Field Update → Shadow Tracking → 
Watchtower Validation → Collapse Prevention → Decision Engine → Action Output
     ↑                                                                           ↓
     └─────────────────── Temporal Feedback Loop (Persistent Learning) ──────────┘
```

## Seked Proportion System

```text
Intent-to-Action Ratio = Perfect Slope (Seked Principle)
    
    1:1  ← Optimal Proportion (Perfect Pyramid Angle)
     ↑
     │  Deviation Detection
     │
    2:1  ← Warning: Overextension Detected
     ↑
     │  Correction Required
     │
    3:1  ← Critical: Imminent Collapse Risk
```

## Multi-Layer Validation Stack

```text
Layer 1: Immediate Cross-Check (Watchtower Network)
Layer 2: Historical Pattern Match (Signal Field)
Layer 3: Empire Failure Pattern Scan (Collapse Prevention)
Layer 4: Seked Proportion Validation (Structural Integrity)
Layer 5: Intent Vector Alignment (Mission Coherence)
```

## Implementation Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                    VERSO DEPLOYMENT CONTAINER                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Single Upload Package | No External Dependencies      │    │
│  │  No Auth Required | No Paid APIs | No Background Jobs  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Key Innovation Points

1. **Persistent Signal Field**: First architecture to maintain temporal continuity across sessions
2. **Seked Foundation**: Ancient engineering principles ensuring structural integrity
3. **Empire Collapse Prevention**: Historical failure patterns as architectural safeguards
4. **Shadow Tracking**: Intent modeling beyond surface signals
5. **Multi-Layer Validation**: Distributed validation preventing single-point failures

---

*This architecture represents a fundamental shift from reactive AI to persistent intelligence systems.*
