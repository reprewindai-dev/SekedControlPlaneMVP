import { authenticateApiKey } from '@/lib/auth'
import { json, notFound, unauthorized } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authenticateApiKey(request)
  if (!apiKey) {
    return unauthorized()
  }

  const { id } = await context.params
  const run = await prisma.run.findFirst({
    where: {
      id,
      organizationId: apiKey.organizationId,
    },
  })

  if (!run) {
    return notFound('Run not found')
  }

  const events = await prisma.runEvent.findMany({
    where: { runId: id },
    orderBy: { createdAt: 'asc' },
  })

  return json({ data: events })
}
