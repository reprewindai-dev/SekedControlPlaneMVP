import { Router } from 'express'
import { z } from 'zod'
import { processCarbonCommand, CarbonCommandError } from '../lib/carbon-command'
import { processCarbonOutcome, CarbonOutcomeError } from '../lib/carbon-outcome'
import { prisma } from '../lib/db'
import { OrganizationError } from '../lib/organizations'
import { getLeasePolicy } from '../lib/governance'

const router = Router()

const priorityEnum = z.enum(['low', 'medium', 'high']).default('medium')
const executionModeEnum = z.enum(['immediate', 'scheduled', 'advisory']).default('immediate')

const payloadSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  workload: z
    .object({
      type: z.string().min(1, 'workload.type is required'),
      modelFamily: z.string().optional(),
      estimatedGpuHours: z.number().nonnegative().optional(),
      estimatedCpuHours: z.number().nonnegative().optional(),
      estimatedMemoryGb: z.number().positive().optional(),
    })
    .refine((value) => typeof value.estimatedGpuHours === 'number' || typeof value.estimatedCpuHours === 'number', {
      message: 'Provide estimatedGpuHours and/or estimatedCpuHours to produce a decision',
      path: ['estimatedGpuHours'],
    }),
  constraints: z
    .object({
      maxLatencyMs: z.number().positive().optional(),
      deadlineAt: z.string().datetime().optional(),
      mustRunRegions: z.array(z.string()).max(20).optional(),
      excludedRegions: z.array(z.string()).max(20).optional(),
      carbonPriority: priorityEnum.optional(),
      costPriority: priorityEnum.optional(),
      latencyPriority: priorityEnum.optional(),
    })
    .refine((value) => value.maxLatencyMs !== undefined || value.deadlineAt !== undefined, {
      message: 'Provide at least maxLatencyMs or deadlineAt to avoid vague requests',
      path: ['maxLatencyMs'],
    }),
  execution: z
    .object({
      mode: executionModeEnum.optional(),
      candidateStartWindowHours: z.number().int().positive().max(168).optional(),
    })
    .optional(),
  preferences: z
    .object({
      allowTimeShifting: z.boolean().optional(),
      allowCrossRegionExecution: z.boolean().optional(),
      requireCreditCoverage: z.boolean().optional(),
    })
    .optional(),
  metadata: z.record(z.any()).optional(),
})

const measurementSourceEnum = z.enum(['estimated', 'provider-reported', 'metered'])

const outcomeSchema = z.object({
  commandId: z.string().min(1, 'commandId is required'),
  orgId: z.string().min(1, 'orgId is required'),
  execution: z
    .object({
      actualRegion: z.string().min(1, 'execution.actualRegion is required'),
      actualStartAt: z.string().datetime('execution.actualStartAt must be an ISO timestamp'),
      actualEndAt: z.string().datetime().optional(),
      actualLatencyMs: z.number().nonnegative().optional(),
      actualGpuHours: z.number().nonnegative().optional(),
      actualCpuHours: z.number().nonnegative().optional(),
      actualMemoryGb: z.number().nonnegative().optional(),
    })
    .refine((value) => value.actualEndAt || value.actualGpuHours !== undefined || value.actualCpuHours !== undefined, {
      message: 'Provide execution.actualEndAt or actual workload hours to derive duration',
      path: ['actualEndAt'],
    }),
  emissions: z
    .object({
      actualCarbonIntensity: z.number().nonnegative().optional(),
      actualEmissionsKgCo2e: z.number().nonnegative().optional(),
      measurementSource: measurementSourceEnum.optional(),
    })
    .optional(),
  cost: z
    .object({
      actualCostUsd: z.number().nonnegative().optional(),
      costIndexObserved: z.number().nonnegative().optional(),
    })
    .optional(),
  status: z.object({
    completed: z.boolean(),
    slaMet: z.boolean().optional(),
    fallbackTriggered: z.boolean().optional(),
  }),
  metadata: z.record(z.any()).optional(),
})

router.post('/command', async (req, res) => {
  try {
    const payload = payloadSchema.parse(req.body)
    const recommendation = await processCarbonCommand(payload)
    return res.status(201).json({ success: true, ...recommendation })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Request validation failed',
          details: error.errors,
        },
      })
    }

    if (error instanceof CarbonCommandError) {
      const status = error.code === 'NO_ELIGIBLE_CANDIDATES' ? 422 : 400
      return res.status(status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      })
    }

    if (error instanceof OrganizationError) {
      const status = error.code === 'QUOTA_EXCEEDED' ? 429 : error.code === 'ORG_NOT_FOUND' ? 404 : 403
      return res.status(status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      })
    }

    console.error('Carbon command error:', error)
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Internal server error',
      },
    })
  }
})

