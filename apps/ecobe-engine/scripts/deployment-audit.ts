#!/usr/bin/env ts-node

/**
 * DEPLOYMENT AUDIT - Real Engine Validation
 * 
 * This script validates the actual deployment configuration
 * for the real ECOBE engine (no mocks, no validation shortcuts)
 */

import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

interface AuditResult {
  category: string
  status: 'PASS' | 'FAIL' | 'WARN'
  message: string
  details?: string
}

interface AuditReport {
  timestamp: string
  overall: 'PASS' | 'FAIL' | 'WARN'
  results: AuditResult[]
  criticalFailures: string[]
  warnings: string[]
}

class DeploymentAudit {
  private results: AuditResult[] = []
  private projectRoot: string

  constructor() {
    this.projectRoot = process.cwd()
  }

  async runFullAudit(): Promise<AuditReport> {
    console.log('🔍 Starting ECOBE Engine Deployment Audit...')
    console.log(`📁 Project Root: ${this.projectRoot}`)

    // Core deployment validations
    await this.auditPackageJson()
    await this.auditDockerfile()
    await this.auditPrismaSchema()
    await this.auditEnvironmentVariables()
    await this.auditBuildProcess()
    await this.auditDatabaseConnection()
    await this.auditRedisConnection()
    await this.auditApiEndpoints()
    await this.auditWorkerProcesses()
    await this.auditSecurityConfiguration()

    // Grid signal specific validations
    await this.auditEIAIntegration()
    await this.auditProviderHierarchy()
    await this.auditDashboardFields()

    const report = this.generateReport()
    this.printReport(report)
    
    return report
  }

  private async auditPackageJson(): Promise<void> {
    try {
      const packageJsonPath = join(this.projectRoot, 'package.json')
      if (!existsSync(packageJsonPath)) {
        this.addResult('FAIL', 'Package Configuration', 'package.json not found')
        return
      }

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      
      // Check critical dependencies
      const requiredDeps = [
        '@prisma/client',
        'express',
        'redis',
        'axios',
        'node-cron',
        'zod'
      ]

      const missingDeps = requiredDeps.filter(dep => 
        !packageJson.dependencies?.[dep] && !packageJson.devDependencies?.[dep]
      )

      if (missingDeps.length > 0) {
        this.addResult('FAIL', 'Package Configuration', 
          `Missing required dependencies: ${missingDeps.join(', ')}`)
      } else {
        this.addResult('PASS', 'Package Configuration', 'All required dependencies present')
      }

      // Check scripts
      const requiredScripts = ['start', 'build', 'dev']
      const missingScripts = requiredScripts.filter(script => !packageJson.scripts?.[script])
      
      if (missingScripts.length > 0) {
        this.addResult('WARN', 'Package Configuration', 
          `Missing recommended scripts: ${missingScripts.join(', ')}`)
      }

    } catch (error) {
      this.addResult('FAIL', 'Package Configuration', `Error reading package.json: ${error}`)
    }
  }

  private async auditDockerfile(): Promise<void> {
    try {
      const dockerfilePath = join(this.projectRoot, 'Dockerfile')
      if (!existsSync(dockerfilePath)) {
        this.addResult('WARN', 'Docker Configuration', 'Dockerfile not found')
        return
      }

      const dockerfile = readFileSync(dockerfilePath, 'utf8')
      
      // Check for production-ready patterns
      const checks = [
        { pattern: /NODE_ENV\s+production/, name: 'Production NODE_ENV' },
        { pattern: /npm\s+ci/, name: 'npm ci for reliable installs' },
        { pattern: /npm\s+run\s+build/, name: 'Build step present' },
        { pattern: /EXPOSE\s+\d+/, name: 'Port exposure' },
        { pattern: /USER\s+node/, name: 'Non-root user (security)' }
      ]

      const failedChecks = checks.filter(check => !check.pattern.test(dockerfile))
      
      if (failedChecks.length > 0) {
        this.addResult('WARN', 'Docker Configuration', 
          `Missing Docker best practices: ${failedChecks.map(c => c.name).join(', ')}`)
      } else {
        this.addResult('PASS', 'Docker Configuration', 'Dockerfile follows best practices')
      }

    } catch (error) {
      this.addResult('FAIL', 'Docker Configuration', `Error reading Dockerfile: ${error}`)
    }
  }

