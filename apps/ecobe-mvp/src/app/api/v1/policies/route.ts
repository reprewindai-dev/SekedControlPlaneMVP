import { z } from 'zod'

import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { badRequest, forbidden, json } from '@/lib/http'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  organizationSlug: z.string().min(1),
  projectSlug: z.string().optional(),
  name: z.string().min(1),
  rules: z.record(z.any()),
})

export async function POST(request: Request) {
  const access = await requireScopedAccess(request, ['policies:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid policy payload', parsed.error.flatten())
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: parsed.data.organizationSlug },
  })
  if (!organization) {
    return badRequest('Organization not found')
  }
  if (!assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  const project = parsed.data.projectSlug
    ? await prisma.project.findUnique({
        where: {
          organizationId_slug: {
            organizationId: organization.id,
            slug: parsed.data.projectSlug,
          },
        },
      })
    : null

  const profile = await prisma.policyProfile.create({
    data: {
      organizationId: organization.id,
      projectId: project?.id,
      name: parsed.data.name,
    },
  })

  const version = await prisma.policyVersion.create({
    data: {
      policyProfileId: profile.id,
      version: 1,
      isActive: true,
      rules: parsed.data.rules as any,
    },
  })

  return json({ profileId: profile.id, versionId: version.id }, { status: 201 })
}

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['policies:read'])
  if (!access.ok) {
    return access.response
  }

  const organizationSlug = new URL(request.url).searchParams.get('organizationSlug')
  const organization =
    organizationSlug
      ? await prisma.organization.findUnique({
          where: { slug: organizationSlug },
          select: { id: true },
        })
      : null

  if (organization && !assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  const data = await prisma.policyVersion.findMany({
    where: access.isPlatformAdmin
      ? (organizationSlug ? { policyProfile: { organization: { slug: organizationSlug } } } : undefined)
      : { policyProfile: { organizationId: access.organizationId } },
    orderBy: { createdAt: 'desc' },
    include: {
      policyProfile: true,
    },
  })

  return json({ data })
}
