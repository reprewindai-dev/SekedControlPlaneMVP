import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
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

    const apiKeys = await prisma.apiKey.findMany({
      where: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    let matched = null as typeof apiKeys[number] | null;
    for (const k of apiKeys) {
      const valid = await bcrypt.compare(token, k.hashedKey);
      if (valid) {
        matched = k;
        break;
      }
    }

    if (!matched) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Update last used
    await prisma.apiKey.update({ where: { id: matched.id }, data: { lastUsedAt: new Date() } });

    req.orgId = matched.orgId;
    req.apiKeyId = matched.id;
    req.role = matched.role;
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Auth failure' });
  }
}