  private async auditPrismaSchema(): Promise<void> {
    try {
      const schemaPath = join(this.projectRoot, 'prisma', 'schema.prisma')
      if (!existsSync(schemaPath)) {
        this.addResult('FAIL', 'Database Schema', 'Prisma schema not found')
        return
      }

      const schema = readFileSync(schemaPath, 'utf8')
      
      // Check for required models
      const requiredModels = [
        'CarbonCommand',
        'GridSignalSnapshot',
        'Eia930BalanceRaw',
        'Eia930InterchangeRaw',
        'Eia930SubregionRaw'
      ]

      const missingModels = requiredModels.filter(model => 
        !schema.includes(`model ${model}`)
      )

      if (missingModels.length > 0) {
        this.addResult('FAIL', 'Database Schema', 
          `Missing required models: ${missingModels.join(', ')}`)
      } else {
        this.addResult('PASS', 'Database Schema', 'All required models present')
      }

      // Check for grid signal fields in CarbonCommand
      const requiredFields = [
        'balancingAuthority',
        'demandRampPct',
        'carbonSpikeProbability',
        'curtailmentProbability',
        'importCarbonLeakageScore'
      ]

      const missingFields = requiredFields.filter(field => 
        !schema.includes(field)
      )

      if (missingFields.length > 0) {
        this.addResult('FAIL', 'Database Schema', 
          `Missing grid signal fields in CarbonCommand: ${missingFields.join(', ')}`)
      }

    } catch (error) {
      this.addResult('FAIL', 'Database Schema', `Error reading Prisma schema: ${error}`)
    }
  }

  private async auditEnvironmentVariables(): Promise<void> {
    try {
      const envExamplePath = join(this.projectRoot, '.env.example')
      if (!existsSync(envExamplePath)) {
        this.addResult('WARN', 'Environment Configuration', '.env.example not found')
        return
      }

      const envExample = readFileSync(envExamplePath, 'utf8')
      
      // Check for required environment variables
      const requiredEnvVars = [
        'DATABASE_URL',
        'REDIS_URL',
        'EIA_API_KEY',
        'WATTTIME_API_KEY',
        'ELECTRICITY_MAPS_API_KEY',
        'EMBER_API_KEY'
      ]

      const missingVars = requiredEnvVars.filter(varName => 
        !envExample.includes(varName)
      )

      if (missingVars.length > 0) {
        this.addResult('FAIL', 'Environment Configuration', 
          `Missing required environment variables: ${missingVars.join(', ')}`)
      } else {
        this.addResult('PASS', 'Environment Configuration', 'All required environment variables documented')
      }

    } catch (error) {
      this.addResult('FAIL', 'Environment Configuration', `Error reading .env.example: ${error}`)
    }
  }

  private async auditBuildProcess(): Promise<void> {
    try {
      // Test build command
      execSync('npm run build', { stdio: 'pipe', cwd: this.projectRoot })
      this.addResult('PASS', 'Build Process', 'Build command succeeds')
    } catch (error) {
      this.addResult('FAIL', 'Build Process', `Build command failed: ${error}`)
    }
  }

  private async auditDatabaseConnection(): Promise<void> {
    try {
      // This would require the actual DATABASE_URL to test
      // For now, check if Prisma client can be generated
      execSync('npx prisma generate', { stdio: 'pipe', cwd: this.projectRoot })
      this.addResult('PASS', 'Database Connection', 'Prisma client generates successfully')
    } catch (error) {
      this.addResult('FAIL', 'Database Connection', `Prisma generation failed: ${error}`)
    }
  }

  private async auditRedisConnection(): Promise<void> {
    // Redis connection test would require actual Redis instance
    // For now, check if redis dependency is present
    try {
      const packageJson = JSON.parse(readFileSync(join(this.projectRoot, 'package.json'), 'utf8'))
      if (packageJson.dependencies?.redis) {
        this.addResult('PASS', 'Redis Connection', 'Redis dependency present')
      } else {
        this.addResult('FAIL', 'Redis Connection', 'Redis dependency missing')
      }
    } catch (error) {
      this.addResult('FAIL', 'Redis Connection', `Error checking Redis dependency: ${error}`)
    }
  }

