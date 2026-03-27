import { Router } from 'express'
import { z } from 'zod'

import { prisma } from '../lib/db'
import { internalServiceGuard } from '../middleware/internal-auth'
import { createDecision, persistCiDecisionResult, requestSchema } from './ci'

const router = Router()

const queueDispatchSchema = z.object({
  job: z.object({
    id: z.string().min(1),
    queueName: z.string().min(1),
    scheduledFor: z.string().optional(),
  }),
  request: requestSchema,
})

const lambdaInvokeSchema = z.object({
  functionName: z.string().min(1),
  awsRegion: z.string().min(1).optional(),
  invocationType: z.enum(['RequestResponse', 'Event']).default('RequestResponse'),
  request: requestSchema,
})

const executionOutcomeSchema = z.object({
  decisionFrameId: z.string().min(1),
  enforcementResult: z.enum(['applied', 'skipped', 'failed']),
  observedRuntimeTarget: z.string().min(1).optional(),
  runtime: z.string().min(1),
  region: z.string().min(1).optional(),
  status: z.enum(['succeeded', 'failed', 'skipped']),
  durationMs: z.number().min(0).optional(),
  traceId: z.string().min(1).optional(),
  message: z.string().optional(),
})

router.get('/spec', (_req, res) => {
  res.json({
    version: 'UniversalAdapterPlaneV1',
    adapters: [
      {
        id: 'ecobe.http.decision.v1',
        runtime: 'http',
        controlPoints: ['gateway_preflight', 'app_middleware', 'orchestrator_pre_dispatch'],
      },
      {
        id: 'ecobe.cloudevents.adapter.v1',
        runtime: 'event',
        controlPoints: ['event_bus', 'workflow_engine', 'scheduler_ingress'],
      },
      {
        id: 'ecobe.queue.adapter.v1',
        runtime: 'queue',
        controlPoints: ['dispatcher', 'consumer_wrapper', 'cron_entrypoint'],
      },
      {
        id: 'ecobe.lambda.adapter.v1',
        runtime: 'lambda',
        controlPoints: ['lambda_wrapper', 'lambda_extension'],
      },
      {
        id: 'ecobe.kubernetes.adapter.v1',
        runtime: 'kubernetes',
        controlPoints: ['admission_controller', 'scheduler_hint', 'operator_metadata'],
      },
      {
        id: 'ecobe.github-actions.adapter.v1',
        runtime: 'github_actions',
        controlPoints: ['pre_job', 'runner_wrapper'],
      },
    ],
  })
})

router.post('/queue/dispatch', async (req, res) => {
  try {
    const payload = queueDispatchSchema.parse(req.body)
    const request = requestSchema.parse({
      ...payload.request,
      requestId: payload.request.requestId ?? payload.job.id,
      idempotencyKey: payload.request.idempotencyKey ?? payload.job.id,
      runtimeTarget: {
        ...(payload.request.runtimeTarget ?? {}),
        runtime: 'queue',
        identifier: payload.job.queueName,
      },
      transport: {
        ...(payload.request.transport ?? {}),
        runtime: 'queue',
        transport: 'queue_dispatch',
        controlPoint: 'dispatcher',
        adapterId: payload.request.transport?.adapterId ?? 'ecobe.queue.adapter.v1',
        observedRuntimeTarget: payload.job.queueName,
      },
      metadata: {
        ...(payload.request.metadata ?? {}),
        queueJob: payload.job,
      },
    })

    const result = await createDecision(request)
    const response = await persistCiDecisionResult(result)

    return res.json({
      job: payload.job,
      dispatch: {
        state:
          response.decision === 'deny'
            ? 'blocked'
            : response.decision === 'delay'
              ? 'deferred'
              : response.decision === 'throttle'
                ? 'throttled'
                : 'dispatch',
        notBefore: response.notBefore,
        selectedRegion: response.selectedRegion,
      },
      decision: response,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid queue dispatch request',
        details: error.errors,
      })
    }

    return res.status(500).json({
      error: 'Failed to process queue dispatch decision',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.post('/lambda/invoke', async (req, res) => {
  try {
    const payload = lambdaInvokeSchema.parse(req.body)
    const request = requestSchema.parse({
      ...payload.request,
      requestId: payload.request.requestId ?? `${payload.functionName}:${Date.now()}`,
      runtimeTarget: {
        ...(payload.request.runtimeTarget ?? {}),
        runtime: 'lambda',
        provider: 'aws',
        identifier: payload.functionName,
        region: payload.awsRegion ?? payload.request.runtimeTarget?.region,
      },
      transport: {
        ...(payload.request.transport ?? {}),
        runtime: 'lambda',
        transport: 'lambda_invoke',
        controlPoint: 'lambda_wrapper',
        adapterId: payload.request.transport?.adapterId ?? 'ecobe.lambda.adapter.v1',
        observedRuntimeTarget: payload.functionName,
      },
      metadata: {
        ...(payload.request.metadata ?? {}),
        lambda: {
          functionName: payload.functionName,
          invocationType: payload.invocationType,
        },
      },
    })

    const result = await createDecision(request)
    const response = await persistCiDecisionResult(result)

    return res.json({
      functionName: payload.functionName,
      invoke: {
        state:
          response.decision === 'deny'
            ? 'blocked'
            : response.decision === 'delay'
              ? 'defer'
              : response.decision === 'throttle'
                ? 'throttle'
                : 'invoke',
        selectedRegion: response.selectedRegion,
        invocationType: payload.invocationType,
        notBefore: response.notBefore,
      },
      decision: response,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid lambda adapter request',
        details: error.errors,
      })
    }

    return res.status(500).json({
      error: 'Failed to process lambda adapter decision',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.post('/execution-outcomes', internalServiceGuard, async (req, res) => {
  try {
    const payload = executionOutcomeSchema.parse(req.body)
    const decision = await prisma.cIDecision.findFirst({
      where: { decisionFrameId: payload.decisionFrameId },
      orderBy: { createdAt: 'desc' },
    })

    if (!decision) {
      return res.status(404).json({
        error: 'Decision not found',
        code: 'DECISION_NOT_FOUND',
      })
    }

    const metadata = (decision.metadata ?? {}) as Record<string, unknown>
    const nextMetadata = {
      ...metadata,
      executionOutcome: {
        enforcementResult: payload.enforcementResult,
        observedRuntimeTarget: payload.observedRuntimeTarget ?? null,
        runtime: payload.runtime,
        region: payload.region ?? null,
        status: payload.status,
        durationMs: payload.durationMs ?? null,
        traceId: payload.traceId ?? null,
        message: payload.message ?? null,
        recordedAt: new Date().toISOString(),
      },
    }

    await prisma.cIDecision.update({
      where: { id: decision.id },
      data: {
        metadata: nextMetadata,
      },
    })

    return res.json({
      decisionFrameId: payload.decisionFrameId,
      recorded: true,
      executionOutcome: nextMetadata.executionOutcome,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid execution outcome payload',
        details: error.errors,
      })
    }

    return res.status(500).json({
      error: 'Failed to record execution outcome',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

export default router
