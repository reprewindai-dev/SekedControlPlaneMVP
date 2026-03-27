# ecobe-mvp

`ecobe-mvp` is the sellable governance and control-plane SaaS that sits in front of customer workloads.

## Owns

- public `/v1` API
- dashboard
- organizations, projects, environments
- API keys and service accounts
- policy management
- governed run lifecycle
- usage, billing, audit views, exports

## Uses under the hood

- Seked governance evaluation
- ConvergeOS reliability evaluation
- `ecobe-engine` internal routing and allocation API

## Core public endpoints

- `POST /api/v1/bootstrap`
- `POST /api/v1/runs`
- `GET /api/v1/runs/:id`
- `GET /api/v1/runs/:id/events`
- `GET /api/v1/usage`
- `GET/POST /api/v1/policies`
- `GET/POST /api/v1/keys`
- `POST /api/v1/billing/webhook`
- `GET /api/v1/health`
- `GET /api/v1/ready`

## Required environment

- `DATABASE_URL` using the `mvp` schema, for example `postgresql://.../ecobe_platform?schema=mvp`
- `ECOBE_ENGINE_URL`
- `ECOBE_ENGINE_INTERNAL_KEY`
- `SEKED_URL` and optional `SEKED_INTERNAL_KEY`, or `USE_LOCAL_GOVERNANCE_FALLBACK=true` for local development only
- `CONVERGEOS_URL` and optional `CONVERGEOS_INTERNAL_KEY`, or `USE_LOCAL_GOVERNANCE_FALLBACK=true` for local development only
- `AUDIT_SIGNING_SECRET`
- `ECOBE_ADMIN_TOKEN`
- `STRIPE_WEBHOOK_SECRET` when receiving signed Stripe events in production

In production, set live `SEKED_URL` and `CONVERGEOS_URL`. The fallback path is intended for local development and test runs, not production governance.

## Local end-to-end

- `npm run e2e:local`
  Starts embedded Postgres, pushes both Prisma schemas, boots `ecobe-engine` and `ecobe-mvp`, and runs a governed happy-path request.

## Railway production

- Use the split deployment guide in [docs/RAILWAY_PRODUCTION_DEPLOYMENT.md](/Users/antho/.windsurf/ecobe-mvp/docs/RAILWAY_PRODUCTION_DEPLOYMENT.md)
- Deploy `ecobe-mvp` and `ecobe-engine` as separate Railway services
- Do not deploy the legacy `SekedControlPlaneMVP` archive as the runtime
