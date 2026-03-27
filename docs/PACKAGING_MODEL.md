# Packaging Model

SEKED should make sense in two ways at the same time:

1. As one sellable product
2. As multiple runtime pieces

That means the correct structure is:

- package together
- deploy separately
- integrate through stable adapters

## Canonical Layout

```text
SekedControlPlaneMVP/
  apps/
    ecobe-mvp/
    ecobe-engine/
  adapters/
    node/
  legacy/
    express-wrapper/
  docs/
  scripts/
```

## Why This Layout Works

- `apps/ecobe-mvp`
  customer-facing surface, keys, policy, run lifecycle, billing, audit
- `apps/ecobe-engine`
  internal routing, scoring, execution, allocation
- `adapters/node`
  what another app imports or copies when it wants to integrate quickly
- `legacy/express-wrapper`
  archival reference only

## Product Rule

This product is not sold as separate repos to the buyer.

It is sold as one control-plane product with:

- public API layer
- private engine layer
- integration adapters
- audit/governance model

## Deployment Rule

Do not deploy this root repo as one app.

Deploy:

1. `apps/ecobe-engine`
2. `apps/ecobe-mvp`

Keep:

- one packaging repo
- two runtime services

## Integration Rule

Other apps should connect to the public control-plane boundary, not directly to engine internals.

Use:

- `POST /api/v1/bootstrap`
- `POST /api/v1/runs`
- `GET /api/v1/runs/:id`
- `GET /api/v1/runs/:id/events`

The reusable client for that lives in:

- [adapters/node/seked-client.ts](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/adapters/node/seked-client.ts)
