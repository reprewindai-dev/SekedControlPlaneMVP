# ecobe-mvp Boundary

`ecobe-mvp` is the customer-facing product.

## Owns

- public `/v1` API
- dashboard
- auth and API keys
- orgs, projects, environments
- policies and policy versions
- run lifecycle
- audit views and usage
- billing surfaces and webhooks

## Forbidden here

- no direct provider routing logic
- no provider allocation engine
- no engine-only telemetry ownership
- no direct customer bypass to `ecobe-engine`
