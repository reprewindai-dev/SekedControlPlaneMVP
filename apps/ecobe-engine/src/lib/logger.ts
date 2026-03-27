export type IntelligenceLogEvent =
  | 'INTELLIGENCE_FINGERPRINT_CREATED'
  | 'INTELLIGENCE_SIMILARITY_SEARCH'
  | 'INTELLIGENCE_OUTCOME_STORED'
  | 'INTELLIGENCE_OPTIMIZATION_APPLIED'
  | 'INTELLIGENCE_JOB_EXECUTED'

export function logIntelligenceEvent(event: IntelligenceLogEvent, details?: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...(details ?? {}),
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload))
}
