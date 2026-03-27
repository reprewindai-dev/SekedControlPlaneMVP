import { env } from '../config/env';

type JsonSchema = {
  type?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  enum?: Array<string | number | boolean | null>;
};

export type ProviderAttempt = {
  provider: string;
  region: string;
  success: boolean;
  latencyMs: number;
  estimatedCostUsd: number;
  error?: string;
};

export type ProviderExecutionResult = {
  output: any;
  provider: string;
  region: string;
  latencyMs: number;
  estimatedCostUsd: number;
  attempts: ProviderAttempt[];
};

type ProviderExecutionInput = {
  schema: JsonSchema;
  task: any;
  inputs: any;
  runId: string;
  attempt: number;
  priorIssues: Array<{ path: string; message: string }>;
  preferredProvider?: string;
};

type ProviderName = 'ollama' | 'groq';

const GROQ_PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
};

export async function executeProviderSynthesis(input: ProviderExecutionInput): Promise<ProviderExecutionResult | null> {
  const providerOrder = resolveProviderOrder(input.preferredProvider);
  if (providerOrder.length === 0) return null;

  const prompt = buildPrompt(input);
  const attempts: ProviderAttempt[] = [];

  for (const provider of providerOrder) {
    const startedAt = Date.now();
    try {
      const result =
        provider === 'ollama'
          ? await executeOllama(prompt)
          : await executeGroq(prompt);

      const parsed = parseJsonPayload(result.text);
      attempts.push({
        provider,
        region: result.region,
        success: true,
        latencyMs: Date.now() - startedAt,
        estimatedCostUsd: result.estimatedCostUsd,
      });

      return {
        output: parsed,
        provider,
        region: result.region,
        latencyMs: Date.now() - startedAt,
        estimatedCostUsd: result.estimatedCostUsd,
        attempts,
      };
    } catch (error) {
      attempts.push({
        provider,
        region: provider === 'ollama' ? env.ollamaProviderRegion : env.groqProviderRegion,
        success: false,
        latencyMs: Date.now() - startedAt,
        estimatedCostUsd: 0,
        error: error instanceof Error ? error.message : 'Unknown provider error',
      });
    }
  }

  throw new Error(
    `Provider execution failed: ${attempts.map((attempt) => `${attempt.provider}:${attempt.error ?? 'unknown'}`).join('; ')}`,
  );
}

function resolveProviderOrder(preferredProvider?: string): ProviderName[] {
  const providers: ProviderName[] = [];
  const preferred = normalizeProvider(preferredProvider);

  if (preferred && isConfigured(preferred)) providers.push(preferred);
  if (!providers.includes('ollama') && isConfigured('ollama')) providers.push('ollama');
  if (!providers.includes('groq') && isConfigured('groq')) providers.push('groq');

  return providers;
}

function normalizeProvider(value?: string): ProviderName | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'ollama') return 'ollama';
  if (normalized === 'groq') return 'groq';
  return null;
}

function isConfigured(provider: ProviderName) {
  if (provider === 'ollama') return Boolean(env.ollamaBaseUrl && env.ollamaModel);
  return Boolean(env.groqApiKey && env.groqModel);
}

async function executeOllama(prompt: string) {
  const response = await fetch(`${env.ollamaBaseUrl.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.ollamaModel,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.1 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    response?: string;
  };

  if (!payload.response) throw new Error('Ollama returned empty response');

  return {
    text: payload.response,
    region: env.ollamaProviderRegion,
    estimatedCostUsd: 0,
  };
}

async function executeGroq(prompt: string) {
  if (!env.groqApiKey) throw new Error('GROQ_API_KEY is not configured');

  const response = await fetch(`${env.groqBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.groqApiKey}`,
    },
    body: JSON.stringify({
      model: env.groqModel,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Return only a valid JSON object that satisfies the requested schema. No markdown. No explanation.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq request failed with ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned empty response');

  const pricing = GROQ_PRICE_PER_MILLION[env.groqModel];
  const promptTokens = payload.usage?.prompt_tokens ?? 0;
  const completionTokens = payload.usage?.completion_tokens ?? 0;
  const estimatedCostUsd = pricing
    ? roundCurrency((promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output)
    : 0;

  return {
    text,
    region: env.groqProviderRegion,
    estimatedCostUsd,
  };
}

function buildPrompt(input: ProviderExecutionInput) {
  const issueText =
    input.priorIssues.length > 0
      ? input.priorIssues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')
      : 'None';

  return [
    `Run ID: ${input.runId}`,
    `Attempt: ${input.attempt}`,
    `Task Type: ${String(input.task?.type ?? 'generic_task')}`,
    `Risk Level: ${String(input.task?.risk_level ?? 'medium')}`,
    'Return a JSON object that matches this JSON schema exactly:',
    JSON.stringify(input.schema, null, 2),
    'Use these source inputs:',
    JSON.stringify(input.inputs, null, 2),
    'Prior validation issues to repair:',
    issueText,
    'Requirements:',
    '- preserve source meaning and terminology',
    '- satisfy required fields',
    '- do not wrap output in markdown fences',
    '- output JSON only',
  ].join('\n\n');
}

function parseJsonPayload(raw: string) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    throw new Error('Provider response did not contain valid JSON');
  }
}

function roundCurrency(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
