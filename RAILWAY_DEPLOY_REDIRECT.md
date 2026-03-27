## Railway Deploy Redirect

Do not deploy this repository root as the production runtime.

Production deployment is split across two separate services:

- `ecobe-mvp`
  Public customer-facing control plane
- `ecobe-engine`
  Private internal routing engine

If Railway is currently connected to `SekedControlPlaneMVP`, that deployment is not the canonical production topology.

Use the split deployment guide in:

- [C:\Users\antho\.windsurf\ecobe-mvp\docs\RAILWAY_PRODUCTION_DEPLOYMENT.md](C:\Users\antho\.windsurf\ecobe-mvp\docs\RAILWAY_PRODUCTION_DEPLOYMENT.md)
