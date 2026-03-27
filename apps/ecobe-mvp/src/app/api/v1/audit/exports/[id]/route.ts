import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { forbidden, json, notFound } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireScopedAccess(request, ['audit:read'])
  if (!access.ok) {
    return access.response
  }

  const { id } = await context.params
  const auditExport = await prisma.auditExport.findUnique({
    where: { id },
  })

  if (!auditExport) {
    return notFound('Audit export not found')
  }

  if (!assertOrganizationAccess(access, auditExport.organizationId)) {
    return forbidden()
  }

  return json(auditExport)
}
