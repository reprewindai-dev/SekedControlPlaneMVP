#!/usr/bin/env ts-node

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

type VerificationStatus = 'PASS' | 'FAIL' | 'WARN'

interface VerificationResult {
  category: string
  status: VerificationStatus
  message: string
}

class DeploymentVerification {
  private results: VerificationResult[] = []
  private readonly engineRoot = process.cwd()
  private readonly dashboardRoot = join(process.cwd(), 'ecobe-dashboard')

  async run() {
    await this.verifyEngineBuild()
    await this.verifyDashboardBuild()
    await this.verifyIntegrationContracts()
    await this.verifyAutomationAssets()
    this.printReport()
  }

  private addResult(status: VerificationStatus, category: string, message: string) {
    this.results.push({ status, category, message })
  }

  private async verifyEngineBuild() {
    try {
      execSync('npm run build', { cwd: this.engineRoot, stdio: 'pipe' })
      execSync('npm run type-check', { cwd: this.engineRoot, stdio: 'pipe' })
      this.addResult('PASS', 'Engine Build', 'Engine builds and type-checks cleanly.')
    } catch (error) {
      this.addResult('FAIL', 'Engine Build', `Engine verification failed: ${String(error)}`)
    }
  }

  private async verifyDashboardBuild() {
    try {
      execSync('npm run build', { cwd: this.dashboardRoot, stdio: 'pipe' })
      execSync('npm run type-check', { cwd: this.dashboardRoot, stdio: 'pipe' })
      this.addResult('PASS', 'Dashboard Build', 'Dashboard builds and type-checks cleanly.')
    } catch (error) {
      this.addResult('FAIL', 'Dashboard Build', `Dashboard verification failed: ${String(error)}`)
    }
  }

  private async verifyIntegrationContracts() {
    const dashboardApiPath = join(this.dashboardRoot, 'src', 'lib', 'api.ts')
    const dekesClientPath = join(
      this.engineRoot,
      '..',
      'dekes-saas',
      'dekes-saas',
      'lib',
      'ecobe',
      'client.ts'
    )
    const dekesRouterPath = join(
      this.engineRoot,
      '..',
      'dekes-saas',
      'dekes-saas',
      'lib',
      'ecobe',
      'router.ts'
    )

    if (!existsSync(dashboardApiPath) || !existsSync(dekesClientPath) || !existsSync(dekesRouterPath)) {
      this.addResult('FAIL', 'Contracts', 'One or more integration client files are missing.')
      return
    }

    const dashboardApi = readFileSync(dashboardApiPath, 'utf8')
    const dekesClient = readFileSync(dekesClientPath, 'utf8')
    const dekesRouter = readFileSync(dekesRouterPath, 'utf8')

    const requiredDashboardEndpoints = [
      '/integrations/dekes/summary',
      '/integrations/dekes/events',
      '/integrations/dekes/metrics',
      'getProviderHealth',
    ]

    const missingDashboardEndpoints = requiredDashboardEndpoints.filter(
      (token) => !dashboardApi.includes(token)
    )

    if (missingDashboardEndpoints.length > 0) {
      this.addResult(
        'FAIL',
        'Contracts',
        `Dashboard API is missing: ${missingDashboardEndpoints.join(', ')}`
      )
      return
    }

    if (
      !dekesClient.includes('/api/v1/integrations/dekes/prospects') ||
      !dekesRouter.includes('/api/v1/integrations/dekes/route')
    ) {
      this.addResult(
        'FAIL',
        'Contracts',
        'DEKES SaaS clients are not targeting the engine integration routes.'
      )
      return
    }

    this.addResult('PASS', 'Contracts', 'Engine, dashboard, and DEKES SaaS use the same integration routes.')
  }

  private async verifyAutomationAssets() {
    const workflows = [
      '.github/workflows/ingest-eia.yml',
      '.github/workflows/refresh-forecasts.yml',
      '.github/workflows/verify-signals.yml',
      '.github/workflows/warm-cache.yml',
    ]

    const missing = workflows.filter((workflow) => !existsSync(join(this.engineRoot, '..', workflow)))

    if (missing.length > 0) {
      this.addResult('FAIL', 'Workflows', `Missing workflow files: ${missing.join(', ')}`)
      return
    }

    this.addResult('PASS', 'Workflows', 'Scheduled GitHub workflow assets are present.')
  }

  private printReport() {
    const failures = this.results.filter((result) => result.status === 'FAIL')
    const warnings = this.results.filter((result) => result.status === 'WARN')
    const overall: VerificationStatus =
      failures.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS'

    console.log(`Deployment verification: ${overall}`)
    for (const result of this.results) {
      console.log(`[${result.status}] ${result.category}: ${result.message}`)
    }

    if (overall === 'FAIL') {
      process.exit(1)
    }
  }
}

if (require.main === module) {
  const verification = new DeploymentVerification()
  verification.run().catch((error) => {
    console.error(`Deployment verification failed to run: ${String(error)}`)
    process.exit(1)
  })
}
