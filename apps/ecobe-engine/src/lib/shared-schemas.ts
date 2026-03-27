/**
 * Shared Integration Schemas
 * Centralized schema definitions to ensure contract consistency across CO₂Router ecosystem
 */

import { z } from 'zod'

// =============================================================================
// CARBON COMMAND SCHEMA (Shared between CO₂Router Engine and DKS SaaS)
// =============================================================================

export const CarbonPriorityEnum = z.enum(['low', 'medium', 'high']).default('medium')
export const ExecutionModeEnum = z.enum(['immediate', 'scheduled', 'advisory']).default('immediate')
export const WorkloadTypeEnum = z.enum([
  'inference',
  'training', 
  'batch',
  // DKS-specific types
  'signal_harvesting',
  'evidence_validation', 
  'lead_scoring',
  'query_processing'
])

export const CarbonCommandPayloadSchema = z.object({
  // Core identification
  orgId: z.string().min(1, 'orgId is required'),
  workloadId: z.string().optional(), // Optional for backward compatibility
  
  // Source attribution - CRITICAL for integration tracking
  sourceApp: z.enum(['dks', 'direct', 'api']).optional(),
  metadata: z.record(z.any()).optional(),
  
  // Workload characteristics
  workload: z.object({
    type: WorkloadTypeEnum,
    modelFamily: z.string().optional(),
    estimatedGpuHours: z.number().nonnegative().optional(),
    estimatedCpuHours: z.number().nonnegative().optional(),
    estimatedMemoryGb: z.number().positive().optional(),
  }).refine((value) => typeof value.estimatedGpuHours === 'number' || typeof value.estimatedCpuHours === 'number', {
    message: 'Provide estimatedGpuHours and/or estimatedCpuHours to produce a decision',
    path: ['estimatedGpuHours'],
  }),
  
  // Constraints
  constraints: z.object({
    maxLatencyMs: z.number().positive().optional(),
    deadlineAt: z.string().datetime().optional(),
    mustRunRegions: z.array(z.string()).max(20).optional(),
    excludedRegions: z.array(z.string()).max(20).optional(),
    carbonPriority: CarbonPriorityEnum.optional(),
    costPriority: CarbonPriorityEnum.optional(),
    latencyPriority: CarbonPriorityEnum.optional(),
  }).refine((value) => value.maxLatencyMs !== undefined || value.deadlineAt !== undefined, {
    message: 'Provide at least maxLatencyMs or deadlineAt to avoid vague requests',
    path: ['maxLatencyMs'],
  }),
  
  // Execution preferences
  execution: z.object({
    mode: ExecutionModeEnum.optional(),
    candidateStartWindowHours: z.number().int().positive().max(168).optional(),
  }).optional(),
  
  // Performance preferences
  preferences: z.object({
    allowTimeShifting: z.boolean().optional(),
    allowCrossRegionExecution: z.boolean().optional(),
    requireCreditCoverage: z.boolean().optional(),
  }).optional(),
})

export type CarbonCommandPayload = z.infer<typeof CarbonCommandPayloadSchema>

// =============================================================================
// CARBON OUTCOME SCHEMA (Shared for reporting actual execution)
// =============================================================================

export const MeasurementSourceEnum = z.enum(['estimated', 'provider-reported', 'metered'])

export const CarbonOutcomeSchema = z.object({
  commandId: z.string().min(1, 'commandId is required'),
  orgId: z.string().min(1, 'orgId is required'),
  sourceApp: z.enum(['dks', 'direct', 'api']).optional(),
  
  // Execution results
  execution: z.object({
    actualRegion: z.string().min(1, 'execution.actualRegion is required'),
    actualStartAt: z.string().datetime('execution.actualStartAt must be an ISO timestamp'),
    actualEndAt: z.string().datetime().optional(),
    actualLatencyMs: z.number().nonnegative().optional(),
    actualGpuHours: z.number().nonnegative().optional(),
    actualCpuHours: z.number().nonnegative().optional(),
    actualMemoryGb: z.number().nonnegative().optional(),
  }).refine((value) => value.actualEndAt || value.actualGpuHours !== undefined || value.actualCpuHours !== undefined, {
    message: 'Provide execution.actualEndAt or actual workload hours to derive duration',
    path: ['actualEndAt'],
  }),
  
  // Emissions data
  emissions: z.object({
    actualCarbonIntensity: z.number().nonnegative().optional(),
    source: MeasurementSourceEnum.optional(),
    estimatedKgCO2e: z.number().nonnegative().optional(),
  }).optional(),
  
  // Additional metadata
  metadata: z.record(z.any()).optional(),
})

export type CarbonOutcome = z.infer<typeof CarbonOutcomeSchema>

// =============================================================================
// DKS-SPECIFIC EXTENSIONS
// =============================================================================

