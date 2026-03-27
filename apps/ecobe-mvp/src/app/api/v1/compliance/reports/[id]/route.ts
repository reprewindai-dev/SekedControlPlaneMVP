import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { forbidden, json, notFound } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireScopedAccess(request, ['compliance:read'])
  if (!access.ok) {
    return access.response
  }

  const { id } = await context.params
  const report = await prisma.complianceReport.findUnique({
    where: { id },
  })

  if (!report) {
    return notFound('Compliance report not found')
  }

  if (!assertOrganizationAccess(access, report.organizationId)) {
    return forbidden()
  }

  return json(report)
}
