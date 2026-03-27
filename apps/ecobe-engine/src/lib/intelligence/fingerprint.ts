import OpenAI from 'openai'
import { env } from '../../config/env'
import type { CarbonCommandPayload } from '../carbon-command'
import { logIntelligenceEvent } from '../logger'

export interface WorkloadFingerprint {
  workloadType: string
  modelType?: string | null
  gpuType?: string | null
  datasetSize?: number | null
  expectedRuntime?: number | null
  deadline?: number | null
  regionOptions: string[]
  latencyWeight: number
  carbonWeight: number
  costWeight: number
}

const openaiClient = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null
const EMBEDDING_MODEL = env.OPENAI_EMBEDDING_MODEL

export function buildFingerprint(payload: CarbonCommandPayload): WorkloadFingerprint {
  const constraints = payload.constraints
  const execution = payload.execution

  const regionOptions = constraints.mustRunRegions?.length
    ? constraints.mustRunRegions
    : constraints.excludedRegions
    ? []
    : []

  const fingerprint: WorkloadFingerprint = {
    workloadType: payload.workload.type,
    modelType: payload.workload.modelFamily ?? null,
    gpuType: payload.metadata?.gpuType as string | undefined,
    datasetSize: (payload.metadata?.datasetSize as number | undefined) ?? null,
    expectedRuntime: payload.metadata?.expectedRuntimeHours as number | undefined,
    deadline: execution?.candidateStartWindowHours ?? null,
    regionOptions,
    latencyWeight: weightForPriority(constraints.latencyPriority),
    carbonWeight: weightForPriority(constraints.carbonPriority),
    costWeight: weightForPriority(constraints.costPriority),
  }

  logIntelligenceEvent('INTELLIGENCE_FINGERPRINT_CREATED', { orgId: payload.orgId, workloadType: fingerprint.workloadType })
  return fingerprint
}

function weightForPriority(priority?: 'low' | 'medium' | 'high'): number {
  if (!priority) return 0.33
  if (priority === 'high') return 0.5
  if (priority === 'medium') return 0.33
  return 0.17
}

export async function generateWorkloadEmbedding(fingerprint: WorkloadFingerprint): Promise<number[] | null> {
  if (!openaiClient) {
    return null
  }

  const document = JSON.stringify(fingerprint)
  const embedding = await openaiClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: document,
  })

  const vector = embedding.data?.[0]?.embedding
  return Array.isArray(vector) ? vector : null
}
