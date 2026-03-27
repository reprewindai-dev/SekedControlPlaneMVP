import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AuthedRequest } from '../middleware/auth';

const router = Router();

const createPolicySchema = z.object({
  name: z.string().min(1),
  config: z.record(z.any()),
});

router.post('/', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.role === 'readonly') return res.status(403).json({ error: 'Forbidden' });

  const parsed = createPolicySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  try {
    const policy = await prisma.policy.create({
      data: {
        orgId,
        name: parsed.data.name,
        sekedConfig: parsed.data.config,
        convergeConfig: {},
        ecobeConfig: {},
        status: 'draft',
      },
    });
    return res.status(201).json(policy);
  } catch (err) {
    console.error(err);
    return res.status(409).json({ error: 'Policy already exists or creation failed' });
  }
});

router.get('/:policy_id', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

  const { policy_id } = req.params;
  try {
    const policy = await prisma.policy.findFirst({ where: { id: policy_id, orgId } });
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    return res.json(policy);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch policy' });
  }
});

export default router;
