import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import healthRouter from './routes/health';
import runsRouter from './routes/runs';
import policiesRouter from './routes/policies';
import keysRouter from './routes/keys';
import usageRouter from './routes/usage';
import { billingWebhookHandler } from './routes/billing';
import { requireBearerAuth } from './middleware/auth';

const app = express();

app.use(helmet());
app.use(cors());
// Stripe webhook requires raw body
app.post('/billing/webhook', express.raw({ type: 'application/json' }), billingWebhookHandler);

app.use(express.json({ limit: '1mb' }));
app.use(compression());
app.use(morgan('combined'));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use('/health', healthRouter);

app.get('/.well-known/x402.json', (_req: Request, res: Response) => {
  res.json({
    x402_version: 2,
    provider: 'Seked Control Plane — Signal Coherence Governance',
    network: 'eip155:8453',
    payTo: '0xCC34553b4e6332ffb9C1b61E22436ACA53113D1d',
    currency: 'USDC',
    identity: {
      veklom_id_app: '6a20f24cc341f72c2f573eb5',
      veklom_id_wallet: '0x3a74772e925b54F7dAD7FD95c9Ba30825033f970',
      verification_domain: 'veklom-id.vercel.app',
    },
    routes: [
      { route: 'POST /runs', price: '$0.020', description: 'Submit an LLM routing run through Seked governance with latency, cost, and carbon-aware selection.', tags: ['seked', 'run', 'routing', 'llm', 'veklom'] },
      { route: 'GET /runs', price: '$0.005', description: 'Query execution run history with provider baselines and quality scores.', tags: ['seked', 'runs', 'history', 'veklom'] },
      { route: 'GET /policies', price: '$0.003', description: 'List active routing policies and compliance rules.', tags: ['seked', 'policies', 'governance', 'veklom'] },
      { route: 'GET /usage', price: '$0.003', description: 'Query usage telemetry, carbon tracking, and cost analytics.', tags: ['seked', 'usage', 'telemetry', 'carbon', 'veklom'] },
      { route: 'POST /keys', price: '$0.010', description: 'Register a new API key for Seked-governed LLM routing.', tags: ['seked', 'keys', 'auth', 'veklom'] },
    ],
    discovery: {
      bazaar: 'https://bazaar.cdp.coinbase.com',
      veklom_id: 'https://veklom-id.vercel.app',
    },
  });
});

// Auth-protected routes
app.use(requireBearerAuth);
app.use('/runs', runsRouter);
app.use('/policies', policiesRouter);
app.use('/keys', keysRouter);
app.use('/usage', usageRouter);

app.use((req: Request, res: Response) => {
  return res.status(404).json({ error: 'Not Found' });
});

// Centralized error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  return res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
