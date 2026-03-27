import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/db'

const router = Router()

const purchaseCreditSchema = z.object({
  organizationId: z.string().optional(),
  amountCO2: z.number().positive(),
  provider: z.string(),
  priceUsd: z.number().positive(),
  certificateUrl: z.string().url().optional(),
})

const retireCreditSchema = z.object({
  creditIds: z.array(z.string()).min(1),
  organizationId: z.string().optional(),
  reason: z.string().optional(),
  workloadRequestId: z.string().optional(),
})

// Purchase carbon credits
router.post('/purchase', async (req, res) => {
  try {
    const data = purchaseCreditSchema.parse(req.body)

    const credit = await prisma.carbonCredit.create({
      data: {
        organizationId: data.organizationId,
        amountCO2: data.amountCO2,
        provider: data.provider,
        priceUsd: data.priceUsd,
        certificateUrl: data.certificateUrl,
        status: 'ACTIVE',
        purchasedAt: new Date(),
      },
    })

    res.json(credit)
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('Purchase credit error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Retire carbon credits
router.post('/retire', async (req, res) => {
  try {
    const data = retireCreditSchema.parse(req.body)

    // Update credits to retired status
    const updated = await prisma.carbonCredit.updateMany({
      where: {
        id: { in: data.creditIds },
        status: 'ACTIVE',
      },
      data: {
        status: 'RETIRED',
        retiredAt: new Date(),
      },
    })

    if (updated.count === 0) {
      return res.status(404).json({ error: 'No active credits found with provided IDs' })
    }

    // Log emission offset
    const credits = await prisma.carbonCredit.findMany({
      where: { id: { in: data.creditIds } },
    })

    const totalOffsetCO2 = credits.reduce((sum: number, c: any) => sum + c.amountCO2, 0)

    await prisma.emissionLog.create({
      data: {
        organizationId: data.organizationId,
        workloadRequestId: data.workloadRequestId,
        emissionCO2: -totalOffsetCO2, // Negative for offset
        offsetCO2: totalOffsetCO2,
        region: 'OFFSET',
        source: 'CARBON_CREDIT',
        timestamp: new Date(),
      },
    })

    res.json({
      success: true,
      creditsRetired: updated.count,
      totalOffsetCO2,
      message: 'Credits retired successfully',
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors })
    }
    console.error('Retire credit error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// List carbon credits
router.get('/', async (req, res) => {
  try {
    const { organizationId, status, provider } = req.query

    const where: any = {}

    if (organizationId) {
      where.organizationId = organizationId as string
    }

    if (status) {
      where.status = status as string
    }

    if (provider) {
      where.provider = provider as string
    }

    const credits = await prisma.carbonCredit.findMany({
      where,
      orderBy: { purchasedAt: 'desc' },
      take: 100,
    })

    const totalActive = credits
      .filter((c: any) => c.status === 'ACTIVE')
      .reduce((sum: number, c: any) => sum + c.amountCO2, 0)

    const totalRetired = credits
      .filter((c: any) => c.status === 'RETIRED')
      .reduce((sum: number, c: any) => sum + c.amountCO2, 0)

    res.json({
      credits,
      summary: {
        totalCredits: credits.length,
        totalActiveCO2: totalActive,
        totalRetiredCO2: totalRetired,
        totalPurchased: credits.reduce((sum: number, c: any) => sum + c.priceUsd, 0),
      },
    })
  } catch (error) {
    console.error('List credits error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get carbon balance for organization
router.get('/balance/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params

    // Get active credits
    const activeCredits = await prisma.carbonCredit.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
      },
    })

    const availableCO2 = activeCredits.reduce((sum: number, c: any) => sum + c.amountCO2, 0)

    // Get total emissions
    const emissions = await prisma.emissionLog.findMany({
      where: { organizationId },
    })

    const totalEmissions = emissions
      .filter((e: any) => e.emissionCO2 > 0)
      .reduce((sum: number, e: any) => sum + e.emissionCO2, 0)

    const totalOffset = emissions
      .filter((e: any) => e.offsetCO2 > 0)
      .reduce((sum: number, e: any) => sum + e.offsetCO2, 0)

    const netEmissions = totalEmissions - totalOffset

    res.json({
      organizationId,
      availableCO2,
      totalEmissions,
      totalOffset,
      netEmissions,
      offsetPercentage: totalEmissions > 0 ? (totalOffset / totalEmissions) * 100 : 0,
      credits: {
        active: activeCredits.length,
        totalValue: activeCredits.reduce((sum: number, c: any) => sum + c.priceUsd, 0),
      },
    })
  } catch (error) {
    console.error('Balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Auto-retire credits to offset emissions
router.post('/auto-offset', async (req, res) => {
  try {
    const { organizationId, targetOffsetPercentage = 100 } = req.body

    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId is required' })
    }

    // Calculate emissions needing offset
    const emissions = await prisma.emissionLog.findMany({
      where: { organizationId },
    })

    const totalEmissions = emissions
      .filter((e: any) => e.emissionCO2 > 0)
      .reduce((sum: number, e: any) => sum + e.emissionCO2, 0)

    const totalOffset = emissions
      .filter((e: any) => e.offsetCO2 > 0)
      .reduce((sum: number, e: any) => sum + e.offsetCO2, 0)

    const targetOffset = (totalEmissions * targetOffsetPercentage) / 100
    const neededOffset = targetOffset - totalOffset

    if (neededOffset <= 0) {
      return res.json({
        success: true,
        message: 'Already at or above target offset percentage',
        currentOffsetPercentage: (totalOffset / totalEmissions) * 100,
      })
    }

    // Get active credits
    const activeCredits = await prisma.carbonCredit.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
      },
      orderBy: { purchasedAt: 'asc' }, // FIFO
    })

    const availableCO2 = activeCredits.reduce((sum: number, c: any) => sum + c.amountCO2, 0)

    if (availableCO2 < neededOffset) {
      return res.status(400).json({
        error: 'Insufficient credits',
        needed: neededOffset,
        available: availableCO2,
        shortfall: neededOffset - availableCO2,
      })
    }

    // Retire credits until offset target met
    let offsetAccumulated = 0
    const creditsToRetire: string[] = []

    for (const credit of activeCredits) {
      if (offsetAccumulated >= neededOffset) break
      creditsToRetire.push(credit.id)
      offsetAccumulated += credit.amountCO2
    }

    // Retire selected credits
    await prisma.carbonCredit.updateMany({
      where: { id: { in: creditsToRetire } },
      data: {
        status: 'RETIRED',
        retiredAt: new Date(),
      },
    })

    // Log offset
    await prisma.emissionLog.create({
      data: {
        organizationId,
        emissionCO2: -offsetAccumulated,
        offsetCO2: offsetAccumulated,
        region: 'OFFSET',
        source: 'AUTO_OFFSET',
        timestamp: new Date(),
      },
    })

    res.json({
      success: true,
      creditsRetired: creditsToRetire.length,
      totalOffsetCO2: offsetAccumulated,
      newOffsetPercentage: ((totalOffset + offsetAccumulated) / totalEmissions) * 100,
      message: 'Credits auto-retired successfully',
    })
  } catch (error) {
    console.error('Auto-offset error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
