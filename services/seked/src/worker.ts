import { Worker, Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const prisma = new PrismaClient();
const convergeQueue = new Queue('pipeline-converge', { connection: redis });
const watchtowerQueue = new Queue('watchtower-validation', { connection: redis });
const celestialQueue = new Queue('celestial-navigation', { connection: redis });
const acousticQueue = new Queue('acoustic-listening', { connection: redis });
const collapseQueue = new Queue('empire-collapse-prevention', { connection: redis });
const shadowQueue = new Queue('shadow-tracking', { connection: redis });

// Enhanced seked evaluation with full Signal Coherence AGI integration
const sekedWorker = new Worker(
  'pipeline-seked',
  async (job) => {
    const { runId, orgId, apiKeyId, role } = job.data as { runId: string; orgId: string; apiKeyId: string; role: string };

    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (!run) throw new Error('Run not found');

    // Load Signal Field for this organization/project
    const signalField = await prisma.signalField.findFirst({
      where: { 
        orgId, 
        projectId: run.projectId || null,
        scope: run.projectId ? 'project' : 'org'
      }
    });

    // Calculate detrimental score based on Signal Field
    const detrimentalScore = calculateDetrimentalScore(run.inputsJson, signalField);
    
    // Determine escalation level based on detrimental score and historical patterns
    const escalationLevel = determineEscalationLevel(detrimentalScore, signalField);
    
    // Detect fractures in the signal field
    const fractureDetected = detectFractures(run.inputsJson, signalField);
    
    // Calculate drift from Reference Stars
    const driftDelta = calculateDrift(run.inputsJson, signalField);
    
    // Update Signal Field with new data
    if (signalField) {
      await updateSignalField(signalField.id, runId, driftDelta, fractureDetected);
    }

    await prisma.sekedScore.upsert({
      where: { runId },
      update: { 
        detrimentalScore, 
        escalationLevel, 
        fractureDetected, 
        fractureMapRefs: fractureDetected ? [runId] : [], 
        driftDelta, 
        trustAnomalies: [], 
        requiredValidations: escalationLevel > 0 ? ['watchtower', 'collapse'] : [], 
        signalFieldUpdates: signalField ? { updated: true } : {}
      },
      create: { 
        runId, 
        detrimentalScore, 
        escalationLevel, 
        fractureDetected, 
        fractureMapRefs: fractureDetected ? [runId] : [], 
        driftDelta, 
        trustAnomalies: [], 
        requiredValidations: escalationLevel > 0 ? ['watchtower', 'collapse'] : [], 
        signalFieldUpdates: signalField ? { updated: true } : {}
      },
    });

    await prisma.runEvent.create({
      data: {
        runId,
        type: 'SEKED_SCORED',
        data: { detrimentalScore, escalationLevel, fractureDetected, driftDelta },
      },
    });

    // Enqueue to Watchtower for multi-perspective validation
    await watchtowerQueue.add('validate', { 
      runId, 
      orgId, 
      apiKeyId, 
      role,
      signalData: run.inputsJson,
      nextQueue: celestialQueue
    });
  },
  { connection: redis }
);

function calculateDetrimentalScore(inputs: any, signalField: any): number {
  let score = 0;
  
  if (!inputs) return score;
  
  // Check for irreversible actions
  if (inputs.requires_pii) score += 0.3;
  if (inputs.task?.risk_level === 'critical') score += 0.3;
  if (inputs.task?.risk_level === 'high') score += 0.2;
  
  // Check for overreach patterns
  if (signalField && signalField.referenceStars) {
    const referenceStars = JSON.parse(signalField.referenceStars as string);
    const conflicts = referenceStars.filter((star: string) => 
      inputs.content?.toLowerCase().includes(star.toLowerCase())
    );
    score += conflicts.length * 0.1;
  }
  
  return Math.min(score, 1.0);
}

function determineEscalationLevel(detrimentalScore: number, signalField: any): number {
  if (detrimentalScore > 0.7) return 2;
  if (detrimentalScore > 0.3) return 1;
  return 0;
}

function detectFractures(inputs: any, signalField: any): boolean {
  if (!signalField || !signalField.fractureMap) return false;
  
  const fractureMap = JSON.parse(signalField.fractureMap as string);
  return fractureMap.some((fracture: any) => 
    inputs.content?.toLowerCase().includes(fracture.keyword?.toLowerCase())
  );
}

function calculateDrift(inputs: any, signalField: any): number {
  if (!signalField || !signalField.intentVectors) return 0;
  
  const intentVectors = JSON.parse(signalField.intentVectors as string);
  let drift = 0;
  
  for (const vector of intentVectors) {
    if (inputs.content?.toLowerCase().includes(vector.keyword?.toLowerCase())) {
      drift += vector.drift || 0;
    }
  }
  
  return Math.min(drift, 1.0);
}

async function updateSignalField(signalFieldId: string, runId: string, driftDelta: number, fractureDetected: boolean) {
  const updates: any = {};
  
  if (driftDelta > 0.25) {
    // Add to drift log
    const currentDriftLog = await prisma.signalField.findUnique({
      where: { id: signalFieldId },
      select: { driftLogEntries: true }
    });
    
    const driftLog = currentDriftLog?.driftLogEntries ? 
      JSON.parse(currentDriftLog.driftLogEntries as string) : [];
    
    driftLog.push({
      timestamp: new Date().toISOString(),
      runId,
      driftDelta,
      dimension: 'task_execution'
    });
    
    updates.driftLogEntries = JSON.stringify(driftLog);
  }
  
  if (fractureDetected) {
    // Add to fracture map
    const currentFractureMap = await prisma.signalField.findUnique({
      where: { id: signalFieldId },
      select: { fractureMap: true }
    });
    
    const fractureMap = currentFractureMap?.fractureMap ? 
      JSON.parse(currentFractureMap.fractureMap as string) : [];
    
    fractureMap.push({
      timestamp: new Date().toISOString(),
      runId,
      type: 'signal_conflict',
      severity: 'medium'
    });
    
    updates.fractureMap = JSON.stringify(fractureMap);
  }
  
  if (Object.keys(updates).length > 0) {
    await prisma.signalField.update({
      where: { id: signalFieldId },
      data: { ...updates, updatedAt: new Date() }
    });
  }
}

sekedWorker.on('completed', (job) => {
  console.log('Seked completed', job.id);
});

sekedWorker.on('failed', (job, err) => {
  console.error('Seked failed', job?.id, err);
});
