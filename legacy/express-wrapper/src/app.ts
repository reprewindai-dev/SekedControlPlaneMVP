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
