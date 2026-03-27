## Legacy Archive Notice

This workspace contains archived planning material and legacy implementation fragments under [`_archived/`](/Users/antho/.windsurf/SekedControlPlaneMVP/_archived).

The archived Express-based control-plane code is not the active runtime and must not be treated as the production baseline.

Active runtime boundary:

- `ecobe-mvp`
  Customer-facing governance/control-plane product.
- `ecobe-engine`
  Internal routing and allocation engine.

Operational rule:

- Do not ship or extend the archived Express implementation.
- Do not wire new production features into `_archived/seked-control-plane-wrapper/...`.
- Use the split runtime (`ecobe-mvp` + `ecobe-engine`) as the only executable production path.
