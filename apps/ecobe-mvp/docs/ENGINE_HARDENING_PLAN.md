# Engine Hardening Plan

- keep `ecobe-engine` private behind service-to-service auth
- expose only internal health, routing decision, decision fetch, and allocation endpoints
- keep routing traces in engine storage
- move tenant, billing, and dashboard concerns out of the engine
- keep provider logic, region scoring, and failover isolated in the engine
