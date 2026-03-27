import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const runQueue = new Queue('run-pipeline', { connection: redis });
const prisma = new PrismaClient();

const runSchema = z.object({
  policy_profile_id: z.string().min(1),
  project_id: z.string().min(1),
  schema_id: z.string().min(1),
  task: z.object({ type: z.string(), risk_level: z.string() }),
  inputs: z.record(z.any()),
  constraints: z.object({ latency_ms_max: z.number().optional(), cost_usd_max: z.number().optional() }).optional(),
  execution: z.record(z.any()).optional(),
});

export async function runsRoutes(app: any) {
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

    await runQueue.add('start', { runId: run.id, orgId, apiKeyId, role });

    return reply.code(202).send({ run_id: run.id, status: 'queued' });
  });

  app.get('/runs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = await requireAuth(request, reply);
    if (!authCtx) return;
    const { orgId } = authCtx;

    const { id } = request.params as { id: string };
    const run = await prisma.run.findFirst({ where: { id, orgId }, include: { events: true } });
    if (!run) return reply.code(404).send({ error: 'Not found' });

    return reply.send(run);
  });

  app.get('/runs/:id/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = await requireAuth(request, reply);
    if (!authCtx) return;
    const { orgId } = authCtx;

    const { id } = request.params as { id: string };
    const events = await prisma.runEvent.findMany({ where: { runId: id, run: { orgId } } });
    return reply.send(events);
  });
}
