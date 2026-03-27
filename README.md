# SEKED Control Plane MVP

This repository is the canonical packaging repo for the SEKED control plane product.

The product is packaged together, but deployed as separate services:

- `apps/ecobe-mvp`
  Public control-plane API and governance surface
- `apps/ecobe-engine`
  Internal routing and allocation engine
- `legacy/express-wrapper`
  Archived Express wrapper kept for reference only
- `adapters/node`
  Reusable integration client for other apps
- `docs`
  Deployment, repo map, packaging, and integration reference
- `scripts`
  Repo refresh and packaging helpers

This repo is intended to be the place you grab when you want to reuse SEKED on another app.

## Source Boundaries

The following source repos are read-only inputs and must not be modified from this packaging repo workflow:

- `C:\Users\antho\.windsurf\dekes-saas`
- `C:\Users\antho\.windsurf\ecobe-engineclaude\ecobe-engine`
- `C:\Users\antho\.windsurf\ecobe-dashboardclaude\ecobe-dashboard`

This repo may copy from those sources, but does not write back to them.

## Product Shape

SEKED is sold as one product, but it operates as a split runtime:

1. `ecobe-mvp` receives customer traffic.
2. `ecobe-mvp` calls `ecobe-engine` over a private/internal boundary.
3. Governance, audit, policy, and adapter surfaces are packaged together here.

Read:

- [docs/REPO_MAP.md](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/docs/REPO_MAP.md)
- [docs/PACKAGING_MODEL.md](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/docs/PACKAGING_MODEL.md)
- [docs/INTEGRATION_QUICKSTART.md](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/docs/INTEGRATION_QUICKSTART.md)
- [docs/DEPLOYMENT_TOPOLOGY.md](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/docs/DEPLOYMENT_TOPOLOGY.md)
- [adapters/node/README.md](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/adapters/node/README.md)

## Refreshing The Packaged Snapshots

Use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\refresh-canonical-repo.ps1
```

That script copies clean snapshots from the source repos into:

- `apps/ecobe-mvp`
- `apps/ecobe-engine`
- `legacy/express-wrapper`

It excludes `.git`, `node_modules`, build caches, and local env files.
