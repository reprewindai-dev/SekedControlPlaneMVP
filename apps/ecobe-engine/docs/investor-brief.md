# CO2 Router Investor Brief

## One-line definition

CO2 Router is a deterministic pre-execution environmental authorization control plane for compute.

It decides whether compute is allowed to run, where it should run, and under what environmental conditions, before execution happens.

## Problem

Enterprises have sustainability data, cloud data, and compliance pressure, but they still lack a pre-execution control system that can:

- enforce environmental policy before workloads run
- treat water as a real infrastructure constraint
- preserve replayable decision lineage
- produce proof strong enough for enterprise trust

Most available tools do one of the following:

- report after the fact
- optimize without proof
- monitor without enforcement
- schedule without governance

That leaves a gap between sustainability intent and infrastructure control.

## Product

CO2 Router fills that gap by operating as an authorization layer in front of compute.

It evaluates:

- carbon
- water
- latency
- cost
- policy

and returns one binding action:

- `run_now`
- `reroute`
- `delay`
- `throttle`
- `deny`

It then emits:

- enforcement artifacts
- proof metadata
- replay lineage

## Why it matters

This changes sustainability from reporting into governance.

Without CO2 Router:

- compute runs
- reporting happens later
- teams argue about what should have happened

With CO2 Router:

- compute must be authorized first
- decisions are explainable
- decisions are replayable
- policy is visible before execution

## Why now

The market conditions are converging:

- more multi-region compute
- more AI and batch workloads
- more infrastructure automation
- more enterprise pressure around environmental control and proof
- stronger need for governance at the control-plane layer

This product sits where environmental policy and infrastructure control meet.

## Who buys

Primary buyers:

- platform engineering
- infrastructure governance
- cloud and platform operations
- CI/CD owners
- Kubernetes platform teams

Secondary stakeholders:

- sustainability leadership
- compliance and audit
- procurement and enterprise architecture

## Wedge

The clearest near-term commercial wedge is:

- CI/CD authorization
- Kubernetes enforcement

These are the strongest current control points because they already sit before execution and are understood by platform teams.

## Moat

The moat is not “carbon optimization” by itself.

The moat is the combination of:

- deterministic pre-execution decisioning
- water-aware hard constraints
- one canonical decision model
- one canonical proof model
- replayable decision lineage
- adapter/control-point portability

That combination is much harder to replace than a dashboard or a routing heuristic.

## Current strengths

- deterministic doctrine exists
- canonical proof and replay model exists
- water is first-class
- CI/CD and Kubernetes wedge is real
- adapter plane is now structurally correct
- public surface now reflects operational truth more honestly

## Current risks

- not fully assurance-ready because water source provenance is not fully hash-verified yet
- universal adapter ecosystem is still early
- observability posture is OTEL-aligned but not yet a mature standalone telemetry product
- local Prisma build friction exists on the current Windows machine

## Current external truth

Production-grade deterministic decisioning and proof, with operational water authority today and full assurance closure still in progress.

## Why this can become large

If CO2 Router becomes the system that decides whether compute is allowed to run under environmental policy, it stops being a “green infrastructure feature” and becomes part of infrastructure governance.

That category is much larger, more durable, and more strategic than sustainability reporting.
