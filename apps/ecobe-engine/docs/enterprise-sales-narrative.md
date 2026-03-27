# CO2 Router Enterprise Sales Narrative

## Opening

CO2 Router is not a sustainability dashboard.

It is a deterministic pre-execution environmental authorization control plane for compute.

That means it decides whether compute is allowed to run, where it should run, and under what environmental conditions, before execution happens.

## What problem we solve

Most enterprises already have:

- cloud telemetry
- cost visibility
- carbon estimates
- some sustainability reporting

What they usually do not have is a system that can enforce environmental policy before execution while preserving enterprise-grade proof and replay.

That is the gap CO2 Router fills.

## What buyers actually get

With CO2 Router, a workload request reaches an authorization layer before compute is allocated.

The engine evaluates:

- carbon conditions
- water conditions
- latency and criticality constraints
- cost influence
- policy rules

Then it returns one binding action:

- run
- reroute
- delay
- throttle
- deny

This changes the customer conversation from:

"Can we report on environmental impact?"

to:

"Can we control execution rights under environmental policy?"

## Why this matters to platform teams

Platform teams do not need another dashboard.

They need:

- deterministic control
- low-latency authorization
- CI/CD and Kubernetes compatibility
- replayable decisioning
- evidence they can show internally

CO2 Router is useful because it meets them at existing control points rather than asking them to rebuild their platform around a sustainability tool.

## Why this matters to compliance and sustainability teams

Compliance and sustainability teams often have after-the-fact data but not pre-execution control.

CO2 Router gives them:

- visible doctrine
- decision lineage
- proof exports
- replayability
- a way to distinguish operational truth from full assurance readiness

## Why we are different

### Not a dashboard

Dashboards observe and summarize after the fact.

CO2 Router decides before the workload runs.

### Not a generic scheduler

Schedulers optimize placement.

CO2 Router enforces authorization under deterministic environmental doctrine.

### Not ESG software

ESG suites focus on reporting, evidence rooms, and disclosure workflows.

CO2 Router focuses on execution control.

## Why customers buy first

The first practical deployment paths are:

- CI/CD authorization
- Kubernetes enforcement

Those are the fastest ways for enterprises to prove value because they already control high-leverage execution paths and already understand the idea of policy gating before execution.

## Strengths to emphasize

- deterministic decisioning
- water as a hard constraint
- replay and proof lineage
- one canonical decision/proof model
- runtime-agnostic core with thin adapters
- honest degraded-state handling

## Weaknesses to handle honestly

- full assurance closure is still in progress because source-file provenance is not fully verified yet
- the broader adapter ecosystem is still early
- the strongest production story is still CI/CD and Kubernetes

These are acceptable weaknesses if stated directly. They are worse only when hidden.

## Best closing line

CO2 Router gives infrastructure teams a way to turn environmental policy into pre-execution control instead of after-the-fact reporting.
