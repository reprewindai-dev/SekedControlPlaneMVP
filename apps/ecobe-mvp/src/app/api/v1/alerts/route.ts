import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['alerts:read'])
  if (!access.ok) {
    return access.response
  }

  const url = new URL(request.url)
  const organizationSlug = url.searchParams.get('organizationSlug')
  const severity = url.searchParams.get('severity') ?? undefined

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

  const alerts = await prisma.alert.findMany({
    where: {
      ...(organization ? { organizationId: organization.id } : access.isPlatformAdmin ? {} : { organizationId: access.organizationId }),
      ...(severity ? { severity } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      run: {
        select: {
          id: true,
          status: true,
          correlationId: true,
        },
      },
    },
  })

  return json({ data: alerts })
}
