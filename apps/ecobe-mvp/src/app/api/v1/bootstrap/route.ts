import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { requireAdmin, generateApiKey, generateServiceAccountKey } from '@/lib/auth'
import { badRequest, json } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { ensureTenantScope } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`
  }

  return JSON.stringify(value)
}

const bodySchema = z.object({
  organizationName: z.string().min(1),
  organizationSlug: z.string().min(1),
  projectName: z.string().min(1),
  projectSlug: z.string().min(1),
  environmentSlug: z.string().default('production'),
  keyName: z.string().default('Primary Production Key'),
  serviceAccountName: z.string().optional(),
  policyName: z.string().default('Default Governance Policy'),
  rotateCredentials: z.boolean().default(true),
  rules: z.record(z.any()).default({
    strictMode: true,
    requireApprovalThreshold: 45,
    blockThreshold: 75,
  }),
})

export async function POST(request: Request) {
  const admin = await requireAdmin(request)
  if (!admin.ok) {
    return admin.response
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return badRequest('Invalid bootstrap payload', parsed.error.flatten())
  }

  const serviceAccountName = parsed.data.serviceAccountName ?? `${parsed.data.organizationName} Automation`
  const desiredRules = parsed.data.rules as Record<string, unknown>
  const desiredRulesJson = stableJson(desiredRules)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const { organization, project } = await ensureTenantScope(parsed.data, tx)

        const environment = await tx.environment.upsert({
          where: {
            projectId_slug: {
              projectId: project.id,
              slug: parsed.data.environmentSlug,
            },
          },
          update: { name: parsed.data.environmentSlug },
          create: {
            projectId: project.id,
            name: parsed.data.environmentSlug,
            slug: parsed.data.environmentSlug,
          },
        })

        const existingPolicyProfile = await tx.policyProfile.findFirst({
          where: {
            organizationId: organization.id,
            projectId: project.id,
            name: parsed.data.policyName,
          },
          include: {
            versions: {
              orderBy: { version: 'desc' },
            },
          },
        })

        const policyProfile =
          existingPolicyProfile ??
          (await tx.policyProfile.create({
            data: {
              organizationId: organization.id,
              projectId: project.id,
              name: parsed.data.policyName,
            },
            include: {
              versions: {
                orderBy: { version: 'desc' },
              },
            },
          }))

        const activePolicyVersion = policyProfile.versions.find((version) => version.isActive) ?? policyProfile.versions[0]
        let policyVersion = activePolicyVersion

        if (!activePolicyVersion || stableJson(activePolicyVersion.rules) !== desiredRulesJson) {
          await tx.policyVersion.updateMany({
            where: {
              policyProfileId: policyProfile.id,
              isActive: true,
            },
            data: { isActive: false },
          })

          policyVersion = await tx.policyVersion.create({
            data: {
              policyProfileId: policyProfile.id,
              version: (policyProfile.versions[0]?.version ?? 0) + 1,
              isActive: true,
              rules: desiredRules as any,
            },
          })
        }

        const existingApiKeys = await tx.apiKey.findMany({
          where: {
            organizationId: organization.id,
            projectId: project.id,
            name: parsed.data.keyName,
            status: 'active',
          },
          orderBy: { createdAt: 'desc' },
        })

        if (existingApiKeys.length && parsed.data.rotateCredentials) {
          await tx.apiKey.updateMany({
            where: {
              id: {
                in: existingApiKeys.map((key) => key.id),
              },
            },
            data: { status: 'revoked' },
          })
        }

        const shouldCreateApiKey = parsed.data.rotateCredentials || existingApiKeys.length === 0
        const generated = shouldCreateApiKey ? generateApiKey() : null
        const apiKey = shouldCreateApiKey
          ? await tx.apiKey.create({
              data: {
                organizationId: organization.id,
                projectId: project.id,
                name: parsed.data.keyName,
                prefix: generated!.prefix,
                keyHash: generated!.hash,
                scopes: ['runs:write', 'runs:read', 'usage:read'],
              },
            })
          : existingApiKeys[0]

        const existingServiceAccounts = await tx.serviceAccount.findMany({
          where: {
            organizationId: organization.id,
            name: serviceAccountName,
            status: 'active',
          },
          orderBy: { createdAt: 'desc' },
        })

        if (existingServiceAccounts.length && parsed.data.rotateCredentials) {
          await tx.serviceAccount.updateMany({
            where: {
              id: {
                in: existingServiceAccounts.map((account) => account.id),
              },
            },
            data: { status: 'revoked' },
          })
        }

        const shouldCreateServiceAccount = parsed.data.rotateCredentials || existingServiceAccounts.length === 0
        const serviceAccountCredential = shouldCreateServiceAccount ? generateServiceAccountKey() : null
        const serviceAccount = shouldCreateServiceAccount
          ? await tx.serviceAccount.create({
              data: {
                organizationId: organization.id,
                name: serviceAccountName,
                prefix: serviceAccountCredential!.prefix,
                secretHash: serviceAccountCredential!.hash,
                scopes: [
                  'alerts:read',
                  'approvals:read',
                  'approvals:write',
                  'audit:read',
                  'audit:write',
                  'dashboard:read',
                  'billing:read',
                  'billing:write',
                  'compliance:read',
                  'compliance:write',
                  'keys:read',
                  'keys:write',
                  'policies:read',
                  'policies:write',
                  'webhooks:read',
                  'webhooks:write',
                ],
              },
            })
          : existingServiceAccounts[0]

        await tx.billingAccount.upsert({
          where: { organizationId: organization.id },
          update: {},
          create: {
            organizationId: organization.id,
            status: 'active',
          },
        })

        return {
          organizationId: organization.id,
          projectId: project.id,
          environmentId: environment.id,
          policyVersionId: policyVersion.id,
          apiKeyId: apiKey.id,
          apiKey: generated?.plaintext ?? null,
          serviceAccountId: serviceAccount.id,
          serviceAccountKey: serviceAccountCredential?.plaintext ?? null,
          credentialsRotated: shouldCreateApiKey || shouldCreateServiceAccount,
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })

      return json(result, { status: 201 })
    } catch (error) {
      const isSerializationConflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'

      if (!isSerializationConflict || attempt === 2) {
        throw error
      }
    }
  }

  throw new Error('Bootstrap transaction failed')
}
