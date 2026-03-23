import { Worker, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const prisma = new PrismaClient();
const ecobeQueue = new Queue("pipeline-ecobe", { connection: redis });

const convergeWorker = new Worker(
  "pipeline-converge",
  async (job) => {
    const { runId, orgId, apiKeyId, role } = job.data;

    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (!run) throw new Error("Run not found");

    const sekedScore = await prisma.sekedScore.findUnique({ where: { runId } });
    if (!sekedScore) throw new Error("Seked score not found");

    // Enhanced convergence with Signal Coherence integration
    const maxAttempts = sekedScore.escalationLevel === 2 ? 5 : sekedScore.escalationLevel === 1 ? 8 : 10;
    const qualityThreshold = sekedScore.escalationLevel === 2 ? 0.95 : sekedScore.escalationLevel === 1 ? 0.85 : 0.8;

    const convergenceRun = await prisma.convergenceRun.create({
      data: {
        runId,
        converged: false,
        attemptsUsed: 0,
        maxAttempts,
        qualityThreshold,
        finalQualityScore: 0,
      },
    });

    await prisma.runEvent.create({
      data: {
        runId,
        type: "CONVERGE_STARTED",
        data: { maxAttempts, qualityThreshold },
      },
    });

    // Simulate convergence attempts with enhanced logic
    let attempts = 0;
    let converged = false;
    let finalQualityScore = 0;

    while (attempts < maxAttempts && !converged) {
      attempts++;
      
      // Generate output (mock - would integrate with actual LLM/API)
      const rawOutput = generateOutput(run.inputsJson, attempts);
      
      // Validate against schema
      const schemaValid = validateSchema(rawOutput, run.schemaId);
      
      // Score quality
      const qualityScore = scoreQuality(rawOutput, run.inputsJson);
      
      // Store attempt
      await prisma.convergenceAttempt.create({
        data: {
          convergenceRunId: convergenceRun.id,
          attemptIndex: attempts,
          rawOutput,
          schemaValid,
          qualityScore,
          errors: schemaValid ? [] : ["Schema validation failed"],
        },
      });

      if (schemaValid && qualityScore >= qualityThreshold) {
        converged = true;
        finalQualityScore = qualityScore;
        break;
      }
    }

    // Update convergence run
    await prisma.convergenceRun.update({
      where: { id: convergenceRun.id },
      data: {
        converged,
        attemptsUsed: attempts,
        finalQualityScore,
      },
    });

    await prisma.runEvent.create({
      data: {
        runId,
        type: converged ? "CONVERGE_PASSED" : "CONVERGE_FAILED",
        data: { attempts, converged, finalQualityScore },
      },
    });

    if (converged) {
      // Enqueue to ECOBE for routing
      await ecobeQueue.add("route", { runId, orgId, apiKeyId, role });
    } else {
      // Mark run as failed
      await prisma.run.update({
        where: { id: runId },
        data: { status: "failed", completedAt: new Date() },
      });
    }
  },
  { connection: redis }
);

function generateOutput(inputs: any, attempt: number): any {
  // Mock output generation - in production would call actual LLM/API
  return {
    result: `Generated output attempt ${attempt}`,
    confidence: Math.min(0.5 + (attempt * 0.1), 0.95),
    metadata: {
      attempt,
      timestamp: new Date().toISOString(),
      inputs: inputs,
    },
  };
}

function validateSchema(output: any, schemaId: string): boolean {
  // Mock schema validation - in production would validate against actual schema
  return output && typeof output === "object" && output.result !== undefined;
}

function scoreQuality(output: any, inputs: any): number {
  let score = 0;
  
  // Completeness (30%)
  if (output && Object.keys(output).length > 0) score += 0.3;
  
  // Relevance (40%)
  if (output.result && output.result.length > 10) score += 0.4;
  
  // Structure (30%)
  if (typeof output === "object" && !Array.isArray(output)) score += 0.3;
  
  return Math.min(score, 1.0);
}

convergeWorker.on("completed", (job) => {
  console.log("ConvergeOS completed", job.id);
});

convergeWorker.on("failed", (job, err) => {
  console.error("ConvergeOS failed", job?.id, err);
});
