import crypto from 'crypto'
import { startOfMonth } from 'date-fns'
import type { Organization, OrgUsageCounter, OrgPlanTier } from '@prisma/client'

import { prisma } from './db'

export type OrganizationErrorCode =
  | 'ORG_NOT_FOUND'
  | 'ORG_SUSPENDED'
  | 'QUOTA_EXCEEDED'
  | 'CREDIT_COVERAGE_REQUIRED'

export class OrganizationError extends Error {
  constructor(public code: OrganizationErrorCode, message: string) {
    super(message)
  }
}

export function usagePeriod(date: Date = new Date()): Date {
  return startOfMonth(date)
}

export async function requireActiveOrganization(orgId: string): Promise<Organization> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } })
  if (!org) {
    throw new OrganizationError('ORG_NOT_FOUND', 'Organization not found for provided orgId.')
  }
  if (org.status !== 'ACTIVE') {
    throw new OrganizationError('ORG_SUSPENDED', 'Organization is not active.')
  }
  return org
}

export async function getOrCreateUsageCounter(orgId: string, periodStart: Date = usagePeriod()): Promise<OrgUsageCounter> {
  return prisma.orgUsageCounter.upsert({
    where: {
      orgId_periodStart: {
        orgId,
        periodStart,
      },
    },
    update: {},
    create: {
      orgId,
      periodStart,
    },
  })
}

export function assertCommandQuota(org: Organization, usage: OrgUsageCounter) {
  if (usage.commandCount >= org.monthlyCommandLimit) {
    // FREE tier: hard block, no overage allowed
    if (org.planTier === 'FREE') {
      throw new OrganizationError(
        'QUOTA_EXCEEDED',
        `Monthly command quota exceeded (${usage.commandCount}/${org.monthlyCommandLimit}). FREE tier does not allow overage. Upgrade to continue.`
      )
    }
    // GROWTH tier: allow 10% grace buffer, then block
    if (org.planTier === 'GROWTH') {
      const graceLimit = Math.ceil(org.monthlyCommandLimit * 1.1)
      if (usage.commandCount >= graceLimit) {
        throw new OrganizationError(
          'QUOTA_EXCEEDED',
          `Monthly command quota exceeded with overage grace (${usage.commandCount}/${graceLimit}). Contact support or upgrade.`
        )
      }
      // Within grace — allow but flag as overage
      console.warn(`[governance] GROWTH org ${org.id} in overage zone: ${usage.commandCount}/${org.monthlyCommandLimit}`)
    }
    // ENTERPRISE tier: unlimited (monthlyCommandLimit is advisory), never hard-block
    // Logged for awareness but not enforced
    if (org.planTier === 'ENTERPRISE') {
      console.info(`[governance] ENTERPRISE org ${org.id} advisory limit reached: ${usage.commandCount}/${org.monthlyCommandLimit}`)
    }
  }
}

export async function incrementOrgUsage(
  orgId: string,
  periodStart: Date,
  delta: {
    commands?: number
    estimatedEmissionsKg?: number
    lastCommandAt?: Date
  }
) {
  // Governance-critical: usage increment must succeed for quota accuracy.
  // Retry up to 3 times with exponential backoff.
  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await prisma.orgUsageCounter.upsert({
        where: {
          orgId_periodStart: {
            orgId,
            periodStart,
          },
        },
        update: {
          commandCount: delta.commands ? { increment: delta.commands } : undefined,
          estimatedEmissionsKg: delta.estimatedEmissionsKg ? { increment: delta.estimatedEmissionsKg } : undefined,
          lastCommandAt: delta.lastCommandAt ?? new Date(),
        },
        create: {
          orgId,
          periodStart,
          commandCount: delta.commands ?? 0,
          estimatedEmissionsKg: delta.estimatedEmissionsKg ?? 0,
          lastCommandAt: delta.lastCommandAt ?? new Date(),
        },
      })
      return // success
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(`[governance] CRITICAL: Usage increment failed after ${MAX_RETRIES} attempts for org ${orgId}:`, err instanceof Error ? err.message : String(err))
        // Do NOT silently swallow — this means quota tracking drifts
        throw err
      }
      const backoffMs = 100 * Math.pow(2, attempt - 1)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
  }
}

export async function getAvailableCreditCoverage(orgId: string): Promise<number> {
  const credits = await prisma.carbonCredit.findMany({
    where: { organizationId: orgId, status: 'ACTIVE' },
    select: { amountCO2: true },
  })
  return credits.reduce((sum: number, credit: any) => sum + (credit.amountCO2 ?? 0), 0)
}

export async function ensureCreditCoverage(orgId: string, requiredAmount: number) {
  const available = await getAvailableCreditCoverage(orgId)
  if (available <= 0 || available < requiredAmount) {
    throw new OrganizationError('CREDIT_COVERAGE_REQUIRED', 'Insufficient carbon credits to cover this workload.')
  }
}

const API_KEY_PREFIX = 'eco_' as const

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50)

const generateApiKey = () => `${API_KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`

async function ensureUniqueSlug(desired: string) {
  let slug = desired
  let counter = 1
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${desired}-${counter++}`
  }
  return slug
}

export async function provisionOrganization(input: {
  name: string
  slug?: string
  planTier?: OrgPlanTier
  billingEmail?: string
  enforceCreditCoverage?: boolean
  monthlyCommandLimit?: number
  featureFlags?: Record<string, unknown>
  proofRetentionDays?: number
}): Promise<Organization> {
  const baseSlug = slugify(input.slug ?? input.name)
  const slug = await ensureUniqueSlug(baseSlug)
  const apiKey = generateApiKey()

  return prisma.organization.create({
    data: {
      name: input.name,
      slug,
      apiKey,
      billingEmail: input.billingEmail,
      planTier: input.planTier ?? 'FREE',
      enforceCreditCoverage: input.enforceCreditCoverage ?? false,
      monthlyCommandLimit: input.monthlyCommandLimit ?? 1000,
      featureFlags: input.featureFlags ?? {},
      proofRetentionDays: input.proofRetentionDays ?? 30,
    },
  })
}

export async function rotateOrganizationApiKey(orgId: string): Promise<Organization> {
  const apiKey = generateApiKey()
  return prisma.organization.update({
    where: { id: orgId },
    data: { apiKey },
  })
}

export async function getOrganizationUsageSummary(orgId: string) {
  const currentPeriod = usagePeriod()
  const usage = await prisma.orgUsageCounter.findMany({
    where: { orgId },
    orderBy: { periodStart: 'desc' },
    take: 12,
  })

  const activeCredits = await prisma.carbonCredit.aggregate({
    _sum: { amountCO2: true },
    where: { organizationId: orgId, status: 'ACTIVE' },
  })

  return {
    currentPeriod,
    usage,
    availableCreditsKg: activeCredits._sum.amountCO2 ?? 0,
  }
}
