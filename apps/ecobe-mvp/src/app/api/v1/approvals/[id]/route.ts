import { z } from 'zod'

import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { approveRun, rejectRun } from '@/lib/run-orchestrator'
import { badRequest, forbidden, json, notFound } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().min(1).optional(),
})

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireScopedAccess(request, ['approvals:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid approval action payload', parsed.error.flatten())
  }

  const { id } = await context.params
  const approvalRequest = await prisma.approvalRequest.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
    },
  })

  if (!approvalRequest) {
    return notFound('Approval request not found')
  }

  if (!assertOrganizationAccess(access, approvalRequest.organizationId)) {
    return forbidden()
  }

  const actor = access.isPlatformAdmin
    ? { type: 'admin' as const, id: 'platform-admin' }
    : { type: 'service_account' as const, id: access.serviceAccountId }

  if (parsed.data.action === 'approve') {
    const result = await approveRun(id, actor)
    return json({ status: 'approved', result })
  }

  const result = await rejectRun(id, actor, parsed.data.reason)
  return json({ status: 'rejected', result })
}
