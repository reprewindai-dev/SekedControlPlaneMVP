import { Router } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { processDecisionEventOutboxBatch, createTestEventForSink } from '../lib/ci/decision-events'
import { env } from '../config/env'
import { prisma } from '../lib/db'
import { recordTelemetryMetric, telemetryMetricNames } from '../lib/observability/telemetry'
import { internalServiceGuard } from '../middleware/internal-auth'

const router = Router()

/**
 * GET /api/v1/integrations/dekes/summary
 * Returns DEKES integration summary
 */
router.get('/dekes/summary', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const [workloads, prospects, handoffs, recentEvents] = await Promise.all([
      prisma.dekesWorkload.findMany({
        where: { scheduledTime: { gte: since } },
        select: {
          actualCO2: true,
          estimatedQueries: true,
          status: true,
          scheduledTime: true,
        },
      }),
      prisma.dekesProspect.findMany({
        where: { createdAt: { gte: since } },
        select: {
          id: true,
          status: true,
          intentScore: true,
          updatedAt: true,
        },
      }),
      prisma.dekesHandoffEvent.findMany({
        where: { createdAt: { gte: since } },
        select: {
          status: true,
          qualificationScore: true,
          updatedAt: true,
        },
      }),
      prisma.integrationEvent.findMany({
        where: {
          source: 'DEKES_INTEGRATION',
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ])

    const successfulCount = workloads.filter((w: any) => ['REPORTED', 'COMPLETED', 'ROUTED'].includes(w.status)).length
    const totalCO2 = workloads.reduce((sum: number, w: any) => sum + (w.actualCO2 ?? 0), 0)
    const avgCO2 = workloads.length > 0 ? totalCO2 / workloads.length : 0
    const qualifiedProspects = prospects.filter((p: any) => (p.intentScore ?? 0) >= 70).length
    const acceptedHandoffs = handoffs.filter((handoff: any) => handoff.status === 'ACCEPTED').length
    const routedHandoffs = handoffs.filter((handoff: any) => handoff.status === 'ROUTED').length
    const proofedHandoffs = handoffs.filter((handoff: any) => handoff.status === 'PROOFED').length
    const failedHandoffs = handoffs.filter((handoff: any) => handoff.status === 'FAILED').length

    return res.json({
      status: failedHandoffs > 0 ? 'degraded' : 'connected',
      integration: 'DEKES',
      lastSync: new Date().toISOString(),
      metrics: {
        totalProspects: prospects.length,
        qualifiedProspects,
        totalHandoffs: handoffs.length,
        acceptedHandoffs,
        routedHandoffs,
        proofedHandoffs,
        failedHandoffs,
        totalWorkloads: workloads.length,
        successfulWorkloads: successfulCount,
        successRate: workloads.length > 0 ? Math.round((successfulCount / workloads.length) * 100) : 0,
        totalCO2Kg: Math.round(totalCO2 * 1000) / 1000,
        avgCO2PerWorkload: Math.round(avgCO2 * 1000) / 1000,
        timeRange: `${days}d`,
      },
      recentSignals: recentEvents.map((event: any) => ({
        id: event.id,
        type: event.eventType || 'INTEGRATION_EVENT',
        success: event.success,
        timestamp: event.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('DEKES integration summary error:', error)
    res.status(500).json({ error: 'Failed to fetch DEKES summary' })
  }
})

/**
 * GET /api/v1/integrations/dekes/events
 * Returns recent DEKES integration events
 */
router.get('/dekes/events', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const hours = parseInt(req.query.hours as string) || 24
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    const events = await prisma.integrationEvent.findMany({
      where: {
        source: 'DEKES_INTEGRATION',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    const formattedEvents = events.map((event: any) => {
      let message = event.message
      try {
        const parsed = typeof event.message === 'string' ? JSON.parse(event.message) : event.message
        message = parsed
      } catch {
        // Keep as string
      }

      return {
        id: event.id,
        timestamp: event.createdAt.toISOString(),
        type: event.eventType || 'INTEGRATION_EVENT',
        message,
        status: event.success ? 'success' : 'error',
      }
    })

    return res.json({
      source: 'DEKES_INTEGRATION',
      timeRange: `${hours}h`,
      events: formattedEvents,
      total: formattedEvents.length,
    })
  } catch (error) {
    console.error('DEKES integration events error:', error)
    res.status(500).json({ error: 'Failed to fetch DEKES events' })
  }
})

/**
 * GET /api/v1/integrations/dekes/metrics
 * Returns DEKES integration health metrics
 */
router.get('/dekes/metrics', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 168 // 1 week default

    // Get recent events
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    const [successEvents, failureEvents, totalWorkloads] = await Promise.all([
      prisma.integrationEvent.count({
        where: {
          source: 'DEKES_INTEGRATION',
          createdAt: { gte: since },
          success: true,
        },
      }),
      prisma.integrationEvent.count({
        where: {
          source: 'DEKES_INTEGRATION',
          createdAt: { gte: since },
          success: false,
        },
      }),
      prisma.dekesWorkload.count({
        where: { scheduledTime: { gte: since } },
      }),
    ])

    const totalEvents = successEvents + failureEvents
    const successRate = totalEvents > 0 ? Math.round((successEvents / totalEvents) * 100) : 100
    const failureRate = totalEvents > 0 ? Math.round((failureEvents / totalEvents) * 100) : 0

    // Get hourly trend
    const workloads = await prisma.dekesWorkload.findMany({
      where: { scheduledTime: { gte: since } },
      select: { scheduledTime: true, actualCO2: true },
      orderBy: { scheduledTime: 'desc' },
    })

    const hourlyMap = new Map<string, { count: number; co2: number }>()
    for (const w of workloads) {
      const hour = w.scheduledTime.toISOString().split(':')[0] + ':00'
      const existing = hourlyMap.get(hour) || { count: 0, co2: 0 }
      existing.count++
      existing.co2 += w.actualCO2 ?? 0
      hourlyMap.set(hour, existing)
    }

    const hourlyTrend = Array.from(hourlyMap.entries())
      .map(([hour, data]: [string, any]) => ({
        hour,
        requestCount: data.count,
        avgCO2: Math.round((data.co2 / data.count) * 1000) / 1000,
      }))
      .sort((a, b) => a.hour.localeCompare(b.hour))

    // Calculate actual average response time from workload durations
    const completedWorkloads = await prisma.dekesWorkload.findMany({
      where: {
        scheduledTime: { gte: since },
        completedAt: { not: null },
      },
      select: { scheduledTime: true, completedAt: true },
    })

    let avgResponseTimeMs = 0
    if (completedWorkloads.length > 0) {
      const totalMs = completedWorkloads.reduce((sum: number, w: any) => {
        const duration = w.completedAt.getTime() - w.scheduledTime.getTime()
        return sum + Math.max(0, duration)
      }, 0)
      avgResponseTimeMs = Math.round(totalMs / completedWorkloads.length)
    }

    return res.json({
      integration: 'DEKES',
      status: failureRate > 20 ? 'degraded' : 'healthy',
      timeRange: `${hours}h`,
      metrics: {
        successRate,
        failureRate,
        totalEvents,
        totalWorkloads,
        avgResponseTimeMs,
        uptime: failureRate === 0 ? 100 : Math.round((100 - failureRate) * 10) / 10,
      },
      hourlyTrend: hourlyTrend.slice(-24), // Last 24 data points
      lastChecked: new Date().toISOString(),
    })
  } catch (error) {
    console.error('DEKES integration metrics error:', error)
    res.status(500).json({ error: 'Failed to fetch DEKES metrics' })
  }
})

router.get('/dekes/handoffs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const days = parseInt(req.query.days as string) || 30
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const [handoffs, prospects] = await Promise.all([
      prisma.dekesHandoffEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.dekesProspect.findMany({
        where: { createdAt: { gte: since } },
        select: {
          id: true,
          externalLeadId: true,
          orgName: true,
          orgDomain: true,
          orgRegion: true,
          intentScore: true,
          status: true,
        },
      }),
    ])

    const prospectMap = new Map<string, (typeof prospects)[number]>(
      prospects.map((prospect: (typeof prospects)[number]) => [prospect.id, prospect])
    )

    return res.json({
      handoffs: handoffs.map((handoff: any) => {
        const prospect = handoff.prospectId ? prospectMap.get(handoff.prospectId) ?? null : null
        let notes: Record<string, unknown> = {}
        try {
          notes = handoff.notes ? JSON.parse(handoff.notes) : {}
        } catch {
          notes = {}
        }

        return {
          id: handoff.id,
          status: handoff.status,
          qualificationScore: handoff.qualificationScore,
          externalLeadId: handoff.externalLeadId,
          createdAt: handoff.createdAt.toISOString(),
          updatedAt: handoff.updatedAt.toISOString(),
          prospect: prospect
            ? {
                id: prospect.id,
                orgName: prospect.orgName,
                orgDomain: prospect.orgDomain,
                orgRegion: prospect.orgRegion,
                intentScore: prospect.intentScore,
                status: prospect.status,
              }
            : null,
          decisionFrameId: notes.decisionFrameId ?? null,
          proofId: notes.proofId ?? null,
          action: notes.action ?? null,
          reasonCode: notes.reasonCode ?? null,
          selectedRegion: notes.selectedRegion ?? null,
          selectedRunner: notes.selectedRunner ?? null,
          carbonReductionPct: notes.carbonReductionPct ?? null,
          waterImpactDeltaLiters: notes.waterImpactDeltaLiters ?? null,
          latencyMs: notes.latencyMs ?? null,
        }
      }),
      total: handoffs.length,
      timeRange: `${days}d`,
    })
  } catch (error) {
    console.error('DEKES integration handoffs error:', error)
    res.status(500).json({ error: 'Failed to fetch DEKES handoffs' })
  }
})

router.get('/dekes/signals', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const hours = parseInt(req.query.hours as string) || 168
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    const events = await prisma.integrationEvent.findMany({
      where: {
        source: 'DEKES_INTEGRATION',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return res.json({
      signals: events.map((event: any) => ({
        id: event.id,
        type: event.eventType || 'INTEGRATION_EVENT',
        success: event.success,
        timestamp: event.createdAt.toISOString(),
        message: event.message,
      })),
      total: events.length,
      timeRange: `${hours}h`,
    })
  } catch (error) {
    console.error('DEKES integration signals error:', error)
    res.status(500).json({ error: 'Failed to fetch DEKES signals' })
  }
})

const webhookCreateSchema = z.object({
  name: z.string().min(2).max(120),
  targetUrl: z.string().url(),
  authToken: z.string().optional(),
  signingSecret: z.string().min(16).optional(),
  metadata: z.record(z.any()).optional(),
})

const webhookUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'DISABLED']).optional(),
  authToken: z.string().optional(),
  rotateSigningSecret: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
})

