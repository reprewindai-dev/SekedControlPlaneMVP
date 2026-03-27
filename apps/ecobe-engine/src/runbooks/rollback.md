# Rollback Runbook

## Trigger
- p95 latency breach sustained above policy budget
- deterministic replay mismatch
- outbox dead-letter growth beyond threshold

## Steps
1. Pause new webhook sinks: `PATCH /api/v1/integrations/webhooks/:id { "status": "PAUSED" }`
2. Disable decision dispatcher: set `DECISION_EVENT_DISPATCH_ENABLED=false` and restart.
3. Revert deploy to previous Railway release.
4. Re-run smoke checks:
- `GET /api/v1/ci/health`
- `GET /api/v1/ci/slo`
- `GET /api/v1/integrations/events/outbox/metrics`
5. Requeue failed outbox records after stability:
- `POST /api/v1/integrations/events/outbox/:id/requeue`

## Exit Criteria
- all five actions return deterministic responses
- no new replay mismatches
- outbox lag returns below alert threshold

