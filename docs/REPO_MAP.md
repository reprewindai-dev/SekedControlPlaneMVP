# Repo Map

## Canonical Packaging Repo

- Local path: [SekedControlPlaneMVP](/C:/Users/antho/.windsurf/SekedControlPlaneMVP)
- Git remote: `https://github.com/reprewindai-dev/SekedControlPlaneMVP.git`
- Purpose: packaged control-plane product repo

This root is the canonical bundle entrypoint.

## Packaged Runtime Snapshots

- Public control plane:
  - [apps/ecobe-mvp](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-mvp)
  - copied from [ecobe-mvp](/C:/Users/antho/.windsurf/ecobe-mvp)
- Internal engine:
  - [apps/ecobe-engine](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-engine)
  - copied from [ecobe-engine](/C:/Users/antho/.windsurf/ecobe-engineclaude/ecobe-engine)
- Legacy reference wrapper:
  - [legacy/express-wrapper](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/legacy/express-wrapper)
  - copied from [_archived/seked-control-plane-wrapper/SekedControlPlaneMVP](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/_archived/seked-control-plane-wrapper/SekedControlPlaneMVP)

## Source Repos

### BarBank

- Local path: [freestylewriter](/C:/Users/antho/.windsurf/freestylewriter)
- Purpose: BarBank product repo
- Separate from SEKED

### ecobe-mvp

- Local path: [ecobe-mvp](/C:/Users/antho/.windsurf/ecobe-mvp)
- Remote: `https://github.com/reprewindai-dev/ecobe-mvp.git`
- Role: public control-plane service

### ecobe-engine

- Local path: [ecobe-engine](/C:/Users/antho/.windsurf/ecobe-engineclaude/ecobe-engine)
- Remote: `https://github.com/reprewindai-dev/ecobe-engineclaude`
- Role: private routing engine

### Protected Repos

These are read-only source repos for this workflow:

- [dekes-saas](/C:/Users/antho/.windsurf/dekes-saas)
- [ecobe-engine](/C:/Users/antho/.windsurf/ecobe-engineclaude/ecobe-engine)
- [ecobe-dashboard](/C:/Users/antho/.windsurf/ecobe-dashboardclaude/ecobe-dashboard)

## Deployment Shape

### Railway

Deploy as two services:

1. `apps/ecobe-engine`
2. `apps/ecobe-mvp`

`ecobe-mvp` calls `ecobe-engine` via Railway private networking.

See:

- [apps/ecobe-mvp/docs/RAILWAY_PRODUCTION_DEPLOYMENT.md](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-mvp/docs/RAILWAY_PRODUCTION_DEPLOYMENT.md)

## Non-Canonical Local Paths

These exist locally but are not the bundle entrypoint:

- [seked-control-plane](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/seked-control-plane)
- [_archived](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/_archived)

## Key Runtime Files

### Public API

- [apps/ecobe-mvp/src/app/api/v1/runs/route.ts](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-mvp/src/app/api/v1/runs/route.ts)
- [apps/ecobe-mvp/src/app/api/v1/bootstrap/route.ts](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-mvp/src/app/api/v1/bootstrap/route.ts)
- [apps/ecobe-mvp/src/lib/run-orchestrator.ts](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-mvp/src/lib/run-orchestrator.ts)

### Engine

- [apps/ecobe-engine/src](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-engine/src)
- [apps/ecobe-engine/prisma/schema.prisma](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-engine/prisma/schema.prisma)

### Adapter

- [adapters/node/seked-client.ts](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/adapters/node/seked-client.ts)
