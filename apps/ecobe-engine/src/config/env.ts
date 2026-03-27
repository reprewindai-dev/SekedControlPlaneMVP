import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_DATABASE_URL: z.string().optional(), // Direct Neon URL for migrations (bypasses Accelerate)
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Optional
  ELECTRICITY_MAPS_API_KEY: z.string().optional(),
  ELECTRICITY_MAPS_BASE_URL: z.string().default('https://api.electricitymap.org'),
  DEFAULT_MAX_CARBON_G_PER_KWH: z.string().default('400'),
  
  // WattTime
  WATTTIME_USERNAME: z.string().optional(),
  WATTTIME_PASSWORD: z.string().optional(),
  WATTTIME_BASE_URL: z.string().optional(),
  
  // Ember
  EMBER_API_KEY: z.string().optional(),
  EMBER_BASE_URL: z.string().default('https://api.ember-energy.org'),
  
  // EIA
  EIA_API_KEY: z.string().optional(),
  EIA_BASE_URL: z.string().default('https://api.eia.gov'),
  WATTTIME_API_KEY: z.string().optional(),

  // GridStatus.io (curated EIA-930 data with real fuel mix)
  GRIDSTATUS_API_KEY: z.string().optional(),
  
  // Finland Fingrid (optional regional provider)
  FINGRID_API_KEY: z.string().optional(),

  // Grid Signal Cache
  GRID_SIGNAL_CACHE_TTL: z.string().default('900'),
  GRID_FEATURE_CACHE_TTL: z.string().default('3600'),

  // Ingestion
  EIA_INGESTION_SCHEDULE: z.string().default('0 */15 * * * *'),
  EIA_BACKFILL_ENABLED: z.string().default('true'),

  // Intelligence / vectors
  UPSTASH_VECTOR_REST_URL: z.string().optional(),
  UPSTASH_VECTOR_REST_TOKEN: z.string().optional(),
  UPSTASH_VECTOR_INDEX_NAME: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OPTIMIZE_API_KEY: z.string().optional(),

  // Intelligence jobs / scheduling
  QSTASH_TOKEN: z.string().optional(),
  QSTASH_BASE_URL: z.string().optional(),
  INTELLIGENCE_JOB_TOKEN: z.string().optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional(),
  INTELLIGENCE_ACCURACY_CRON: z.string().default('*/30 * * * *'),
  INTELLIGENCE_VECTOR_CLEANUP_CRON: z.string().default('0 3 * * *'),
  INTELLIGENCE_CALIBRATION_CRON: z.string().default('15 * * * *'),

  FORECAST_REFRESH_ENABLED: z.string().optional(),
  FORECAST_REFRESH_CRON: z.string().default('*/30 * * * *'),

  // Autonomy loops
  LEARNING_LOOP_ENABLED: z.string().optional(),
  LEARNING_LOOP_CRON: z.string().default('*/15 * * * *'),
  LEARNING_LOOKBACK_HOURS: z.string().default('168'),
  RUNTIME_SUPERVISOR_ENABLED: z.string().optional(),
  RUNTIME_SUPERVISOR_INTERVAL_SEC: z.string().default('60'),
  SUPERVISOR_FORECAST_STALE_MIN: z.string().default('90'),
  SUPERVISOR_INTELLIGENCE_STALE_MIN: z.string().default('90'),
  SUPERVISOR_LEARNING_STALE_MIN: z.string().default('120'),
  SUPERVISOR_DECISION_EVENT_STALE_MIN: z.string().default('30'),

  // Decision event outbox / sink delivery
  DECISION_EVENT_DISPATCH_ENABLED: z.string().optional(),
  DECISION_EVENT_DISPATCH_CRON: z.string().default('*/20 * * * * *'),
  DECISION_EVENT_DISPATCH_BATCH_SIZE: z.string().default('25'),
  DECISION_EVENT_DISPATCH_TIMEOUT_MS: z.string().default('3000'),
  DECISION_EVENT_MAX_ATTEMPTS: z.string().default('5'),
  DECISION_EVENT_RETRY_BASE_MS: z.string().default('1000'),
  DECISION_EVENT_SIGNATURE_SECRET: z.string().optional(),
  DECISION_EVENT_ALERT_LAG_MINUTES: z.string().default('10'),
  DECISION_EVENT_ALERT_FAILURE_RATE_PCT: z.string().default('20'),
  DECISION_EVENT_ALERT_DEADLETTER_COUNT: z.string().default('25'),
  DECISION_API_IDEMPOTENCY_TTL_SEC: z.string().default('900'),
  DECISION_API_SIGNATURE_SECRET: z.string().optional(),

  // Optional external pre-decision policy hook
  EXTERNAL_POLICY_HOOK_ENABLED: z.string().optional(),
  EXTERNAL_POLICY_HOOK_URL: z.string().optional(),
  EXTERNAL_POLICY_HOOK_AUTH_TOKEN: z.string().optional(),
  EXTERNAL_POLICY_HOOK_TIMEOUT_MS: z.string().default('800'),
  EXTERNAL_POLICY_HOOK_STRICT_PROFILES: z.string().optional(),

  // SEKED pre-decision policy adapter (separate control plane)
  SEKED_POLICY_ADAPTER_ENABLED: z.string().optional(),
  SEKED_POLICY_ADAPTER_URL: z.string().optional(),
  SEKED_POLICY_ADAPTER_AUTH_TOKEN: z.string().optional(),
  SEKED_POLICY_ADAPTER_TIMEOUT_MS: z.string().default('800'),
  SEKED_POLICY_ADAPTER_STRICT_PROFILES: z.string().optional(),

  // UI (debug)
  UI_ENABLED: z.string().optional(),
  UI_TOKEN: z.string().optional(),
  ENGINE_BACKGROUND_WORKERS_ENABLED: z.string().optional(),

  // Internal service auth (used by internal-auth middleware and admin routes)
  ECOBE_INTERNAL_API_KEY: z.string().optional(),

  // External integrations
  ECOBE_ENGINE_URL: z.string().optional(),
  ECOBE_ENGINE_API_KEY: z.string().optional(),

  // Observability / OTLP-aligned export
  OTEL_EXPORT_ENABLED: z.string().optional(),
  OTEL_EXPORT_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('ecobe-engine'),
  OTEL_EXPORT_TIMEOUT_MS: z.string().default('1500'),

  // DEKES SaaS integration
  DEKES_API_KEY: z.string().optional(),
  DEKES_WEBHOOK_URL: z.string().optional(), // e.g. https://dekes.example.com/api/ecobe/handoff-status
  DEKES_WEBHOOK_SECRET: z.string().optional(),

  // Authentication
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  
  // Stripe Billing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_GROWTH_MONTHLY_PRICE_ID: z.string().optional(),
  STRIPE_GROWTH_ANNUAL_PRICE_ID: z.string().optional(),
  STRIPE_ENTERPRISE_PRICE_ID: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(JSON.stringify(parsed.error.format(), null, 2))
  process.exit(1)
}

