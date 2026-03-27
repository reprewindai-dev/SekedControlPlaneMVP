import { z } from 'zod'

import { assertOrganizationAccess, generateServiceAccountKey, requireScopedAccess } from '@/lib/auth'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { ensureOrganizationScope } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  organizationName: z.string().min(1),
  organizationSlug: z.string().min(1),
  serviceAccountName: z.string().min(1),
  scopes: z.array(z.string()).default([
    'runs:read',
    'runs:write',
    'usage:read',
  ]),
  revokeExisting: z.boolean().default(false),
})

export async function POST(request: Request) {
  const access = await requireScopedAccess(request, ['keys:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid service account request', parsed.error.flatten())
  }

  const { organizationName, organizationSlug, serviceAccountName, scopes, revokeExisting } = parsed.data
  const organization = access.isPlatformAdmin
    ? await ensureOrganizationScope({
        organizationName,
        organizationSlug,
      })
    : await prisma.organization.findUnique({
        where: { slug: organizationSlug },
        select: { id: true, slug: true, name: true },
      })

  if (!organization) {
    return badRequest('Organization not found')
  }

  if (!assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  if (revokeExisting) {
    await prisma.serviceAccount.updateMany({
      where: {
        organizationId: organization.id,
        name: serviceAccountName,
        status: 'active',
      },
      data: {
        status: 'revoked',
      },
    })
  }

  const generated = generateServiceAccountKey()
  const serviceAccount = await prisma.serviceAccount.create({
    data: {
      organizationId: organization.id,
      name: serviceAccountName,
      prefix: generated.prefix,
      secretHash: generated.hash,
      scopes,
    },
  })

  return json(
    {
      id: serviceAccount.id,
      organizationId: organization.id,
      name: serviceAccount.name,
      prefix: serviceAccount.prefix,
      scopes,
      key: generated.plaintext,
      status: serviceAccount.status,
      createdAt: serviceAccount.createdAt,
    },
    { status: 201 }
  )
}

export async function GET(request: Request) {
  const access = await requireScopedAccess(request, ['keys:read'])
  if (!access.ok) {
    return access.response
  }

  const organizationSlug = new URL(request.url).searchParams.get('organizationSlug')
  const organization = organizationSlug
    ? await prisma.organization.findUnique({
        where: { slug: organizationSlug },
        select: { id: true },
      })
    : null

  if (organization && !assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  if (!access.isPlatformAdmin && !organization) {
    return badRequest('organizationSlug is required for scoped access')
  }

  const serviceAccounts = await prisma.serviceAccount.findMany({
    where: access.isPlatformAdmin
      ? organization
        ? { organizationId: organization.id }
        : undefined
      : { organizationId: access.organizationId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      organizationId: true,
      name: true,
      prefix: true,
      scopes: true,
      status: true,
      lastUsedAt: true,
      createdAt: true,
    },
  })

  return json({ data: serviceAccounts })
}
