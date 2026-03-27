import { Worker, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const prisma = new PrismaClient();

const ecobeWorker = new Worker(
  "pipeline-ecobe",
  async (job) => {
    const { runId, orgId, apiKeyId, role } = job.data;

    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (!run) throw new Error("Run not found");

    const convergenceRun = await prisma.convergenceRun.findUnique({ where: { runId } });
    if (!convergenceRun) throw new Error("Convergence run not found");

    // Enhanced ECOBE routing with Signal Coherence integration
    const routingDecision = await selectOptimalRegion(run.inputsJson, orgId);

    // Store routing decision
    await prisma.routingDecision.create({
      data: {
        runId,
        provider: routingDecision.provider,
        region: routingDecision.region,
        inputsJson: run.inputsJson,
        estimatedCostUsd: routingDecision.cost,
        estimatedLatencyMs: routingDecision.latency,
        carbonIntensityGco2Kwh: routingDecision.carbonIntensity,
        decisionTraceJson: routingDecision.trace,
      },
    });

    await prisma.runEvent.create({
      data: {
        runId,
        type: "ECOBE_ROUTED",
        data: routingDecision,
      },
    });

    // Execute workload (mock)
    const result = await executeWorkload(convergenceRun, routingDecision);

    // Update run with final result
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: "completed",
        completedAt: new Date(),
        finalOutputJson: result,
        durationMs: Date.now() - run.createdAt.getTime(),
      },
    });

    await prisma.runEvent.create({
      data: {
        runId,
        type: "RUN_COMPLETED",
        data: { result, routing: routingDecision },
      },
    });

    // Record usage
    await prisma.usageRecord.create({
      data: {
        orgId,
        runId,
        metric: "compute",
        quantity: 1,
        unit: "execution",
        unitCost: routingDecision.cost,
        totalCost: routingDecision.cost,
      },
    });

    // Record carbon savings
    const carbonSaved = calculateCarbonSaved(routingDecision);
    if (carbonSaved > 0) {
      await prisma.carbonCredit.create({
        data: {
          orgId,
          amount: carbonSaved,
          source: "ecobe_routing",
        },
      });
    }
  },
  { connection: redis }
);

async function selectOptimalRegion(inputs: any, orgId: string) {
  // Load organization routing policies
  const routingPolicies = await prisma.routingPolicy.findMany({
    where: { orgId },
  });

  // Fetch available regions (mock data - would integrate with cloud providers)
  const regions = [
    { provider: "aws", region: "us-west-1", carbonIntensity: 120, latency: 50, cost: 0.10, available: true },
    { provider: "aws", region: "us-east-1", carbonIntensity: 200, latency: 30, cost: 0.08, available: true },
    { provider: "aws", region: "eu-west-1", carbonIntensity: 80, latency: 100, cost: 0.12, available: true },
    { provider: "aws", region: "ap-south-1", carbonIntensity: 300, latency: 150, cost: 0.06, available: true },
    { provider: "gcp", region: "us-west1", carbonIntensity: 100, latency: 45, cost: 0.09, available: true },
    { provider: "gcp", region: "us-east1", carbonIntensity: 180, latency: 35, cost: 0.07, available: true },
    { provider: "azure", region: "west-us", carbonIntensity: 110, latency: 55, cost: 0.11, available: true },
    { provider: "azure", region: "east-us", carbonIntensity: 190, latency: 40, cost: 0.09, available: true },
  ];

  // Apply constraints from inputs
  const maxLatency = inputs?.constraints?.latency_ms_max || 200;
  const maxCost = inputs?.constraints?.cost_usd_max || 0.15;
  const maxCarbon = inputs?.constraints?.carbon_gco2kwh_max || 250;

  // Filter eligible regions
  const eligible = regions.filter(r => 
    r.latency <= maxLatency &&
    r.cost <= maxCost &&
    r.carbonIntensity <= maxCarbon &&
    r.available
  );

  if (eligible.length === 0) {
    throw new Error("No regions meet constraints");
  }

  // Apply organization weights or use defaults
  const weights = routingPolicies.length > 0 ? 
    routingPolicies[0].weights : 
    { carbon: 0.5, latency: 0.3, cost: 0.2 };

  // Score each region
  const scored = eligible.map(r => ({
    ...r,
    score: calculateScore(r, weights),
  }));

  // Select best (lowest score = best)
  scored.sort((a, b) => a.score - b.score);

  const selected = scored[0];

  return {
    provider: selected.provider,
    region: selected.region,
    carbonIntensity: selected.carbonIntensity,
    latency: selected.latency,
    cost: selected.cost,
    score: selected.score,
    trace: {
      constraints: { maxLatency, maxCost, maxCarbon },
      eligibleCount: eligible.length,
      weights,
      allScores: scored.map(s => ({ provider: s.provider, region: s.region, score: s.score })),
    },
  };
}

function calculateScore(region: any, weights: any): number {
  return (
    weights.carbon * (region.carbonIntensity / 300) +  // Normalize to 0-1
    weights.latency * (region.latency / 150) +           // Normalize to 0-1
    weights.cost * (region.cost / 0.15)                  // Normalize to 0-1
  );
}

async function executeWorkload(convergenceRun: any, routing: any): Promise<any> {
  // Mock execution - in production would actually execute in the selected region
  return {
    status: "success",
    output: convergenceRun.finalQualityScore 
      ? `High quality output (${convergenceRun.finalQualityScore}) executed in ${routing.region}`
      : `Output executed in ${routing.region}`,
    execution: {
      provider: routing.provider,
      region: routing.region,
      cost: routing.cost,
      carbonIntensity: routing.carbonIntensity,
      latency: routing.latency,
    },
    timestamp: new Date().toISOString(),
  };
}

function calculateCarbonSaved(routing: any): number {
  // Compare to baseline (worst region)
  const baseline = 300; // gCO2/kWh
  return Math.max(0, baseline - routing.carbonIntensity);
}

ecobeWorker.on("completed", (job) => {
  console.log("ECOBE completed", job.id);
});

ecobeWorker.on("failed", (job, err) => {
  console.error("ECOBE failed", job?.id, err);
});
