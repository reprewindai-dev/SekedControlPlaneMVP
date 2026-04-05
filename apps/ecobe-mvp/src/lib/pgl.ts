import { createHash } from 'crypto'

import { prisma } from './prisma'
import { signAuditPayload } from './audit'

export type PglActor = {
  type: 'service_account' | 'admin' | 'system' | 'api_key'
  id: string
}

export type EnsurePglSystemInput = {
  organizationId: string
  runId?: string | null
  genomeId: string
  name: string
  owner: string
  modelType: string
  metadata?: Record<string, unknown>
  versionIdentifier: string
  parentVersionId?: string | null
  versionMetadata?: Record<string, unknown>
}

export function payloadHash(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function ensurePglSystemAndVersion(input: EnsurePglSystemInput) {
  return prisma.$transaction(async (tx) => {
    const system = await tx.pglSystem.upsert({
      where: {
        organizationId_genomeId: {
          organizationId: input.organizationId,
          genomeId: input.genomeId,
        },
      },
      update: {
        name: input.name,
        owner: input.owner,
        modelType: input.modelType,
        metadata: (input.metadata ?? {}) as any,
        runId: input.runId ?? null,
      },
      create: {
        organizationId: input.organizationId,
        runId: input.runId ?? null,
        genomeId: input.genomeId,
        name: input.name,
        owner: input.owner,
        modelType: input.modelType,
        metadata: (input.metadata ?? {}) as any,
      },
    })

    const version = await tx.pglVersion.upsert({
      where: {
        systemId_versionIdentifier: {
          systemId: system.id,
          versionIdentifier: input.versionIdentifier,
        },
      },
      update: {
        parentVersionId: input.parentVersionId ?? null,
        metadata: (input.versionMetadata ?? {}) as any,
      },
      create: {
        organizationId: input.organizationId,
        systemId: system.id,
        versionIdentifier: input.versionIdentifier,
        parentVersionId: input.parentVersionId ?? null,
        metadata: (input.versionMetadata ?? {}) as any,
      },
    })

    if (version.parentVersionId) {
      await tx.pglLineageEdge.upsert({
        where: {
          systemId_parentVersionId_childVersionId: {
            systemId: system.id,
            parentVersionId: version.parentVersionId,
            childVersionId: version.id,
          },
        },
        update: {},
        create: {
          organizationId: input.organizationId,
          systemId: system.id,
          parentVersionId: version.parentVersionId,
          childVersionId: version.id,
          relationType: 'derived_from',
        },
      })
    }

    return { system, version }
  })
}

export async function appendPglLifecycleEvent(input: {
  organizationId: string
  systemId: string
  runId?: string | null
  versionId?: string | null
  eventType: string
  payload: Record<string, unknown>
}) {
  const hash = payloadHash(input.payload)
  const signature = signAuditPayload({
    eventType: input.eventType,
    hash,
    systemId: input.systemId,
    versionId: input.versionId ?? null,
    payload: input.payload,
  })

  return prisma.pglLifecycleEvent.create({
    data: {
      organizationId: input.organizationId,
      systemId: input.systemId,
      runId: input.runId ?? null,
      versionId: input.versionId ?? null,
      eventType: input.eventType,
      payload: input.payload as any,
      payloadHash: hash,
      signature,
    },
  })
}

export function resolveSystemIdentity(input: {
  payload: Record<string, unknown>
  organizationId: string
  projectId: string
  runId?: string
}) {
  const payload = input.payload
  const systemBlock =
    payload.system && typeof payload.system === 'object'
      ? (payload.system as Record<string, unknown>)
      : null

  const genomeId = String(
    payload.genomeId ?? systemBlock?.genomeId ?? payload.model ?? systemBlock?.model ?? `${input.projectId}-default-genome`,
  )
  const name = String(payload.systemName ?? systemBlock?.name ?? `${input.projectId}-primary-system`)
  const owner = String(payload.owner ?? systemBlock?.owner ?? input.organizationId)
  const modelType = String(payload.modelType ?? payload.model ?? systemBlock?.modelType ?? systemBlock?.model ?? 'unknown')
  const versionIdentifier = String(payload.versionIdentifier ?? payload.systemVersion ?? systemBlock?.version ?? 'v1')

  const parentVersionIdRaw = payload.parentVersionId ?? systemBlock?.parentVersionId
  const parentVersionId = parentVersionIdRaw ? String(parentVersionIdRaw) : null

  return {
    organizationId: input.organizationId,
    runId: input.runId ?? null,
    genomeId,
    name,
    owner,
    modelType,
    versionIdentifier,
    parentVersionId,
  }
}
