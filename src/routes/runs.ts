import type { Prisma, ProviderRegionBaseline } from '@prisma/client';
import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AuthedRequest } from '../middleware/auth';
import { executeThreePlanePipeline } from '../services/pipeline';
import { recordRoutingObservation } from '../services/ecobe';

const router = Router();

const createRunSchema = z.object({
  policy_profile_id: z.string().min(1),
  project_id: z.string().min(1),
  schema_id: z.string().min(1),
  task: z.object({
    type: z.string(),
    risk_level: z.string(),
  }),
  inputs: z.record(z.any()),
  constraints: z
    .object({
      latency_ms_max: z.number().optional(),
      cost_usd_max: z.number().optional(),
    })
    .optional(),
  execution: z
    .object({
      provider_preference: z.array(z.string()).optional(),
    })
    .optional(),
});

const providerObservationSchema = z.object({
  provider: z.string().min(1),
  region: z.string().min(1),
  observedLatencyMs: z.number().positive(),
  observedCostUsd: z.number().min(0),
  observedCarbonIntensityGco2Kwh: z.number().positive().optional(),
  observedAt: z.string().datetime().optional(),
  metadata: z.record(z.any()).optional(),
});

type AnalyticsRun = Prisma.RunGetPayload<{
  include: {
    project: true;
    policyProfile: true;
    sekedScore: true;
    convergenceRun: true;
    routingDecision: true;
    usageRecords: true;
  };
}>;

type ProviderAnalyticsDecision = Prisma.RoutingDecisionGetPayload<{
  include: {
    run: {
      select: {
        status: true;
        startedAt: true;
        completedAt: true;
        convergenceRun: {
          select: {
            finalQualityScore: true;
          };
        };
      };
    };
  };
}>;

type ProviderBaselineSnapshot = {
  sampleCount: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  avgCarbonIntensityGco2Kwh: number;
  lastObservedAt: Date;
};

type ProviderRegionRow = {
  provider: string;
  region: string;
  baseline: ProviderBaselineSnapshot | null;
  recent: {
    days: number;
    runs: number;
    completed: number;
    failed: number;
    successRate: number;
    avgQualityScore: number;
    avgObservedLatencyMs: number;
    avgObservedCostUsd: number;
    lastDecisionAt: Date | null;
  };
};

type ProviderRollupAccumulator = Record<
  string,
  {
    provider: string;
    regions: number;
    totalSampleCount: number;
    recentRuns: number;
    recentCompleted: number;
    recentFailed: number;
    baselineLatencies: number[];
    baselineCosts: number[];
    baselineCarbons: number[];
    recentQualities: number[];
  }
>;

router.post('/', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.role === 'readonly') return res.status(403).json({ error: 'Forbidden' });

  const parsed = createRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const body = parsed.data;
  try {
    const [policy, schema, project] = await Promise.all([
      prisma.policy.findFirst({ where: { id: body.policy_profile_id, orgId } }),
      prisma.schema.findFirst({ where: { id: body.schema_id, OR: [{ orgId }, { orgId: null }] } }),
      prisma.project.findFirst({ where: { id: body.project_id, orgId } }),
    ]);

    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    if (!schema) return res.status(404).json({ error: 'Schema not found' });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const run = await prisma.run.create({
      data: {
        orgId,
        projectId: body.project_id,
        policyProfileId: body.policy_profile_id,
        schemaId: body.schema_id,
        correlationId: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        policyVersion: policy.version,
        schemaVersion: schema.version,
        status: 'queued',
        taskType: body.task.type,
        riskLevel: body.task.risk_level,
        inputsJson: body.inputs as any,
        constraintsJson: (body.constraints ?? null) as any,
        executionJson: (body.execution ?? null) as any,
        finalOutputJson: null as any,
        analyticsJson: {
          lifecycle: { queuedAt: new Date().toISOString() },
          request: {
            taskType: body.task.type,
            riskLevel: body.task.risk_level,
          },
        } as any,
        events: {
          create: {
            type: 'RUN_CREATED',
            data: { task: body.task, inputs: body.inputs, constraints: body.constraints, execution: body.execution },
          },
        },
      },
    });

    // record usage per request
    await prisma.usageRecord.create({
      data: {
        orgId,
        runId: run.id,
        quantity: 1,
        metric: 'requests',
        unit: 'request',
        unitCost: 0,
        totalCost: 0,
      },
    });

    // Kick off three-plane pipeline asynchronously
    setImmediate(async () => {
      try {
        await executeThreePlanePipeline(run.id, {
          orgId,
          project_id: body.project_id,
          policy_profile_id: body.policy_profile_id,
          schema_id: body.schema_id,
          task: body.task,
          inputs: body.inputs,
          constraints: body.constraints,
          execution: body.execution,
        });
      } catch (err) {
        console.error('Pipeline error for run', run.id, err);
      }
    });

    return res.status(202).json({ run_id: run.id, status: run.status });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create run' });
  }
});

