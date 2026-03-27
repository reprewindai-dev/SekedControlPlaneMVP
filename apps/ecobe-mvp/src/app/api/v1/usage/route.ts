import { authenticateApiKey } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { json, unauthorized } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const apiKey = await authenticateApiKey(request)
  if (!apiKey) {
    return unauthorized()
  }

  const usage = await prisma.usageRecord.findMany({
    where: {
      organizationId: apiKey.organizationId,
      projectId: apiKey.projectId ?? undefined,
    },
    orderBy: { recordedAt: 'desc' },
    take: 100,
  })

  const summary = await prisma.usageRecord.aggregate({
    where: {
      organizationId: apiKey.organizationId,
      projectId: apiKey.projectId ?? undefined,
    },
    _sum: {
      quantity: true,
      amountUsd: true,
    },
  })

  const billingAccount = await prisma.billingAccount.findUnique({
    where: {
      organizationId: apiKey.organizationId,
    },
    include: {
      subscriptions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      invoices: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  })

  return json({
    data: usage,
    summary: {
      totalQuantity: summary._sum.quantity ?? 0,
      totalAmountUsd: summary._sum.amountUsd ?? 0,
    },
    billing: billingAccount
      ? {
          status: billingAccount.status,
          stripeCustomerId: billingAccount.stripeCustomerId,
          currentSubscription: billingAccount.subscriptions[0] ?? null,
          recentInvoices: billingAccount.invoices,
        }
      : null,
  })
}
