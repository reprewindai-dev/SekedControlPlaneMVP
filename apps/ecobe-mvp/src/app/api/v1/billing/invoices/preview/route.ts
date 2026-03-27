import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { previewUsageInvoice } from '@/lib/billing'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['billing:read'])
  if (!access.ok) {
    return access.response
  }

  const url = new URL(request.url)
  const organizationSlug = url.searchParams.get('organizationSlug')
  if (!organizationSlug) {
    return badRequest('organizationSlug is required')
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true },
  })

  if (!organization) {
    return badRequest('Organization not found')
  }

  if (!assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  const periodStart = parseDate(url.searchParams.get('periodStart'))
  const periodEnd = parseDate(url.searchParams.get('periodEnd'))

  const preview = await previewUsageInvoice({
    organizationId: organization.id,
    periodStart,
    periodEnd,
  })

  return json(preview)
}

function parseDate(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
