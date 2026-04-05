import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { forbidden, json, notFound } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireScopedAccess(request, ['policies:read'])
  if (!access.ok) {
    return access.response
  }

  const { id } = await context.params
  const system = await prisma.pglSystem.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { createdAt: 'desc' },
      },
      lifecycleEvents: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  })

  if (!system) {
    return notFound('System not found')
  }

  if (!assertOrganizationAccess(access, system.organizationId)) {
    return forbidden()
  }

  return json(system)
}
