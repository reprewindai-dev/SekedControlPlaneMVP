import { Router } from 'express'
import { prisma } from '../lib/db'

const router = Router()

/**
 * GET /api/v1/patterns/weekly
 * Returns weekly pattern data for carbon intensity
 */
router.get('/weekly', async (req, res) => {
  try {
    const region = req.query.region as string
    const days = 7

    // Generate mock weekly pattern data
    const weeklyData = []
    const now = new Date()
    
    for (let i = 0; i < days; i++) {
      const date = new Date(now)
      date.setDate(date.getDate() - (days - i - 1))
      
      // Generate hourly patterns for the day
      const hourlyData = []
      for (let hour = 0; hour < 24; hour++) {
        // Base carbon intensity with daily/weekly patterns
        let baseIntensity = 150
        
        // Morning peak (7-9am) and evening peak (5-8pm)
        if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20)) {
          baseIntensity += 50
        }
        // Overnight dip (11pm-5am)
        else if (hour >= 23 || hour <= 5) {
          baseIntensity -= 30
        }
        
        // Weekend patterns (lower overall)
        const dayOfWeek = date.getDay()
        if (dayOfWeek === 0 || dayOfWeek === 6) { // Saturday/Sunday
          baseIntensity -= 20
        }
        
        // Add variation
        const variation = Math.random() * 40 - 20
        const carbonIntensity = Math.round(baseIntensity + variation)
        
        hourlyData.push({
          hour,
          carbonIntensity,
          timestamp: new Date(date.setHours(hour, 0, 0, 0)).toISOString()
        })
      }
      
      weeklyData.push({
        date: date.toISOString().split('T')[0],
        dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()],
        hourlyData,
        avgIntensity: Math.round(hourlyData.reduce((sum, h) => sum + h.carbonIntensity, 0) / 24),
        minIntensity: Math.min(...hourlyData.map(h => h.carbonIntensity)),
        maxIntensity: Math.max(...hourlyData.map(h => h.carbonIntensity))
      })
    }

    // Get actual routing decisions for the period if available
    const decisions = await prisma.dashboardRoutingDecision.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        }
      },
      select: {
        createdAt: true,
        chosenRegion: true,
        carbonIntensityChosenGPerKwh: true,
        fallbackUsed: true
      },
      orderBy: { createdAt: 'asc' }
    })

    const patterns = {
      region: region || 'all',
      period: `${days} days`,
      weeklyData,
      routingDecisions: decisions.map((d: any) => ({
        timestamp: d.createdAt.toISOString(),
        region: d.chosenRegion,
        carbonIntensity: d.carbonIntensityChosenGPerKwh,
        degraded: d.fallbackUsed
      })),
      summary: {
        avgCarbonIntensity: weeklyData.reduce((sum: number, day: any) => sum + day.avgIntensity, 0) / days,
        bestDay: weeklyData.reduce((best: any, day: any) => day.avgIntensity < best.avgIntensity ? day : best),
        worstDay: weeklyData.reduce((worst: any, day: any) => day.avgIntensity > worst.avgIntensity ? day : worst),
        totalRoutings: decisions.length,
        degradedRoutings: decisions.filter((d: any) => d.fallbackUsed).length
      }
    }

    res.json(patterns)
  } catch (error: any) {
    console.error('Patterns error:', error)
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

export default router
