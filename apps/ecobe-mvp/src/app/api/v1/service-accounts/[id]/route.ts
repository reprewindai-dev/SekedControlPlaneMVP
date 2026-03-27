import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { forbidden, json, notFound } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PATCH(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireScopedAccess(_request, ['keys:write'])
  if (!access.ok) {
    return access.response
  }

  const { id } = await context.params
  const serviceAccount = await prisma.serviceAccount.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      status: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      createdAt: true,
    },
  })

  if (!serviceAccount) {
    return notFound('Service account not found')
  }

  if (!assertOrganizationAccess(access, serviceAccount.organizationId)) {
    return forbidden()
  }

  const updated = serviceAccount.status === 'revoked'
    ? serviceAccount
    : await prisma.serviceAccount.update({
        where: { id },
        data: { status: 'revoked' },
        select: {
          id: true,
          organizationId: true,
          status: true,
          name: true,
          prefix: true,
          scopes: true,
          lastUsedAt: true,
          createdAt: true,
        },
      })

  return json({ data: updated })
}
