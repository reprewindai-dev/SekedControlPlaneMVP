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
    select: {
      id: true,
      organizationId: true,
      name: true,
      genomeId: true,
    },
  })

  if (!system) {
    return notFound('System not found')
  }

  if (!assertOrganizationAccess(access, system.organizationId)) {
    return forbidden()
  }

  const history = await prisma.pglLifecycleEvent.findMany({
    where: { systemId: system.id },
    orderBy: { createdAt: 'asc' },
    include: {
      version: {
        select: {
          id: true,
          versionIdentifier: true,
          parentVersionId: true,
        },
      },
    },
  })

  return json({
    system,
    data: history,
  })
}
