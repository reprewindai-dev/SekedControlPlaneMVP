# CO2 Router Doctrine

## Definition

CO2 Router is a deterministic pre-execution environmental authorization control plane for compute.

It evaluates:

- carbon
- water
- latency
- cost
- policy

It returns exactly one binding action:

- `run_now`
- `reroute`
- `delay`
- `throttle`
- `deny`

It is not:

- a passive dashboard
- an ESG reporting suite
- a generic scheduler
- a recommendation engine

## Core doctrine

### 1. Decide before compute runs

CO2 Router exists to make authorization decisions before execution happens.

That means the product is not judged by:

- how much it visualizes
- how much it reports
- how many sustainability metrics it can summarize after the fact

It is judged by whether it can:

- decide
- enforce
- explain
- replay
- prove

### 2. Determinism is mandatory

The decision core must behave as follows:

- same request
- same doctrine version
- same signal snapshot
- same operating mode

must produce:

- the same action
- the same target
- the same reason code

Randomness, hidden heuristic drift, or UI-side decision logic are doctrine violations.

### 3. Fixed-order evaluation

The engine evaluates in this order:

1. policy overrides
2. water guardrails
3. latency and SLA protection
4. carbon optimization inside the allowed envelope
5. cost as late influence

This order matters because the product is an authorization system, not a generic optimizer.

### 4. Water is a hard authorization input

Water is not a decorative score.

If a target fails water guardrails, it should not win selection just because it is cleaner on carbon.

Water is one of the reasons CO2 Router is infrastructure governance software rather than simple carbon-aware routing.

### 5. Proof is part of the product

Every decision should persist enough information to answer:

- what would have happened by default
- what was selected instead
- why that action won
- what signal state was used
- whether degraded or fallback conditions were involved

Proof is not optional exhaust. It is a first-class product surface.

### 6. Adapters stay dumb

HTTP, CloudEvents, queue/job, Lambda, CI/CD, and Kubernetes are adapter/control-point layers.

Adapters may:

- translate runtime context
- translate transport shape
- carry proof and enforcement metadata

Adapters may not:

- score candidates
- rewrite doctrine
- make policy decisions

The engine decides. Adapters translate.

### 7. Public claims must match engine truth

If a surface is:

- replayed
- simulated
- degraded
- operational but not assurance-ready

it must be labeled as such.

The product should not claim full audit-grade source pinning while the provenance layer is still incomplete.

## Current product truth

Today CO2 Router is strongest as:

- a deterministic decision engine
- a proof and replay system
- a CI/CD and Kubernetes authorization wedge
- a water-aware environmental control plane

Today CO2 Router is not yet fully complete as:

- a fully source-pinned assurance system
- a fully mature universal adapter ecosystem
- a deeply mature observability platform in its own right

## Current external phrasing

Use this externally:

Production-grade deterministic decisioning and proof, with operational water authority today and full assurance closure still in progress.
