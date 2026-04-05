import { randomUUID } from 'crypto'

import { prisma } from './prisma'
import { createRunEvent } from './audit'
import { assertRunEntitlements } from './billing'
import { evaluateSeked, normalizeSekedEvaluation, type SekedDirective, type SekedDirectiveAction } from './seked'
import { evaluateConvergeos } from './convergeos'
import { createRoutingDecision, executeAllocation } from './engine'
import { executeGovernedPayload } from './execution'
import { appendPglLifecycleEvent, ensurePglSystemAndVersion, resolveSystemIdentity } from './pgl'

type GovernanceSnapshot = {
  score: number
  drift: boolean
  fracture: boolean
  tier: string
  blocked: boolean
  blockReason: string | null
  requiresApproval: boolean
  directive: SekedDirective
}

type ReliabilitySnapshot = {
  attemptCount: number
  schemaValid: boolean
  qualityScore: number
  finalDecision: string
}

function requiresNonExecuteGate(action: SekedDirectiveAction) {
  return action === 'REQUIRE_APPROVAL' || action === 'CLARIFY'
}

function sekedSnapshot(seked: GovernanceSnapshot) {
  return {
    score: seked.score,
    drift: seked.drift,
    fracture: seked.fracture,
    tier: seked.tier,
    blocked: seked.blocked,
    requiresApproval: seked.requiresApproval,
    blockReason: seked.blockReason,
    directive: seked.directive,
  }
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
  const gateForApproval = requiresNonExecuteGate(seked.directive.action)

  const run = await prisma.run.create({
    data: {
      organizationId,
      projectId,
      environmentId: environment.id,
      apiKeyId: apiKey.id,
      policyVersionId: policyVersion?.id,
      correlationId,
      status: seked.blocked ? 'blocked' : gateForApproval ? 'approval_required' : 'pending',
      inputPayload: payload as any,
      blockedReason: seked.blockReason,
      approvalRequired: gateForApproval,
    },
  })

  const identity = resolveSystemIdentity({
    payload,
    organizationId,
    projectId,
    runId: run.id,
  })
  const pgl = await ensurePglSystemAndVersion(identity)

  await createRunEvent(run.id, organizationId, 'run.received', {
    correlationId,
    input: payload,
  })
  await appendPglLifecycleEvent({
    organizationId,
    systemId: pgl.system.id,
    versionId: pgl.version.id,
    runId: run.id,
    eventType: 'seked.evaluated',
    payload: {
      correlationId,
      seked: sekedSnapshot(seked),
      convergeos,
    },
  })

  if (seked.blocked) {
    const envelope = {
      runId: run.id,
      status: 'blocked',
      result: null,
      seked: sekedSnapshot(seked),
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
    await appendPglLifecycleEvent({
      organizationId,
      systemId: pgl.system.id,
      versionId: pgl.version.id,
      runId: run.id,
      eventType: 'run.gated',
      payload: {
        status: 'blocked',
        directive: seked.directive,
        reason: seked.blockReason ?? seked.directive.reason,
      },
    })
    await createAlert(organizationId, run.id, 'critical', seked.blockReason ?? 'Run blocked by Seked governance')
    return envelope
  }

  if (gateForApproval) {
    await prisma.approvalRequest.create({
      data: {
        organizationId,
        runId: run.id,
        reason: seked.directive.reason,
      },
    })

    const envelope = {
      runId: run.id,
      status: 'approval_required',
      result: null,
      seked: sekedSnapshot(seked),
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
    await appendPglLifecycleEvent({
      organizationId,
      systemId: pgl.system.id,
      versionId: pgl.version.id,
      runId: run.id,
      eventType: 'run.gated',
      payload: {
        status: 'approval_required',
        directive: seked.directive,
        reason: seked.directive.reason,
      },
    })
    await createAlert(
      organizationId,
      run.id,
      'high',
      seked.directive.action === 'CLARIFY'
        ? 'Run requires clarification before execution'
        : 'Run requires human approval before execution',
    )
    return envelope
  }

  if (!convergeos.schemaValid) {
    const envelope = {
      runId: run.id,
      status: 'failed',
      result: null,
      seked: sekedSnapshot(seked),
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
    await appendPglLifecycleEvent({
      organizationId,
      systemId: pgl.system.id,
      versionId: pgl.version.id,
      runId: run.id,
      eventType: 'run.execution_result',
      payload: {
        status: 'failed',
        reason: 'ConvergeOS schema validation failed before routing',
        convergeos,
      },
    })
    await createAlert(organizationId, run.id, 'high', 'Run failed ConvergeOS schema validation')
    return envelope
  }

  const pendingEnvelope = {
    runId: run.id,
    status: 'pending',
    result: null,
    seked: sekedSnapshot(seked),
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
      resultEnvelope: pendingEnvelope as any,
      auditId: run.id,
    },
  })

  void executeRunInBackground({
    runId: run.id,
    organizationId,
    projectId,
    payload,
    seked,
    convergeos,
    pglSystemId: pgl.system.id,
    pglVersionId: pgl.version.id,
  })

  return pendingEnvelope
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
  const restoredSeked = normalizeSekedEvaluation({
    score: envelope.seked?.score,
    drift: envelope.seked?.drift,
    fracture: envelope.seked?.fracture,
    tier: envelope.seked?.tier ?? 'elevated',
    blocked: envelope.seked?.blocked,
    requiresApproval: envelope.seked?.requiresApproval ?? true,
    blockReason: envelope.seked?.blockReason,
    directive: envelope.seked?.directive,
  })
  const identity = resolveSystemIdentity({
    payload: (run.inputPayload as Record<string, unknown>) ?? {},
    organizationId: run.organizationId,
    projectId: run.projectId,
    runId: run.id,
  })
  const pgl = await ensurePglSystemAndVersion(identity)

  await prisma.approvalRequest.update({
    where: { id: approvalRequestId },
    data: { status: 'approved' },
  })

  await createRunEvent(run.id, run.organizationId, 'run.approved', {
    approvalRequestId,
    actor,
  })
  await appendPglLifecycleEvent({
    organizationId: run.organizationId,
    systemId: pgl.system.id,
    versionId: pgl.version.id,
    runId: run.id,
    eventType: 'run.approval_decision',
    payload: {
      approvalRequestId,
      actor,
      decision: 'approved',
      directive: restoredSeked.directive,
    },
  })

  const result = await completeRunExecution({
    runId: run.id,
    organizationId: run.organizationId,
    projectId: run.projectId,
    payload: run.inputPayload as Record<string, any>,
    seked: restoredSeked,
    convergeos: {
      attemptCount: Number(envelope.convergeos?.attemptCount ?? 1),
      schemaValid: Boolean(envelope.convergeos?.schemaValid ?? true),
      qualityScore: Number(envelope.convergeos?.qualityScore ?? 0),
      finalDecision: String(envelope.convergeos?.finalDecision ?? 'accepted'),
    },
    pglSystemId: pgl.system.id,
    pglVersionId: pgl.version.id,
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
  const identity = resolveSystemIdentity({
    payload: (run.inputPayload as Record<string, unknown>) ?? {},
    organizationId: run.organizationId,
    projectId: run.projectId,
    runId: run.id,
  })
  const pgl = await ensurePglSystemAndVersion(identity)
  await appendPglLifecycleEvent({
    organizationId: run.organizationId,
    systemId: pgl.system.id,
    versionId: pgl.version.id,
    runId: run.id,
    eventType: 'run.approval_decision',
    payload: {
      approvalRequestId,
      actor,
      decision: 'rejected',
      reason: reason ?? approvalRequest.reason,
      directive: ((envelope as Record<string, any>).seked as { directive?: unknown } | undefined)?.directive ?? null,
    },
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
  pglSystemId: string
  pglVersionId: string
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
  await appendPglLifecycleEvent({
    organizationId: input.organizationId,
    systemId: input.pglSystemId,
    versionId: input.pglVersionId,
    runId: input.runId,
    eventType: 'ecobe.routed',
    payload: {
      decisionId: engineDecision.decisionId,
      selectedProvider: engineDecision.selectedProvider,
      selectedRegion: engineDecision.selectedRegion,
      estimatedLatency: engineDecision.estimatedLatency,
      estimatedCost: engineDecision.estimatedCost,
      carbonEstimate: engineDecision.carbonEstimate,
      decisionReason: engineDecision.decisionReason,
      routeMode: engineDecision.routeMode ?? 'engine',
      fallbackUsed: engineDecision.fallbackUsed ?? false,
      proofHash: engineDecision.proofHash ?? null,
      proofAvailability: engineDecision.proofHash ? 'available' : 'not_available_from_internal_engine_route',
    },
  })

  const allocation = await executeAllocation(engineDecision.decisionId)

  await createRunEvent(input.runId, input.organizationId, 'run.allocated', {
    executionReference: allocation.executionReference,
    provider: allocation.provider ?? engineDecision.selectedProvider,
    region: allocation.region ?? engineDecision.selectedRegion,
    routeMode: allocation.routeMode ?? engineDecision.routeMode ?? 'engine',
  })
  await appendPglLifecycleEvent({
    organizationId: input.organizationId,
    systemId: input.pglSystemId,
    versionId: input.pglVersionId,
    runId: input.runId,
    eventType: 'ecobe.allocated',
    payload: {
      decisionId: engineDecision.decisionId,
      executionReference: allocation.executionReference,
      provider: allocation.provider ?? engineDecision.selectedProvider,
      region: allocation.region ?? engineDecision.selectedRegion,
      routeMode: allocation.routeMode ?? engineDecision.routeMode ?? 'engine',
    },
  })

  const generation = await executeGovernedPayload(
    {
      input: input.payload.input,
      schema: input.payload.schema,
      temperature: input.payload.temperature,
      operation: input.payload.operation,
    },
    {
      selectedProvider: allocation.provider ?? engineDecision.selectedProvider,
      selectedRegion: allocation.region ?? engineDecision.selectedRegion,
    },
  )

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
      seked: sekedSnapshot(input.seked),
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
    await appendPglLifecycleEvent({
      organizationId: input.organizationId,
      systemId: input.pglSystemId,
      versionId: input.pglVersionId,
      runId: input.runId,
      eventType: 'run.execution_result',
      payload: {
        status: 'failed',
        error: envelope.error,
        convergeos,
        executionReference: allocation.executionReference,
        provider: generation.provider,
        model: generation.model,
      },
    })
    await createAlert(input.organizationId, input.runId, 'high', envelope.error)
    return envelope
  }

  const envelope = {
    runId: input.runId,
    status: 'completed',
    result: generation.output,
    seked: sekedSnapshot(input.seked),
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
  await appendPglLifecycleEvent({
    organizationId: input.organizationId,
    systemId: input.pglSystemId,
    versionId: input.pglVersionId,
    runId: input.runId,
    eventType: 'run.execution_result',
    payload: {
      status: 'completed',
      convergeos,
      executionReference: allocation.executionReference,
      provider: generation.provider,
      model: generation.model,
      outputPreview:
        generation.output && typeof generation.output === 'object'
          ? generation.output
          : { value: generation.output },
    },
  })
  return envelope
}

async function executeRunInBackground(input: {
  runId: string
  organizationId: string
  projectId: string
  payload: Record<string, any>
  seked: GovernanceSnapshot
  convergeos: ReliabilitySnapshot
  pglSystemId: string
  pglVersionId: string
}) {
  try {
    await completeRunExecution(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Governed execution failed'
    const envelope = {
      runId: input.runId,
      status: 'failed',
      result: null,
      seked: sekedSnapshot(input.seked),
      convergeos: input.convergeos,
      ecobe: null,
      auditId: input.runId,
      error: message,
    }

    await prisma.run.update({
      where: { id: input.runId },
      data: {
        status: 'failed',
        blockedReason: message,
        resultEnvelope: envelope as any,
        auditId: input.runId,
      },
    })

    await createRunEvent(input.runId, input.organizationId, 'run.failed', envelope)
    await appendPglLifecycleEvent({
      organizationId: input.organizationId,
      systemId: input.pglSystemId,
      versionId: input.pglVersionId,
      runId: input.runId,
      eventType: 'run.execution_result',
      payload: {
        status: 'failed',
        error: message,
      },
    })
    await createAlert(input.organizationId, input.runId, 'critical', message)
  }
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