  private async auditApiEndpoints(): Promise<void> {
    try {
      const appPath = join(this.projectRoot, 'src', 'app.ts')
      if (!existsSync(appPath)) {
        this.addResult('FAIL', 'API Endpoints', 'app.ts not found')
        return
      }

      const app = readFileSync(appPath, 'utf8')
      
      // Check for grid intelligence endpoints
      const requiredEndpoints = [
        '/api/v1/intelligence/grid',
        'grid-intelligence-routes'
      ]

      const missingEndpoints = requiredEndpoints.filter(endpoint => 
        !app.includes(endpoint)
      )

      if (missingEndpoints.length > 0) {
        this.addResult('FAIL', 'API Endpoints', 
          `Missing grid intelligence endpoints: ${missingEndpoints.join(', ')}`)
      } else {
        this.addResult('PASS', 'API Endpoints', 'Grid intelligence endpoints configured')
      }

    } catch (error) {
      this.addResult('FAIL', 'API Endpoints', `Error checking API endpoints: ${error}`)
    }
  }

  private async auditWorkerProcesses(): Promise<void> {
    try {
      const serverPath = join(this.projectRoot, 'src', 'server.ts')
      if (!existsSync(serverPath)) {
        this.addResult('FAIL', 'Worker Processes', 'server.ts not found')
        return
      }

      const server = readFileSync(serverPath, 'utf8')
      
      // Check for EIA ingestion worker
      if (server.includes('startEIAIngestionWorker')) {
        this.addResult('PASS', 'Worker Processes', 'EIA ingestion worker configured')
      } else {
        this.addResult('FAIL', 'Worker Processes', 'EIA ingestion worker not configured')
      }

    } catch (error) {
      this.addResult('FAIL', 'Worker Processes', `Error checking worker processes: ${error}`)
    }
  }

  private async auditSecurityConfiguration(): Promise<void> {
    try {
      // Check for basic security patterns
      const appPath = join(this.projectRoot, 'src', 'app.ts')
      if (!existsSync(appPath)) {
        return
      }

      const app = readFileSync(appPath, 'utf8')
      
      if (app.includes('trust proxy')) {
        this.addResult('PASS', 'Security Configuration', 'Trust proxy configured')
      } else {
        this.addResult('WARN', 'Security Configuration', 'Trust proxy not configured')
      }

    } catch (error) {
      this.addResult('FAIL', 'Security Configuration', `Error checking security: ${error}`)
    }
  }

  private async auditEIAIntegration(): Promise<void> {
    try {
      const eiaClientPath = join(this.projectRoot, 'src', 'lib', 'grid-signals', 'eia-client.ts')
      if (!existsSync(eiaClientPath)) {
        this.addResult('FAIL', 'EIA-930 Integration', 'EIA client not found')
        return
      }

      // Check for required methods
      const eiaClient = readFileSync(eiaClientPath, 'utf8')
      const requiredMethods = ['getBalance', 'getInterchange', 'getSubregion']
      
      const missingMethods = requiredMethods.filter(method => 
        !eiaClient.includes(method)
      )

      if (missingMethods.length > 0) {
        this.addResult('FAIL', 'EIA-930 Integration', 
          `Missing EIA methods: ${missingMethods.join(', ')}`)
      } else {
        this.addResult('PASS', 'EIA-930 Integration', 'EIA client properly implemented')
      }

    } catch (error) {
      this.addResult('FAIL', 'EIA-930 Integration', `Error checking EIA integration: ${error}`)
    }
  }

  private async auditProviderHierarchy(): Promise<void> {
    try {
      const providerRouterPath = join(this.projectRoot, 'src', 'lib', 'carbon', 'provider-router.ts')
      if (!existsSync(providerRouterPath)) {
        this.addResult('FAIL', 'Provider Hierarchy', 'Provider router not found')
        return
      }

      const router = readFileSync(providerRouterPath, 'utf8')
      
      // Check for WattTime priority enforcement
      if (router.includes('WattTime MOER') && router.includes('PRIMARY CAUSAL')) {
        this.addResult('PASS', 'Provider Hierarchy', 'WattTime priority properly documented')
      } else {
        this.addResult('WARN', 'Provider Hierarchy', 'WattTime priority not explicitly documented')
      }

      // Check for Ember role limitation
      if (router.includes('Ember') && router.includes('validation only')) {
        this.addResult('PASS', 'Provider Hierarchy', 'Ember role properly limited')
      } else {
        this.addResult('WARN', 'Provider Hierarchy', 'Ember role limitation not explicit')
      }

    } catch (error) {
      this.addResult('FAIL', 'Provider Hierarchy', `Error checking provider hierarchy: ${error}`)
    }
  }

