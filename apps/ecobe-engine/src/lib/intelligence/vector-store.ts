import { Index } from '@upstash/vector'
import { env } from '../../config/env'

const workloadNamespace = 'workloads'

let workloadIndex: Index | null = null
let workloadNamespaceClient: ReturnType<Index['namespace']> | null = null

function ensureWorkloadNamespace() {
  if (!env.UPSTASH_VECTOR_REST_URL || !env.UPSTASH_VECTOR_REST_TOKEN) {
    return null
  }

  if (!workloadIndex) {
    workloadIndex = new Index({
      url: env.UPSTASH_VECTOR_REST_URL,
      token: env.UPSTASH_VECTOR_REST_TOKEN,
    })
  }

  if (!workloadNamespaceClient) {
    workloadNamespaceClient = workloadIndex.namespace(workloadNamespace)
  }

  return workloadNamespaceClient
}

export interface WorkloadVectorMetadata extends Record<string, unknown> {
  workloadId: string
  orgId: string
  regionChosen?: string | null
  carbonIntensity?: number | null
  latency?: number | null
  cost?: number | null
  carbonSaved?: number | null
  success?: boolean | null
}

export async function storeWorkloadFingerprint(params: {
  workloadId: string
  embedding: number[]
  metadata: WorkloadVectorMetadata
}) {
  const namespace = ensureWorkloadNamespace()
  if (!namespace) return

  await namespace.upsert({
    id: params.workloadId,
    vector: params.embedding,
    metadata: params.metadata,
  })
}

export async function deleteWorkloadFingerprints(ids: string[]) {
  const namespace = ensureWorkloadNamespace()
  if (!namespace || ids.length === 0) return

  await namespace.delete(ids)
}

export async function findSimilarWorkloads(queryVector: number[], topK = 10) {
  const namespace = ensureWorkloadNamespace()
  if (!namespace) return []

  const matches = await namespace.query({
    topK,
    vector: queryVector,
    includeMetadata: true,
  })

  return matches.map((match) => ({
    metadata: (match.metadata ?? {}) as WorkloadVectorMetadata,
    score: match.score ?? 0,
  }))
}
