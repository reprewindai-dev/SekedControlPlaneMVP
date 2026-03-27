import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';

export interface AuthedRequest extends Request {
  orgId?: string;
  apiKeyId?: string;
  role?: string;
}

// Bearer token auth backed by stored hashed API keys
export async function requireBearerAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const tokenDigest = digestApiKey(token);
    let matched = await prisma.apiKey.findUnique({
      where: {
        keyDigest: tokenDigest,
      },
    });

    if (!matched) {
      matched = await resolveLegacyApiKey(token);
    }

    if (!matched || matched.revokedAt || (matched.expiresAt && matched.expiresAt < new Date())) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const valid = await bcrypt.compare(token, matched.hashedKey);
    if (!valid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!matched.keyDigest || !matched.keyPrefix) {
      const keyPrefix = inferApiKeyPrefix(token);
      await prisma.apiKey.update({
        where: { id: matched.id },
        data: {
          keyDigest: tokenDigest,
          keyPrefix,
          lastUsedAt: new Date(),
        },
      });
    } else {
      await prisma.apiKey.update({ where: { id: matched.id }, data: { lastUsedAt: new Date() } });
    }

    req.orgId = matched.orgId;
    req.apiKeyId = matched.id;
    req.role = matched.role;
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Auth failure' });
  }
}

export function digestApiKey(token: string) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function inferApiKeyPrefix(token: string) {
  const parts = token.split('_');
  if (parts.length >= 3 && parts[0] === 'sek') {
    return `sek_${parts[1]}`;
  }

  return token.slice(0, Math.min(token.length, 12));
}

async function resolveLegacyApiKey(token: string) {
  const candidates = await prisma.apiKey.findMany({
    where: {
      keyDigest: { equals: null },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
  });

  for (const candidate of candidates) {
    const valid = await bcrypt.compare(token, candidate.hashedKey);
    if (valid) {
      return candidate;
    }
  }

  return null;
}