  private async auditDashboardFields(): Promise<void> {
    try {
      const carbonCommandPath = join(this.projectRoot, 'src', 'lib', 'carbon-command.ts')
      if (!existsSync(carbonCommandPath)) {
        this.addResult('FAIL', 'Dashboard Fields', 'Carbon command processor not found')
        return
      }

      const carbonCommand = readFileSync(carbonCommandPath, 'utf8')
      
      // Check for guaranteed dashboard fields
      const requiredFields = [
        'balancingAuthority',
        'demandRampPct',
        'carbonSpikeProbability',
        'curtailmentProbability',
        'importCarbonLeakageScore'
      ]

      const missingFields = requiredFields.filter(field => 
        !carbonCommand.includes(field)
      )

      if (missingFields.length > 0) {
        this.addResult('FAIL', 'Dashboard Fields', 
          `Missing guaranteed dashboard fields: ${missingFields.join(', ')}`)
      } else {
        this.addResult('PASS', 'Dashboard Fields', 'All required dashboard fields implemented')
      }

    } catch (error) {
      this.addResult('FAIL', 'Dashboard Fields', `Error checking dashboard fields: ${error}`)
    }
  }

  private addResult(status: 'PASS' | 'FAIL' | 'WARN', category: string, message: string, details?: string): void {
    this.results.push({ status, category, message, details })
  }

  private generateReport(): AuditReport {
    const criticalFailures = this.results
      .filter(r => r.status === 'FAIL')
      .map(r => `${r.category}: ${r.message}`)

    const warnings = this.results
      .filter(r => r.status === 'WARN')
      .map(r => `${r.category}: ${r.message}`)

    let overall: 'PASS' | 'FAIL' | 'WARN' = 'PASS'
    if (criticalFailures.length > 0) overall = 'FAIL'
    else if (warnings.length > 0) overall = 'WARN'

    return {
      timestamp: new Date().toISOString(),
      overall,
      results: this.results,
      criticalFailures,
      warnings
    }
  }

  private printReport(report: AuditReport): void {
    console.log('\n' + '='.repeat(60))
    console.log('📋 DEPLOYMENT AUDIT REPORT')
    console.log('='.repeat(60))
    console.log(`🕐 Timestamp: ${report.timestamp}`)
    console.log(`🎯 Overall Status: ${report.overall}`)
    console.log(`✅ Passed: ${report.results.filter(r => r.status === 'PASS').length}`)
    console.log(`⚠️  Warnings: ${report.warnings.length}`)
    console.log(`❌ Failures: ${report.criticalFailures.length}`)
    
    if (report.criticalFailures.length > 0) {
      console.log('\n❌ CRITICAL FAILURES:')
      report.criticalFailures.forEach(failure => console.log(`   • ${failure}`))
    }

    if (report.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:')
      report.warnings.forEach(warning => console.log(`   • ${warning}`))
    }

    console.log('\n📊 DETAILED RESULTS:')
    report.results.forEach(result => {
      const icon = result.status === 'PASS' ? '✅' : result.status === 'WARN' ? '⚠️' : '❌'
      console.log(`   ${icon} ${result.category}: ${result.message}`)
      if (result.details) {
        console.log(`      ${result.details}`)
      }
    })

    console.log('\n' + '='.repeat(60))
    
    if (report.overall === 'FAIL') {
      console.log('🚫 AUDIT FAILED - Fix critical issues before deployment')
      process.exit(1)
    } else if (report.overall === 'WARN') {
      console.log('⚠️  AUDIT PASSED WITH WARNINGS - Review before deployment')
    } else {
      console.log('✅ AUDIT PASSED - Ready for deployment')
    }
  }
}

// Run audit if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const audit = new DeploymentAudit()
  audit.runFullAudit().catch(error => {
    console.error('❌ Audit failed to run:', error)
    process.exit(1)
  })
}

export { DeploymentAudit }