export const env = {
  ...parsed.data,
  DEFAULT_MAX_CARBON_G_PER_KWH: parseInt(parsed.data.DEFAULT_MAX_CARBON_G_PER_KWH),
  PORT: parseInt(parsed.data.PORT),
  UI_ENABLED:
    parsed.data.UI_ENABLED !== undefined
      ? parsed.data.UI_ENABLED === 'true'
      : parsed.data.NODE_ENV !== 'production',
  ENGINE_BACKGROUND_WORKERS_ENABLED:
    parsed.data.ENGINE_BACKGROUND_WORKERS_ENABLED !== undefined
      ? parsed.data.ENGINE_BACKGROUND_WORKERS_ENABLED === 'true'
      : false,
  FORECAST_REFRESH_ENABLED:
    parsed.data.FORECAST_REFRESH_ENABLED !== undefined
      ? parsed.data.FORECAST_REFRESH_ENABLED === 'true'
      : parsed.data.NODE_ENV !== 'test',
  FORECAST_REFRESH_CRON: parsed.data.FORECAST_REFRESH_CRON,
  LEARNING_LOOP_ENABLED:
    parsed.data.LEARNING_LOOP_ENABLED !== undefined
      ? parsed.data.LEARNING_LOOP_ENABLED === 'true'
      : parsed.data.NODE_ENV !== 'test',
  LEARNING_LOOP_CRON: parsed.data.LEARNING_LOOP_CRON,
  LEARNING_LOOKBACK_HOURS: parseInt(parsed.data.LEARNING_LOOKBACK_HOURS),
  RUNTIME_SUPERVISOR_ENABLED:
    parsed.data.RUNTIME_SUPERVISOR_ENABLED !== undefined
      ? parsed.data.RUNTIME_SUPERVISOR_ENABLED === 'true'
      : parsed.data.NODE_ENV !== 'test',
  RUNTIME_SUPERVISOR_INTERVAL_SEC: parseInt(parsed.data.RUNTIME_SUPERVISOR_INTERVAL_SEC),
  SUPERVISOR_FORECAST_STALE_MIN: parseInt(parsed.data.SUPERVISOR_FORECAST_STALE_MIN),
  SUPERVISOR_INTELLIGENCE_STALE_MIN: parseInt(parsed.data.SUPERVISOR_INTELLIGENCE_STALE_MIN),
  SUPERVISOR_LEARNING_STALE_MIN: parseInt(parsed.data.SUPERVISOR_LEARNING_STALE_MIN),
  SUPERVISOR_DECISION_EVENT_STALE_MIN: parseInt(parsed.data.SUPERVISOR_DECISION_EVENT_STALE_MIN),
  DECISION_EVENT_DISPATCH_ENABLED:
    parsed.data.DECISION_EVENT_DISPATCH_ENABLED !== undefined
      ? parsed.data.DECISION_EVENT_DISPATCH_ENABLED === 'true'
      : parsed.data.NODE_ENV !== 'test',
  DECISION_EVENT_DISPATCH_CRON: parsed.data.DECISION_EVENT_DISPATCH_CRON,
  DECISION_EVENT_DISPATCH_BATCH_SIZE: parseInt(parsed.data.DECISION_EVENT_DISPATCH_BATCH_SIZE),
  DECISION_EVENT_DISPATCH_TIMEOUT_MS: parseInt(parsed.data.DECISION_EVENT_DISPATCH_TIMEOUT_MS),
  DECISION_EVENT_MAX_ATTEMPTS: parseInt(parsed.data.DECISION_EVENT_MAX_ATTEMPTS),
  DECISION_EVENT_RETRY_BASE_MS: parseInt(parsed.data.DECISION_EVENT_RETRY_BASE_MS),
  DECISION_EVENT_ALERT_LAG_MINUTES: parseInt(parsed.data.DECISION_EVENT_ALERT_LAG_MINUTES),
  DECISION_EVENT_ALERT_FAILURE_RATE_PCT: parseInt(parsed.data.DECISION_EVENT_ALERT_FAILURE_RATE_PCT),
  DECISION_EVENT_ALERT_DEADLETTER_COUNT: parseInt(parsed.data.DECISION_EVENT_ALERT_DEADLETTER_COUNT),
  DECISION_API_IDEMPOTENCY_TTL_SEC: parseInt(parsed.data.DECISION_API_IDEMPOTENCY_TTL_SEC),
  DECISION_API_SIGNATURE_SECRET: parsed.data.DECISION_API_SIGNATURE_SECRET,
  EXTERNAL_POLICY_HOOK_ENABLED:
    parsed.data.EXTERNAL_POLICY_HOOK_ENABLED !== undefined
      ? parsed.data.EXTERNAL_POLICY_HOOK_ENABLED === 'true'
      : false,
  EXTERNAL_POLICY_HOOK_URL: parsed.data.EXTERNAL_POLICY_HOOK_URL,
  EXTERNAL_POLICY_HOOK_AUTH_TOKEN: parsed.data.EXTERNAL_POLICY_HOOK_AUTH_TOKEN,
  EXTERNAL_POLICY_HOOK_TIMEOUT_MS: parseInt(parsed.data.EXTERNAL_POLICY_HOOK_TIMEOUT_MS),
  EXTERNAL_POLICY_HOOK_STRICT_PROFILES: parsed.data.EXTERNAL_POLICY_HOOK_STRICT_PROFILES,
  SEKED_POLICY_ADAPTER_ENABLED:
    parsed.data.SEKED_POLICY_ADAPTER_ENABLED !== undefined
      ? parsed.data.SEKED_POLICY_ADAPTER_ENABLED === 'true'
      : false,
  SEKED_POLICY_ADAPTER_URL: parsed.data.SEKED_POLICY_ADAPTER_URL,
  SEKED_POLICY_ADAPTER_AUTH_TOKEN: parsed.data.SEKED_POLICY_ADAPTER_AUTH_TOKEN,
  SEKED_POLICY_ADAPTER_TIMEOUT_MS: parseInt(parsed.data.SEKED_POLICY_ADAPTER_TIMEOUT_MS),
  SEKED_POLICY_ADAPTER_STRICT_PROFILES: parsed.data.SEKED_POLICY_ADAPTER_STRICT_PROFILES,
  OTEL_EXPORT_ENABLED:
    parsed.data.OTEL_EXPORT_ENABLED !== undefined
      ? parsed.data.OTEL_EXPORT_ENABLED === 'true'
      : false,
  OTEL_EXPORT_ENDPOINT: parsed.data.OTEL_EXPORT_ENDPOINT,
  OTEL_SERVICE_NAME: parsed.data.OTEL_SERVICE_NAME,
  OTEL_EXPORT_TIMEOUT_MS: parseInt(parsed.data.OTEL_EXPORT_TIMEOUT_MS),
  INTELLIGENCE_ACCURACY_CRON: parsed.data.INTELLIGENCE_ACCURACY_CRON,
  INTELLIGENCE_VECTOR_CLEANUP_CRON: parsed.data.INTELLIGENCE_VECTOR_CLEANUP_CRON,
  INTELLIGENCE_CALIBRATION_CRON: parsed.data.INTELLIGENCE_CALIBRATION_CRON,
}

export type Env = typeof env
