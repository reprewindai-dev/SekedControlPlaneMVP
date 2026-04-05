import { z } from 'zod'

import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { badRequest, forbidden, json, notFound } from '@/lib/http'
import { appendPglLifecycleEvent } from '@/lib/pgl'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  eventType: z.string().min(1),
  payload: z.record(z.unknown()),
  runId: z.string().min(1).optional(),
  versionId: z.string().min(1).optional(),
  versionIdentifier: z.string().min(1).optional(),
})

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireScopedAccess(request, ['policies:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid lifecycle event payload', parsed.error.flatten())
  }

  const { id } = await context.params
  const system = await prisma.pglSystem.findUnique({
    where: { id },
    select: { id: true, organizationId: true },
  })

  if (!system) {
    return notFound('System not found')
  }

  if (!assertOrganizationAccess(access, system.organizationId)) {
    return forbidden()
  }

  let resolvedVersionId = parsed.data.versionId ?? null
  if (!resolvedVersionId && parsed.data.versionIdentifier) {
    const version = await prisma.pglVersion.findUnique({
      where: {
        systemId_versionIdentifier: {
          systemId: system.id,
          versionIdentifier: parsed.data.versionIdentifier,
        },
      },
      select: { id: true },
    })

    if (!version) {
      return badRequest('Version not found for versionIdentifier')
    }

    resolvedVersionId = version.id
  }

  const event = await appendPglLifecycleEvent({
    organizationId: system.organizationId,
    systemId: system.id,
    runId: parsed.data.runId ?? null,
    versionId: resolvedVersionId,
    eventType: parsed.data.eventType,
    payload: parsed.data.payload,
  })

  return json(event, { status: 201 })
}
