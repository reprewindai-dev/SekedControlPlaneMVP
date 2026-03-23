import dotenv from 'dotenv';

dotenv.config();

const required = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) throw new Error(`Missing required env var ${key}`);
  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT || '8080', 10),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  stripeSecretKey: required('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: required('STRIPE_WEBHOOK_SECRET'),
  adminApiKey: required('ADMIN_API_KEY'),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b',
  ollamaProviderRegion: process.env.OLLAMA_PROVIDER_REGION ?? 'local',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  groqBaseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
  groqModel: process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant',
  groqProviderRegion: process.env.GROQ_PROVIDER_REGION ?? 'groq-cloud',
};
