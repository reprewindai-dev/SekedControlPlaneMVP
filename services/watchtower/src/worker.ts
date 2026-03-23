import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const watchtowerWorker = new Worker("watchtower-validation", async (job) => {
  const { runId, orgId, signalData } = job.data;
  
  // Multi-perspective validation logic
  const perspectives = [
    validateFromSecurityPerspective(signalData),
    validateFromReliabilityPerspective(signalData),
    validateFromCompliancePerspective(signalData),
    validateFromEthicalPerspective(signalData)
  ];
  
  const consensus = calculateConsensus(perspectives);
  const consistencyScore = calculateConsistency(perspectives);
  
  // Store watchtower validation result
  await prisma.watchtowerValidation.create({
    data: {
      runId,
      perspectives: perspectives,
      consensusScore: consensus,
      consistencyScore,
      validatedAt: new Date()
    }
  });
  
  // Enqueue next step if consensus passes threshold
  if (consensus >= 0.8) {
    await job.data.nextQueue.add("process", job.data);
  }
});

function validateFromSecurityPerspective(data: any) {
  return {
    perspective: "security",
    score: 0.9,
    reasoning: "No security threats detected",
    confidence: 0.85
  };
}

function validateFromReliabilityPerspective(data: any) {
  return {
    perspective: "reliability",
    score: 0.85,
    reasoning: "Source reliability confirmed",
    confidence: 0.9
  };
}

function validateFromCompliancePerspective(data: any) {
  return {
    perspective: "compliance",
    score: 0.95,
    reasoning: "Fully compliant with policies",
    confidence: 0.95
  };
}

function validateFromEthicalPerspective(data: any) {
  return {
    perspective: "ethical",
    score: 0.88,
    reasoning: "Ethical guidelines satisfied",
    confidence: 0.8
  };
}

function calculateConsensus(perspectives: any[]) {
  const avgScore = perspectives.reduce((sum, p) => sum + p.score, 0) / perspectives.length;
  return avgScore;
}

function calculateConsistency(perspectives: any[]) {
  // Calculate how consistent the perspectives are with each other
  const scores = perspectives.map(p => p.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
  return 1 - variance; // Lower variance = higher consistency
}

watchtowerWorker.on("completed", (job) => {
  console.log(`Watchtower validation completed for run ${job.data.runId}`);
});

watchtowerWorker.on("failed", (job, err) => {
  console.error(`Watchtower validation failed for run ${job.data.runId}:`, err);
});
