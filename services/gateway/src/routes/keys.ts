import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';

const prisma = new PrismaClient();

const keyCreateSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['admin', 'developer', 'readonly']),
});

export async function keysRoutes(app: any) {
  app.post('/keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = await requireAuth(request, reply);
    if (!authCtx) return;
    const { orgId, role } = authCtx;

    if (role !== 'admin') return reply.code(403).send({ error: 'Forbidden' });

    const parsed = keyCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.errors });
    }

    const rawKey = `sk_${Math.random().toString(36).slice(2, 15)}`;
    const hashedKey = await bcrypt.hash(rawKey, 10);

    const apiKey = await prisma.apiKey.create({
      data: {
        orgId,
        name: parsed.data.name,
        role: parsed.data.role,
        hashedKey,
      },
    });

    return reply.send({ id: apiKey.id, name: apiKey.name, role: apiKey.role, apiKey: rawKey });
  });

  app.get('/keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = await requireAuth(request, reply);
    if (!authCtx) return;
    const { orgId, role } = authCtx;

    if (role !== 'admin') return reply.code(403).send({ error: 'Forbidden' });

    const keys = await prisma.apiKey.findMany({ where: { orgId }, select: { id: true, name: true, role: true, createdAt: true } });
    return reply.send(keys);
  });
}
