export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  NEXT_PUBLIC_APP_URL: (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, ''),
  ECOBE_ENGINE_URL: (process.env.ECOBE_ENGINE_URL ?? '').replace(/\/$/, ''),
  ECOBE_ENGINE_INTERNAL_KEY: process.env.ECOBE_ENGINE_INTERNAL_KEY ?? '',
  SEKED_URL: (process.env.SEKED_URL ?? '').replace(/\/$/, ''),
  SEKED_INTERNAL_KEY: process.env.SEKED_INTERNAL_KEY ?? '',
  CONVERGEOS_URL: (process.env.CONVERGEOS_URL ?? '').replace(/\/$/, ''),
  CONVERGEOS_INTERNAL_KEY: process.env.CONVERGEOS_INTERNAL_KEY ?? '',
  USE_LOCAL_GOVERNANCE_FALLBACK:
    process.env.USE_LOCAL_GOVERNANCE_FALLBACK !== undefined
      ? process.env.USE_LOCAL_GOVERNANCE_FALLBACK === 'true'
      : (process.env.NODE_ENV ?? 'development') !== 'production',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  STRIPE_TIER_1_PRICE_ID: process.env.STRIPE_TIER_1_PRICE_ID ?? '',
  STRIPE_TIER_2_PRICE_ID: process.env.STRIPE_TIER_2_PRICE_ID ?? '',
  STRIPE_TIER_3_PRICE_ID: process.env.STRIPE_TIER_3_PRICE_ID ?? '',
  STRIPE_CHECKOUT_SUCCESS_URL: (process.env.STRIPE_CHECKOUT_SUCCESS_URL ?? '').replace(/\/$/, ''),
  STRIPE_CHECKOUT_CANCEL_URL: (process.env.STRIPE_CHECKOUT_CANCEL_URL ?? '').replace(/\/$/, ''),
  STRIPE_PORTAL_RETURN_URL: (process.env.STRIPE_PORTAL_RETURN_URL ?? '').replace(/\/$/, ''),
  AUDIT_SIGNING_SECRET: process.env.AUDIT_SIGNING_SECRET ?? 'development-audit-secret',
  WEBHOOK_SECRET_ENCRYPTION_KEY: process.env.WEBHOOK_SECRET_ENCRYPTION_KEY ?? '',
  ECOBE_ADMIN_TOKEN: process.env.ECOBE_ADMIN_TOKEN ?? 'ecobe-admin-local',
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME ?? 'ECOBE Control Plane',
  OLLAMA_BASE_URL: (process.env.OLLAMA_BASE_URL ?? '').replace(/\/$/, ''),
  OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b',
  OLLAMA_NUM_PREDICT: Number(process.env.OLLAMA_NUM_PREDICT ?? 4096),
  OLLAMA_MAX_ATTEMPTS: Number(process.env.OLLAMA_MAX_ATTEMPTS ?? 2),
}

export function governanceFallbackAllowed() {
  return env.USE_LOCAL_GOVERNANCE_FALLBACK
}

export function engineConfigured() {
  return Boolean(env.ECOBE_ENGINE_URL && env.ECOBE_ENGINE_INTERNAL_KEY)
}
