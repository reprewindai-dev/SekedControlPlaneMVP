import { z } from 'zod'

import { assertOrganizationAccess, generateApiKey, requireScopedAccess } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { badRequest, forbidden, json } from '@/lib/http'
import { ensureTenantScope } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  organizationName: z.string().min(1),
  organizationSlug: z.string().min(1),
  projectName: z.string().min(1),
  projectSlug: z.string().min(1),
  keyName: z.string().min(1),
  scopes: z.array(z.string()).default(['runs:write', 'runs:read']),
})

export async function POST(request: Request) {
  const access = await requireScopedAccess(request, ['keys:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid key request', parsed.error.flatten())
  }

  const { organizationName, organizationSlug, projectName, projectSlug, keyName, scopes } = parsed.data
  const scope = access
  const tenant = scope.isPlatformAdmin
    ? await ensureTenantScope({
        organizationName,
        organizationSlug,
        projectName,
        projectSlug,
      })
    : await resolveScopedProject(scope.organizationId, organizationSlug, projectSlug)

  if (!tenant) {
    return badRequest('Organization or project not found for service account scope')
  }

  if (!assertOrganizationAccess(scope, tenant.organization.id)) {
    return forbidden()
  }

  const generated = generateApiKey()

  const apiKey = await prisma.apiKey.create({
    data: {
      organizationId: tenant.organization.id,
      projectId: tenant.project.id,
      name: keyName,
      prefix: generated.prefix,
      keyHash: generated.hash,
      scopes,
    },
  })

  return json({
    id: apiKey.id,
    organizationId: tenant.organization.id,
    projectId: tenant.project.id,
    key: generated.plaintext,
    prefix: apiKey.prefix,
    scopes,
  }, { status: 201 })
}

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['keys:read'])
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

  const keys = await prisma.apiKey.findMany({
    where: access.isPlatformAdmin
      ? (organizationSlug ? { organization: { slug: organizationSlug } } : undefined)
      : { organizationId: access.organizationId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      status: true,
      scopes: true,
      lastUsedAt: true,
      createdAt: true,
      organizationId: true,
      projectId: true,
    },
  })

  return json({ data: keys })
}

async function resolveScopedProject(organizationId: string, organizationSlug: string, projectSlug: string) {
  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true, slug: true, name: true },
  })

  if (!organization || organization.id !== organizationId) {
    return null
  }

  const project = await prisma.project.findUnique({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: projectSlug,
      },
    },
    select: { id: true, slug: true, name: true },
  })

  if (!project) {
    return null
  }

  return { organization, project }
}
