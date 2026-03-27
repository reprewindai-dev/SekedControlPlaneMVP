import { Router } from 'express'
import { z } from 'zod'
import { calculateEnergyEquation } from '../lib/energy-equation'
import { prisma } from '../lib/db'

const router = Router()

const energyRequestSchema = z.object({
  requestVolume: z.number().positive(),
  workloadType: z.enum(['inference', 'training', 'batch']),
  modelSize: z.string().optional(),
  regionTargets: z.array(z.string()).min(1),
  carbonBudget: z.number().positive().optional(),
  deadlineWindow: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }).optional(),
  hardwareMix: z.object({
    cpu: z.number().min(0).max(1),
    gpu: z.number().min(0).max(1),
    tpu: z.number().min(0).max(1),
  }).optional(),
})

router.post('/equation', async (req, res) => {
  try {
    const data = energyRequestSchema.parse(req.body)

    const result = await calculateEnergyEquation(data)

    // Log workload request
    await prisma.workloadRequest.create({
      data: {
        requestVolume: data.requestVolume,
        workloadType: data.workloadType,
        modelSize: data.modelSize,
        regionTargets: data.regionTargets,
        carbonBudget: data.carbonBudget,
        deadlineStart: data.deadlineWindow ? new Date(data.deadlineWindow.start) : null,
        deadlineEnd: data.deadlineWindow ? new Date(data.deadlineWindow.end) : null,
        hardwareCpu: data.hardwareMix?.cpu,
        hardwareGpu: data.hardwareMix?.gpu,
        hardwareTpu: data.hardwareMix?.tpu,
        selectedRegion: result.routingRecommendation[0].region,
        estimatedCO2: result.totalEstimatedCO2,
        status: 'ROUTED',
      },
    })

    res.json(result)
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('Energy equation error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
