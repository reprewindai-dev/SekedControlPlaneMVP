import { z } from 'zod'

import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { badRequest, forbidden, json } from '@/lib/http'
import { ensurePglSystemAndVersion, appendPglLifecycleEvent } from '@/lib/pgl'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  organizationSlug: z.string().min(1).optional(),
  genomeId: z.string().min(1),
  name: z.string().min(1),
  owner: z.string().min(1),
  modelType: z.string().min(1),
  versionIdentifier: z.string().min(1).default('v1'),
  parentVersionId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  versionMetadata: z.record(z.unknown()).optional(),
})

export async function POST(request: Request) {
  const access = await requireScopedAccess(request, ['policies:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid systems payload', parsed.error.flatten())
  }

  const organization = parsed.data.organizationSlug
    ? await prisma.organization.findUnique({
        where: { slug: parsed.data.organizationSlug },
        select: { id: true, slug: true },
      })
    : access.isPlatformAdmin
      ? null
      : await prisma.organization.findUnique({
          where: { id: access.organizationId },
          select: { id: true, slug: true },
        })

  if (!organization && !access.isPlatformAdmin) {
    return badRequest('Organization not found')
  }

  if (organization && !assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  if (access.isPlatformAdmin && !organization) {
    return badRequest('organizationSlug is required for platform admin requests')
  }

  const organizationId = organization?.id ?? access.organizationId
  if (!organizationId) {
    return badRequest('Unable to resolve organization scope')
  }

  const { system, version } = await ensurePglSystemAndVersion({
    organizationId,
    genomeId: parsed.data.genomeId,
    name: parsed.data.name,
    owner: parsed.data.owner,
    modelType: parsed.data.modelType,
    versionIdentifier: parsed.data.versionIdentifier,
    parentVersionId: parsed.data.parentVersionId ?? null,
    metadata: parsed.data.metadata,
    versionMetadata: parsed.data.versionMetadata,
  })

  await appendPglLifecycleEvent({
    organizationId,
    systemId: system.id,
    versionId: version.id,
    eventType: 'system.registered',
    payload: {
      source: 'api',
      modelType: system.modelType,
      genomeId: system.genomeId,
      versionIdentifier: version.versionIdentifier,
      actor: access.isPlatformAdmin ? { type: 'admin', id: 'platform-admin' } : { type: 'service_account', id: access.serviceAccountId },
    },
  })

  return json(
    {
      id: system.id,
      organizationId: system.organizationId,
      genomeId: system.genomeId,
      name: system.name,
      owner: system.owner,
      modelType: system.modelType,
      metadata: system.metadata,
      version: {
        id: version.id,
        versionIdentifier: version.versionIdentifier,
        parentVersionId: version.parentVersionId,
        metadata: version.metadata,
      },
      createdAt: system.createdAt,
      updatedAt: system.updatedAt,
    },
    { status: 201 },
  )
}
