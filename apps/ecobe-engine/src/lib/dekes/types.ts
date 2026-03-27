import { z } from 'zod'

export const discoveryTriggerSchema = z.object({
  triggerId: z.string().min(1),
  orgId: z.string().min(1),
  query: z.object({
    value: z.string().min(1),
    domain: z.string().min(1).toLowerCase(),
    locale: z.string().min(2).max(10).default('en-US'),
  }),
  requestedAgents: z
    .array(z.enum(['company', 'domain_contact', 'intent', 'icp']))
    .default(['company', 'domain_contact', 'intent', 'icp']),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  deadlineAt: z.coerce.date().optional(),
  metadata: z
    .object({
      source: z.string().optional(),
      userId: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .default({}),
})

export type DiscoveryTrigger = z.infer<typeof discoveryTriggerSchema>

export const companyIntelligenceSchema = z.object({
  agent: z.literal('company'),
  confidence: z.number().min(0).max(1),
  findings: z.object({
    companyProfile: z.string().nullable(),
    businessType: z.string().nullable(),
    sizeEstimate: z.string().nullable(),
    category: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    signals: z.array(z.string()),
  }),
  issues: z.array(z.string()).default([]),
})

export type CompanyIntelligenceResult = z.infer<typeof companyIntelligenceSchema>

export const domainContactSchema = z.object({
  agent: z.literal('domain_contact'),
  confidence: z.number().min(0).max(1),
  findings: z.object({
    domain: z.string(),
    primaryContacts: z
      .array(
        z.object({
          email: z.string().email().nullable(),
          name: z.string().nullable(),
          role: z.string().nullable(),
          confidence: z.number().min(0).max(1),
          decisionMakerLikelihood: z.number().min(0).max(1).nullable(),
        })
      )
      .default([]),
    emailPattern: z.string().nullable(),
    mxConfidence: z.number().min(0).max(1).nullable(),
    deliverabilityRisk: z.enum(['low', 'medium', 'high']).nullable(),
  }),
  issues: z.array(z.string()).default([]),
})

export type DomainContactResult = z.infer<typeof domainContactSchema>

export const intentSignalSchema = z.object({
  agent: z.literal('intent'),
  confidence: z.number().min(0).max(1),
  findings: z.object({
    intentScore: z.number().min(0).max(1),
    urgency: z.enum(['low', 'medium', 'high']).nullable(),
    signals: z.array(z.string()),
    platformBreakdown: z
      .record(
        z.object({
          score: z.number().min(0).max(1),
          evidence: z.array(z.string()).default([]),
        })
      )
      .default({}),
  }),
  issues: z.array(z.string()).default([]),
})

export type IntentSignalResult = z.infer<typeof intentSignalSchema>

export const icpSimilaritySchema = z.object({
  agent: z.literal('icp'),
  confidence: z.number().min(0).max(1),
  findings: z.object({
    icpFitScore: z.number().min(0).max(1),
    matchedSegment: z.string().nullable(),
    similarCustomers: z.array(
      z.object({
        name: z.string(),
        similarity: z.number().min(0).max(1),
      })
    ),
    riskFlags: z.array(z.string()),
  }),
  issues: z.array(z.string()).default([]),
})

export type IcpSimilarityResult = z.infer<typeof icpSimilaritySchema>

export const agentResultSchema = z.discriminatedUnion('agent', [
  companyIntelligenceSchema,
  domainContactSchema,
  intentSignalSchema,
  icpSimilaritySchema,
])

export type AgentResult = z.infer<typeof agentResultSchema>

export const aggregationInputSchema = z.object({
  trigger: discoveryTriggerSchema,
  agentResponses: z.array(agentResultSchema),
})

export type AggregationInput = z.infer<typeof aggregationInputSchema>

export type SpecialistName = AgentResult['agent']

export const aggregatedCandidateSchema = z.object({
  triggerId: z.string(),
  orgId: z.string(),
  domain: z.string(),
  company: z.string().nullable(),
  primaryContact: z.object({
    name: z.string().nullable(),
    role: z.string().nullable(),
    email: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
  }),
  businessType: z.string().nullable(),
  intentScore: z.number().min(0).max(1),
  icpFitScore: z.number().min(0).max(1),
  category: z.string().nullable(),
  signals: z.array(z.string()),
  riskFlags: z.array(z.string()),
  confidenceBreakdown: z.record(z.number().min(0).max(1)),
  rawAgentFindings: z.array(agentResultSchema),
})

export type AggregatedCandidate = z.infer<typeof aggregatedCandidateSchema>

export const verificationReportSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  fallbackRequired: z.boolean(),
  missingFields: z.array(z.string()),
})

export type VerificationReport = z.infer<typeof verificationReportSchema>

export const leadCandidateSchema = z.object({
  candidateId: z.string(),
  orgId: z.string(),
  company: z.string().nullable(),
  domain: z.string(),
  primaryContact: z.object({
    name: z.string().nullable(),
    role: z.string().nullable(),
    email: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
  }),
  businessType: z.string().nullable(),
  intentScore: z.number().min(0).max(1),
  icpFitScore: z.number().min(0).max(1),
  sourceSignals: z.array(z.string()),
  riskFlags: z.array(z.string()),
  verificationStatus: z.enum(['passed', 'failed', 'fallback']),
  metadata: z.record(z.any()).default({}),
})

export type LeadCandidate = z.infer<typeof leadCandidateSchema>

export interface AgentExecutionContext {
  trigger: DiscoveryTrigger
  startTime: Date
  timeoutMs: number
}

export interface SpecialistAgent<T extends AgentResult = AgentResult> {
  name: T['agent']
  run(context: AgentExecutionContext, signal: AbortSignal): Promise<T>
}

export interface Aggregator {
  aggregate(input: AggregationInput, signal: AbortSignal): Promise<AggregatedCandidate>
}

export interface Verifier {
  verify(candidate: AggregatedCandidate, signal: AbortSignal): Promise<VerificationReport>
}

export interface LeadCandidatePublisher {
  publish(candidate: LeadCandidate): Promise<void>
}
