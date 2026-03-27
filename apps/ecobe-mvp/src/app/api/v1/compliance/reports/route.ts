import { z } from 'zod'

import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { generateComplianceReport } from '@/lib/reporting'

export const dynamic = 'force-dynamic'

const createComplianceReportSchema = z.object({
  organizationSlug: z.string().min(1),
  reportType: z.enum(['governance_posture', 'run_reliability', 'billing_compliance']).default('governance_posture'),
  framework: z.string().min(1).default('seked_control_plane'),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
})

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['compliance:read'])
  if (!access.ok) {
    return access.response
  }

  const url = new URL(request.url)
  const organizationSlug = url.searchParams.get('organizationSlug')
  const reportType = url.searchParams.get('reportType') ?? undefined

  if (!organizationSlug) {
    return badRequest('organizationSlug is required')
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true },
  })

  if (!organization) {
    return json({ data: [] })
  }

  if (!assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  const reports = await prisma.complianceReport.findMany({
    where: {
      organizationId: organization.id,
      ...(reportType ? { reportType } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })

  return json({ data: reports })
}

export async function POST(request: Request) {
  const access = await requireScopedAccess(request, ['compliance:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = createComplianceReportSchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid compliance report payload', parsed.error.flatten())
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: parsed.data.organizationSlug },
    select: { id: true },
  })

  if (!organization) {
    return badRequest('Organization not found')
  }

  if (!assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  const report = await generateComplianceReport({
    organizationId: organization.id,
    reportType: parsed.data.reportType,
    framework: parsed.data.framework,
    periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : undefined,
    periodEnd: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : undefined,
  })

  return json(report, { status: 201 })
}
