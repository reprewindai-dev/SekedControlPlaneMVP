import { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthedContext {
  orgId: string;
  apiKeyId: string;
  role: string;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<AuthedContext | void> {
  const header = request.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: {
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  let matched: any = null;
  for (const k of apiKeys) {
    if (await bcrypt.compare(token, k.hashedKey)) {
      matched = k;
      break;
    }
  }

  if (!matched) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  return { orgId: matched.orgId, apiKeyId: matched.id, role: matched.role };
}
