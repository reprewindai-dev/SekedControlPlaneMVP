import { requireAdmin } from '@/lib/auth'
import { json } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const admin = await requireAdmin(request)
  if (!admin.ok) {
    return admin.response
  }

  const versions = await prisma.policyVersion.findMany({
    where: { isActive: true },
    include: { policyProfile: true },
    orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
  })

  const seen = new Set<string>()
  const deactivate: string[] = []

  for (const version of versions) {
    const profile = version.policyProfile
    const key = `${profile.organizationId}:${profile.projectId ?? 'none'}:${profile.name}`

    if (seen.has(key)) {
      deactivate.push(version.id)
      continue
    }

    seen.add(key)
  }

  if (deactivate.length) {
    await prisma.policyVersion.updateMany({
      where: { id: { in: deactivate } },
      data: { isActive: false },
    })
  }

  const remaining = await prisma.policyVersion.findMany({
    where: { isActive: true },
    include: { policyProfile: true },
    orderBy: [{ createdAt: 'desc' }],
  })

  return json({
    deactivatedCount: deactivate.length,
    activePolicies: remaining.map((version) => ({
      id: version.id,
      policyProfileId: version.policyProfileId,
      name: version.policyProfile.name,
      organizationId: version.policyProfile.organizationId,
      projectId: version.policyProfile.projectId,
      version: version.version,
    })),
  })
}
