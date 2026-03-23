import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const acousticWorker = new Worker("acoustic-listening", async (job) => {
  const { runId, orgId, signalData } = job.data;
  
  // Pattern Memory - Store and cross-reference historical signals
  const historicalPatterns = await loadHistoricalPatterns(orgId);
  const patternMatches = findPatternMatches(signalData, historicalPatterns);
  
  // Anomaly Detection - Identify deviations from expected patterns
  const anomalies = detectAnomalies(signalData, historicalPatterns);
  
  // Signal Amplification - Boost weak but persistent signals
  const amplifiedSignals = amplifyWeakSignals(signalData, patternMatches);
  
  // Noise Filtering - Separate meaningful patterns from background noise
  const filteredSignals = filterNoise(amplifiedSignals, historicalPatterns);
  
  // Store acoustic analysis results
  await prisma.acousticAnalysis.create({
    data: {
      runId,
      patternMatches: patternMatches,
      anomalies: anomalies,
      amplifiedSignals: amplifiedSignals,
      filteredSignals: filteredSignals,
      analyzedAt: new Date()
    }
  });
  
  // Enqueue next step if significant patterns detected
  if (patternMatches.length > 0 || anomalies.length > 0) {
    await job.data.nextQueue.add("process", job.data);
  }
});

async function loadHistoricalPatterns(orgId: string) {
  const patterns = await prisma.signalPattern.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 1000
  });
  
  return patterns.map(p => ({
    id: p.id,
    pattern: JSON.parse(p.patternJson),
    frequency: p.frequency,
    lastSeen: p.lastSeen,
    significance: p.significance
  }));
}

function findPatternMatches(currentSignal: any, historicalPatterns: any[]) {
  const matches = [];
  
  for (const pattern of historicalPatterns) {
    const similarity = calculatePatternSimilarity(currentSignal, pattern.pattern);
    if (similarity > 0.8) {
      matches.push({
        patternId: pattern.id,
        similarity,
        frequency: pattern.frequency,
        significance: pattern.significance,
        lastSeen: pattern.lastSeen
      });
    }
  }
  
  return matches.sort((a, b) => b.similarity - a.similarity);
}

function calculatePatternSimilarity(signal1: any, signal2: any) {
  // Simple similarity calculation - can be enhanced with ML models
  const features1 = extractFeatures(signal1);
  const features2 = extractFeatures(signal2);
  
  let similarity = 0;
  const featureCount = Math.min(features1.length, features2.length);
  
  for (let i = 0; i < featureCount; i++) {
    similarity += features1[i] === features2[i] ? 1 : 0;
  }
  
  return similarity / featureCount;
}

function extractFeatures(signal: any) {
  // Extract key features from signal for comparison
  return [
    signal.type,
    signal.source,
    signal.priority,
    signal.category,
    signal.risk_level
  ].filter(Boolean);
}

function detectAnomalies(currentSignal: any, historicalPatterns: any[]) {
  const anomalies = [];
  
  // Check for unusual patterns
  const expectedPatterns = historicalPatterns.filter(p => p.frequency > 0.5);
  
  for (const pattern of expectedPatterns) {
    const deviation = calculateDeviation(currentSignal, pattern.pattern);
    if (deviation > 0.7) {
      anomalies.push({
        type: "pattern_deviation",
        severity: deviation > 0.9 ? "high" : "medium",
        description: `Significant deviation from pattern ${pattern.id}`,
        expectedPattern: pattern.pattern,
        actualSignal: currentSignal,
        deviation
      });
    }
  }
  
  // Check for completely new patterns
  const isNewPattern = historicalPatterns.every(p => 
    calculatePatternSimilarity(currentSignal, p.pattern) < 0.3
  );
  
  if (isNewPattern) {
    anomalies.push({
      type: "new_pattern",
      severity: "medium",
      description: "Previously unseen signal pattern detected",
      signal: currentSignal
    });
  }
  
  return anomalies;
}

function calculateDeviation(signal1: any, signal2: any) {
  // Calculate how much signal1 deviates from signal2
  const features1 = extractFeatures(signal1);
  const features2 = extractFeatures(signal2);
  
  let deviations = 0;
  const featureCount = Math.max(features1.length, features2.length);
  
  for (let i = 0; i < featureCount; i++) {
    if (features1[i] !== features2[i]) {
      deviations++;
    }
  }
  
  return deviations / featureCount;
}

function amplifyWeakSignals(signalData: any, patternMatches: any[]) {
  const amplified = [];
  
  // Amplify signals that match significant patterns but have low strength
  for (const match of patternMatches) {
    if (match.significance > 0.7 && signalData.strength < 0.5) {
      amplified.push({
        originalSignal: signalData,
        amplifiedSignal: {
          ...signalData,
          strength: Math.min(signalData.strength * 2, 1.0),
          confidence: signalData.confidence * 1.2
        },
        reason: `Amplified due to significant pattern match (${match.patternId})`,
        amplificationFactor: 2.0
      });
    }
  }
  
  return amplified;
}

function filterNoise(signals: any[], historicalPatterns: any[]) {
  const filtered = [];
  
  for (const signal of signals) {
    // Remove signals that are likely noise
    const isNoise = historicalPatterns.every(p => 
      calculatePatternSimilarity(signal, p.pattern) < 0.2
    ) && signal.strength < 0.3;
    
    if (!isNoise) {
      filtered.push(signal);
    }
  }
  
  return filtered;
}

acousticWorker.on("completed", (job) => {
  console.log(`Acoustic analysis completed for run ${job.data.runId}`);
});

acousticWorker.on("failed", (job, err) => {
  console.error(`Acoustic analysis failed for run ${job.data.runId}:`, err);
});
