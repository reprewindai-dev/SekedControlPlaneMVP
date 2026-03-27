# Integration Quickstart

Use this repo as the packaged source of truth for SEKED.

## What Another App Needs

Another app should integrate against the public control-plane service only:

- Service root: [apps/ecobe-mvp](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-mvp)
- Adapter: [adapters/node/seked-client.ts](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/adapters/node/seked-client.ts)

The integrating app should not call the engine directly.

## Runtime Contract

1. Your app sends governed work to `ecobe-mvp`
2. `ecobe-mvp` authenticates, persists, and evaluates policy
3. `ecobe-mvp` calls `ecobe-engine` over an internal/private network
4. `ecobe-mvp` returns the governed run result to your app

## Minimum Environment In The Integrating App

- `SEKED_BASE_URL`
- `SEKED_API_KEY`

Example:

```ts
import { SekedClient } from "./seked-client";

const seked = new SekedClient({
  baseUrl: process.env.SEKED_BASE_URL!,
  apiKey: process.env.SEKED_API_KEY!,
});

const run = await seked.createRun({
  environmentSlug: "production",
  operation: "lyrics.generate",
  input: {
    transcript: "raw freestyle input here",
  },
  providerConstraints: {
    providers: ["groq", "ollama"],
  },
});
```

## Bootstrap Flow

Use bootstrap once per tenant/project:

1. Call `POST /api/v1/bootstrap`
2. Pass `x-ecobe-admin-token`
3. Store the returned API key in the integrating app

Key route:

- [apps/ecobe-mvp/src/app/api/v1/bootstrap/route.ts](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-mvp/src/app/api/v1/bootstrap/route.ts)

## Run Flow

Primary run route:

- [apps/ecobe-mvp/src/app/api/v1/runs/route.ts](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/apps/ecobe-mvp/src/app/api/v1/runs/route.ts)

Support routes:

- `GET /api/v1/runs/:id`
- `GET /api/v1/runs/:id/events`

## What To Copy Into Another App

If you are integrating a Node app:

1. Copy [adapters/node/seked-client.ts](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/adapters/node/seked-client.ts)
2. Set `SEKED_BASE_URL`
3. Set `SEKED_API_KEY`
4. Call `createRun`

If you are integrating another platform:

1. Keep the same HTTP contract
2. Recreate the adapter in that platform
3. Do not embed engine credentials in the client app

## What Not To Do

- Do not call `ecobe-engine` from the customer-facing app
- Do not write integration-specific logic into the protected source repos
- Do not treat the nested [seked-control-plane](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/seked-control-plane) checkout as canonical
