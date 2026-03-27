/**
 * GridStatus.io API Client
 *
 * Provides access to EIA-930 data via GridStatus.io's curated API.
 * Returns data mapped to the same internal types used by the existing EIA parsers,
 * plus a new fuel mix endpoint with real per-fuel-type generation data.
 *
 * SIGNAL DOCTRINE: EIA-930 = predictive telemetry (not routing truth)
 * This adapter replaces direct EIA API calls when GRIDSTATUS_API_KEY is set.
 */

import axios from 'axios'
import { env } from '../../config/env'
import { recordIntegrationFailure, recordIntegrationSuccess } from '../integration-metrics'
import { eiaResilience } from '../resilience'
import { EIABalanceData, EIAInterchangeData, GridStatusFuelMixData } from './types'

const GRIDSTATUS_BASE_URL = 'https://api.gridstatus.io/v1/datasets'
const REQUEST_TIMEOUT = 15000

export class GridStatusClient {
  private apiKey?: string

  constructor() {
    this.apiKey = env.GRIDSTATUS_API_KEY
  }

  get isAvailable(): boolean {
    return !!this.apiKey
  }

  private async logSuccess() {
    try {
      await recordIntegrationSuccess('GRIDSTATUS')
    } catch (error) {
      console.warn('Failed to record GridStatus success metric:', error)
    }
  }

  private async logFailure(message: string) {
    try {
      await recordIntegrationFailure('GRIDSTATUS', message)
    } catch (error) {
      console.warn('Failed to record GridStatus failure metric:', error)
    }
  }

