# Provider Outage Runbook

## Trigger
- repeated upstream errors from WattTime/Ember adapters
- confidence collapse due stale carbon feeds

## Detection
1. `GET /api/v1/system/status`
2. `GET /api/v1/ci/health`
3. `GET /api/v1/integrations/events/outbox/metrics`

## Required Control-Plane Response
- mark fallback in decision trace
- lower confidence score
- apply strict fail-safe action under strict profiles
- never silently fail-open

## Operator Actions
1. Confirm mirror snapshot freshness and fallback resolution path.
2. Validate decision stream carries `fallbackUsed=true` for impacted region(s).
3. When provider recovers, verify resolver exits degraded mode and confidence normalizes.

