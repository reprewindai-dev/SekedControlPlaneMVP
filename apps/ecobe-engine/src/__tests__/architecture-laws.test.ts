import fs from 'fs'
import path from 'path'

import {
  ARCHITECTURE_LAWS,
  ARCHITECTURE_LAWSET_VERSION,
  FORBIDDEN_POLICY_IMPORT_PATTERNS,
  FORBIDDEN_ROUTE_IMPORT_PATTERNS,
  REQUIRED_NORMALIZED_SIGNAL_FILES,
  REQUIRED_RUNBOOK_FILES,
} from '../lib/architecture/laws'

const projectRoot = path.resolve(__dirname, '..', '..')
const srcRoot = path.join(projectRoot, 'src')

function listFilesRecursive(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full))
    } else {
      files.push(full)
    }
  }
  return files
}

function extractImports(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8')
  const imports = new Set<string>()
  const staticImportRegex = /from\s+['"]([^'"]+)['"]/g
  const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g

  for (const regex of [staticImportRegex, dynamicImportRegex]) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(source)) !== null) {
      imports.add(match[1])
    }
  }

  return [...imports]
}

function containsForbiddenPattern(specifier: string, patterns: readonly string[]) {
  return patterns.some((pattern) => specifier.includes(pattern))
}

describe('Architecture Laws', () => {
  it('locks the non-negotiable lawset version', () => {
    expect(ARCHITECTURE_LAWSET_VERSION).toBe('2026-03-24.b')
    expect(ARCHITECTURE_LAWS.integrationFirst).toBe(true)
    expect(ARCHITECTURE_LAWS.frameworkPluggable).toBe(true)
    expect(ARCHITECTURE_LAWS.providerIsolation).toBe(true)
    expect(ARCHITECTURE_LAWS.normalizedSignalModel).toBe(true)
    expect(ARCHITECTURE_LAWS.policyProviderSeparation).toBe(true)
    expect(ARCHITECTURE_LAWS.proofFirstOutputs).toBe(true)
    expect(ARCHITECTURE_LAWS.offlineDeterminism).toBe(true)
  })

  it('keeps required normalized signal files in place', () => {
    for (const relativeFile of REQUIRED_NORMALIZED_SIGNAL_FILES) {
      const absoluteFile = path.join(projectRoot, relativeFile)
      expect(fs.existsSync(absoluteFile)).toBe(true)
    }
  })

  it('keeps mandatory doctrine runbooks in place', () => {
    for (const relativeFile of REQUIRED_RUNBOOK_FILES) {
      const absoluteFile = path.join(projectRoot, relativeFile)
      expect(fs.existsSync(absoluteFile)).toBe(true)
    }
  })

  it('prevents route layer from importing provider-specific clients directly', () => {
    const routeFiles = [
      path.join(srcRoot, 'routes', 'ci.ts'),
      path.join(srcRoot, 'routes', 'route-debug.ts'),
    ]
    const violations: string[] = []

    for (const routeFile of routeFiles) {
      const imports = extractImports(routeFile)
      for (const specifier of imports) {
        if (containsForbiddenPattern(specifier, FORBIDDEN_ROUTE_IMPORT_PATTERNS)) {
          violations.push(`${path.relative(projectRoot, routeFile)} -> ${specifier}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('keeps policy modules provider-agnostic', () => {
    const policyFiles = [path.join(srcRoot, 'lib', 'water', 'policy.ts')]
    const violations: string[] = []

    for (const policyFile of policyFiles) {
      const imports = extractImports(policyFile)
      for (const specifier of imports) {
        if (containsForbiddenPattern(specifier, FORBIDDEN_POLICY_IMPORT_PATTERNS)) {
          violations.push(`${path.relative(projectRoot, policyFile)} -> ${specifier}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
