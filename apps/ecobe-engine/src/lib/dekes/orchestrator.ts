import { randomUUID } from 'crypto'
import {
  AggregatedCandidate,
  AgentResult,
  DiscoveryTrigger,
  LeadCandidate,
  SpecialistName,
  VerificationReport,
  aggregationInputSchema,
  agentResultSchema,
  discoveryTriggerSchema,
  leadCandidateSchema,
  verificationReportSchema,
  LeadCandidatePublisher,
  Aggregator,
  Verifier,
} from './types'

export interface OrchestratorConfig {
  parallelism: number
  agentTimeoutMs: number
  aggregationTimeoutMs: number
  verificationTimeoutMs: number
  log: (entry: Record<string, unknown>) => void
  metrics: {
    increment: (metric: string, value?: number, tags?: Record<string, string>) => void
    histogram: (metric: string, value: number, tags?: Record<string, string>) => void
  }
}

export interface SpecialistRegistryEntry {
  name: SpecialistName
  run: (trigger: DiscoveryTrigger, signal: AbortSignal) => Promise<AgentResult>
}

export class DekesOrchestrator {
  private readonly specialistMap: Map<SpecialistName, SpecialistRegistryEntry>
  private readonly config: OrchestratorConfig
  private readonly aggregator: Aggregator
  private readonly verifier: Verifier
  private readonly publisher: LeadCandidatePublisher

  constructor(
    registry: SpecialistRegistryEntry[],
    aggregator: Aggregator,
    verifier: Verifier,
    publisher: LeadCandidatePublisher,
    config: OrchestratorConfig
  ) {
    this.specialistMap = new Map(registry.map((entry) => [entry.name, entry]))
    this.config = config
    this.aggregator = aggregator
    this.verifier = verifier
    this.publisher = publisher
  }

  async execute(rawTrigger: unknown): Promise<LeadCandidate> {
    const parseStart = Date.now()
    const trigger = discoveryTriggerSchema.parse(rawTrigger)
    this.config.metrics.histogram('dekes.orchestrator.trigger_parse_ms', Date.now() - parseStart)

    const agentNames = this.resolveAgents(trigger)
    const agentResults = await this.runSpecialists(trigger, agentNames)

    const aggregation = await this.runAggregation(trigger, agentResults)
    const verification = await this.runVerification(aggregation)

    const leadCandidate = this.buildLeadCandidate(aggregation, verification)

    await this.publisher.publish(leadCandidate)

    this.config.metrics.increment('dekes.orchestrator.success')
    this.config.log({
      event: 'dekes.orchestrator.executed',
      triggerId: trigger.triggerId,
      orgId: trigger.orgId,
      agentCount: agentNames.length,
      verificationPassed: verification.pass,
    })

    return leadCandidate
  }

  private resolveAgents(trigger: DiscoveryTrigger): SpecialistName[] {
    const configured = trigger.requestedAgents
    const unique = Array.from(new Set(configured))
    const missing = unique.filter((name) => !this.specialistMap.has(name))
    if (missing.length > 0) {
      throw new Error(`Unsupported specialist agents requested: ${missing.join(', ')}`)
    }
    return unique
  }

  private async runSpecialists(trigger: DiscoveryTrigger, agents: SpecialistName[]): Promise<AgentResult[]> {
    const controller = new AbortController()
    const timeoutHandles = new Map<SpecialistName, NodeJS.Timeout>()

    const tasks = agents.map(async (name) => {
      const entry = this.specialistMap.get(name)
      if (!entry) {
        throw new Error(`Specialist ${name} is not registered`)
      }

      const start = Date.now()
      try {
        const timeoutHandle = setTimeout(() => controller.abort(), this.config.agentTimeoutMs)
        timeoutHandles.set(name, timeoutHandle)
        const result = await entry.run(trigger, controller.signal)
        clearTimeout(timeoutHandle)
        const parsed = agentResultSchema.parse(result)
        this.config.metrics.histogram(`dekes.agent.${name}.latency_ms`, Date.now() - start)
        this.config.metrics.increment(`dekes.agent.${name}.success`)
        return parsed
      } catch (error) {
        this.config.metrics.increment(`dekes.agent.${name}.failure`)
        this.config.log({
          level: 'error',
          event: 'dekes.agent.failed',
          agent: name,
          triggerId: trigger.triggerId,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        const handle = timeoutHandles.get(name)
        if (handle) {
          clearTimeout(handle)
        }
      }
    })

    if (tasks.length <= this.config.parallelism) {
      return Promise.all(tasks)
    }

    const results: AgentResult[] = []
    const executing = new Set<Promise<void>>()

    for (const task of tasks) {
      const wrapped = (async () => {
        const value = await task
        results.push(value)
      })()
      executing.add(wrapped)
      wrapped.finally(() => executing.delete(wrapped)).catch(() => {})

      if (executing.size >= this.config.parallelism) {
        await Promise.race(executing)
      }
    }

    await Promise.all(executing)
    return results
  }

  private async runAggregation(trigger: DiscoveryTrigger, agentResponses: AgentResult[]): Promise<AggregatedCandidate> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.aggregationTimeoutMs)

    const start = Date.now()
    try {
      const input = aggregationInputSchema.parse({ trigger, agentResponses })
      const aggregated = await this.aggregator.aggregate(input, controller.signal)
      this.config.metrics.histogram('dekes.aggregation.latency_ms', Date.now() - start)
      this.config.metrics.increment('dekes.aggregation.success')
      return aggregated
    } catch (error) {
      this.config.metrics.increment('dekes.aggregation.failure')
      this.config.log({
        level: 'error',
        event: 'dekes.aggregation.failed',
        triggerId: trigger.triggerId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  private async runVerification(candidate: AggregatedCandidate): Promise<VerificationReport> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.verificationTimeoutMs)
    const start = Date.now()
    try {
      const verified = await this.verifier.verify(candidate, controller.signal)
      const parsed = verificationReportSchema.parse(verified)
      this.config.metrics.histogram('dekes.verification.latency_ms', Date.now() - start)
      this.config.metrics.increment('dekes.verification.success')
      return parsed
    } catch (error) {
      this.config.metrics.increment('dekes.verification.failure')
      this.config.log({
        level: 'error',
        event: 'dekes.verification.failed',
        candidateTriggerId: candidate.triggerId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  private buildLeadCandidate(candidate: AggregatedCandidate, verification: VerificationReport): LeadCandidate {
    const payload = {
      candidateId: randomUUID(),
      orgId: candidate.orgId,
      company: candidate.company,
      domain: candidate.domain,
      primaryContact: candidate.primaryContact,
      businessType: candidate.businessType,
      intentScore: candidate.intentScore,
      icpFitScore: candidate.icpFitScore,
      sourceSignals: candidate.signals,
      riskFlags: candidate.riskFlags,
      verificationStatus: verification.pass ? 'passed' : verification.fallbackRequired ? 'fallback' : 'failed',
      metadata: {
        confidenceBreakdown: candidate.confidenceBreakdown,
        rawAgentFindings: candidate.rawAgentFindings,
        verification,
      },
    }

    return leadCandidateSchema.parse(payload)
  }
}
