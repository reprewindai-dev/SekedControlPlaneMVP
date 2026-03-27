import { prisma } from '../lib/prisma';

export interface EcobeInput {
  runId: string;
  convergeResult: any;
  policyConfig: any;
  execution?: {
    provider_preference?: string[];
  };
  constraints?: {
    latency_ms_max?: number;
    cost_usd_max?: number;
  };
}

export interface EcobeResult {
  provider: string;
  region: string;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
  carbonIntensityGco2Kwh: number;
  decisionTraceJson: any;
}

export interface RoutingObservation {
  orgId: string;
  provider: string;
  region: string;
  observedLatencyMs: number;
  observedCostUsd: number;
  observedCarbonIntensityGco2Kwh: number;
  observedAt?: Date;
}

type CandidateBaseline = {
  id: string;
  provider: string;
  region: string;
  sampleCount: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  avgCarbonIntensityGco2Kwh: number;
  lastObservedAt: Date;
};

type GridIntensitySampleRecord = {
  region: string;
  carbonIntensityGco2Kwh: number;
};

type CandidateEvaluation = CandidateBaseline & {
  carbonIntensityGco2Kwh: number;
  composite: number;
  normalizedLatency: number;
  normalizedCost: number;
  normalizedCarbon: number;
  usedLiveGridSample: boolean;
};

type RoutingDecisionWithRun = {
  provider: string;
  region: string;
  estimatedLatencyMs: number;
  estimatedCostUsd: number;
  carbonIntensityGco2Kwh: number;
  createdAt: Date;
  run: {
    orgId: string;
    startedAt: Date | null;
    completedAt: Date | null;
  };
};