router.get('/webhooks', internalServiceGuard, async (_req, res) => {
  const sinks = await prisma.integrationWebhookSink.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return res.json({
    sinks: sinks.map((sink: any) => ({
      id: sink.id,
      name: sink.name,
      targetUrl: sink.targetUrl,
      status: sink.status,
      metadata: sink.metadata,
      createdAt: sink.createdAt,
      updatedAt: sink.updatedAt,
      lastSuccessAt: sink.lastSuccessAt,
      lastFailureAt: sink.lastFailureAt,
      lastResponseCode: sink.lastResponseCode,
      lastError: sink.lastError,
      hasAuthToken: Boolean(sink.authToken),
      hasSigningSecret: Boolean(sink.signingSecret),
    })),
    total: sinks.length,
  })
})

router.post('/webhooks', internalServiceGuard, async (req, res) => {
  try {
    const data = webhookCreateSchema.parse(req.body)
    const signingSecret = data.signingSecret || crypto.randomBytes(24).toString('hex')

    const sink = await prisma.integrationWebhookSink.create({
      data: {
        name: data.name,
        targetUrl: data.targetUrl,
        authToken: data.authToken ?? null,
        signingSecret,
        status: 'ACTIVE',
        metadata: data.metadata ?? {},
      },
    })

    return res.status(201).json({
      id: sink.id,
      name: sink.name,
      targetUrl: sink.targetUrl,
      status: sink.status,
      signingSecret,
      createdAt: sink.createdAt,
    })
  } catch (error) {
    return res.status(400).json({
      error: 'Invalid webhook sink payload',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.patch('/webhooks/:id', internalServiceGuard, async (req, res) => {
  try {
    const data = webhookUpdateSchema.parse(req.body)
    const updates: Record<string, unknown> = {}

    if (data.status) updates.status = data.status
    if (data.authToken !== undefined) updates.authToken = data.authToken || null
    if (data.metadata) updates.metadata = data.metadata
    if (data.rotateSigningSecret) {
      updates.signingSecret = crypto.randomBytes(24).toString('hex')
    }

    const sink = await prisma.integrationWebhookSink.update({
      where: { id: req.params.id },
      data: updates,
    })

    return res.json({
      id: sink.id,
      name: sink.name,
      targetUrl: sink.targetUrl,
      status: sink.status,
      rotatedSigningSecret: data.rotateSigningSecret ? sink.signingSecret : undefined,
      updatedAt: sink.updatedAt,
    })
  } catch (error) {
    return res.status(400).json({
      error: 'Failed to update webhook sink',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.post('/webhooks/:id/test', internalServiceGuard, async (req, res) => {
  try {
    const test = await createTestEventForSink(req.params.id)
    return res.json({
      status: 'queued',
      ...test,
    })
  } catch (error) {
    return res.status(404).json({
      error: 'Webhook sink test enqueue failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.get('/events/outbox', internalServiceGuard, async (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50)))
  const items = await prisma.decisionEventOutbox.findMany({
    include: { sink: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return res.json({
    items: items.map((item: any) => ({
      id: item.id,
      eventType: item.eventType,
      eventKey: item.eventKey,
      status: item.status,
      attemptCount: item.attemptCount,
      nextAttemptAt: item.nextAttemptAt,
      lastResponseCode: item.lastResponseCode,
      lastError: item.lastError,
      sink: item.sink
        ? {
            id: item.sink.id,
            name: item.sink.name,
            status: item.sink.status,
            targetUrl: item.sink.targetUrl,
          }
        : null,
      createdAt: item.createdAt,
      processedAt: item.processedAt,
    })),
    total: items.length,
  })
})

router.get('/events/outbox/metrics', internalServiceGuard, async (_req, res) => {
  const [pendingCount, processingCount, failedCount, deadLetterCount, sentCount, oldestUnprocessed] =
    await Promise.all([
      prisma.decisionEventOutbox.count({
        where: { status: 'PENDING' },
      }),
      prisma.decisionEventOutbox.count({
        where: { status: 'PROCESSING' },
      }),
      prisma.decisionEventOutbox.count({
        where: { status: 'FAILED' },
      }),
      prisma.decisionEventOutbox.count({
        where: { status: 'DEAD_LETTER' },
      }),
      prisma.decisionEventOutbox.count({
        where: { status: 'SENT' },
      }),
      prisma.decisionEventOutbox.findFirst({
        where: { status: { in: ['PENDING', 'FAILED'] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ])

  const lagMinutes = oldestUnprocessed
    ? (Date.now() - oldestUnprocessed.createdAt.getTime()) / 60000
    : 0
  const processedTotal = sentCount + failedCount + deadLetterCount
  const failureRatePct = processedTotal > 0 ? ((failedCount + deadLetterCount) / processedTotal) * 100 : 0

  const alerts = {
    lagBreached: lagMinutes > env.DECISION_EVENT_ALERT_LAG_MINUTES,
    failureRateBreached: failureRatePct > env.DECISION_EVENT_ALERT_FAILURE_RATE_PCT,
    deadLetterBreached: deadLetterCount > env.DECISION_EVENT_ALERT_DEADLETTER_COUNT,
  }
  recordTelemetryMetric(telemetryMetricNames.outboxLagSeconds, 'gauge', lagMinutes * 60, {
    pending: pendingCount,
    failed: failedCount,
    dead_letter: deadLetterCount,
  })

  res.json({
    generatedAt: new Date().toISOString(),
    counts: {
      pending: pendingCount,
      processing: processingCount,
      failed: failedCount,
      deadLetter: deadLetterCount,
      sent: sentCount,
    },
    lagMinutes: Number(lagMinutes.toFixed(3)),
    failureRatePct: Number(failureRatePct.toFixed(3)),
    thresholds: {
      lagMinutes: env.DECISION_EVENT_ALERT_LAG_MINUTES,
      failureRatePct: env.DECISION_EVENT_ALERT_FAILURE_RATE_PCT,
      deadLetterCount: env.DECISION_EVENT_ALERT_DEADLETTER_COUNT,
    },
    alerts,
    alertActive: alerts.lagBreached || alerts.failureRateBreached || alerts.deadLetterBreached,
  })
})

router.post('/events/outbox/:id/requeue', internalServiceGuard, async (req, res) => {
  try {
    const updated = await prisma.decisionEventOutbox.update({
      where: { id: req.params.id },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        lastResponseCode: null,
        processedAt: null,
      },
    })
    return res.json({
      status: 'requeued',
      id: updated.id,
      eventKey: updated.eventKey,
      nextAttemptAt: updated.nextAttemptAt,
    })
  } catch (error) {
    return res.status(404).json({
      error: 'Outbox record not found',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.post('/events/dispatch', internalServiceGuard, async (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.body?.limit ?? 50)))
  const result = await processDecisionEventOutboxBatch(limit)
  return res.json({
    status: 'ok',
    ...result,
  })
})

export default router
