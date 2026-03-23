import { prisma } from '../lib/prisma';

export interface SekedInput {
  orgId: string;
  runId: string;
  projectId?: string;
  task: any;
  inputs: any;
  policyConfig: any;
}

export interface SekedResult {
  escalationLevel: 0 | 1 | 2;
  detrimentalScore: number;
  fractureDetected: boolean;
  fractureMapRefs: string[];
  driftDelta: number;
  trustAnomalies: string[];
  requiredValidations: any;
  signalFieldUpdates: any;
}

export async function evaluateSeked(input: SekedInput): Promise<SekedResult> {
  // Load or create signal field for scope
  const scope = input.projectId ? 'project' : 'org';
  const scopeId = input.projectId ?? input.orgId;
  let signalField = await prisma.signalField.findFirst({
    where: { orgId: input.orgId, scope, scopeId },
    include: {
      referenceStars: true,
      intentVectors: true,
      trustWeights: true,
      driftLogEntries: { orderBy: { createdAt: 'desc' }, take: 10 },
      fractureMaps: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  });

  if (!signalField) {
    signalField = await prisma.signalField.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        scope,
        scopeId,
      },
      include: {
        referenceStars: true,
        intentVectors: true,
        trustWeights: true,
        driftLogEntries: { orderBy: { createdAt: 'desc' }, take: 10 },
        fractureMaps: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
  }

  // 1) Detrimental scoring
  const detrimentalScore = calculateDetrimentalScore(input.task, input.inputs, signalField!);

  // 2) Fracture detection
  const fractureResult = detectFractures(input.task, signalField!);

  // 3) Drift detection
  const driftDelta = calculateDrift(input.task, signalField!.driftLogEntries);

  // 4) Trust anomalies
  const trustAnomalies = detectTrustAnomalies(signalField!.trustWeights);

  // 5) Escalation level
  const escalationLevel = determineEscalation(detrimentalScore, fractureResult.detected, driftDelta);

  // 6) Required validations
  const requiredValidations = buildValidations(escalationLevel, input.policyConfig);

  // 7) Signal field updates
  const signalFieldUpdates = planSignalFieldUpdates(input, signalField, {
    detrimentalScore,
    fractureResult,
    driftDelta,
  });

  await applySignalFieldUpdates(signalField.id, signalFieldUpdates);

  // Persist SekedScore
  await prisma.sekedScore.create({
    data: {
      runId: input.runId,
      escalationLevel,
      detrimentalScore,
      fractureDetected: fractureResult.detected,
      fractureMapRefs: fractureResult.refs,
      driftDelta,
      trustAnomalies,
      requiredValidations,
      signalFieldUpdates,
    },
  });

  return {
    escalationLevel,
    detrimentalScore,
    fractureDetected: fractureResult.detected,
    fractureMapRefs: fractureResult.refs,
    driftDelta,
    trustAnomalies,
    requiredValidations,
    signalFieldUpdates,
  };
}

function calculateDetrimentalScore(task: any, inputs: any, signalField: any): number {
  let score = 0;
  const searchableInput = stringifyInputs(inputs);
  if (task.type === 'system_action') score += 0.3;
  if (searchableInput.includes('delete') || searchableInput.includes('remove')) score += 0.25;
  if (searchableInput.includes('sudo') || searchableInput.includes('drop table')) score += 0.3;
  if (task.risk_level === 'high') score += 0.2;
  if (signalField.intentVectors.some((v: any) => v.magnitude > 0.8 && v.label === 'override')) score += 0.25;
  if (signalField.fractureMaps.some((map: any) => map.severity > 0.75)) score += 0.15;
  return Math.min(score, 1);
}

function detectFractures(task: any, signalField: any) {
  const currentType = String(task.type ?? '').toLowerCase();
  const priorTypes = signalField.intentVectors
    .map((vector: any) => safeParseDirection(vector.directionJson)?.type)
    .filter(Boolean)
    .map((value: string) => value.toLowerCase());

  const conflictingTypes = priorTypes.filter((value: string) => value !== currentType);
  const fractureRefs = signalField.referenceStars
    .slice(0, 3)
    .map((star: any) => star.label)
    .filter(Boolean);
  const severity = priorTypes.length > 0 ? conflictingTypes.length / priorTypes.length : 0;
  const detected = severity >= 0.6;
  const refs: string[] = detected ? fractureRefs : [];
  return { detected, refs };
}

function calculateDrift(task: any, driftLogs: any[]): number {
  if (driftLogs.length === 0) return 0;
  const recentAverage =
    driftLogs.reduce((sum: number, entry: any) => sum + Number(entry.driftDelta ?? 0), 0) / driftLogs.length;
  const riskBump = task.risk_level === 'high' ? 0.1 : 0;
  return Math.min(1, Math.max(0, recentAverage + riskBump));
}

function detectTrustAnomalies(trustWeights: any[]): string[] {
  return trustWeights
    .filter((tw: any) => tw.weight < 0.3)
    .map((tw: any) => `${tw.sourceType}:${tw.sourceId}`);
}

function determineEscalation(detrimental: number, fracture: boolean, drift: number): 0 | 1 | 2 {
  if (detrimental > 0.7 || fracture) return 2;
  if (detrimental > 0.4 || drift > 0.5) return 1;
  return 0;
}

function buildValidations(level: number, policyConfig: any): any {
  return {
    watchtower: level >= 1,
    shadowTracking: level >= 2,
    humanReview: level === 2,
  };
}

function planSignalFieldUpdates(input: SekedInput, signalField: any, analysis: any): any {
  const sourceText = stringifyInputs(input.inputs);
  const referenceLabels = extractReferenceLabels(sourceText);

  return {
    referenceStars: referenceLabels.map((label) => ({
      label,
      payloadJson: {
        taskType: input.task.type,
        riskLevel: input.task.risk_level,
      },
    })),
    intentVectors: [
      {
        label: 'last_task_type',
        directionJson: { type: input.task.type, riskLevel: input.task.risk_level },
        magnitude: 0.6,
      },
    ],
    trustWeights: [
      {
        sourceType: 'task_type',
        sourceId: String(input.task.type),
        weight: Math.max(0.2, 1 - analysis.detrimentalScore),
      },
    ],
    driftLogEntries: [
      {
        dimension: 'goal',
        driftDelta: analysis.driftDelta,
        notes: `Detrimental: ${analysis.detrimentalScore}`,
      },
    ],
    fractureMaps: analysis.fractureResult.detected
      ? [
          {
            refsJson: analysis.fractureResult.refs,
            severity: Math.min(1, analysis.driftDelta + analysis.detrimentalScore),
          },
        ]
      : [],
  };
}

function stringifyInputs(inputs: any): string {
  if (typeof inputs === 'string') return inputs.toLowerCase();
  if (inputs == null) return '';

  try {
    return JSON.stringify(inputs).toLowerCase();
  } catch {
    return String(inputs).toLowerCase();
  }
}

async function applySignalFieldUpdates(signalFieldId: string, updates: any) {
  const operations: Promise<unknown>[] = [];

  for (const star of updates.referenceStars ?? []) {
    operations.push(
      prisma.referenceStar.create({
        data: {
          signalFieldId,
          label: star.label,
          payloadJson: star.payloadJson ?? null,
        },
      }),
    );
  }

  for (const vector of updates.intentVectors ?? []) {
    operations.push(
      prisma.intentVector.create({
        data: {
          signalFieldId,
          label: vector.label,
          directionJson: vector.directionJson ?? {},
          magnitude: vector.magnitude ?? 0,
        },
      }),
    );
  }

  for (const weight of updates.trustWeights ?? []) {
    operations.push(
      prisma.trustWeight.upsert({
        where: {
          signalFieldId_sourceType_sourceId: {
            signalFieldId,
            sourceType: weight.sourceType,
            sourceId: weight.sourceId,
          },
        },
        create: {
          signalFieldId,
          sourceType: weight.sourceType,
          sourceId: weight.sourceId,
          weight: weight.weight,
        },
        update: {
          weight: weight.weight,
        },
      }),
    );
  }

  for (const drift of updates.driftLogEntries ?? []) {
    operations.push(
      prisma.driftLogEntry.create({
        data: {
          signalFieldId,
          dimension: drift.dimension,
          driftDelta: drift.driftDelta,
          notes: drift.notes ?? null,
        },
      }),
    );
  }

  for (const fracture of updates.fractureMaps ?? []) {
    operations.push(
      prisma.fractureMap.create({
        data: {
          signalFieldId,
          refsJson: fracture.refsJson ?? null,
          severity: fracture.severity ?? 0,
        },
      }),
    );
  }

  await Promise.all(operations);
}

function extractReferenceLabels(text: string) {
  const normalized = text
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  return Array.from(new Set(normalized)).slice(0, 5);
}

function safeParseDirection(directionJson: any) {
  if (!directionJson) return null;
  if (typeof directionJson === 'object') return directionJson;
  try {
    return JSON.parse(directionJson);
  } catch {
    return null;
  }
}
