import { z } from 'zod'

import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { createStripePortalSession } from '@/lib/billing'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  organizationSlug: z.string().min(1),
  returnUrl: z.string().url().optional(),
})

export async function POST(request: Request) {
  const access = await requireScopedAccess(request, ['billing:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid billing portal payload', parsed.error.flatten())
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: parsed.data.organizationSlug },
    select: { id: true, slug: true, name: true },
  })

  if (!organization) {
    return badRequest('Organization not found')
  }

  if (!assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  try {
    const session = await createStripePortalSession({
      organizationId: organization.id,
      organizationSlug: organization.slug,
      organizationName: organization.name,
      returnUrl: parsed.data.returnUrl,
    })

    return json(session, { status: 201 })
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Unable to create portal session' },
      { status: 503 }
    )
  }
}
