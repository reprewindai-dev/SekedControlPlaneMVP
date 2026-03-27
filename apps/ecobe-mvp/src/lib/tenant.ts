import type { Prisma, PrismaClient } from '@prisma/client'

import { prisma } from './prisma'

type TenantClient = PrismaClient | Prisma.TransactionClient

export async function ensureTenantScope(input: {
  organizationName: string
  organizationSlug: string
  projectName: string
  projectSlug: string
}, db: TenantClient = prisma) {
  const organization = await db.organization.upsert({
    where: { slug: input.organizationSlug },
    update: { name: input.organizationName },
    create: { name: input.organizationName, slug: input.organizationSlug },
  })

  const project = await db.project.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: input.projectSlug,
      },
    },
    update: { name: input.projectName },
    create: {
      organizationId: organization.id,
      name: input.projectName,
      slug: input.projectSlug,
    },
  })

  return { organization, project }
}

export async function ensureOrganizationScope(input: {
  organizationName: string
  organizationSlug: string
}, db: TenantClient = prisma) {
  return db.organization.upsert({
    where: { slug: input.organizationSlug },
    update: { name: input.organizationName },
    create: { name: input.organizationName, slug: input.organizationSlug },
  })
}