  /**
   * Fetch EIA regional hourly data (load, net_generation, total_interchange)
   * Maps response to EIABalanceData[] for compatibility with BalanceParser
   */
  async getBalance(
    balancingAuthority: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<EIABalanceData[]> {
    if (!this.apiKey) {
      await this.logFailure('Missing GridStatus API key')
      return []
    }

    try {
      const params: Record<string, string> = {
        api_key: this.apiKey,
        limit: '5000',
      }

      if (startTime) params.start_time = startTime.toISOString().slice(0, 10)
      if (endTime) params.end_time = endTime.toISOString().slice(0, 10)

      // Filter to specific BA
      params.filter_column = 'respondent'
      params.filter_value = balancingAuthority

      const response = await eiaResilience.execute('gridstatus-regional', () =>
        axios.get<GridStatusRegionalResponse>(
          `${GRIDSTATUS_BASE_URL}/eia_regional_hourly/query`,
          { params, timeout: REQUEST_TIMEOUT }
        )
      )

      const records = response.data.data || []
      await this.logSuccess()

      // Map each GridStatus record → 3 EIABalanceData records (D, NG, TI)
      const result: EIABalanceData[] = []
      for (const record of records) {
        const period = record.interval_start_utc

        if (record.load !== null && record.load !== undefined) {
          result.push({
            period,
            respondent: record.respondent,
            'respondent-name': record.respondent_name,
            type: 'D',
            value: record.load,
            'value-units': 'megawatthours',
          })
        }

        if (record.net_generation !== null && record.net_generation !== undefined) {
          result.push({
            period,
            respondent: record.respondent,
            'respondent-name': record.respondent_name,
            type: 'NG',
            value: record.net_generation,
            'value-units': 'megawatthours',
          })
        }

        if (record.total_interchange !== null && record.total_interchange !== undefined) {
          result.push({
            period,
            respondent: record.respondent,
            'respondent-name': record.respondent_name,
            type: 'TI',
            value: record.total_interchange,
            'value-units': 'megawatthours',
          })
        }
      }

      return result
    } catch (error: any) {
      console.error(`GridStatus: Failed to fetch regional data for ${balancingAuthority}:`, error.message)
      await this.logFailure(error.message ?? 'Failed to fetch regional data')
      return []
    }
  }

  /**
   * Fetch EIA BA interchange hourly data
   * Maps response to EIAInterchangeData[] for compatibility with InterchangeParser
   */
  async getInterchange(
    balancingAuthority: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<EIAInterchangeData[]> {
    if (!this.apiKey) {
      await this.logFailure('Missing GridStatus API key')
      return []
    }

    try {
      const baseParams: Record<string, string> = {
        api_key: this.apiKey,
        limit: '5000',
      }

      if (startTime) baseParams.start_time = startTime.toISOString().slice(0, 10)
      if (endTime) baseParams.end_time = endTime.toISOString().slice(0, 10)

      // Fetch BOTH directions: BA as exporter (from_ba) AND as importer (to_ba)
      // InterchangeParser needs both to calculate correct net interchange
      const [fromResponse, toResponse] = await Promise.all([
        eiaResilience.execute('gridstatus-interchange-from', () =>
          axios.get<GridStatusInterchangeResponse>(
            `${GRIDSTATUS_BASE_URL}/eia_ba_interchange_hourly/query`,
            { params: { ...baseParams, filter_column: 'from_ba', filter_value: balancingAuthority }, timeout: REQUEST_TIMEOUT }
          )
        ),
        eiaResilience.execute('gridstatus-interchange-to', () =>
          axios.get<GridStatusInterchangeResponse>(
            `${GRIDSTATUS_BASE_URL}/eia_ba_interchange_hourly/query`,
            { params: { ...baseParams, filter_column: 'to_ba', filter_value: balancingAuthority }, timeout: REQUEST_TIMEOUT }
          )
        ),
      ])

      const fromRecords = fromResponse.data.data || []
      const toRecords = toResponse.data.data || []
      await this.logSuccess()

      // Combine and deduplicate by interface_id + timestamp
      const seen = new Set<string>()
      const allRecords: GridStatusInterchangeRecord[] = []
      for (const record of [...fromRecords, ...toRecords]) {
        const key = `${record.interface_id}::${record.interval_start_utc}`
        if (!seen.has(key)) {
          seen.add(key)
          allRecords.push(record)
        }
      }

      // Map to EIAInterchangeData
      return allRecords.map(record => ({
        period: record.interval_start_utc,
        'from-ba': record.from_ba,
        'from-ba-name': record.from_ba_name,
        'to-ba': record.to_ba,
        'to-ba-name': record.to_ba_name,
        type: 'ID', // Interchange Data
        value: record.mw,
        'value-units': 'megawatthours',
      }))
    } catch (error: any) {
      console.error(`GridStatus: Failed to fetch interchange data for ${balancingAuthority}:`, error.message)
      await this.logFailure(error.message ?? 'Failed to fetch interchange data')
      return []
    }
  }

  /**
   * Fetch EIA fuel mix hourly data — REAL per-fuel-type generation
   * This is the key upgrade over the heuristic subregion parser.
   */
  async getFuelMix(
    balancingAuthority: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<GridStatusFuelMixData[]> {
    if (!this.apiKey) {
      await this.logFailure('Missing GridStatus API key')
      return []
    }

    try {
      const params: Record<string, string> = {
        api_key: this.apiKey,
        limit: '5000',
      }

      if (startTime) params.start_time = startTime.toISOString().slice(0, 10)
      if (endTime) params.end_time = endTime.toISOString().slice(0, 10)

      params.filter_column = 'respondent'
      params.filter_value = balancingAuthority

      const response = await eiaResilience.execute('gridstatus-fuelmix', () =>
        axios.get<GridStatusFuelMixResponse>(
          `${GRIDSTATUS_BASE_URL}/eia_fuel_mix_hourly/query`,
          { params, timeout: REQUEST_TIMEOUT }
        )
      )

      await this.logSuccess()
      return response.data.data || []
    } catch (error: any) {
      console.error(`GridStatus: Failed to fetch fuel mix data for ${balancingAuthority}:`, error.message)
      await this.logFailure(error.message ?? 'Failed to fetch fuel mix data')
      return []
    }
  }
}

// ── Response types (internal to this module) ──────────────────────────

interface GridStatusRegionalRecord {
  interval_start_utc: string
  interval_end_utc: string
  respondent: string
  respondent_name: string
  load: number | null
  load_forecast: number | null
  net_generation: number | null
  total_interchange: number | null
}

interface GridStatusInterchangeRecord {
  interval_start_utc: string
  interval_end_utc: string
  from_ba: string
  from_ba_name: string
  to_ba: string
  to_ba_name: string
  mw: number
  interface_id: string
}

interface GridStatusApiMeta {
  page: number
  limit: number
  page_size: number
  hasNextPage: boolean
  cursor: string | null
}

interface GridStatusRegionalResponse {
  status_code: number
  data: GridStatusRegionalRecord[]
  meta: GridStatusApiMeta
}

interface GridStatusInterchangeResponse {
  status_code: number
  data: GridStatusInterchangeRecord[]
  meta: GridStatusApiMeta
}

interface GridStatusFuelMixResponse {
  status_code: number
  data: GridStatusFuelMixData[]
  meta: GridStatusApiMeta
}

// Singleton
export const gridStatus = new GridStatusClient()
