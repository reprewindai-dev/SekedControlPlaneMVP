# ECOBE / CO2 Router Architecture Laws

Version: `2026-03-24.a`
Status: `non-negotiable`

## Law 1: Integration-First
ECOBE must remain framework-pluggable and integration-first. Core decisions, policy outcomes, and provenance must be exposed through stable API contracts and machine-consumable outputs.

## Law 2: Provider Isolation
Provider-specific clients are implementation details. Route and policy layers must consume normalized signals via adapter/facade layers (for example `provider-router`, `water bundle`) and must not import raw provider clients directly.

## Law 3: Normalized Signal Model
Carbon and water decisions must be computed on normalized internal models with explicit confidence, provenance, and fallback state. Direct provider payloads are forbidden in decision contracts.

## Law 4: Policy / Provider Separation
Policy evaluation is deterministic and provider-agnostic. Policy modules must not depend on provider libraries or external APIs.

## Law 5: Proof-First Outputs
Decision outputs must be replayable and audit-grade:
- selected vs baseline impact
- policy trace
- signal confidence
- dataset provenance
- immutable chain metadata for exports

## Law 6: Offline Determinism
Decision-time execution must not depend on live water API calls. Local mirrored artifacts and last-known-good recovery are required.

## Enforcement
These laws are enforced in CI by `src/__tests__/architecture-laws.test.ts`.
