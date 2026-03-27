import { prisma } from '../db'
import { GridSignalSnapshot } from './types'

export interface GridSignalAuditRecord {
  id: string
  region: string
  balancingAuthority: string | null
  timestamp: string
  source: string
  signalQuality: 'high' | 'medium' | 'low'
  estimatedFlag: boolean
  syntheticFlag: boolean
  rawData: Record<string, unknown>
  derivedFeatures: Record<string, unknown>
  provenance: {
    sourceUsed: string
    validationSource?: string
    referenceTime: string
    fetchedAt: string
    fallbackUsed: boolean
    disagreementFlag: boolean
    disagreementPct: number
  }
  createdAt: Date
}

export class GridSignalAudit {
  /**
   * Record grid signal processing for audit trail
   */
  static async recordSignalProcessing(
    snapshot: GridSignalSnapshot,
    provenance: {
      sourceUsed: string
      validationSource?: string
      referenceTime: string
      fetchedAt: string
      fallbackUsed: boolean
      disagreementFlag: boolean
      disagreementPct: number
    },
    derivedFeatures: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      // Store in audit log (simplified - in production would use dedicated audit table)
      const auditRecord = {
        region: snapshot.region,
        balancingAuthority: snapshot.balancingAuthority,
        timestamp: snapshot.timestamp,
        source: snapshot.source,
        signalQuality: snapshot.signalQuality,
        estimatedFlag: snapshot.estimatedFlag,
        syntheticFlag: snapshot.syntheticFlag,
        rawData: snapshot.metadata,
        derivedFeatures,
        provenance,
        createdAt: new Date()
      }

      // For now, store in integration events as audit trail
      await prisma.integrationEvent.create({
        data: {
          source: `GRID_SIGNAL_${snapshot.region}`,
          success: true,
          message: JSON.stringify(auditRecord),
          createdAt: new Date()
        }
      })

    } catch (error) {
      console.error('Failed to record grid signal audit:', error)
      // Don't throw - audit failures shouldn't break processing
    }
  }

  /**
   * Record routing decision with grid signals
   */
  static async recordRoutingDecision(
    commandId: string,
    region: string,
    gridSignals: {
      balancingAuthority: string | null
      demandRampPct: number | null
      carbonSpikeProbability: number | null
      curtailmentProbability: number | null
      importCarbonLeakageScore: number | null
      signalQuality: 'high' | 'medium' | 'low'
      estimatedFlag: boolean
      syntheticFlag: boolean
    },
    provenance: {
      sourceUsed: string
      validationSource?: string
      referenceTime: string
      fetchedAt: string
      fallbackUsed: boolean
      disagreementFlag: boolean
      disagreementPct: number
    }
  ): Promise<void> {
    try {
      // Update carbon command trace with grid signal data
      await prisma.carbonCommandTrace.updateMany({
        where: { commandId },
        data: {
          traceJson: {
            gridSignals,
            provenance,
            recordedAt: new Date().toISOString()
          }
        }
      })

    } catch (error) {
      console.error('Failed to record routing decision audit:', error)
    }
  }

  /**
   * Get audit history for a region
   */
  static async getRegionAuditHistory(
    region: string,
    startTime: Date,
    endTime: Date
  ): Promise<GridSignalAuditRecord[]> {
    try {
      const events = await prisma.integrationEvent.findMany({
        where: {
          source: `GRID_SIGNAL_${region}`,
          createdAt: {
            gte: startTime,
            lte: endTime
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 1000
      })

      return events
        .map((event: any) => {
          try {
            return JSON.parse(event.message || '{}') as GridSignalAuditRecord
          } catch {
            return null
          }
        })
        .filter((record: any): record is GridSignalAuditRecord => record !== null)

    } catch (error) {
      console.error('Failed to get region audit history:', error)
      return []
    }
  }

  /**
   * Get audit history for a specific command
   */
  static async getCommandAuditHistory(commandId: string): Promise<{
    gridSignals?: any
    provenance?: any
    recordedAt?: string
  } | null> {
    try {
      const trace = await prisma.carbonCommandTrace.findUnique({
        where: { commandId }
      })

      if (!trace) return null

      const traceJson = trace.traceJson as any
      return {
        gridSignals: traceJson.gridSignals,
        provenance: traceJson.provenance,
        recordedAt: traceJson.recordedAt
      }

    } catch (error) {
      console.error('Failed to get command audit history:', error)
      return null
    }
  }

  /**
   * Calculate audit statistics
   */
  static async calculateAuditStats(
    region: string,
    startTime: Date,
    endTime: Date
  ): Promise<{
    totalRecords: number
    qualityDistribution: Record<string, number>
    estimatedDataPct: number
    syntheticDataPct: number
    disagreementRate: number
    fallbackRate: number
    avgDisagreementPct: number
  }> {
    const records = await this.getRegionAuditHistory(region, startTime, endTime)

    const stats = {
      totalRecords: records.length,
      qualityDistribution: { high: 0, medium: 0, low: 0 },
      estimatedDataPct: 0,
      syntheticDataPct: 0,
      disagreementRate: 0,
      fallbackRate: 0,
      avgDisagreementPct: 0
    }

    if (records.length === 0) return stats

    let estimatedCount = 0
    let syntheticCount = 0
    let disagreementCount = 0
    let fallbackCount = 0
    let totalDisagreementPct = 0

    for (const record of records) {
      // Quality distribution
      stats.qualityDistribution[record.signalQuality]++

      // Estimated/synthetic flags
      if (record.estimatedFlag) estimatedCount++
      if (record.syntheticFlag) syntheticCount++

      // Disagreement and fallback
      if (record.provenance.disagreementFlag) disagreementCount++
      if (record.provenance.fallbackUsed) fallbackCount++
      totalDisagreementPct += record.provenance.disagreementPct
    }

    stats.estimatedDataPct = (estimatedCount / records.length) * 100
    stats.syntheticDataPct = (syntheticCount / records.length) * 100
    stats.disagreementRate = (disagreementCount / records.length) * 100
    stats.fallbackRate = (fallbackCount / records.length) * 100
    stats.avgDisagreementPct = totalDisagreementPct / records.length

    return stats
  }

  /**
   * Validate signal provenance completeness
   */
  static validateProvenance(provenance: {
    sourceUsed: string
    validationSource?: string
    referenceTime: string
    fetchedAt: string
    fallbackUsed: boolean
    disagreementFlag: boolean
    disagreementPct: number
  }): {
    isValid: boolean
    missing: string[]
    warnings: string[]
  } {
    const missing: string[] = []
    const warnings: string[] = []

    // Required fields
    if (!provenance.sourceUsed) missing.push('sourceUsed')
    if (!provenance.referenceTime) missing.push('referenceTime')
    if (!provenance.fetchedAt) missing.push('fetchedAt')
    if (typeof provenance.fallbackUsed !== 'boolean') missing.push('fallbackUsed')
    if (typeof provenance.disagreementFlag !== 'boolean') missing.push('disagreementFlag')
    if (typeof provenance.disagreementPct !== 'number') missing.push('disagreementPct')

    // Warnings
    if (provenance.fallbackUsed && !provenance.validationSource) {
      warnings.push('Fallback used without validation source')
    }

    if (provenance.disagreementFlag && provenance.disagreementPct < 5) {
      warnings.push('Disagreement flagged but disagreement percentage is very low')
    }

    if (!provenance.validationSource && provenance.sourceUsed !== 'EIA_930') {
      warnings.push('No validation source for non-EIA data')
    }

    return {
      isValid: missing.length === 0,
      missing,
      warnings
    }
  }

  /**
   * Record data quality issues
   */
  static async recordDataQualityIssue(
    region: string,
    timestamp: string,
    issue: {
      type: 'missing_data' | 'stale_data' | 'inconsistent_data' | 'provider_error'
      severity: 'low' | 'medium' | 'high'
      description: string
      affectedFields: string[]
      metadata?: Record<string, unknown>
    }
  ): Promise<void> {
    try {
      await prisma.integrationEvent.create({
        data: {
          source: `GRID_QUALITY_${region}`,
          success: false,
          message: JSON.stringify({
            ...issue,
            region,
            timestamp,
            recordedAt: new Date().toISOString()
          }),
          createdAt: new Date()
        }
      })

    } catch (error) {
      console.error('Failed to record data quality issue:', error)
    }
  }

  /**
   * Get data quality issues for a region
   */
  static async getDataQualityIssues(
    region: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<Array<{
    type: string
    severity: string
    description: string
    affectedFields: string[]
    timestamp: string
    metadata?: Record<string, unknown>
  }>> {
    try {
      const where: any = {
        source: `GRID_QUALITY_${region}`
      }

      if (startTime || endTime) {
        where.createdAt = {}
        if (startTime) where.createdAt.gte = startTime
        if (endTime) where.createdAt.lte = endTime
      }

      const events = await prisma.integrationEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100
      })

      return events
        .map((event: any) => {
          try {
            return JSON.parse(event.message || '{}')
          } catch {
            return null
          }
        })
        .filter((record: any): record is any => record !== null)

    } catch (error) {
      console.error('Failed to get data quality issues:', error)
      return []
    }
  }

  /**
   * Generate audit report for compliance
   */
  static async generateAuditReport(
    region: string,
    startTime: Date,
    endTime: Date
  ): Promise<{
    summary: {
      totalRecords: number
      qualityDistribution: Record<string, number>
      dataQualityScore: number
      complianceScore: number
    }
    qualityIssues: Array<{
      type: string
      severity: string
      count: number
    }>
    recommendations: string[]
  }> {
    const [stats, qualityIssues] = await Promise.all([
      this.calculateAuditStats(region, startTime, endTime),
      this.getDataQualityIssues(region, startTime, endTime)
    ])

    // Calculate quality score (0-100)
    const qualityScore = Math.max(0, 
      100 - (stats.estimatedDataPct * 0.3) - (stats.syntheticDataPct * 0.5) - (stats.disagreementRate * 0.2)
    )

    // Calculate compliance score (0-100)
    const complianceScore = Math.max(0,
      100 - (stats.fallbackRate * 0.4) - (stats.avgDisagreementPct * 0.6)
    )

    // Group quality issues by type and severity
    const issueSummary = qualityIssues.reduce((acc, issue) => {
      const key = `${issue.type}_${issue.severity}`
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const qualityIssuesSummary = Object.entries(issueSummary).map(([key, count]) => {
      const [type, severity] = key.split('_')
      return { type, severity, count }
    })

    // Generate recommendations
    const recommendations: string[] = []
    
    if (stats.estimatedDataPct > 20) {
      recommendations.push('High percentage of estimated data detected - consider additional data sources')
    }

    if (stats.disagreementRate > 10) {
      recommendations.push('Elevated provider disagreement rate - review validation logic')
    }

    if (stats.fallbackRate > 5) {
      recommendations.push('Frequent fallback usage - investigate primary data source reliability')
    }

    if (qualityIssuesSummary.some(issue => issue.severity === 'high' && issue.count > 5)) {
      recommendations.push('Multiple high-severity quality issues - immediate attention required')
    }

    return {
      summary: {
        totalRecords: stats.totalRecords,
        qualityDistribution: stats.qualityDistribution,
        dataQualityScore: qualityScore,
        complianceScore
      },
      qualityIssues: qualityIssuesSummary,
      recommendations
    }
  }
}
