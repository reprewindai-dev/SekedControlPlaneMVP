import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/db'
import {
  provisionOrganization,
  rotateOrganizationApiKey,
  getOrganizationUsageSummary,
  OrganizationError,
} from '../lib/organizations'
import { env } from '../config/env'

const router = Router()

const adminGuard = (req: any, res: any, next: any) => {
  if (!env.UI_TOKEN) {
    return next()
  }
  const token = req.header('x-ecobe-admin-token')
  if (token !== env.UI_TOKEN) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid admin token',
      },
    })
  }
  return next()
}

const provisionSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  planTier: z.enum(['FREE', 'GROWTH', 'ENTERPRISE']).optional(),
  billingEmail: z.string().email().optional(),
  enforceCreditCoverage: z.boolean().optional(),
  monthlyCommandLimit: z.number().int().positive().optional(),
  featureFlags: z.record(z.any()).optional(),
  proofRetentionDays: z.number().int().positive().max(3650).optional(),
})

router.post('/', adminGuard, async (req, res) => {
  try {
    const payload = provisionSchema.parse(req.body)
    const org = await provisionOrganization(payload)
    return res.status(201).json({ success: true, organization: org })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', details: error.errors } })
    }
    console.error('Provision org error:', error)
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to provision organization' } })
  }
})

router.get('/', adminGuard, async (_req, res) => {
  const orgs = await prisma.organization.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  return res.json({ success: true, organizations: orgs })
})

const rotateSchema = z.object({ orgId: z.string().min(1) })

router.post('/rotate-key', adminGuard, async (req, res) => {
  try {
    const { orgId } = rotateSchema.parse(req.body)
    const org = await rotateOrganizationApiKey(orgId)
    return res.json({ success: true, organization: org })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', details: error.errors } })
    }
    if (error instanceof OrganizationError) {
      return res.status(400).json({ success: false, error: { code: error.code, message: error.message } })
    }
    console.error('Rotate API key error:', error)
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to rotate API key' } })
  }
})

router.get('/:orgId/usage', adminGuard, async (req, res) => {
  try {
    const { orgId } = z.object({ orgId: z.string().min(1) }).parse(req.params)
    const summary = await getOrganizationUsageSummary(orgId)
    const org = await prisma.organization.findUnique({ where: { id: orgId } })
    if (!org) {
      return res.status(404).json({ success: false, error: { code: 'ORG_NOT_FOUND', message: 'Organization not found' } })
    }
    return res.json({ success: true, organization: org, summary })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', details: error.errors } })
    }
    console.error('Org usage error:', error)
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch usage summary' } })
  }
})

export default router
