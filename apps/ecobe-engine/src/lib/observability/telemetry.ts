type MetricKind = 'counter' | 'histogram' | 'gauge'

type MetricAttributes = Record<string, string | number | boolean | null | undefined>

interface MetricRecord {
  name: string
  kind: MetricKind
  value: number
  attributes: MetricAttributes
  recordedAt: string
}

interface MetricSeries {
  kind: MetricKind
  records: MetricRecord[]
}

const MAX_RECORDS_PER_METRIC = 500
const metricStore = new Map<string, MetricSeries>()

function ensureSeries(name: string, kind: MetricKind) {
  const existing = metricStore.get(name)
  if (existing) return existing

  const series: MetricSeries = {
    kind,
    records: [],
  }
  metricStore.set(name, series)
  return series
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)] ?? null
}

export function recordTelemetryMetric(
  name: string,
  kind: MetricKind,
  value: number,
  attributes: MetricAttributes = {}
) {
  if (!Number.isFinite(value)) return

  const series = ensureSeries(name, kind)
  series.records.push({
    name,
    kind,
    value,
    attributes,
    recordedAt: new Date().toISOString(),
  })

  if (series.records.length > MAX_RECORDS_PER_METRIC) {
    series.records.splice(0, series.records.length - MAX_RECORDS_PER_METRIC)
  }
}

export function getTelemetrySnapshot() {
  const metrics = Array.from(metricStore.entries()).map(([name, series]) => {
    const values = series.records.map((record) => record.value)
    const last = series.records[series.records.length - 1] ?? null
    const total = values.reduce((sum, value) => sum + value, 0)

    return {
      name,
      kind: series.kind,
      samples: series.records.length,
      sum: Number(total.toFixed(3)),
      lastValue: last ? Number(last.value.toFixed(3)) : null,
      lastRecordedAt: last?.recordedAt ?? null,
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      attributes: last?.attributes ?? {},
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    metrics,
  }
}

export const telemetryMetricNames = {
  httpServerDurationMs: 'http.server.request.duration.ms',
  authorizationDecisionCount: 'ecobe.authorization.decision.count',
  authorizationDecisionLatencyMs: 'ecobe.authorization.decision.latency.ms',
  authorizationFailClosedCount: 'ecobe.authorization.fail_closed.count',
  authorizationActionCount: 'ecobe.authorization.action.count',
  authorizationFallbackCount: 'ecobe.authorization.fallback.count',
  authorizationDisagreementPct: 'ecobe.authorization.signal.disagreement.pct',
  policyEvaluationCount: 'ecobe.authorization.policy.evaluation.count',
  providerFreshnessSeconds: 'ecobe.provider.freshness.seconds',
  waterAuthorityFreshnessSeconds: 'ecobe.water.authority.freshness.seconds',
  waterScenarioPlanningCount: 'ecobe.water.scenario_planning.count',
  waterGuardrailTriggeredCount: 'ecobe.water.guardrail.triggered.count',
  precedenceOverrideCount: 'ecobe.authorization.precedence_override.count',
  waterSupplierFallbackRate: 'ecobe.water.supplier.fallback.rate',
  enforcementApplicationCount: 'ecobe.enforcement.application.count',
  enforcementSkippedCount: 'ecobe.enforcement.skipped.count',
  enforcementFailedCount: 'ecobe.enforcement.failed.count',
  proofExportCount: 'ecobe.proof.export.count',
  replayConsistencyCount: 'ecobe.replay.consistency.count',
  replayMismatchCount: 'ecobe.replay.mismatch.count',
  idempotencyReplayCount: 'ecobe.idempotency.replay.count',
  otelSpanExportCount: 'ecobe.otel.span.export.count',
  otelSpanExportFailureCount: 'ecobe.otel.span.export.failure.count',
  outboxLagSeconds: 'ecobe.outbox.lag.seconds',
} as const
