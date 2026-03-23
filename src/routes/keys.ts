import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AuthedRequest } from '../middleware/auth';

const router = Router();

const createKeySchema = z.object({
  name: z.string().min(1),
  role: z.enum(['admin', 'developer', 'readonly']).default('developer'),
});

router.post('/', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  const parsed = createKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const plainKey = `sek_${crypto.randomBytes(24).toString('hex')}`;
  const hashedKey = await bcrypt.hash(plainKey, 10);

  try {
    const created = await prisma.apiKey.create({
      data: {
        orgId,
        name: parsed.data.name,
        role: parsed.data.role,
        hashedKey,
      },
      select: { id: true, name: true, role: true, createdAt: true },
    });

    return res.status(201).json({
      api_key: plainKey,
      key_id: created.id,
      name: created.name,
      role: created.role,
      created_at: created.createdAt,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.get('/', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const keys = await prisma.apiKey.findMany({
      where: { orgId },
      select: { id: true, name: true, role: true, createdAt: true, revokedAt: true, expiresAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ keys });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to list API keys' });
  }
});

export default router;
