import { z } from 'zod'

import { assertOrganizationAccess, requireScopedAccess } from '@/lib/auth'
import { generateInternalInvoice } from '@/lib/billing'
import { badRequest, forbidden, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  organizationSlug: z.string().min(1),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
})

export async function POST(request: Request) {
  const access = await requireScopedAccess(request, ['billing:write'])
  if (!access.ok) {
    return access.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid invoice generation payload', parsed.error.flatten())
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: parsed.data.organizationSlug },
    select: { id: true },
  })

  if (!organization) {
    return badRequest('Organization not found')
  }

  if (!assertOrganizationAccess(access, organization.id)) {
    return forbidden()
  }

  const invoice = await generateInternalInvoice({
    organizationId: organization.id,
    periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : null,
    periodEnd: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : null,
  })

  return json(invoice, { status: 201 })
}
