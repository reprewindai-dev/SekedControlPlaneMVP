import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthedRequest } from '../middleware/auth';

const router = Router();

router.get('/', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

  const { from, to } = req.query;
  const fromDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to as string) : new Date();

  try {
    const usage = await prisma.usageRecord.groupBy({
      by: ['metric'],
      where: {
        orgId,
        timestamp: { gte: fromDate, lte: toDate },
      },
      _sum: { quantity: true, totalCost: true },
    });
    return res.json({ usage, from: fromDate, to: toDate });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

export default router;
