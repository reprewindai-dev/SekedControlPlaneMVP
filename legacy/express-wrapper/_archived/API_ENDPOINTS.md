# Seked Control Plane – API Endpoints (Multi-Service Architecture)

**Base URL**: http://localhost:3000 (Gateway)  
**Authentication**: Bearer token (API key)  
**Stack**: Fastify + BullMQ + Redis + PostgreSQL + Prisma  

---

## Overview

All requests are handled by the **Gateway API** (port 3000). The Gateway validates auth, enqueues jobs to BullMQ, and returns run IDs. The three governance planes (Seked, ConvergeOS, ECOBE) run as background workers consuming from Redis queues.

---

## Core Endpoints

### POST /runs
Create a governed run and enqueue the three-plane pipeline.

**Request**:
```json
{
  "policy_profile_id": "string",
  "project_id": "string",
  "schema_id": "string",
  "task": { "type": "string", "risk_level": "string" },
  "inputs": { "prompt": "string" },
  "constraints": { "latency_ms_max": 3000, "cost_usd_max": 0.05 },
  "execution": { "provider": "openai" }
}
```

**Response**:
```json
{
  "run_id": "string",
  "status": "queued"
}
```

**Internal Flow**:
1) Auth middleware validates bearer token → orgId/apiKeyId/role  
2) Run created in PostgreSQL with RUN_CREATED event  
3) UsageRecord created (requests: 1)  
4) BullMQ job enqueued to run-pipeline/start with orgId/apiKeyId/role  
5) Workers process: Seked → ConvergeOS → ECOBE → Run completed/failed  

---

### GET /runs/:id
Retrieve run status and final output.

**Response**:
```json
{
  "id": "string",
  "status": "completed|failed|queued",
  "finalOutputJson": { ... },
  "events": [...],
  "createdAt": "2026-02-19T...",
  "completedAt": "2026-02-19T..."
}
```

---

### GET /runs/:id/events
Full audit trail for a run.

**Response**:
```json
[
  { "type": "RUN_CREATED", "timestamp": "...", "data": {...} },
  { "type": "SEKED_SCORED", "timestamp": "...", "data": {...} },
  { "type": "CONVERGE_PASSED", "timestamp": "...", "data": {...} },
  { "type": "ECOBE_ROUTED", "timestamp": "...", "data": {...} },
  { "type": "RUN_COMPLETED", "timestamp": "...", "data": {...} }
]
```

---

### GET /usage
Aggregated usage metrics by metric and date range (scoped to org).

**Query**: ?from=2026-02-01T00:00:00Z&to=2026-02-19T23:59:59Z

**Response**:
```json
{
  "usage": [
    { "metric": "requests", "_sum": { "quantity": 1234, "totalCost": 12.34 } }
  ],
  "from": "2026-02-01T00:00:00.000Z",
  "to": "2026-02-19T23:59:59.000Z"
}
```

---

### POST /policies
Create a governance policy (admin/developer only).

**Request**:
```json
{
  "name": "Finance-MediumRisk",
  "sekedConfig": { "escalation_thresholds": { "tier0": 0.25, "tier1": 0.55, "tier2": 1.0 } }
}
```

**Response**:
```json
{
  "id": "string",
  "name": "Finance-MediumRisk",
  "sekedConfig": { ... },
  "convergeConfig": {},
  "ecobeConfig": {},
  "status": "draft",
  "createdAt": "..."
}
```

---

### GET /policies/:id
Retrieve a policy.

---

### POST /keys
Create an API key (admin only).

**Request**:
```json
{
  "name": "Production Key",
  "role": "developer"
}
```

**Response**:
```json
{
  "id": "string",
  "name": "Production Key",
  "role": "developer",
  "apiKey": "sk_..."
}
```

---

### GET /keys
List API keys for the organization (admin only).

---

### POST /billing/webhook
Stripe billing webhook (public endpoint).

**Headers**: stripe-signature  
**Body**: Stripe event payload  

**Response**: { received: true }

---

### GET /health
Service health check.

**Response**: { status: "ok" }

---

## Internal Queue Flow (Multi-Service)

1) Gateway enqueues job to `run-pipeline/start` with { runId, orgId, apiKeyId, role }  
2) Seked worker consumes `pipeline-seked`, writes SekedScore, enqueues `pipeline-converge`  
3) ConvergeOS worker consumes `pipeline-converge`, writes ConvergenceRun/Attempts, enqueues `pipeline-ecobe`  
4) ECOBE worker consumes `pipeline-ecobe`, writes RoutingDecision, marks Run completed  

All workers emit RunEvent entries for full auditability.

---

## Security & RBAC

- Auth: bcrypt-hashed API keys; bearer token required on all protected routes.
- Roles: admin (full access), developer (create runs/policies), readonly (GET only).
- Rate limiting: 120 req/min per IP.
- Input validation: Zod schemas on all payloads.

---

## Error Responses

- 400: Invalid payload (details included)
- 401: Unauthorized (missing/invalid bearer token)
- 403: Forbidden (insufficient role)
- 404: Not found
- 500: Internal server error

---

## Multi-Service Deployment

- Gateway: port 3000 (Fastify)
- Seked worker: port 3002 (BullMQ consumer)
- ConvergeOS worker: port 3001 (BullMQ consumer)
- ECOBE worker: port 3003 (BullMQ consumer)
- Redis: port 6379 (BullMQ queues)
- PostgreSQL: port 5432 (shared schema)

All services share the SEKED_PLATFORM_SCHEMA.prisma via Prisma generate.
  "events": ["collapse_event", "tier2_decision", "convergence_failure"],
  "secret": "your_webhook_secret"
}
```

---

*End of API Specifications*
