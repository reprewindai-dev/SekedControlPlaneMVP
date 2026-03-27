import { z } from 'zod'

import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { generateAuditExport } from '@/lib/reporting'

export const dynamic = 'force-dynamic'

const createAuditExportSchema = z.object({
  organizationSlug: z.string().min(1),
  runId: z.string().min(1).optional(),
  format: z.enum(['json']).default('json'),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
})

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['audit:read'])
  if (!access.ok) {
    return access.response
  }

  const url = new URL(request.url)
  const organizationSlug = url.searchParams.get('organizationSlug')
  const status = url.searchParams.get('status') ?? undefined

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

  const auditExports = await prisma.auditExport.findMany({
    where: {
      organizationId: organization.id,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })

  return json({ data: auditExports })
}

export async function POST(request: Request) {
  const access = await requireScopedAccess(request, ['audit:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = createAuditExportSchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid audit export payload', parsed.error.flatten())
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

  const auditExport = await generateAuditExport({
    organizationId: organization.id,
    runId: parsed.data.runId,
    format: parsed.data.format,
    periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : undefined,
    periodEnd: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : undefined,
  })

  return json(auditExport, { status: 201 })
}
