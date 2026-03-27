import { createHash } from 'crypto'

import { prisma } from './prisma'

type ReportingWindow = {
  periodStart?: Date
  periodEnd?: Date
}

type AuditExportInput = ReportingWindow & {
  organizationId: string
  runId?: string
  format: string
}

type ComplianceReportInput = ReportingWindow & {
  organizationId: string
  reportType: string
  framework?: string
}

function checksumFor(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function buildRunWhere(input: AuditExportInput | ComplianceReportInput) {
  return {
    organizationId: input.organizationId,
    ...(input.periodStart || input.periodEnd
      ? {
          createdAt: {
            ...(input.periodStart ? { gte: input.periodStart } : {}),
            ...(input.periodEnd ? { lte: input.periodEnd } : {}),
          },
        }
      : {}),
  }
}

export async function generateAuditExport(input: AuditExportInput) {
  const pendingExport = await prisma.auditExport.create({
    data: {
      organizationId: input.organizationId,
      runId: input.runId,
      format: input.format,
      status: 'processing',
      filters: {
        runId: input.runId ?? null,
        periodStart: input.periodStart?.toISOString() ?? null,
        periodEnd: input.periodEnd?.toISOString() ?? null,
      } as any,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    },
  })

  const runWhere = {
    ...buildRunWhere(input),
    ...(input.runId ? { id: input.runId } : {}),
  }

  const [organization, runs, activePolicies, webhookDeliveries] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        planTier: true,
      },
    }),
    prisma.run.findMany({
      where: runWhere,
      orderBy: { createdAt: 'desc' },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        environment: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        policyVersion: {
          select: {
            id: true,
            version: true,
            rules: true,
            policyProfile: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            eventType: true,
            payload: true,
            signature: true,
            createdAt: true,
          },
        },
        usageRecords: {
          orderBy: { recordedAt: 'asc' },
          select: {
            id: true,
            metric: true,
            quantity: true,
            unit: true,
            amountUsd: true,
            recordedAt: true,
          },
        },
        approvalRequest: {
          select: {
            id: true,
            status: true,
            reason: true,
            createdAt: true,
          },
        },
        alerts: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            severity: true,
            message: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.policyVersion.findMany({
      where: {
        isActive: true,
        policyProfile: {
          organizationId: input.organizationId,
        },
      },
      select: {
        id: true,
        version: true,
        rules: true,
        createdAt: true,
        policyProfile: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.webhookDelivery.count({
      where: {
        organizationId: input.organizationId,
        ...(input.periodStart || input.periodEnd
          ? {
              createdAt: {
                ...(input.periodStart ? { gte: input.periodStart } : {}),
                ...(input.periodEnd ? { lte: input.periodEnd } : {}),
              },
            }
          : {}),
      },
    }),
  ])

  const completedRuns = runs.filter((run) => run.status === 'completed').length
  const blockedRuns = runs.filter((run) => run.status === 'blocked').length
  const approvalRuns = runs.filter((run) => run.status === 'approval_required').length
  const failedRuns = runs.filter((run) => run.status === 'failed').length
  const totalUsageUsd = runs.reduce(
    (sum, run) => sum + run.usageRecords.reduce((innerSum, record) => innerSum + record.amountUsd, 0),
    0
  )

  const artifact = {
    generatedAt: new Date().toISOString(),
    organization,
    summary: {
      format: input.format,
      runCount: runs.length,
      completedRuns,
      blockedRuns,
      approvalRuns,
      failedRuns,
      activePolicyCount: activePolicies.length,
      webhookDeliveryCount: webhookDeliveries,
      totalUsageUsd: Number(totalUsageUsd.toFixed(2)),
    },
    activePolicies,
    runs,
  }

  const checksum = checksumFor(artifact)

  return prisma.auditExport.update({
    where: { id: pendingExport.id },
    data: {
      status: 'completed',
      artifact: artifact as any,
      checksum,
      completedAt: new Date(),
    },
  })
}

export async function generateComplianceReport(input: ComplianceReportInput) {
  const pendingReport = await prisma.complianceReport.create({
    data: {
      organizationId: input.organizationId,
      reportType: input.reportType,
      framework: input.framework ?? 'seked_control_plane',
      status: 'processing',
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    },
  })

  const runWhere = buildRunWhere(input)
  const alertWhere = {
    organizationId: input.organizationId,
    ...(input.periodStart || input.periodEnd
      ? {
          createdAt: {
            ...(input.periodStart ? { gte: input.periodStart } : {}),
            ...(input.periodEnd ? { lte: input.periodEnd } : {}),
          },
        }
      : {}),
  }

  const [
    organization,
    runs,
    alerts,
    pendingApprovals,
    activePolicies,
    recentAuditExports,
    billingAccount,
  ] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        planTier: true,
      },
    }),
    prisma.run.findMany({
      where: runWhere,
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        approvalRequired: true,
      },
    }),
    prisma.alert.findMany({
      where: alertWhere,
      select: {
        id: true,
        severity: true,
        message: true,
        runId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.approvalRequest.count({
      where: {
        organizationId: input.organizationId,
        status: 'pending',
      },
    }),
    prisma.policyVersion.count({
      where: {
        isActive: true,
        policyProfile: {
          organizationId: input.organizationId,
        },
      },
    }),
    prisma.auditExport.count({
      where: {
        organizationId: input.organizationId,
        status: 'completed',
      },
    }),
    prisma.billingAccount.findUnique({
      where: { organizationId: input.organizationId },
      select: {
        status: true,
        subscriptions: {
          select: {
            planTier: true,
            status: true,
            currentPeriodEnd: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    }),
  ])

  const totalRuns = runs.length
  const completedRuns = runs.filter((run) => run.status === 'completed').length
  const blockedRuns = runs.filter((run) => run.status === 'blocked').length
  const failedRuns = runs.filter((run) => run.status === 'failed').length
  const approvalRuns = runs.filter((run) => run.status === 'approval_required').length
  const criticalAlerts = alerts.filter((alert) => alert.severity.toLowerCase() === 'critical').length
  const highAlerts = alerts.filter((alert) => alert.severity.toLowerCase() === 'high').length

  const failureRate = totalRuns === 0 ? 0 : failedRuns / totalRuns
  const blockedRate = totalRuns === 0 ? 0 : blockedRuns / totalRuns
  const approvalRate = totalRuns === 0 ? 0 : approvalRuns / totalRuns

  const findings: Array<{
    severity: 'info' | 'medium' | 'high' | 'critical'
    code: string
    message: string
    metric?: number
  }> = []

  if (activePolicies === 0) {
    findings.push({
      severity: 'critical',
      code: 'POLICY_GAP',
      message: 'No active governance policy is attached to this organization.',
    })
  }

  if (pendingApprovals > 0) {
    findings.push({
      severity: pendingApprovals > 5 ? 'high' : 'medium',
      code: 'PENDING_APPROVALS',
      message: `${pendingApprovals} approval requests remain unresolved.`,
      metric: pendingApprovals,
    })
  }

  if (criticalAlerts > 0 || highAlerts > 0) {
    findings.push({
      severity: criticalAlerts > 0 ? 'critical' : 'high',
      code: 'OPEN_ALERTS',
      message: `${criticalAlerts} critical and ${highAlerts} high-severity alerts were recorded in the reporting window.`,
      metric: criticalAlerts + highAlerts,
    })
  }

  if (failureRate >= 0.1) {
    findings.push({
      severity: failureRate >= 0.25 ? 'critical' : 'high',
      code: 'FAILURE_RATE',
      message: `Run failure rate is ${(failureRate * 100).toFixed(1)}%, above the control-plane target.`,
      metric: Number((failureRate * 100).toFixed(2)),
    })
  }

  if (blockedRate >= 0.2) {
    findings.push({
      severity: blockedRate >= 0.4 ? 'high' : 'medium',
      code: 'BLOCK_RATE',
      message: `Run block rate is ${(blockedRate * 100).toFixed(1)}%, indicating elevated governance friction.`,
      metric: Number((blockedRate * 100).toFixed(2)),
    })
  }

  const overallStatus =
    findings.some((finding) => finding.severity === 'critical')
      ? 'critical'
      : findings.some((finding) => finding.severity === 'high')
        ? 'attention_required'
        : 'pass'

  const summary = {
    generatedAt: new Date().toISOString(),
    organization,
    reportType: input.reportType,
    framework: input.framework ?? 'seked_control_plane',
    overallStatus,
    totalRuns,
    completedRuns,
    blockedRuns,
    failedRuns,
    approvalRuns,
    approvalRate: Number((approvalRate * 100).toFixed(2)),
    failureRate: Number((failureRate * 100).toFixed(2)),
    blockedRate: Number((blockedRate * 100).toFixed(2)),
    activePolicies,
    completedAuditExports: recentAuditExports,
    billingStatus: billingAccount?.status ?? 'unconfigured',
    subscriptionPlanTier: billingAccount?.subscriptions[0]?.planTier ?? organization.planTier,
  }

  return prisma.complianceReport.update({
    where: { id: pendingReport.id },
    data: {
      status: 'completed',
      summary: summary as any,
      findings: findings as any,
      completedAt: new Date(),
    },
  })
}
