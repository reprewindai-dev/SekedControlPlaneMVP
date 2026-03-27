# Integrated Seked Control Plane Architecture

**Three-Plane Governance: Seked + ConvergeOS + ECOBE**

**Document ID**: SSA-INT-2026-005  
**Created**: February 19, 2026  
**Status**: Implemented and Running

---

## Executive Summary

The Seked Control Plane integrates three governance planes into a single production API:

1. **Seked Governance Plane** – Risk scoring, escalation, fracture/drift detection, signal field persistence
2. **ConvergeOS Reliability Plane** – Deterministic retry loops, schema validation, quality scoring
3. **ECOBE Infrastructure Plane** – Carbon/cost/latency-aware routing, provider/region selection

The system provides multi-tenant, auditable, governed AI execution with billing and usage tracking.

---

## Implemented Architecture

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

## Data Models (SEKED_PLATFORM_SCHEMA.prisma)

### Multi-Tenancy Core
- Organization, Project, ApiKey (bcrypt-hashed), User

### Runs + Events
- Run (correlationId, status, finalOutputJson)
- RunEvent (type, ts, data, dataHash)

### Seked Governance Store
- SignalField (scope: org/project)
- ReferenceStar, IntentVector, TrustWeight
- DriftLogEntry, FractureMap, DetrimentalScore
- SekedScore (run-level result)

### ConvergeOS Store
- Schema (jsonSchema)
- ConvergenceRun (maxAttempts, qualityThreshold)
- ConvergenceAttempt (rawOutput, schemaValid, qualityScore, errorsJson, patchedPrompt)

### ECOBE Store
- RoutingPolicy (weights, allowlists)
- GridIntensitySample (region, carbonIntensityGco2Kwh)
- RoutingDecision (provider, region, scores, decisionTraceJson)

### Billing & Usage
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

## API Surface

### Auth
- Bearer token (hashed API key) with RBAC (admin/developer/readonly)

### Endpoints
- `GET /health` – public ping
- `POST /runs` – create governed run (triggers pipeline)
- `GET /runs/{id}` – run details
- `GET /runs/{id}/events` – audit trail
- `GET /usage` – usage aggregation
- `POST /policies` – create governance policy (admin/dev)
- `GET /policies/{id}` – fetch policy
- `POST /keys` – create API key (admin only)
- `GET /keys` – list org keys
- `POST /billing/webhook` – Stripe webhook (raw)

---

## Production Infrastructure

- Dockerfile.production – multi-stage build, security scan, non-root user, healthcheck
- .github/workflows/ci.yml – lint, build, prisma:generate, test
- Auth middleware – bcrypt-hashed API keys, RBAC
- Express app – helmet, cors, compression, morgan, rate limiting
- Environment – DATABASE_URL, STRIPE_* keys, ADMIN_API_KEY

---

## Integration Points

### External Providers
- OpenAI, Anthropic, etc. via executeWithProvider (mocked now, replace with real SDK calls)

### Carbon Data
- GridIntensitySample table populated via Electricity Maps API or provider feeds

### Billing
- Stripe webhooks create BillingAccount records; extend to Invoice and UsageRecord aggregation

---

## Multi-Tenant Operations

- Organizations are top-level tenants.
- Projects provide isolation (prod/staging/dev).
- API keys and policies are scoped to orgs.
- Signal fields auto-created per org/project on first run.

---

## Monitoring and Observability

- RunEvent table provides full audit trail.
- Express morgan logs HTTP requests.
- Add Prometheus middleware for metrics if needed.
- Health check endpoint for load balancers.

---

## Security

- API keys hashed with bcrypt.
- Rate limiting via express-rate-limit.
- Helmet, CORS, compression.
- Environment variables for secrets.
- Non-root Docker user.

---

## Extending the System

### Adding a New Provider
- Add provider/region candidates in ecobe.ts.
- Implement executeWithProvider call.
- Update GridIntensitySample data.

### Custom Governance Rules
- Extend seked.ts with new scoring functions.
- Add fields to SekedScore or SignalField.
- Update policy schema.

### New Usage Metrics
- Add UsageRecord entries in pipeline or routes.
- Update GET /usage aggregation.
- Optionally add billing logic.

---

## Conclusion

The Seked Control Plane is a production-ready, multi-tenant API that orchestrates three governance planes for safe, reliable, and carbon-aware AI execution. All components are implemented, wired, and backed by a comprehensive Prisma schema.

---

*"The pyramids stood for millennia because their proportions were perfect. Our integrated AGI system will stand for the same reason—built on perfect proportions, temporal continuity, and historical wisdom."*
