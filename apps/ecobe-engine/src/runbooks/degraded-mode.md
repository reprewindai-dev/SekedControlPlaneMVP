# Degraded Mode Runbook

## Trigger
- carbon provider outages
- external policy adapter timeout/error
- stale water artifacts with successful LKG recovery

## Expected Runtime Behavior
- strict profiles: fail-closed (`delay`/`throttle`/`deny`)
- default profile: fail-safe with explicit trace flags
- `fallbackUsed=true` and reduced `signalConfidence`

## Operator Checks
1. `GET /api/v1/ci/health` and confirm `status=degraded` reason.
2. `GET /api/v1/system/status` and confirm worker health.
3. Verify policy trace fields in last decisions:
- `policyTrace.reasonCodes`
- `policyTrace.externalPolicy`
- `policyTrace.sekedPolicy`

## Recovery
1. Restore upstream provider/adapters.
2. Force cache warm cycle if needed.
3. Validate deterministic replay on latest affected decision IDs.

