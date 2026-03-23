import { prisma } from '../lib/prisma';
import { evaluateSeked, SekedInput, SekedResult } from './seked';
import { runConvergence, ConvergeOSInput, ConvergeOSResult } from './convergeos';
import { routeEcobe, EcobeInput, EcobeResult, recordRoutingObservation } from './ecobe';

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
    // Load policy and schema
    const policy = await prisma.policy.findUnique({ where: { id: payload.policy_profile_id } });
    const schema = await prisma.schema.findUnique({ where: { id: payload.schema_id } });
    if (!policy || !schema) throw new Error('Policy or schema not found');

    // 1) Seked Governance Plane
    const sekedInput: SekedInput = {
      orgId: payload.orgId,
      runId,
      projectId: payload.project_id,
      task: payload.task,
      inputs: payload.inputs,
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

    // 2) ConvergeOS Reliability Plane
    const convergeInput: ConvergeOSInput = {
      runId,
      sekedResult,
      task: payload.task,
      inputs: payload.inputs,
      schemaId: payload.schema_id,
      policyConfig: policy,
    };
    const convergeResult = await runConvergence(convergeInput);

    await prisma.runEvent.create({
      data: {
        runId,
        type: convergeResult.converged ? 'CONVERGE_PASSED' : 'CONVERGE_FAILED',
        data: convergeResult as any,
      },
    });

    // 3) ECOBE Infrastructure Plane
    const ecobeInput: EcobeInput = {
      runId,
      convergeResult,
      policyConfig: policy,
      execution: payload.execution,
      constraints: payload.constraints,
    };
    const ecobeResult = await routeEcobe(ecobeInput);

    await prisma.runEvent.create({
      data: {
        runId,
        type: 'ECOBE_ROUTED',
        data: ecobeResult as any,
      },
    });

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
        provider: ecobeResult.provider,
        region: ecobeResult.region,
        estimatedCostUsd: ecobeResult.estimatedCostUsd,
        estimatedLatencyMs: ecobeResult.estimatedLatencyMs,
        carbonIntensityGco2Kwh: ecobeResult.carbonIntensityGco2Kwh,
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
      orgId: payload.orgId,
      provider: ecobeResult.provider,
      region: ecobeResult.region,
      observedLatencyMs: Math.max(1, Date.now() - pipelineStartedAt),
      observedCostUsd: ecobeResult.estimatedCostUsd,
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