export async function routeEcobe(input: EcobeInput): Promise<EcobeResult> {
  const orgId = String(input.policyConfig.orgId);
  const routingPolicy = await prisma.routingPolicy.findFirst({
    where: { orgId },
  });
  const weights = normalizeWeights((routingPolicy?.weightsJson as any) ?? { carbon: 0.4, cost: 0.3, latency: 0.3 });
  const preferredProviders = resolveProviderPreferences(input.policyConfig, input.execution);

  let baselines = (await prisma.providerRegionBaseline.findMany({
    where: {
      orgId,
      provider: preferredProviders.length > 0 ? { in: preferredProviders } : undefined,
    },
    orderBy: [{ sampleCount: 'desc' }, { lastObservedAt: 'desc' }],
  })) as CandidateBaseline[];

  if (baselines.length === 0) {
    await rebuildProviderRegionBaselines(orgId, preferredProviders);
    baselines = (await prisma.providerRegionBaseline.findMany({
      where: {
        orgId,
        provider: preferredProviders.length > 0 ? { in: preferredProviders } : undefined,
      },
      orderBy: [{ sampleCount: 'desc' }, { lastObservedAt: 'desc' }],
    })) as CandidateBaseline[];
  }

  if (baselines.length === 0) {
    throw new Error('No persisted provider-region performance baselines available for routing');
  }

  const gridSamples = (await prisma.gridIntensitySample.findMany({
    where: {
      validUntil: { gt: new Date() },
      region: { in: Array.from(new Set<string>(baselines.map((entry: CandidateBaseline) => entry.region))) },
    },
    orderBy: { ts: 'desc' },
  })) as GridIntensitySampleRecord[];

  const candidates: CandidateEvaluation[] = baselines.map((baseline: CandidateBaseline) => {
    const liveGridSample = gridSamples.find((sample: GridIntensitySampleRecord) => sample.region === baseline.region);
    const carbonIntensity = liveGridSample?.carbonIntensityGco2Kwh ?? baseline.avgCarbonIntensityGco2Kwh;

    const normalizedLatency = normalizeMetric(
      baseline.avgLatencyMs,
      baselines.map((entry: CandidateBaseline) => entry.avgLatencyMs),
    );
    const normalizedCost = normalizeMetric(
      baseline.avgCostUsd,
      baselines.map((entry: CandidateBaseline) => entry.avgCostUsd),
    );
    const normalizedCarbon = normalizeMetric(
      carbonIntensity,
      baselines.map((entry: CandidateBaseline) => entry.avgCarbonIntensityGco2Kwh),
    );

    const composite =
      weights.carbon * normalizedCarbon +
      weights.cost * normalizedCost +
      weights.latency * normalizedLatency;

    return {
      ...baseline,
      carbonIntensityGco2Kwh: carbonIntensity,
      composite,
      normalizedLatency,
      normalizedCost,
      normalizedCarbon,
      usedLiveGridSample: Boolean(liveGridSample),
    };
  });

  const filtered = candidates.filter((candidate: CandidateEvaluation) => {
    if (input.constraints?.latency_ms_max && candidate.avgLatencyMs > input.constraints.latency_ms_max) return false;
    if (input.constraints?.cost_usd_max && candidate.avgCostUsd > input.constraints.cost_usd_max) return false;
    return true;
  });

  const choicePool = filtered.length > 0 ? filtered : candidates;
  const chosen = choicePool.reduce((best: CandidateEvaluation, current: CandidateEvaluation) =>
    current.composite < best.composite ? current : best,
  );

  const decisionTrace = {
    weights,
    preferredProviders,
    constraints: input.constraints ?? null,
    candidates: candidates.map((candidate: CandidateEvaluation) => ({
      provider: candidate.provider,
      region: candidate.region,
      sampleCount: candidate.sampleCount,
      avgLatencyMs: candidate.avgLatencyMs,
      avgCostUsd: candidate.avgCostUsd,
      avgCarbonIntensityGco2Kwh: candidate.avgCarbonIntensityGco2Kwh,
      liveCarbonIntensityGco2Kwh: candidate.carbonIntensityGco2Kwh,
      normalizedLatency: candidate.normalizedLatency,
      normalizedCost: candidate.normalizedCost,
      normalizedCarbon: candidate.normalizedCarbon,
      composite: candidate.composite,
      usedLiveGridSample: candidate.usedLiveGridSample,
      lastObservedAt: candidate.lastObservedAt,
    })),
    chosen: {
      provider: chosen.provider,
      region: chosen.region,
      sampleCount: chosen.sampleCount,
      avgLatencyMs: chosen.avgLatencyMs,
      avgCostUsd: chosen.avgCostUsd,
      avgCarbonIntensityGco2Kwh: chosen.avgCarbonIntensityGco2Kwh,
      liveCarbonIntensityGco2Kwh: chosen.carbonIntensityGco2Kwh,
      composite: chosen.composite,
      baselineId: chosen.id,
    },
    routingBasis: 'persisted_provider_region_baseline',
  };

  await prisma.routingDecision.create({
    data: {
      runId: input.runId,
      provider: chosen.provider,
      region: chosen.region,
      inputsJson: {
        weights,
        constraints: input.constraints ?? null,
        preferredProviders,
        baselineId: chosen.id,
      } as any,
      estimatedCostUsd: chosen.avgCostUsd,
      estimatedLatencyMs: chosen.avgLatencyMs,
      carbonIntensityGco2Kwh: chosen.carbonIntensityGco2Kwh,
      decisionTraceJson: decisionTrace as any,
    },
  });

  return {
    provider: chosen.provider,
    region: chosen.region,
    estimatedCostUsd: chosen.avgCostUsd,
    estimatedLatencyMs: chosen.avgLatencyMs,
    carbonIntensityGco2Kwh: chosen.carbonIntensityGco2Kwh,
    decisionTraceJson: decisionTrace,
  };
}

