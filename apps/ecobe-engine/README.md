# CO2 Router

CO2 Router is a deterministic pre-execution environmental authorization control plane for compute.

It evaluates:

- carbon
- water
- latency
- cost
- policy

and returns exactly one binding action:

- `run_now`
- `reroute`
- `delay`
- `throttle`
- `deny`

It then emits enforcement artifacts, persists proof and replay lineage, and exposes adapter/control-point metadata for external callers.

## What it is

CO2 Router is infrastructure governance software that decides whether compute is allowed to run, where it should run, and under what environmental conditions, before execution happens.

It is not:

- a passive dashboard
- an ESG reporting suite
- a generic scheduler
- a recommendation engine

## What is real today

The current engine already has:

- deterministic decision doctrine
- replay and persisted decision lineage
- proof export chain
- water-aware authorization
- CI/CD enforcement bundle generation
- Kubernetes enforcement bundle generation
- canonical decision and proof envelopes
- adapter entry points for HTTP, CloudEvents, queue/job, and Lambda paths

## What is not fully closed yet

The product is operational, but not fully assurance-ready.

Why:

- water source-file provenance is not fully verified yet
- the provenance verifier currently reports missing local source files for key water datasets
- the adapter ecosystem is structurally correct but still early

Use this external qualifier:

Production-grade deterministic decisioning and proof, with operational water authority today and full assurance closure still in progress.

## Core runtime flow

1. A caller submits a workload request with execution context, constraints, runtime target, and policy metadata.
2. The engine resolves candidate regions and gathers carbon and water signals.
3. It applies doctrine in fixed order:
   - policy overrides
   - water guardrails
   - SLA / critical-path protection
   - carbon optimization inside the allowed envelope
   - cost as late influence
4. It returns one binding action.
5. It emits enforcement outputs and canonical proof metadata.
6. It persists the decision for replay, evidence lookup, and export.

## Canonical API surfaces

### Decision API v1

- `POST /api/v1/ci/authorize`
- aliases:
  - `POST /api/v1/ci/route`
  - `POST /api/v1/ci/carbon-route`

### Event ingress

- `POST /api/v1/events/ingest`

### Queue/job adapter

- `POST /api/v1/adapters/queue/dispatch`

### Lambda adapter

- `POST /api/v1/adapters/lambda/invoke`

### Execution outcome callback

- `POST /api/v1/adapters/execution-outcomes`

### Replay

- `GET /api/v1/ci/decisions/:decisionFrameId/replay`

### Proof export

- `POST /api/v1/ci/exports/proof`

### Water provenance

- `GET /api/v1/water/provenance`
- `POST /api/v1/water/provenance/verify`

## Canonical response shape

The decision response includes both the historical CI response and the canonical envelopes:

- `decisionEnvelope`
- `proofEnvelope`
- `telemetryBridge`
- `adapterContext`

These sit alongside:

- `policyTrace`
- `decisionExplanation`
- `proofRecord`
- `enforcementBundle`
- `mss`

## Who it is for

Primary buyers and operators:

- platform engineering
- infrastructure governance
- CI/CD owners
- Kubernetes platform teams
- regulated enterprises
- sustainability/compliance teams that need pre-execution evidence

Best fit environments:

- movable workloads
- multi-region execution
- CI/CD-heavy delivery
- Kubernetes clusters
- queue and batch workloads

## Strengths

- deterministic decisioning
- one canonical decision and proof model
- water as a real hard constraint
- replay and proof lineage
- runtime-agnostic core with thin adapters
- honest degraded-state handling

## Weaknesses

- not fully assurance-ready yet
- adapter ecosystem still early
- strongest production wedge is still CI/CD and Kubernetes
- local Windows Prisma build friction can block `prisma generate`

## Local development

### Prerequisites

- Node.js 20+
- PostgreSQL
- Redis

### Install

```bash
npm install
```

### Run development server

```bash
npm run dev
```

### Type-check

```bash
npm run type-check
```

### Run focused doctrine tests

```bash
npm test -- --runTestsByPath src/__tests__/ci-doctrine.test.ts
npm test -- --runTestsByPath src/__tests__/ci-response-v2-contract.test.ts
```

### Verify water provenance

```bash
npm run water:verify-provenance
```

## Build note

On the current Windows machine, `npm run build` may fail during `prisma generate` because of a Prisma DLL rename lock. Type-checking and targeted tests are the more reliable validation paths in this local environment until that lock is resolved.

## Key docs

- [Doctrine](C:/Users/antho/.windsurf/ecobe-engineclaude/ecobe-engine/docs/co2-router-doctrine.md)
- [Universal Adapter Spec](C:/Users/antho/.windsurf/ecobe-engineclaude/ecobe-engine/docs/universal-adapter-spec.md)
- [Investor Brief](C:/Users/antho/.windsurf/ecobe-engineclaude/ecobe-engine/docs/investor-brief.md)
- [Enterprise Sales Narrative](C:/Users/antho/.windsurf/ecobe-engineclaude/ecobe-engine/docs/enterprise-sales-narrative.md)
