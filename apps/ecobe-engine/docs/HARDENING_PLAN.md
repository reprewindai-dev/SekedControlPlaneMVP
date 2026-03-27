# ecobe-engine Hardening Plan

## Goal

Keep the engine private, minimal, and focused on routing and allocation.

## Completed direction

- internal service auth added with `ECOBE_INTERNAL_API_KEY`
- internal routes added under `/internal/v1`
- engine-only `app.ts` surface now mounts the internal contract instead of the old public product API

## Next hardening items

- move any remaining customer-product routes behind a disabled legacy flag or remove them entirely
- isolate worker startup so only engine-required workers boot in production
- move provider readiness checks into `/internal/v1/health`
- add integration tests for create decision, fetch decision, execute allocation, and auth rejection
- rotate internal shared secrets through secret manager rather than local env files
