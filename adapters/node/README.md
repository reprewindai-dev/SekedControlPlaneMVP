# Node Adapter

This adapter is the quick integration surface for another app.

Use it when you want to connect a product to the SEKED public control-plane API without copying logic out of `ecobe-mvp`.

Primary file:

- [seked-client.ts](/C:/Users/antho/.windsurf/SekedControlPlaneMVP/adapters/node/seked-client.ts)

Expected environment in the integrating app:

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
  input: {
    prompt: "Evaluate this workload",
    payload: { example: true },
  },
});
```
