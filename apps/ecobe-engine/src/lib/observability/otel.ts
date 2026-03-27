import { randomUUID } from 'crypto'

import { env } from '../../config/env'
import { recordTelemetryMetric, telemetryMetricNames } from './telemetry'

export type DecisionSpanRecord = {
  traceId: string
  spanId: string
  spanName: string
  serviceName: string
  startedAt: string
  endedAt: string
  durationMs: number
  attributes: Record<string, string | number | boolean>
}

function randomHex(bytes: number) {
  return randomUUID().replace(/-/g, '').slice(0, bytes * 2)
}

export function buildDecisionSpanRecord(input: {
  startedAt: Date
  endedAt: Date
  decisionFrameId: string
  action: string
  reasonCode: string
  operatingMode: string
  proofHash: string
  fallbackUsed: boolean
  runtime: string
  regionSelected: string
  adapterId: string
  transport: string
  traceId?: string
}) {
  const durationMs = Math.max(0, input.endedAt.getTime() - input.startedAt.getTime())
  const traceId = input.traceId?.trim() || randomHex(16)
  const spanId = randomHex(8)
  const attributes = {
    'ecobe.decision_frame_id': input.decisionFrameId,
    'ecobe.action': input.action,
    'ecobe.reason_code': input.reasonCode,
    'ecobe.operating_mode': input.operatingMode,
    'ecobe.proof_hash': input.proofHash,
    'ecobe.fallback_used': input.fallbackUsed,
    'ecobe.runtime': input.runtime,
    'ecobe.region_selected': input.regionSelected,
    'ecobe.adapter_id': input.adapterId,
    'ecobe.transport': input.transport,
  }

  return {
    traceId,
    spanId,
    spanName: 'ecobe.decision.authorize',
    serviceName: env.OTEL_SERVICE_NAME,
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    durationMs,
    attributes,
  } satisfies DecisionSpanRecord
}

export async function exportDecisionSpanRecord(span: DecisionSpanRecord) {
  if (!env.OTEL_EXPORT_ENABLED || !env.OTEL_EXPORT_ENDPOINT) {
    return {
      enabled: false,
      exported: false,
      endpoint: null,
    }
  }

  try {
    const response = await fetch(env.OTEL_EXPORT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resource: {
          service: {
            name: span.serviceName,
          },
        },
        spans: [span],
      }),
      signal: AbortSignal.timeout(Math.max(250, env.OTEL_EXPORT_TIMEOUT_MS)),
    })

    if (!response.ok) {
      recordTelemetryMetric(telemetryMetricNames.otelSpanExportFailureCount, 'counter', 1, {
        status_code: response.status,
      })
      return {
        enabled: true,
        exported: false,
        endpoint: env.OTEL_EXPORT_ENDPOINT,
        statusCode: response.status,
      }
    }

    recordTelemetryMetric(telemetryMetricNames.otelSpanExportCount, 'counter', 1, {
      service: span.serviceName,
    })

    return {
      enabled: true,
      exported: true,
      endpoint: env.OTEL_EXPORT_ENDPOINT,
      statusCode: response.status,
    }
  } catch (error) {
    recordTelemetryMetric(telemetryMetricNames.otelSpanExportFailureCount, 'counter', 1, {
      error: error instanceof Error ? error.message : 'unknown',
    })
    return {
      enabled: true,
      exported: false,
      endpoint: env.OTEL_EXPORT_ENDPOINT,
      error: error instanceof Error ? error.message : 'Unknown export error',
    }
  }
}
