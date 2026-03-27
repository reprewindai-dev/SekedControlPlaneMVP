# Railway Production Deployment

This product deploys as two Railway services:

- `ecobe-mvp`
  Public customer-facing control plane
- `ecobe-engine`
  Private internal routing engine

Do not deploy [`SekedControlPlaneMVP`](/Users/antho/.windsurf/SekedControlPlaneMVP) as the runtime service.

## Service 1: ecobe-engine

Repository:

- `ecobe-engine`

Railway settings:

- Root directory: repo root
- Builder: config-as-code via [`railway.json`](/Users/antho/.windsurf/ecobe-engineclaude/ecobe-engine/railway.json)
- Public networking: disabled if possible
- Private networking: enabled
- Healthcheck path: `/health`

Required environment:

- `NODE_ENV=production`
- `PORT=8080`
- `DATABASE_URL=<engine postgres url>`
- `DIRECT_DATABASE_URL=<engine postgres url>`
- `REDIS_URL=<redis url>`
- `ECOBE_INTERNAL_API_KEY=<shared internal bearer>`
- `ENGINE_BACKGROUND_WORKERS_ENABLED=false` for initial production bring-up unless you are also deploying the queue/cache dependencies
- `ENGINE_OFFLINE_ROUTING_ENABLED=false`

Optional but recommended:

- `OPTIMIZE_API_KEY`
- provider API keys

Private service URL:

- use Railway private networking, for example `http://ecobe-engine.railway.internal:8080`

## Service 2: ecobe-mvp

Repository:

- `ecobe-mvp`

Railway settings:

- Root directory: repo root
- Builder: config-as-code via [`railway.json`](/Users/antho/.windsurf/ecobe-mvp/railway.json)
- Public networking: enabled
- Healthcheck path: `/api/v1/health`

Required environment:

- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL=<mvp postgres url>`
- `ECOBE_ENGINE_URL=http://ecobe-engine.railway.internal:8080`
- `ECOBE_ENGINE_INTERNAL_KEY=<same shared internal bearer>`
- `AUDIT_SIGNING_SECRET=<long random secret>`
- `ECOBE_ADMIN_TOKEN=<bootstrap admin token>`
- `SEKED_URL=<production seked url>`
- `CONVERGEOS_URL=<production convergeos url>`
- `USE_LOCAL_GOVERNANCE_FALLBACK=false`

Optional:

- `SEKED_INTERNAL_KEY=<seked bearer>`
- `CONVERGEOS_INTERNAL_KEY=<convergeos bearer>`
- `STRIPE_WEBHOOK_SECRET=<stripe webhook signing secret>`
- `NEXT_PUBLIC_APP_NAME=ECOBE Control Plane`

## Database split

Do not share one uncontrolled schema between both services.

- `ecobe-mvp` owns the customer/product schema
- `ecobe-engine` owns the routing/engine schema

Use either:

- separate Railway Postgres services, recommended

or

- one Postgres instance with separate schemas and separate connection strings

## Bring-up order

1. Deploy `ecobe-engine`
2. Verify `GET /health`
3. Deploy `ecobe-mvp`
4. Verify `GET /api/v1/health`
5. Verify `GET /api/v1/ready`
6. Call `POST /api/v1/bootstrap`
7. Call `POST /api/v1/runs`

## Production rule

`ecobe-engine` is internal-only.

Customers should only hit `ecobe-mvp`.
