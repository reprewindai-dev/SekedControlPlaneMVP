import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';

const prisma = new PrismaClient();

const policySchema = z.object({
  name: z.string().min(1),
  sekedConfig: z.record(z.any()),
});

export async function policiesRoutes(app: any) {
  app.post('/policies', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = await requireAuth(request, reply);
    if (!authCtx) return;
    const { orgId, role } = authCtx;

    if (role === 'readonly') return reply.code(403).send({ error: 'Forbidden' });

    const parsed = policySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.errors });
    }

    const policy = await prisma.policy.create({
      data: {
        orgId,
        name: parsed.data.name,
        sekedConfig: parsed.data.sekedConfig,
        convergeConfig: {},
        ecobeConfig: {},
        status: 'draft',
      },
    });

    return reply.send(policy);
  });

  app.get('/policies/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = await requireAuth(request, reply);
    if (!authCtx) return;
    const { orgId } = authCtx;

    const { id } = request.params as { id: string };
    const policy = await prisma.policy.findFirst({ where: { id, orgId } });
    if (!policy) return reply.code(404).send({ error: 'Not found' });

    return reply.send(policy);
  });
}
