# Stale Water Bundle Runbook

## Trigger
- `validateWaterArtifacts()` fails
- `water.bundle.json` missing/corrupt/schema mismatch

## Automatic Path
1. Startup/runtime supervisor attempts `recoverWaterArtifactsFromLastKnownGood()`.
2. If recovery succeeds, runtime continues with degraded trace.
3. If recovery fails in production, startup fails closed.

## Operator Actions
1. Inspect artifact health:
- `GET /api/v1/ci/health`
2. Confirm manifest and bundle schema versions match.
3. Rebuild and re-publish normalized water artifacts.
4. Restart service and confirm health returns `healthy`.

## Validation
- new decisions include valid `water.datasetVersion`
- no silent defaulting to “water ignored”