router.post('/outcome', async (req, res) => {
  try {
    const payload = outcomeSchema.parse(req.body)
    const result = await processCarbonOutcome(payload)
    return res.status(201).json({ success: true, ...result })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Request validation failed',
          details: error.errors,
        },
      })
    }

    if (error instanceof CarbonOutcomeError) {
      let status = 400
      if (error.code === 'COMMAND_NOT_FOUND') status = 404
      if (error.code === 'OUTCOME_ALREADY_EXISTS') status = 409
      return res.status(status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      })
    }

    console.error('Carbon outcome error:', error)
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Internal server error',
      },
    })
  }
})

/**
 * GET /carbon/command/:commandId/replay
 * Replay a carbon-command decision for audit purposes.
 * Returns the full decision with all governance fields.
 */
router.get('/command/:commandId/replay', async (req, res) => {
  try {
    const { commandId } = req.params

    const command = await prisma.carbonCommand.findUnique({
      where: { id: commandId },
      include: {
        trace: true,
        outcomes: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    })

    if (!command) {
      return res.status(404).json({ error: 'Command not found' })
    }

    // Parse trace data
    let traceData: any = {}
    if (command.trace?.traceJson) {
      try {
        traceData = typeof command.trace.traceJson === 'string'
          ? JSON.parse(command.trace.traceJson as string)
          : command.trace.traceJson
      } catch { /* ignore parse errors */ }
    }

    // Parse metadata for additional governance fields
    let metadata: any = {}
    if (command.metadata) {
      try {
        metadata = typeof command.metadata === 'string'
          ? JSON.parse(command.metadata)
          : command.metadata
      } catch { /* ignore */ }
    }

    // Reconstruct governance fields from persisted data
    const confidence = command.confidence ?? 0.5
    const qualityTier = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low'

    const replay = {
      replayedAt: new Date().toISOString(),
      commandId: command.id,
      decisionId: command.decisionId,
      decisionFrameId: command.decisionId ?? command.id,
      orgId: command.orgId,
      createdAt: command.createdAt.toISOString(),

      recommendation: {
        region: command.selectedRegion,
        startAt: command.selectedStartAt?.toISOString() ?? command.createdAt.toISOString(),
        mode: command.executionMode,
        expectedCarbonIntensity: command.expectedCarbonIntensity,
        expectedLatencyMs: command.expectedLatencyMs,
        estimatedEmissionsKgCo2e: command.estimatedEmissionsKgCo2e,
        estimatedSavingsKgCo2e: command.estimatedSavingsKgCo2e,
        confidence,
      },

      governance: {
        qualityTier,
        carbon_delta_g_per_kwh: metadata?.carbonDeltaGPerKwh ?? null,
        forecast_stability: confidence >= 0.75 ? 'stable' : confidence >= 0.45 ? 'medium' : 'unstable',
        provider_disagreement: {
          flag: traceData?.provenance?.disagreementFlag ?? false,
          pct: traceData?.provenance?.disagreementPct ?? 0,
        },
        source_used: traceData?.provenance?.sourceUsed ?? 'carbon_command',
        validation_source: traceData?.provenance?.validationSource ?? null,
        fallback_used: traceData?.provenance?.fallbackUsed ?? false,
        estimatedFlag: metadata?.estimatedFlag ?? false,
        syntheticFlag: metadata?.syntheticFlag ?? false,
        balancingAuthority: (command as any).balancingAuthority ?? null,
        demandRampPct: (command as any).demandRampPct ?? null,
        carbonSpikeProbability: (command as any).carbonSpikeProbability ?? null,
        curtailmentProbability: (command as any).curtailmentProbability ?? null,
        importCarbonLeakageScore: (command as any).importCarbonLeakageScore ?? null,
        // Lease fields reconstructed from quality tier and creation time
        lease_policy: getLeasePolicy(qualityTier as 'high' | 'medium' | 'low'),
        lease_expired: (() => {
          const { leaseMinutes } = getLeasePolicy(qualityTier as 'high' | 'medium' | 'low')
          const leaseEnd = new Date(command.createdAt.getTime() + leaseMinutes * 60 * 1000)
          return new Date() > leaseEnd
        })(),
      },

      summary: {
        reason: command.summaryReason,
        tradeoff: command.tradeoffSummary,
      },

      outcome: command.outcomes?.[0] ? {
        actualRegion: command.outcomes[0].actualRegion,
        actualStartAt: command.outcomes[0].actualStartAt?.toISOString(),
        actualEndAt: command.outcomes[0].actualEndAt?.toISOString(),
        actualCarbonIntensity: command.outcomes[0].actualCarbonIntensity,
        actualEmissionsKgCo2e: command.outcomes[0].actualEmissionsKgCo2e,
        regionMatch: command.outcomes[0].regionMatch,
        predictionQuality: command.outcomes[0].predictionQuality,
      } : null,

      traceData,
    }

    return res.json(replay)
  } catch (error) {
    console.error('Carbon command replay error:', error)
    return res.status(500).json({ error: 'Failed to replay command' })
  }
})

export default router
