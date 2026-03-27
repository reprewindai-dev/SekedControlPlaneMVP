import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['approvals:read'])
  if (!access.ok) {
    return access.response
  }

  const url = new URL(request.url)
  const organizationSlug = url.searchParams.get('organizationSlug')
  const status = url.searchParams.get('status') ?? undefined

  const organization = organizationSlug
    ? await prisma.organization.findUnique({
        where: { slug: organizationSlug },
        select: { id: true },
      })
    : null

  if (organization && !assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  if (!access.isPlatformAdmin && !organization) {
    return badRequest('organizationSlug is required for scoped access')
  }

  const approvals = await prisma.approvalRequest.findMany({
    where: {
      ...(organization ? { organizationId: organization.id } : access.isPlatformAdmin ? {} : { organizationId: access.organizationId }),
      ...(status ? { status: status as any } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      run: {
        select: {
          id: true,
          status: true,
          blockedReason: true,
          createdAt: true,
          updatedAt: true,
          correlationId: true,
        },
      },
    },
  })

  return json({ data: approvals })
}
