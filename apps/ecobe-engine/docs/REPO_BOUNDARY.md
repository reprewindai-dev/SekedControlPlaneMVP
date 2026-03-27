# ECOBE Engine Boundary

`ecobe-engine` is the internal routing and execution engine. It is not the customer-facing SaaS.

## This repo owns

- internal routing logic
- provider and region scoring
- failover logic
- cost, latency, and carbon decisioning
- allocation handoff
- internal engine telemetry
- internal health endpoints
- routing decision traces

## This repo does not own

- public `/v1` customer API
- dashboard product UI
- tenant auth
- orgs, users, memberships, API key lifecycle
- billing, subscriptions, invoices
- customer audit views and exports
- policy CRUD as a product surface

## Internal contract

- `GET /internal/v1/health`
- `POST /internal/v1/routing-decisions`
- `GET /internal/v1/routing-decisions/:decisionId`
- `POST /internal/v1/routing-decisions/:decisionId/execute`

## Forbidden drift

- do not expose engine routes directly to customers
- do not merge dashboard and product concerns back into this repo
- do not let this repo become the tenant or billing source of truth
