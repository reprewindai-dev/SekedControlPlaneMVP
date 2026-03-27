# ecobe-mvp to ecobe-engine Interface

- shared auth: `Authorization: Bearer <ECOBE_ENGINE_INTERNAL_KEY>`
- create routing decision: `POST /internal/v1/routing-decisions`
- fetch decision: `GET /internal/v1/routing-decisions/:decisionId`
- execute allocation: `POST /internal/v1/routing-decisions/:decisionId/execute`
- engine health: `GET /internal/v1/health`
