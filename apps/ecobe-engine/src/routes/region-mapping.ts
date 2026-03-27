import { Router } from 'express'
import { REGION_GRID_MAPPING } from '../services/fingard.service'

const router = Router()

/**
 * GET /api/v1/dashboard/region-mapping
 * Returns region to grid zone mapping
 */
router.get('/', async (req, res) => {
  try {
    const mapping = Object.entries(REGION_GRID_MAPPING).map(([region, info]) => ({
      region,
      gridZone: info.zone,
      country: info.country,
      provider: getPrimaryProvider(info.country)
    }))

    res.json({ regions: mapping })
  } catch (error: any) {
    console.error('Region mapping error:', error)
    res.status(500).json({ error: 'Internal server error', message: error.message })
  }
})

function getPrimaryProvider(country: string): string {
  switch (country) {
    case 'US':
      return 'watttime'
    case 'GB':
    case 'DK':
    case 'FI':
      return country.toLowerCase()
    case 'IE':
      return 'ember' // Ireland uses Ember as primary
    case 'DE':
    case 'SE':
      return 'ember'
    default:
      return 'ember'
  }
}

export default router
