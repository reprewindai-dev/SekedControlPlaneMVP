import { prisma } from '../lib/prisma';
import { evaluateSeked, SekedInput, SekedResult } from './seked';
import { runConvergence, ConvergeOSInput, ConvergeOSResult } from './convergeos';
import { routeEcobe, EcobeInput, EcobeResult, recordRoutingObservation } from './ecobe';
import { env } from '../config/env';

export async function executeThreePlanePipeline(runId: string, payload: any) {
  const pipelineStartedAt = Date.now();
  await prisma.run.update({
    where: { id: runId },
    data: {
      status: 'running',
      startedAt: new Date(),
    },
  });
  try {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      include: {
        policyProfile: true,
        schema: true,
        project: true,
      },
    });
    if (!run) throw new Error('Run not found');

    const policy = run.policyProfile;
    const schema = run.schema;
    if (!policy || !schema) throw new Error('Policy or schema not found');

    const runtimePayload = {
      orgId: run.orgId,
      project_id: run.projectId,
      policy_profile_id: run.policyProfileId,
      schema_id: run.schemaId,
      task: {
        type: run.taskType ?? payload.task?.type ?? 'generic_task',
        risk_level: run.riskLevel ?? payload.task?.risk_level ?? 'medium',
      },
      inputs: run.inputsJson ?? payload.inputs ?? {},
      constraints: run.constraintsJson ?? payload.constraints ?? null,
      execution: run.executionJson ?? payload.execution ?? null,
    };

    // 1) Seked Governance Plane
    const sekedInput: SekedInput = {
      orgId: runtimePayload.orgId,
      runId,
      projectId: runtimePayload.project_id,
      task: runtimePayload.task,
      inputs: runtimePayload.inputs,
      policyConfig: policy,
    };
    const sekedResult = await evaluateSeked(sekedInput);

    await prisma.runEvent.create({
      data: {
        runId,
        type: 'SEKED_SCORED',
        data: sekedResult as any,
      },
    });

    // 2) ECOBE Infrastructure Plane
    const ecobeInput: EcobeInput = {
      runId,
      convergeResult: { converged: true },
      policyConfig: policy,
      execution: normalizeExecution(runtimePayload.execution),
      constraints: normalizeConstraints(runtimePayload.constraints),
    };
    const ecobeResult = await routeEcobe(ecobeInput);

    await prisma.runEvent.create({
      data: {
        runId,
        type: 'ECOBE_ROUTED',
        data: ecobeResult as any,
      },
    });

    // 3) ConvergeOS Reliability Plane
    const convergeInput: ConvergeOSInput = {
      runId,
      sekedResult,
      task: runtimePayload.task,
      inputs: runtimePayload.inputs,
      schemaId: runtimePayload.schema_id,
      policyConfig: policy,
      execution: {
        primaryProvider: ecobeResult.provider,
        region: ecobeResult.region,
      },
    };
    const convergeResult = await runConvergence(convergeInput);

    await prisma.runEvent.create({
      data: {
        runId,
        type: convergeResult.converged ? 'CONVERGE_PASSED' : 'CONVERGE_FAILED',
        data: convergeResult as any,
      },
    });

    if (convergeResult.providerUsed && convergeResult.providerUsed !== ecobeResult.provider) {
      await prisma.runEvent.create({
        data: {
          runId,
          type: 'PROVIDER_FALLBACK_USED',
          data: {
            routedProvider: ecobeResult.provider,
            routedRegion: ecobeResult.region,
            executedProvider: convergeResult.providerUsed,
            executedRegion: convergeResult.regionUsed,
            providerAttempts: convergeResult.providerAttempts ?? [],
          } as any,
        },
      });
    }

    // Finalize run
    const finalOutput = convergeResult.converged ? convergeResult.finalOutput : null;
    const finalStatus = convergeResult.converged ? 'completed' : 'failed';
    const analyticsSnapshot = {
      governance: {
        escalationLevel: sekedResult.escalationLevel,
        detrimentalScore: sekedResult.detrimentalScore,
        fractureDetected: sekedResult.fractureDetected,
        driftDelta: sekedResult.driftDelta,
        trustAnomalyCount: sekedResult.trustAnomalies.length,
      },
      convergence: {
        converged: convergeResult.converged,
        attemptsUsed: convergeResult.attemptsUsed,
        finalQualityScore: convergeResult.finalQualityScore ?? null,
        errorCount: Array.isArray(convergeResult.errors) ? convergeResult.errors.length : convergeResult.errors ? 1 : 0,
      },
      infrastructure: {
        routedProvider: ecobeResult.provider,
        routedRegion: ecobeResult.region,
        executedProvider: convergeResult.providerUsed ?? ecobeResult.provider,
        executedRegion: convergeResult.regionUsed ?? ecobeResult.region,
        estimatedCostUsd: ecobeResult.estimatedCostUsd,
        estimatedLatencyMs: ecobeResult.estimatedLatencyMs,
        executionCostUsd: convergeResult.executionCostUsd ?? ecobeResult.estimatedCostUsd,
        executionLatencyMs: convergeResult.executionLatencyMs ?? ecobeResult.estimatedLatencyMs,
        carbonIntensityGco2Kwh: ecobeResult.carbonIntensityGco2Kwh,
        fallbackTriggered:
          Boolean(convergeResult.providerUsed) && convergeResult.providerUsed !== ecobeResult.provider,
      },
      outcome: {
        status: finalStatus,
        success: convergeResult.converged,
      },
    };

    await prisma.run.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        finalOutputJson: finalOutput,
        analyticsJson: analyticsSnapshot as any,
        completedAt: new Date(),
        error: null as any,
      },
    });

    await prisma.runEvent.create({
      data: {
        runId,
        type: finalStatus === 'completed' ? 'RUN_COMPLETED' : 'RUN_FAILED',
        data: analyticsSnapshot as any,
      },
    });

    await recordRoutingObservation({
      orgId: runtimePayload.orgId,
      provider: convergeResult.providerUsed ?? ecobeResult.provider,
      region:
        convergeResult.regionUsed ??
        (convergeResult.providerUsed === 'groq'
          ? env.groqProviderRegion
          : convergeResult.providerUsed === 'ollama'
            ? env.ollamaProviderRegion
            : ecobeResult.region),
      observedLatencyMs: Math.max(1, convergeResult.executionLatencyMs ?? Date.now() - pipelineStartedAt),
      observedCostUsd: convergeResult.executionCostUsd ?? ecobeResult.estimatedCostUsd,
      observedCarbonIntensityGco2Kwh: ecobeResult.carbonIntensityGco2Kwh,
      observedAt: new Date(),
    });

    return {
      runId,
      status: finalStatus,
      sekedResult,
      convergeResult,
      ecobeResult,
      finalOutput,
    };
  } catch (err) {
    const failure = serializeError(err);
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: 'failed',
        error: failure as any,
        analyticsJson: {
          outcome: {
            status: 'failed',
            success: false,
          },
          failure,
        } as any,
        completedAt: new Date(),
      },
    });

    await prisma.runEvent.create({
      data: {
        runId,
        type: 'RUN_FAILED',
        data: failure as any,
      },
    });

    throw err;
  }
}

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return {
      message: err.message,
      name: err.name,
      stack: err.stack,
    };
  }

  return {
    message: typeof err === 'string' ? err : 'Unknown pipeline failure',
  };
}

function normalizeExecution(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const execution = value as { provider_preference?: unknown };
  const providerPreference = Array.isArray(execution.provider_preference)
    ? execution.provider_preference.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : undefined;

  return providerPreference ? { provider_preference: providerPreference } : undefined;
}

function normalizeConstraints(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const constraints = value as { latency_ms_max?: unknown; cost_usd_max?: unknown };

  const normalized = {
    latency_ms_max:
      typeof constraints.latency_ms_max === 'number' && Number.isFinite(constraints.latency_ms_max)
        ? constraints.latency_ms_max
        : undefined,
    cost_usd_max:
      typeof constraints.cost_usd_max === 'number' && Number.isFinite(constraints.cost_usd_max)
        ? constraints.cost_usd_max
        : undefined,
  };

  return normalized.latency_ms_max !== undefined || normalized.cost_usd_max !== undefined ? normalized : undefined;
}
