import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';

const prisma = new PrismaClient();

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function usageRoutes(app: any) {
  app.get('/usage', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = await requireAuth(request, reply);
    if (!authCtx) return;
    const { orgId } = authCtx;

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.errors });
    }

    const { from, to } = parsed.data;
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();

    try {
      const usage = await prisma.usageRecord.groupBy({
        by: ['metric'],
        where: {
          orgId,
          timestamp: { gte: fromDate, lte: toDate },
        },
        _sum: { quantity: true, totalCost: true },
      });
      return reply.send({ usage, from: fromDate, to: toDate });
    } catch (err) {
      console.error(err);
      return reply.code(500).send({ error: 'Failed to fetch usage' });
    }
  });
}
