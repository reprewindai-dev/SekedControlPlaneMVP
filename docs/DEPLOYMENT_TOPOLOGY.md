# Deployment Topology

SEKED is packaged together in this repo, but deployed as separate services.

## Canonical Service Roots

- Public API: [apps/ecobe-mvp](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-mvp)
- Private engine: [apps/ecobe-engine](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-engine)
- Legacy reference only: [legacy/express-wrapper](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/legacy/express-wrapper)

## Railway Shape

Deploy two services:

1. `ecobe-engine`
   - private/internal service
   - no direct customer traffic
2. `ecobe-mvp`
   - public service
   - receives customer traffic and orchestrates governed runs

`ecobe-mvp` talks to `ecobe-engine` over private networking.

## Required Internal Wiring

Set these on `ecobe-mvp`:

- `ECOBE_ENGINE_URL`
- `ECOBE_ENGINE_INTERNAL_KEY`

Set these on `ecobe-engine`:

- matching engine auth key
- engine database and provider env vars

Reference:

- [apps/ecobe-mvp/docs/RAILWAY_PRODUCTION_DEPLOYMENT.md](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-mvp/docs/RAILWAY_PRODUCTION_DEPLOYMENT.md)

## Packaging Rule

This repo is the bundle you keep, clone, and reuse.

The protected source repos remain read-only reference inputs for this workflow.

## Non-Canonical Paths

These exist locally but are not the bundle entrypoint:

- [seked-control-plane](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/seked-control-plane)
- [_archived](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/_archived)

Use them as historical inputs only.
