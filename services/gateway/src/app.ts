import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { requireAuth } from './middleware/auth';
import routesPlugin from './plugins/routes';

dotenv.config();

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const runQueue = new Queue('run-pipeline', { connection: redis });
const sekedQueue = new Queue('pipeline-seked', { connection: redis });
const convergeQueue = new Queue('pipeline-converge', { connection: redis });
const ecobeQueue = new Queue('pipeline-ecobe', { connection: redis });
const watchtowerQueue = new Queue('watchtower-validation', { connection: redis });
const celestialQueue = new Queue('celestial-navigation', { connection: redis });
const acousticQueue = new Queue('acoustic-listening', { connection: redis });
const collapseQueue = new Queue('empire-collapse-prevention', { connection: redis });
const shadowQueue = new Queue('shadow-tracking', { connection: redis });

const prisma = new PrismaClient();

const app = Fastify({ logger: true });

app.register(helmet);
app.register(cors);
app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
});

app.register(routesPlugin);

const runSchema = z.object({
  policy_profile_id: z.string().min(1),
  project_id: z.string().min(1),
  schema_id: z.string().min(1),
  task: z.object({ type: z.string(), risk_level: z.string() }),
  inputs: z.record(z.any()),
  constraints: z.object({ latency_ms_max: z.number().optional(), cost_usd_max: z.number().optional() }).optional(),
  execution: z.record(z.any()).optional(),
});

app.get('/health', async () => ({ status: 'ok' }));

app.post('/runs', async (request: FastifyRequest, reply: FastifyReply) => {
  const parsed = runSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const authCtx = await requireAuth(request, reply);
  if (!authCtx) return;
  const { orgId, apiKeyId, role } = authCtx;

  if (role === 'readonly') return reply.code(403).send({ error: 'Forbidden' });

  const body = parsed.data;
  const run = await prisma.run.create({
    data: {
      orgId,
      projectId: body.project_id,
      policyProfileId: body.policy_profile_id,
      schemaId: body.schema_id,
      correlationId: `corr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      policyVersion: 1,
      schemaVersion: 1,
      status: 'queued',
      finalOutputJson: null as any,
      events: {
        create: {
          type: 'RUN_CREATED',
          data: body as any,
        },
      },
    },
  });

  await prisma.usageRecord.create({
    data: {
      orgId,
      runId: run.id,
      metric: 'requests',
      quantity: 1,
      unit: 'request',
      unitCost: 0,
      totalCost: 0,
    },
  });

  await runQueue.add('start', { 
    runId: run.id, 
    orgId, 
    apiKeyId, 
    role,
    nextQueue: sekedQueue
  });

  return reply.code(202).send({ run_id: run.id, status: 'queued' });
});

const port = Number(process.env.PORT || 3000);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Gateway listening on ${port}`);
  })
  .catch((err: Error) => {
    app.log.error(err);
    process.exit(1);
  });