async function rebuildProviderRegionBaselines(orgId: string, providers: string[]) {
  const decisions = (await prisma.routingDecision.findMany({
    where: {
      provider: providers.length > 0 ? { in: providers } : undefined,
      run: {
        orgId,
      },
    },
    include: {
      run: {
        select: { orgId: true, startedAt: true, completedAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })) as RoutingDecisionWithRun[];

  const grouped = new Map<string, CandidateBaseline>();

  for (const decision of decisions) {
    if (decision.run.orgId !== orgId) continue;
    const key = `${decision.provider}::${decision.region}`;
    const existing = grouped.get(key);

    if (!existing) {
      const observedLatency = resolveObservedLatency(decision.run.startedAt, decision.run.completedAt, decision.estimatedLatencyMs);
      grouped.set(key, {
        id: '',
        provider: decision.provider,
        region: decision.region,
        sampleCount: 1,
        avgLatencyMs: observedLatency,
        avgCostUsd: decision.estimatedCostUsd,
        avgCarbonIntensityGco2Kwh: decision.carbonIntensityGco2Kwh,
        lastObservedAt: decision.createdAt,
      });
      continue;
    }

    const observedLatency = resolveObservedLatency(decision.run.startedAt, decision.run.completedAt, decision.estimatedLatencyMs);
    const sampleCount = existing.sampleCount + 1;
    existing.avgLatencyMs = rollingAverage(existing.avgLatencyMs, existing.sampleCount, observedLatency);
    existing.avgCostUsd = rollingAverage(existing.avgCostUsd, existing.sampleCount, decision.estimatedCostUsd);
    existing.avgCarbonIntensityGco2Kwh = rollingAverage(
      existing.avgCarbonIntensityGco2Kwh,
      existing.sampleCount,
      decision.carbonIntensityGco2Kwh,
    );
    existing.sampleCount = sampleCount;
    existing.lastObservedAt = decision.createdAt > existing.lastObservedAt ? decision.createdAt : existing.lastObservedAt;
  }

  await Promise.all(
    Array.from(grouped.values()).map((baseline) =>
      prisma.providerRegionBaseline.upsert({
        where: {
          orgId_provider_region: {
            orgId,
            provider: baseline.provider,
            region: baseline.region,
          },
        },
        create: {
          orgId,
          provider: baseline.provider,
          region: baseline.region,
          sampleCount: baseline.sampleCount,
          avgLatencyMs: baseline.avgLatencyMs,
          avgCostUsd: baseline.avgCostUsd,
          avgCarbonIntensityGco2Kwh: baseline.avgCarbonIntensityGco2Kwh,
          lastObservedAt: baseline.lastObservedAt,
        },
        update: {
          sampleCount: baseline.sampleCount,
          avgLatencyMs: baseline.avgLatencyMs,
          avgCostUsd: baseline.avgCostUsd,
          avgCarbonIntensityGco2Kwh: baseline.avgCarbonIntensityGco2Kwh,
          lastObservedAt: baseline.lastObservedAt,
        },
      }),
    ),
  );
}

export async function recordRoutingObservation(observation: RoutingObservation) {
  const existing = await prisma.providerRegionBaseline.findUnique({
    where: {
      orgId_provider_region: {
        orgId: observation.orgId,
        provider: observation.provider,
        region: observation.region,
      },
    },
  });

  if (!existing) {
    await prisma.providerRegionBaseline.create({
      data: {
        orgId: observation.orgId,
        provider: observation.provider,
        region: observation.region,
        sampleCount: 1,
        avgLatencyMs: observation.observedLatencyMs,
        avgCostUsd: observation.observedCostUsd,
        avgCarbonIntensityGco2Kwh: observation.observedCarbonIntensityGco2Kwh,
        lastObservedAt: observation.observedAt ?? new Date(),
      },
    });
    return;
  }

  await prisma.providerRegionBaseline.update({
    where: { id: existing.id },
    data: {
      sampleCount: existing.sampleCount + 1,
      avgLatencyMs: rollingAverage(existing.avgLatencyMs, existing.sampleCount, observation.observedLatencyMs),
      avgCostUsd: rollingAverage(existing.avgCostUsd, existing.sampleCount, observation.observedCostUsd),
      avgCarbonIntensityGco2Kwh: rollingAverage(
        existing.avgCarbonIntensityGco2Kwh,
        existing.sampleCount,
        observation.observedCarbonIntensityGco2Kwh,
      ),
      lastObservedAt: observation.observedAt ?? new Date(),
    },
  });
}

function resolveProviderPreferences(policyConfig: any, execution: EcobeInput['execution']) {
  const fromExecution = execution?.provider_preference?.filter(Boolean) ?? [];
  const fromPolicy = Array.isArray(policyConfig.ecobeConfig?.providers)
    ? policyConfig.ecobeConfig.providers.filter(Boolean)
    : [];

  return Array.from(new Set([...fromExecution, ...fromPolicy]));
}

function normalizeWeights(weights: { carbon?: number; cost?: number; latency?: number }) {
  const carbon = Number(weights.carbon ?? 0.4);
  const cost = Number(weights.cost ?? 0.3);
  const latency = Number(weights.latency ?? 0.3);
  const total = carbon + cost + latency;

  if (total <= 0) {
    return { carbon: 0.4, cost: 0.3, latency: 0.3 };
  }

  return {
    carbon: carbon / total,
    cost: cost / total,
    latency: latency / total,
  };
}

function normalizeMetric(value: number, allValues: number[]) {
  if (allValues.length === 0) return 1;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  if (min === max) return 0.5;
  return (value - min) / (max - min);
}

function rollingAverage(currentAverage: number, sampleCount: number, observedValue: number) {
  if (sampleCount <= 0) return observedValue;
  return (currentAverage * sampleCount + observedValue) / (sampleCount + 1);
}

function resolveObservedLatency(startedAt: Date | null, completedAt: Date | null, fallbackLatency: number) {
  if (startedAt && completedAt) {
    return Math.max(1, completedAt.getTime() - startedAt.getTime());
  }

  return fallbackLatency;
}
