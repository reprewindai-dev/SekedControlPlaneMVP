import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { getBillingSnapshot } from '@/lib/billing'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['billing:read'])
  if (!access.ok) {
    return access.response
  }

  const organizationSlug = new URL(request.url).searchParams.get('organizationSlug')
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

  const snapshot = await getBillingSnapshot(organization.id)
  return json(snapshot)
}
