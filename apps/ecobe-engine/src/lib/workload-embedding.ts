import OpenAI from 'openai'
import type { CarbonCommand } from '@prisma/client'

import { prisma } from './db'
import type { CarbonCommandPayload } from './carbon-command'
import { env } from '../config/env'
import { getWorkloadVectorIndex, vectorNamespace } from './vector'

const openaiClient = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null
const EMBEDDING_MODEL = env.OPENAI_EMBEDDING_MODEL
const MAX_DOCUMENT_LENGTH = 3500

const gpuHoursBucket = (value?: number | null): string | null => {
  if (value === undefined || value === null) return null
  if (value < 1) return '<1h'
  if (value < 10) return '1-10h'
  if (value < 50) return '10-50h'
  if (value < 200) return '50-200h'
  if (value < 500) return '200-500h'
  return '>=500h'
}

const serializeArray = (values?: string[] | null) => (values && values.length > 0 ? values.join(', ') : 'none')

const buildEmbeddingDocument = (command: CarbonCommand, payload: CarbonCommandPayload) => {
  const workload = payload.workload
  const constraints = payload.constraints
  const execution = payload.execution
  const preferences = payload.preferences

  const doc = [
    `org:${command.orgId}`,
    `workload_type:${workload.type}`,
    workload.modelFamily ? `model_family:${workload.modelFamily}` : '',
    `estimated_gpu_hours:${workload.estimatedGpuHours ?? 0}`,
    `estimated_cpu_hours:${workload.estimatedCpuHours ?? 0}`,
    workload.estimatedMemoryGb ? `estimated_memory_gb:${workload.estimatedMemoryGb}` : '',
    constraints.maxLatencyMs ? `max_latency_ms:${constraints.maxLatencyMs}` : '',
    constraints.deadlineAt ? `deadline:${constraints.deadlineAt}` : '',
    `must_regions:${serializeArray(constraints.mustRunRegions)}`,
    `excluded_regions:${serializeArray(constraints.excludedRegions)}`,
    `carbon_priority:${constraints.carbonPriority ?? 'medium'}`,
    `latency_priority:${constraints.latencyPriority ?? 'medium'}`,
    `cost_priority:${constraints.costPriority ?? 'medium'}`,
    `execution_mode:${execution?.mode ?? 'immediate'}`,
    `candidate_window_hours:${execution?.candidateStartWindowHours ?? 0}`,
    `time_shifting:${preferences?.allowTimeShifting ?? true}`,
    `selected_region:${command.selectedRegion ?? 'pending'}`,
    command.selectedStartAt ? `selected_start:${command.selectedStartAt.toISOString()}` : '',
    `expected_carbon:${command.expectedCarbonIntensity ?? 'na'}`,
    `expected_latency:${command.expectedLatencyMs ?? 'na'}`,
    `expected_cost_index:${command.expectedCostIndex ?? 'na'}`,
    `estimated_emissions:${command.estimatedEmissionsKgCo2e ?? 'na'}`,
    `estimated_savings:${command.estimatedSavingsKgCo2e ?? 'na'}`,
  ]
    .filter(Boolean)
    .join('\n')

  return doc.length > MAX_DOCUMENT_LENGTH ? doc.slice(0, MAX_DOCUMENT_LENGTH) : doc
}

const buildVectorMetadata = (command: CarbonCommand, payload: CarbonCommandPayload) => ({
  commandId: command.id,
  orgId: command.orgId,
  workloadType: command.workloadType ?? payload.workload.type,
  modelFamily: command.modelFamily ?? payload.workload.modelFamily ?? null,
  executionMode: command.executionMode ?? command.mode,
  selectedRegion: command.selectedRegion ?? null,
})

export async function indexWorkloadEmbedding(command: CarbonCommand, payload: CarbonCommandPayload) {
  if (!openaiClient) {
    return
  }

  const vectorIndex = getWorkloadVectorIndex()
  if (!vectorIndex) {
    return
  }

  const document = buildEmbeddingDocument(command, payload)
  if (!document) return

  const embedding = await openaiClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: document,
  })

  const vector = embedding.data?.[0]?.embedding
  if (!Array.isArray(vector)) {
    return
  }

  const vectorId = `${vectorNamespace ?? 'default'}:${command.id}`

  await prisma.workloadEmbeddingIndex.upsert({
    where: { commandId: command.id },
    update: {
      vectorId,
      workloadType: command.workloadType ?? payload.workload.type,
      modelFamily: command.modelFamily ?? payload.workload.modelFamily,
      executionMode: command.executionMode ?? command.mode,
      gpuHoursBucket: gpuHoursBucket(payload.workload.estimatedGpuHours ?? null),
      gpuHours: payload.workload.estimatedGpuHours ?? null,
      cpuHours: payload.workload.estimatedCpuHours ?? null,
      memoryGb: payload.workload.estimatedMemoryGb ?? null,
      region: command.selectedRegion ?? null,
      carbonIntensity: command.expectedCarbonIntensity ?? null,
      emissionsKgCo2e: command.estimatedEmissionsKgCo2e ?? null,
      savingsKgCo2e: command.estimatedSavingsKgCo2e ?? null,
      latencyMs: command.expectedLatencyMs ?? null,
    },
    create: {
      commandId: command.id,
      orgId: command.orgId,
      vectorId,
      workloadType: command.workloadType ?? payload.workload.type,
      modelFamily: command.modelFamily ?? payload.workload.modelFamily,
      executionMode: command.executionMode ?? command.mode,
      gpuHoursBucket: gpuHoursBucket(payload.workload.estimatedGpuHours ?? null),
      gpuHours: payload.workload.estimatedGpuHours ?? null,
      cpuHours: payload.workload.estimatedCpuHours ?? null,
      memoryGb: payload.workload.estimatedMemoryGb ?? null,
      region: command.selectedRegion ?? null,
      carbonIntensity: command.expectedCarbonIntensity ?? null,
      emissionsKgCo2e: command.estimatedEmissionsKgCo2e ?? null,
      savingsKgCo2e: command.estimatedSavingsKgCo2e ?? null,
      latencyMs: command.expectedLatencyMs ?? null,
    },
  })

  const metadata = buildVectorMetadata(command, payload)

  const upsertPayload: {
    id: string
    vector: number[]
    metadata: Record<string, string | number | boolean | null>
    namespace?: string
  } = {
    id: command.id,
    vector,
    metadata,
  }

  if (vectorNamespace) {
    upsertPayload.namespace = vectorNamespace
  }

  await vectorIndex.upsert(upsertPayload)
}
