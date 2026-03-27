import { randomUUID } from 'crypto'

import { prisma } from './prisma'
import { createRunEvent } from './audit'
import { assertRunEntitlements } from './billing'
import { evaluateSeked } from './seked'
import { evaluateConvergeos } from './convergeos'
import { createRoutingDecision, executeAllocation } from './engine'
import { executeGovernedPayload } from './execution'

type GovernanceSnapshot = {
  score: number
  drift: boolean
  fracture: boolean
  tier: string
  blocked?: boolean
  blockReason?: string | null
  requiresApproval?: boolean
}

type ReliabilitySnapshot = {
  attemptCount: number
  schemaValid: boolean
  qualityScore: number
  finalDecision: string
}

export async function orchestrateRun(apiKey: any, payload: Record<string, any>) {
  const organizationId = apiKey.organizationId
  const projectId = apiKey.projectId ?? payload.projectId
  const environmentSlug = payload.environmentSlug ?? 'production'

  if (!projectId) {
    throw new Error('API key is not scoped to a project')
  }

  await assertRunEntitlements(organizationId, payload)

  const environment = await prisma.environment.upsert({
    where: {
      projectId_slug: {
        projectId,
        slug: environmentSlug,
      },
    },
    update: { name: environmentSlug },
    create: {
      projectId,
      name: environmentSlug,
      slug: environmentSlug,
    },
  })

  const policyVersion = await prisma.policyVersion.findFirst({
    where: {
      isActive: true,
      policyProfile: {
        organizationId,
        OR: [{ projectId }, { projectId: null }],
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const seked = await evaluateSeked(payload.input ?? payload, policyVersion?.rules as Record<string, any> | undefined)
  const convergeos = await evaluateConvergeos(payload.input ?? payload)
  const correlationId = randomUUID()

  const run = await prisma.run.create({
    data: {
      organizationId,
      projectId,
      environmentId: environment.id,
      apiKeyId: apiKey.id,
      policyVersionId: policyVersion?.id,
      correlationId,
      status: seked.blocked ? 'blocked' : seked.requiresApproval ? 'approval_required' : 'pending',
      inputPayload: payload as any,
      blockedReason: seked.blockReason,
      approvalRequired: seked.requiresApproval,
    },
  })

  await createRunEvent(run.id, organizationId, 'run.received', {
    correlationId,
    input: payload,
  })

  if (seked.blocked) {
    const envelope = {
      runId: run.id,
      status: 'blocked',
      result: null,
      seked: {
        score: seked.score,
        drift: seked.drift,
        fracture: seked.fracture,
        tier: seked.tier,
      },
      convergeos: {
        attemptCount: convergeos.attemptCount,
        schemaValid: convergeos.schemaValid,
        qualityScore: convergeos.qualityScore,
        finalDecision: convergeos.finalDecision,
      },
      ecobe: null,
      auditId: run.id,
    }

    await prisma.run.update({
      where: { id: run.id },
      data: {
        resultEnvelope: envelope as any,
        auditId: run.id,
      },
    })

    await createRunEvent(run.id, organizationId, 'run.blocked', envelope)
    await createAlert(organizationId, run.id, 'critical', seked.blockReason ?? 'Run blocked by Seked governance')
    return envelope
  }

  if (seked.requiresApproval) {
    await prisma.approvalRequest.create({
      data: {
        organizationId,
        runId: run.id,
        reason: 'Seked elevated this run for approval',
      },
    })

    const envelope = {
      runId: run.id,
      status: 'approval_required',
      result: null,
      seked: {
        score: seked.score,
        drift: seked.drift,
        fracture: seked.fracture,
        tier: seked.tier,
      },
      convergeos: {
        attemptCount: convergeos.attemptCount,
        schemaValid: convergeos.schemaValid,
        qualityScore: convergeos.qualityScore,
        finalDecision: convergeos.finalDecision,
      },
      ecobe: null,
      auditId: run.id,
    }

    await prisma.run.update({
      where: { id: run.id },
      data: {
        resultEnvelope: envelope as any,
        auditId: run.id,
      },
    })

    await createRunEvent(run.id, organizationId, 'run.approval_required', envelope)
    await createAlert(organizationId, run.id, 'high', 'Run requires human approval before execution')
    return envelope
  }

  if (!convergeos.schemaValid) {
    const envelope = {
      runId: run.id,
      status: 'failed',
      result: null,
      seked: {
        score: seked.score,
        drift: seked.drift,
        fracture: seked.fracture,
        tier: seked.tier,
      },
      convergeos: {
        attemptCount: convergeos.attemptCount,
        schemaValid: convergeos.schemaValid,
        qualityScore: convergeos.qualityScore,
        finalDecision: convergeos.finalDecision,
      },
      ecobe: null,
      auditId: run.id,
    }

    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        resultEnvelope: envelope as any,
        auditId: run.id,
      },
    })

    await createRunEvent(run.id, organizationId, 'run.failed', envelope)
    await createAlert(organizationId, run.id, 'high', 'Run failed ConvergeOS schema validation')
    return envelope
  }

  return completeRunExecution({
    runId: run.id,
    organizationId,
    projectId,
    payload,
    seked,
    convergeos,
  })
}

export async function approveRun(approvalRequestId: string, actor: { type: 'service_account' | 'admin'; id: string }) {
  const approvalRequest = await prisma.approvalRequest.findUnique({
    where: { id: approvalRequestId },
    include: {
      run: true,
    },
  })

  if (!approvalRequest) {
    throw new Error('Approval request not found')
  }

  if (approvalRequest.status !== 'pending') {
    throw new Error('Approval request is not pending')
  }

  const run = approvalRequest.run
  const envelope = (run.resultEnvelope ?? {}) as Record<string, any>

  await prisma.approvalRequest.update({
    where: { id: approvalRequestId },
    data: { status: 'approved' },
  })

  await createRunEvent(run.id, run.organizationId, 'run.approved', {
    approvalRequestId,
    actor,
  })

  const result = await completeRunExecution({
    runId: run.id,
    organizationId: run.organizationId,
    projectId: run.projectId,
    payload: run.inputPayload as Record<string, any>,
    seked: {
      score: Number(envelope.seked?.score ?? 0),
      drift: Boolean(envelope.seked?.drift),
      fracture: Boolean(envelope.seked?.fracture),
      tier: String(envelope.seked?.tier ?? 'elevated'),
    },
    convergeos: {
      attemptCount: Number(envelope.convergeos?.attemptCount ?? 1),
      schemaValid: Boolean(envelope.convergeos?.schemaValid ?? true),
      qualityScore: Number(envelope.convergeos?.qualityScore ?? 0),
      finalDecision: String(envelope.convergeos?.finalDecision ?? 'accepted'),
    },
  })

  await prisma.alert.create({
    data: {
      organizationId: run.organizationId,
      runId: run.id,
      severity: 'info',
      message: `Approval request ${approvalRequestId} approved and run resumed`,
    },
  })

  return result
}

export async function rejectRun(approvalRequestId: string, actor: { type: 'service_account' | 'admin'; id: string }, reason?: string) {
  const approvalRequest = await prisma.approvalRequest.findUnique({
    where: { id: approvalRequestId },
    include: {
      run: true,
    },
  })

  if (!approvalRequest) {
    throw new Error('Approval request not found')
  }

  if (approvalRequest.status !== 'pending') {
    throw new Error('Approval request is not pending')
  }

  const run = approvalRequest.run
  const envelope = {
    ...(run.resultEnvelope as Record<string, any> | null),
    status: 'blocked',
    result: null,
    auditId: run.id,
    blockedReason: reason ?? approvalRequest.reason,
  }

  await prisma.approvalRequest.update({
    where: { id: approvalRequestId },
    data: { status: 'rejected', reason: reason ?? approvalRequest.reason },
  })

  await prisma.run.update({
    where: { id: run.id },
    data: {
      status: 'blocked',
      blockedReason: reason ?? approvalRequest.reason,
      resultEnvelope: envelope as any,
      auditId: run.id,
    },
  })

  await createRunEvent(run.id, run.organizationId, 'run.rejected', {
    approvalRequestId,
    actor,
    reason: reason ?? approvalRequest.reason,
  })

  await createAlert(run.organizationId, run.id, 'medium', `Approval request ${approvalRequestId} rejected`)

  return envelope
}

async function completeRunExecution(input: {
  runId: string
  organizationId: string
  projectId: string
  payload: Record<string, any>
  seked: GovernanceSnapshot
  convergeos: ReliabilitySnapshot
}) {
  const engineDecision = await createRoutingDecision({
    runId: input.runId,
    orgId: input.organizationId,
    projectId: input.projectId,
    providerConstraints: input.payload.providerConstraints ?? {},
    latencyCeiling: input.payload.latencyCeiling,
    costCeiling: input.payload.costCeiling,
    carbonPolicy: input.payload.carbonPolicy ?? {},
    executionMetadata: {
      model: input.payload.model,
      tokenCount: input.payload.tokenCount,
      operation: input.payload.operation ?? 'governed-run',
      requestCount: input.payload.requestCount ?? 1,
      estimatedKwh: input.payload.estimatedKwh ?? 0.08,
    },
  })

  await createRunEvent(input.runId, input.organizationId, 'run.routed', {
    provider: engineDecision.selectedProvider,
    region: engineDecision.selectedRegion,
    estimatedLatency: engineDecision.estimatedLatency,
    estimatedCost: engineDecision.estimatedCost,
    carbonEstimate: engineDecision.carbonEstimate,
    decisionReason: engineDecision.decisionReason,
    routeMode: engineDecision.routeMode ?? 'engine',
    fallbackUsed: engineDecision.fallbackUsed ?? false,
  })

  const allocation = await executeAllocation(engineDecision.decisionId)

  await createRunEvent(input.runId, input.organizationId, 'run.allocated', {
    executionReference: allocation.executionReference,
    provider: allocation.provider ?? engineDecision.selectedProvider,
    region: allocation.region ?? engineDecision.selectedRegion,
    routeMode: allocation.routeMode ?? engineDecision.routeMode ?? 'engine',
  })

  const generation = await executeGovernedPayload({
    input: input.payload.input,
    schema: input.payload.schema,
    temperature: input.payload.temperature,
    operation: input.payload.operation,
  })

  const convergeos = {
    attemptCount: Math.max(input.convergeos.attemptCount, generation.attemptCount),
    schemaValid: generation.schemaValid,
    qualityScore: generation.schemaValid
      ? Math.max(input.convergeos.qualityScore, generation.qualityScore)
      : Math.min(input.convergeos.qualityScore, generation.qualityScore),
    finalDecision: generation.finalDecision,
  }

  if (!generation.schemaValid) {
    const envelope = {
      runId: input.runId,
      status: 'failed',
      result: null,
      seked: {
        score: input.seked.score,
        drift: input.seked.drift,
        fracture: input.seked.fracture,
        tier: input.seked.tier,
      },
      convergeos,
      ecobe: {
        provider: engineDecision.selectedProvider,
        region: engineDecision.selectedRegion,
        estimatedLatency: engineDecision.estimatedLatency,
        estimatedCost: engineDecision.estimatedCost,
        carbonEstimate: engineDecision.carbonEstimate,
        decisionReason: generation.error ?? engineDecision.decisionReason,
        executionReference: allocation.executionReference,
        executionProvider: generation.provider,
        executionModel: generation.model,
      },
      auditId: input.runId,
      error: generation.error ?? 'Governed generation failed schema validation',
    }

    await prisma.run.update({
      where: { id: input.runId },
      data: {
        status: 'failed',
        resultEnvelope: envelope as any,
        auditId: input.runId,
      },
    })

    await createRunEvent(input.runId, input.organizationId, 'run.failed', envelope)
    await createAlert(input.organizationId, input.runId, 'high', envelope.error)
    return envelope
  }

  const envelope = {
    runId: input.runId,
    status: 'completed',
    result: generation.output,
    seked: {
      score: input.seked.score,
      drift: input.seked.drift,
      fracture: input.seked.fracture,
      tier: input.seked.tier,
    },
    convergeos,
    ecobe: {
      provider: engineDecision.selectedProvider,
      region: engineDecision.selectedRegion,
      estimatedLatency: engineDecision.estimatedLatency,
      estimatedCost: engineDecision.estimatedCost,
      carbonEstimate: engineDecision.carbonEstimate,
      decisionReason: engineDecision.decisionReason,
      executionReference: allocation.executionReference,
      executionProvider: generation.provider,
      executionModel: generation.model,
    },
    auditId: input.runId,
  }

  await prisma.run.update({
    where: { id: input.runId },
    data: {
      status: 'completed',
      resultPayload: envelope.result as any,
      resultEnvelope: envelope as any,
      auditId: input.runId,
    },
  })

  await prisma.usageRecord.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      runId: input.runId,
      metric: 'governed_run',
      quantity: 1,
      unit: 'run',
      amountUsd: Number(engineDecision.estimatedCost ?? 0),
    },
  })

  await createRunEvent(input.runId, input.organizationId, 'run.completed', envelope)
  return envelope
}

async function createAlert(organizationId: string, runId: string, severity: string, message: string) {
  await prisma.alert.create({
    data: {
      organizationId,
      runId,
      severity,
      message,
    },
  })
}
