import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AuthedRequest } from '../middleware/auth';
import { digestApiKey } from '../middleware/auth';

const router = Router();

const createKeySchema = z.object({
  name: z.string().min(1),
  role: z.enum(['admin', 'developer', 'readonly']).default('developer'),
  expires_at: z.string().datetime().optional(),
});

router.post('/', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  const parsed = createKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const keyIdFragment = crypto.randomBytes(6).toString('hex');
  const keySecret = crypto.randomBytes(24).toString('hex');
  const plainKey = `sek_${keyIdFragment}_${keySecret}`;
  const keyPrefix = `sek_${keyIdFragment}`;
  const keyDigest = digestApiKey(plainKey);
  const hashedKey = await bcrypt.hash(plainKey, 10);

  try {
    const created = await prisma.apiKey.create({
      data: {
        orgId,
        name: parsed.data.name,
        role: parsed.data.role,
        keyPrefix,
        keyDigest,
        hashedKey,
        expiresAt: parsed.data.expires_at ? new Date(parsed.data.expires_at) : null,
      },
      select: { id: true, name: true, role: true, createdAt: true, expiresAt: true, keyPrefix: true },
    });

    return res.status(201).json({
      api_key: plainKey,
      key_id: created.id,
      key_prefix: created.keyPrefix,
      name: created.name,
      role: created.role,
      created_at: created.createdAt,
      expires_at: created.expiresAt,
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
      select: {
        id: true,
        name: true,
        role: true,
        keyPrefix: true,
        createdAt: true,
        revokedAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ keys });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to list API keys' });
  }
});

router.delete('/:key_id', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  const { key_id } = req.params;

  try {
    const updated = await prisma.apiKey.updateMany({
      where: {
        id: key_id,
        orgId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }

    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;
