# Hook Timeout Runbook

## Trigger
- external policy hook timeout
- SEKED policy adapter timeout

## Expected Behavior
- strict profile: fail-closed action enforced (`delay`/`throttle`/`deny`)
- non-strict profile: continue with fail-safe trace and fallback flags

## Checks
1. Inspect decision `policyTrace.externalPolicy` and `policyTrace.sekedPolicy`.
2. Confirm hook status is `error` with reason codes.
3. Confirm action remains deterministic and auditable.

## Recovery
1. Validate remote hook endpoint health and auth token.
2. Reduce timeout risk by tuning:
- `EXTERNAL_POLICY_HOOK_TIMEOUT_MS`
- `SEKED_POLICY_ADAPTER_TIMEOUT_MS`
3. Re-test strict and non-strict policy profiles.