export const DksWorkloadPayloadSchema = CarbonCommandPayloadSchema.extend({
  // DKS-specific identification
  workloadId: z.string().min(1, 'workloadId is required'),
  userId: z.string().optional(),
  sourceApp: z.literal('dks'),
  
  // DKS workload types (more specific than generic types)
  workloadType: z.enum([
    'signal_harvesting', 
    'evidence_validation', 
    'lead_scoring', 
    'query_processing'
  ]),
  
  // DKS-specific timing
  durationMinutes: z.number().positive().optional(),
  
  // DKS-specific metadata structure
  metadata: z.object({
    // Lead/Run context
    leadId: z.string().optional(),
    queryId: z.string().optional(),
    runId: z.string().optional(),
    
    // Signal context
    signalType: z.string().optional(),
    signalCount: z.number().optional(),
    
    // Organization context
    organizationName: z.string().optional(),
    plan: z.string().optional(),
    
    // DKS internal tracking
    sessionId: z.string().optional(),
    requestId: z.string().optional(),
    
    // Performance metrics
    estimatedQueries: z.number().optional(),
    complexity: z.enum(['simple', 'medium', 'complex']).optional(),
  }).optional(),
  
  // Timestamp
  timestamp: z.string().datetime().default(() => new Date().toISOString()),
})

export type DksWorkloadPayload = z.infer<typeof DksWorkloadPayloadSchema>

// =============================================================================
// INTEGRATION RESPONSE SCHEMAS
// =============================================================================

export const DksWorkloadResponseSchema = z.object({
  success: z.boolean(),
  commandId: z.string().optional(),
  recommendation: z.object({
    selectedRegion: z.string(),
    estimatedCO2: z.number().optional(),
    scheduledTime: z.string().optional(),
    confidence: z.number().optional(),
    reasoning: z.string().optional(),
  }).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
})

export type DksWorkloadResponse = z.infer<typeof DksWorkloadResponseSchema>

// =============================================================================
// DASHBOARD RESPONSE SCHEMAS
// =============================================================================

export const DksIntegrationSummarySchema = z.object({
  integration: z.literal('DEKES'),
  status: z.enum(['active', 'inactive', 'error']),
  lastSyncAt: z.string().datetime().optional(),
  metrics: z.object({
    totalWorkloads: z.number(),
    successfulWorkloads: z.number(),
    carbonSaved: z.number().optional(),
    averageResponseTime: z.number().optional(),
  }),
})

export type DksIntegrationSummary = z.infer<typeof DksIntegrationSummarySchema>

export const DksIntegrationMetricsSchema = z.object({
  integration: z.literal('DEKES'),
  status: z.enum(['active', 'inactive', 'error']),
  timeframe: z.string(),
  metrics: z.object({
    workloadsByType: z.record(z.number()),
    carbonSavingsByType: z.record(z.number()),
    successRate: z.number(),
    averageLatency: z.number(),
    errorRate: z.number(),
  }),
  hourlyTrend: z.array(z.object({
    hour: z.string(),
    workloads: z.number(),
    carbonSaved: z.number(),
    successRate: z.number(),
  })),
})

export type DksIntegrationMetrics = z.infer<typeof DksIntegrationMetricsSchema>

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

export function validateDksToCarbonCommand(dksPayload: unknown): CarbonCommandPayload {
  return DksWorkloadPayloadSchema.parse(dksPayload)
}

export function validateCarbonOutcome(outcome: unknown): CarbonOutcome {
  return CarbonOutcomeSchema.parse(outcome)
}

export function validateDksIntegrationSummary(summary: unknown): DksIntegrationSummary {
  return DksIntegrationSummarySchema.parse(summary)
}

export function validateDksIntegrationMetrics(metrics: unknown): DksIntegrationMetrics {
  return DksIntegrationMetricsSchema.parse(metrics)
}

// =============================================================================
// CONTRACT VERSIONING
// =============================================================================

export const SCHEMA_VERSION = '1.0.0'

export interface SchemaContract {
  version: string
  carbonCommand: typeof CarbonCommandPayloadSchema
  carbonOutcome: typeof CarbonOutcomeSchema
  dksWorkload: typeof DksWorkloadPayloadSchema
  dksResponse: typeof DksWorkloadResponseSchema
  integrationSummary: typeof DksIntegrationSummarySchema
  integrationMetrics: typeof DksIntegrationMetricsSchema
}

export const CURRENT_CONTRACT: SchemaContract = {
  version: SCHEMA_VERSION,
  carbonCommand: CarbonCommandPayloadSchema,
  carbonOutcome: CarbonOutcomeSchema,
  dksWorkload: DksWorkloadPayloadSchema,
  dksResponse: DksWorkloadResponseSchema,
  integrationSummary: DksIntegrationSummarySchema,
  integrationMetrics: DksIntegrationMetricsSchema,
}
