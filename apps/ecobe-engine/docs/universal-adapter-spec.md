# ECOBE Universal Adapter Plane

## Canonical sync decision path

- `POST /api/v1/ci/authorize`
- Aliases:
  - `POST /api/v1/ci/route`
  - `POST /api/v1/ci/carbon-route`

The canonical decision response always resolves to one binding action:

- `run_now`
- `reroute`
- `delay`
- `throttle`
- `deny`

## Canonical request extensions

These fields are implemented in the current request schema and are intended for external callers:

- `requestId`
- `idempotencyKey`
- `timeoutMs`
- `caller`
- `runtimeTarget`
- `transport`
- `telemetryContext`

Core environmental fields remain:

- `preferredRegions`
- `criticality`
- `waterPolicyProfile`
- `signalPolicy`
- `allowDelay`
- `maxDelayMinutes`

## Canonical response extensions

All adapter paths preserve the same core response and add:

- `decisionEnvelope`
- `proofEnvelope`
- `telemetryBridge`
- `adapterContext`

These sit alongside the existing deterministic response surface:

- `policyTrace`
- `decisionExplanation`
- `proofRecord`
- `enforcementBundle`

## Implemented adapter/control-point paths

### CloudEvents / event ingress

- `POST /api/v1/events/ingest`

Expected:

- CloudEvents-compatible envelope
- signed request support via `x-ecobe-signature` when configured
- idempotent processing based on event/request identity

### Queue / job adapter

- `POST /api/v1/adapters/queue/dispatch`

Control point:

- dispatcher

### Lambda adapter

- `POST /api/v1/adapters/lambda/invoke`

Control point:

- lambda wrapper / extension boundary

### Execution outcome callback

- `POST /api/v1/adapters/execution-outcomes`

Internal/authenticated path for adapters to attach observed runtime outcome metadata back onto a persisted decision frame.

## Provenance and assurance

### Water provenance inspection

- `GET /api/v1/water/provenance`

### Water provenance verification

- `POST /api/v1/water/provenance/verify`

Requires internal auth.

When local source files are discoverable, the verifier computes SHA-256 hashes and can persist them back into the normalized manifest.

## Telemetry

- `GET /api/v1/ci/telemetry`

This exposes:

- OTEL export posture
- current service name
- in-memory metric snapshot used by the control surface

## Notes

- Adapters are translation layers only. They must not implement scoring or doctrine logic.
- Replay remains engine-owned via `GET /api/v1/ci/decisions/:decisionFrameId/replay`.
- Proof export remains engine-owned via `POST /api/v1/ci/exports/proof`.