router.get('/analytics/summary', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);

  try {
    const runs: AnalyticsRun[] = await prisma.run.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        project: true,
        policyProfile: true,
        sekedScore: true,
        convergenceRun: true,
        routingDecision: true,
        usageRecords: true,
      },
    });

    const completedRuns = runs.filter((run: AnalyticsRun) => run.status === 'completed');
    const qualityScores = completedRuns
      .map((run: AnalyticsRun) => run.convergenceRun?.finalQualityScore)
      .filter((value: number | null | undefined): value is number => typeof value === 'number');
    const detrimentalScores = runs
      .map((run: AnalyticsRun) => run.sekedScore?.detrimentalScore)
      .filter((value: number | null | undefined): value is number => typeof value === 'number');
    const attempts = runs
      .map((run: AnalyticsRun) => resolveAttemptsUsed(run))
      .filter((value: number | null): value is number => typeof value === 'number');
    const routingLatencies = runs
      .map((run: AnalyticsRun) => run.routingDecision?.estimatedLatencyMs)
      .filter((value: number | null | undefined): value is number => typeof value === 'number');
    const routingCosts = runs
      .map((run: AnalyticsRun) => run.routingDecision?.estimatedCostUsd)
      .filter((value: number | null | undefined): value is number => typeof value === 'number');
    const completionLatencies = completedRuns
      .map((run: AnalyticsRun) =>
        run.completedAt && run.createdAt ? run.completedAt.getTime() - run.createdAt.getTime() : null,
      )
      .filter((value: number | null): value is number => typeof value === 'number');
    const totalUsageCost = runs.reduce((sum: number, run: AnalyticsRun) => {
      return (
        sum +
        run.usageRecords.reduce((inner: number, usage) => inner + Number(usage.totalCost ?? 0), 0)
      );
    }, 0);

    return res.json({
      totals: {
        runs: runs.length,
        completed: completedRuns.length,
        failed: runs.filter((run: AnalyticsRun) => run.status === 'failed').length,
      },
      averages: {
        qualityScore: average(qualityScores),
        detrimentalScore: average(detrimentalScores),
        attemptsUsed: average(attempts),
        routingLatencyMs: average(routingLatencies),
        routingCostUsd: averageCurrency(routingCosts),
        completionLatencyMs: average(completionLatencies),
        usageCostUsd: roundCurrency(totalUsageCost / Math.max(runs.length, 1)),
      },
      recentRuns: runs.slice(0, 20).map((run: AnalyticsRun) => ({
        id: run.id,
        status: run.status,
        taskType: run.taskType,
        riskLevel: run.riskLevel,
        project: run.project.name,
        policy: run.policyProfile.name,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        qualityScore: run.convergenceRun?.finalQualityScore ?? null,
        detrimentalScore: run.sekedScore?.detrimentalScore ?? null,
        attemptsUsed: resolveAttemptsUsed(run),
        routingLatencyMs: run.routingDecision?.estimatedLatencyMs ?? null,
        routingCostUsd: run.routingDecision?.estimatedCostUsd ?? null,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch analytics summary' });
  }
});

router.post('/analytics/providers/bootstrap', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  const parsed = providerObservationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const payload = parsed.data;

  try {
    const fallbackCarbon =
      payload.observedCarbonIntensityGco2Kwh ??
      (
        await prisma.gridIntensitySample.findFirst({
          where: {
            OR: [{ orgId }, { orgId: null }],
            region: payload.region,
            validUntil: { gt: new Date() },
          },
          orderBy: { ts: 'desc' },
        })
      )?.carbonIntensityGco2Kwh ??
      (
        await prisma.providerRegionBaseline.findFirst({
          where: { orgId, region: payload.region },
          orderBy: { lastObservedAt: 'desc' },
        })
      )?.avgCarbonIntensityGco2Kwh;

    if (typeof fallbackCarbon !== 'number' || Number.isNaN(fallbackCarbon)) {
      return res.status(400).json({
        error: 'Missing carbon intensity baseline for region',
        message: `Provide observedCarbonIntensityGco2Kwh or seed grid intensity data for region ${payload.region}`,
      });
    }

    await recordRoutingObservation({
      orgId,
      provider: payload.provider,
      region: payload.region,
      observedLatencyMs: payload.observedLatencyMs,
      observedCostUsd: payload.observedCostUsd,
      observedCarbonIntensityGco2Kwh: fallbackCarbon,
      observedAt: payload.observedAt ? new Date(payload.observedAt) : new Date(),
    });

    const baseline = await prisma.providerRegionBaseline.findUnique({
      where: {
        orgId_provider_region: {
          orgId,
          provider: payload.provider,
          region: payload.region,
        },
      },
    });

    return res.status(201).json({
      provider: payload.provider,
      region: payload.region,
      baseline: baseline
        ? {
            sampleCount: baseline.sampleCount,
            avgLatencyMs: roundMetric(baseline.avgLatencyMs),
            avgCostUsd: roundCurrency(baseline.avgCostUsd),
            avgCarbonIntensityGco2Kwh: roundMetric(baseline.avgCarbonIntensityGco2Kwh),
            lastObservedAt: baseline.lastObservedAt,
          }
        : null,
      metadata: payload.metadata ?? null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to bootstrap provider baseline' });
  }
});

router.get('/analytics/providers', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

  const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const [baselines, decisions] = await Promise.all([
      prisma.providerRegionBaseline.findMany({
        where: { orgId },
        orderBy: [{ provider: 'asc' }, { region: 'asc' }],
      }),
      prisma.routingDecision.findMany({
        where: {
          createdAt: { gte: since },
          run: { orgId },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          run: {
            select: {
              status: true,
              startedAt: true,
              completedAt: true,
              convergenceRun: {
                select: {
                  finalQualityScore: true,
                },
              },
            },
          },
        },
      }),
    ]);

    type ProviderStats = {
      provider: string;
      region: string;
      recentRuns: number;
      recentCompleted: number;
      recentFailed: number;
      recentQualityScores: number[];
      recentObservedLatencies: number[];
      recentObservedCosts: number[];
      lastDecisionAt: Date | null;
    };

    const statsByKey = new Map<string, ProviderStats>();

    for (const decision of decisions as ProviderAnalyticsDecision[]) {
      const key = `${decision.provider}::${decision.region}`;
      const stats =
        statsByKey.get(key) ??
        {
          provider: decision.provider,
          region: decision.region,
          recentRuns: 0,
          recentCompleted: 0,
          recentFailed: 0,
          recentQualityScores: [],
          recentObservedLatencies: [],
          recentObservedCosts: [],
          lastDecisionAt: null,
        };

      stats.recentRuns += 1;
      if (decision.run.status === 'completed') stats.recentCompleted += 1;
      if (decision.run.status === 'failed') stats.recentFailed += 1;

      if (typeof decision.run.convergenceRun?.finalQualityScore === 'number') {
        stats.recentQualityScores.push(decision.run.convergenceRun.finalQualityScore);
      }

      const observedLatency =
        decision.run.startedAt && decision.run.completedAt
          ? Math.max(1, decision.run.completedAt.getTime() - decision.run.startedAt.getTime())
          : decision.estimatedLatencyMs;

      if (typeof observedLatency === 'number') {
        stats.recentObservedLatencies.push(observedLatency);
      }
      if (typeof decision.estimatedCostUsd === 'number') {
        stats.recentObservedCosts.push(decision.estimatedCostUsd);
      }

      if (!stats.lastDecisionAt || decision.createdAt > stats.lastDecisionAt) {
        stats.lastDecisionAt = decision.createdAt;
      }

      statsByKey.set(key, stats);
    }

    const baselinesByKey = new Map<string, ProviderRegionBaseline>(
      (baselines as ProviderRegionBaseline[]).map(
        (baseline: ProviderRegionBaseline): [string, ProviderRegionBaseline] => [
          `${baseline.provider}::${baseline.region}`,
          baseline,
        ],
      ),
    );

    const providerRegionKeys = Array.from(
      new Set<string>([...Array.from(baselinesByKey.keys()), ...Array.from(statsByKey.keys())]),
    );

    const providerRegionRows: ProviderRegionRow[] = providerRegionKeys
      .sort()
      .map((key: string) => {
        const [provider, region] = key.split('::');
        const baseline = baselinesByKey.get(key) ?? null;
        const stats = statsByKey.get(key) ?? null;

        return {
          provider,
          region,
          baseline: baseline
            ? {
                sampleCount: baseline.sampleCount,
                avgLatencyMs: roundMetric(baseline.avgLatencyMs),
                avgCostUsd: roundCurrency(baseline.avgCostUsd),
                avgCarbonIntensityGco2Kwh: roundMetric(baseline.avgCarbonIntensityGco2Kwh),
                lastObservedAt: baseline.lastObservedAt,
              }
            : null,
          recent: {
            days,
            runs: stats?.recentRuns ?? 0,
            completed: stats?.recentCompleted ?? 0,
            failed: stats?.recentFailed ?? 0,
            successRate: stats ? roundMetric((stats.recentCompleted / Math.max(stats.recentRuns, 1)) * 100) : 0,
            avgQualityScore: stats ? average(stats.recentQualityScores) : 0,
            avgObservedLatencyMs: stats ? roundMetric(average(stats.recentObservedLatencies)) : 0,
            avgObservedCostUsd: stats ? roundCurrency(average(stats.recentObservedCosts)) : 0,
            lastDecisionAt: stats?.lastDecisionAt ?? null,
          },
        };
      });

    const providerRollups = Object.values(
      providerRegionRows.reduce<ProviderRollupAccumulator>((acc, row: ProviderRegionRow) => {
        const existing =
          acc[row.provider] ??
          {
            provider: row.provider,
            regions: 0,
            totalSampleCount: 0,
            recentRuns: 0,
            recentCompleted: 0,
            recentFailed: 0,
            baselineLatencies: [],
            baselineCosts: [],
            baselineCarbons: [],
            recentQualities: [],
          };

        existing.regions += 1;
        existing.totalSampleCount += row.baseline?.sampleCount ?? 0;
        existing.recentRuns += row.recent.runs;
        existing.recentCompleted += row.recent.completed;
        existing.recentFailed += row.recent.failed;

        if (row.baseline) {
          existing.baselineLatencies.push(row.baseline.avgLatencyMs);
          existing.baselineCosts.push(row.baseline.avgCostUsd);
          existing.baselineCarbons.push(row.baseline.avgCarbonIntensityGco2Kwh);
        }
        if (row.recent.avgQualityScore > 0) {
          existing.recentQualities.push(row.recent.avgQualityScore);
        }

        acc[row.provider] = existing;
        return acc;
      }, {}),
    ).map((rollup: ProviderRollupAccumulator[string]) => ({
      provider: rollup.provider,
      regions: rollup.regions,
      totalSampleCount: rollup.totalSampleCount,
      recentRuns: rollup.recentRuns,
      recentCompleted: rollup.recentCompleted,
      recentFailed: rollup.recentFailed,
      successRate: roundMetric((rollup.recentCompleted / Math.max(rollup.recentRuns, 1)) * 100),
      avgBaselineLatencyMs: roundMetric(average(rollup.baselineLatencies)),
      avgBaselineCostUsd: roundCurrency(average(rollup.baselineCosts)),
      avgBaselineCarbonIntensityGco2Kwh: roundMetric(average(rollup.baselineCarbons)),
      avgRecentQualityScore: average(rollup.recentQualities),
    }));

    return res.json({
      window: { days, since },
      totals: {
        providerRegions: providerRegionRows.length,
        providers: providerRollups.length,
      },
      providers: providerRollups,
      providerRegions: providerRegionRows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch provider analytics' });
  }
});

// Usage endpoint
router.get('/usage', async (req: AuthedRequest, res: Response) => {
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

router.get('/:run_id', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

  const { run_id } = req.params;
  try {
    const run = await prisma.run.findFirst({
      where: { id: run_id, orgId },
      include: {
        events: { orderBy: { ts: 'asc' } },
        policyProfile: true,
        project: true,
        sekedScore: true,
        convergenceRun: true,
        routingDecision: true,
        usageRecords: true,
      },
    });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json(run);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch run' });
  }
});

router.get('/:run_id/events', async (req: AuthedRequest, res: Response) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
  const { run_id } = req.params;
  const limit = Number(req.query.limit ?? 100);
  try {
    const events = await prisma.runEvent.findMany({
      where: { runId: run_id, run: { orgId } },
      orderBy: { ts: 'desc' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
    return res.json(events);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
});

export default router;

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function roundCurrency(value: number) {
  return Math.round(value * 10000) / 10000;
}

function averageCurrency(values: number[]) {
  if (values.length === 0) return 0;
  return roundCurrency(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function resolveAttemptsUsed(run: Pick<AnalyticsRun, 'convergenceRun' | 'analyticsJson'>) {
  const direct = run.convergenceRun?.attemptsUsed;
  if (typeof direct === 'number' && direct > 0) return direct;

  const analytics = run.analyticsJson as { convergence?: { attemptsUsed?: number } } | null;
  const fallback = analytics?.convergence?.attemptsUsed;
  if (typeof fallback === 'number' && fallback > 0) return fallback;

  return null;
}
