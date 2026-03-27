export type SekedClientOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
};

export type SekedRunPayload = {
  environmentSlug?: string;
  input: Record<string, unknown>;
  providerConstraints?: {
    preferredRegions?: string[];
    providers?: string[];
  };
  latencyCeiling?: number;
  costCeiling?: number;
  carbonPolicy?: {
    maxCarbonGPerKwh?: number;
  };
  model?: string;
  tokenCount?: number;
  requestCount?: number;
  operation?: string;
  output?: Record<string, unknown>;
  schema?: Record<string, unknown>;
  temperature?: number;
};

export type SekedBootstrapPayload = {
  organizationName: string;
  organizationSlug: string;
  projectName: string;
  projectSlug: string;
  environmentSlug?: string;
  keyName?: string;
  serviceAccountName?: string;
  policyName?: string;
  rotateCredentials?: boolean;
  rules?: Record<string, unknown>;
};

export class SekedClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: SekedClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  health() {
    return this.request("/api/v1/health", { method: "GET" }, false);
  }

  ready() {
    return this.request("/api/v1/ready", { method: "GET" }, false);
  }

  createRun(payload: SekedRunPayload) {
    return this.request("/api/v1/runs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  getRun(runId: string) {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}`, { method: "GET" });
  }

  getRunEvents(runId: string) {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/events`, { method: "GET" });
  }

  bootstrap(adminToken: string, payload: SekedBootstrapPayload) {
    return this.request(
      "/api/v1/bootstrap",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "x-ecobe-admin-token": adminToken,
        },
      },
      false,
    );
  }

  private async request(
    path: string,
    init: RequestInit,
    includeApiKey = true,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(includeApiKey ? { "x-api-key": this.apiKey } : {}),
          ...(init.headers ?? {}),
        },
      });

      const text = await response.text();
      const data = text ? safeJsonParse(text) : null;

      if (!response.ok) {
        throw new Error(
          `SEKED request failed (${response.status}) ${response.statusText}: ${text || "empty response"}`,
        );
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
