import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/db'

const router = Router()

const decisionSchema = z
  .object({
    ts: z.string().datetime().optional(),
    createdAt: z.string().datetime().optional(),

    workspace_id: z.string().optional(),
    operation: z.string().optional(),

    workloadName: z.string().optional(),
    opName: z.string().optional(),

    baseline_region: z.string().optional(),
    chosen_region: z.string().optional(),

    baselineRegion: z.string().optional(),
    chosenRegion: z.string().optional(),

    zone_baseline: z.string().optional(),
    zone_chosen: z.string().optional(),

    zoneBaseline: z.string().optional(),
    zoneChosen: z.string().optional(),

    request_count: z.number().int().nonnegative().optional(),
    requestCount: z.number().int().nonnegative().optional(),

    ci_baseline_g_per_kwh: z.number().int().nonnegative().optional(),
    ci_chosen_g_per_kwh: z.number().int().nonnegative().optional(),

    carbonIntensityBaselineGPerKwh: z.number().int().nonnegative().optional(),
    carbonIntensityChosenGPerKwh: z.number().int().nonnegative().optional(),

    energy_kwh: z.number().nonnegative().optional(),
    estimatedKwh: z.number().nonnegative().optional(),

    co2_baseline_kg: z.number().nonnegative().optional(),
    co2_chosen_kg: z.number().nonnegative().optional(),

    co2BaselineG: z.number().nonnegative().optional(),
    co2ChosenG: z.number().nonnegative().optional(),

    reason: z.string().optional(),

    latency_estimate_ms: z.number().int().nonnegative().optional(),
    latency_actual_ms: z.number().int().nonnegative().optional(),

    latencyEstimateMs: z.number().int().nonnegative().optional(),
    latencyActualMs: z.number().int().nonnegative().optional(),

    fallback: z.boolean().optional(),
    fallbackUsed: z.boolean().optional(),

    data_freshness_seconds: z.number().int().nonnegative().optional(),
    dataFreshnessSeconds: z.number().int().nonnegative().optional(),

    // Grid signal fields
    balancingAuthority: z.string().optional(),
    demandRampPct: z.number().optional(),
    carbonSpikeProbability: z.number().optional(),
    curtailmentProbability: z.number().optional(),
    importCarbonLeakageScore: z.number().optional(),

    // Provenance fields
    sourceUsed: z.string().optional(),
    validationSource: z.string().optional(),
    referenceTime: z.string().datetime().optional(),
    disagreementFlag: z.boolean().optional(),
    disagreementPct: z.number().optional(),
    estimatedFlag: z.boolean().optional(),
    syntheticFlag: z.boolean().optional(),

    meta: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    const baselineRegion = value.baselineRegion ?? value.baseline_region
    const chosenRegion = value.chosenRegion ?? value.chosen_region

    if (!baselineRegion || !chosenRegion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'baselineRegion/chosenRegion are required',
      })
    }
  })

router.post('/', async (req, res) => {
  try {
    const value = decisionSchema.parse(req.body)

    const baselineRegion: string = (value.baselineRegion ?? value.baseline_region) as string
    const chosenRegion: string = (value.chosenRegion ?? value.chosen_region) as string

    const workloadName = (value.workloadName ?? value.workspace_id ?? null) || null
    const opName = (value.opName ?? value.operation ?? null) || null

    const zoneBaseline = (value.zoneBaseline ?? value.zone_baseline ?? null) || null
    const zoneChosen = (value.zoneChosen ?? value.zone_chosen ?? null) || null

    const requestCount = value.requestCount ?? value.request_count ?? 1

    const carbonIntensityBaselineGPerKwh =
      value.carbonIntensityBaselineGPerKwh ?? value.ci_baseline_g_per_kwh ?? null
    const carbonIntensityChosenGPerKwh = value.carbonIntensityChosenGPerKwh ?? value.ci_chosen_g_per_kwh ?? null

    const estimatedKwh = value.estimatedKwh ?? value.energy_kwh ?? null

    const co2BaselineG =
      value.co2BaselineG ?? (typeof value.co2_baseline_kg === 'number' ? value.co2_baseline_kg * 1000 : null) ?? null
    const co2ChosenG =
      value.co2ChosenG ?? (typeof value.co2_chosen_kg === 'number' ? value.co2_chosen_kg * 1000 : null) ?? null

    const latencyEstimateMs = value.latencyEstimateMs ?? value.latency_estimate_ms ?? null
    const latencyActualMs = value.latencyActualMs ?? value.latency_actual_ms ?? null

    const fallbackUsed = value.fallbackUsed ?? value.fallback ?? false
    const dataFreshnessSeconds = value.dataFreshnessSeconds ?? value.data_freshness_seconds ?? null

    const createdAtStr = value.ts ?? value.createdAt
    const createdAt = createdAtStr ? new Date(createdAtStr) : undefined

    const referenceTime = value.referenceTime ? new Date(value.referenceTime) : undefined

    const created = await prisma.dashboardRoutingDecision.create({
      data: {
        createdAt,
        workloadName,
        opName,
        baselineRegion,
        chosenRegion,
        zoneBaseline,
        zoneChosen,
        carbonIntensityBaselineGPerKwh,
        carbonIntensityChosenGPerKwh,
        estimatedKwh,
        co2BaselineG,
        co2ChosenG,
        reason: value.reason ?? null,
        latencyEstimateMs,
        latencyActualMs,
        fallbackUsed,
        dataFreshnessSeconds,
        requestCount,
        // Grid signal fields
        balancingAuthority: value.balancingAuthority ?? null,
        demandRampPct: value.demandRampPct ?? null,
        carbonSpikeProbability: value.carbonSpikeProbability ?? null,
        curtailmentProbability: value.curtailmentProbability ?? null,
        importCarbonLeakageScore: value.importCarbonLeakageScore ?? null,
        // Provenance fields
        sourceUsed: value.sourceUsed ?? null,
        validationSource: value.validationSource ?? null,
        referenceTime,
        disagreementFlag: value.disagreementFlag ?? null,
        disagreementPct: value.disagreementPct ?? null,
        estimatedFlag: value.estimatedFlag ?? null,
        syntheticFlag: value.syntheticFlag ?? null,
        meta: (value.meta ?? {}) as any,
      },
      select: { id: true },
    })

    return res.status(201).json({ ok: true, id: created.id })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('Decision ingest error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
