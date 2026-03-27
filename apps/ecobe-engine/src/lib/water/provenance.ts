import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { loadWaterArtifacts } from './bundle'

const ROOT = path.resolve(process.cwd())
const SOURCE_DIRECTORIES = [
  path.join(ROOT, 'data', 'source', 'water'),
  path.join(ROOT, 'data', 'sources', 'water'),
  path.join(ROOT, 'data', 'raw', 'water'),
  path.join(ROOT, 'data', 'water'),
]

function readDirectoryRecursive(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return []

  const results: string[] = []
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      results.push(...readDirectoryRecursive(entryPath))
    } else {
      results.push(entryPath)
    }
  }

  return results
}

function computeSha256(filePath: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function findDatasetSourcePath(datasetName: string) {
  const matcher = datasetName.toLowerCase()
  for (const directory of SOURCE_DIRECTORIES) {
    const files = readDirectoryRecursive(directory)
    const match = files.find((filePath) => path.basename(filePath).toLowerCase().includes(matcher))
    if (match) return match
  }
  return null
}

export function inspectWaterDatasetProvenance() {
  const { manifest } = loadWaterArtifacts(true)
  const datasets = manifest.datasets.map((dataset) => {
    const discoveredSourcePath = findDatasetSourcePath(dataset.name)
    const computedHash = discoveredSourcePath ? computeSha256(discoveredSourcePath) : null
    const manifestHash = dataset.file_hash || null
    const manifestHashVerified = Boolean(
      manifestHash && manifestHash !== 'unverified' && computedHash && computedHash === manifestHash
    )

    const verificationStatus =
      discoveredSourcePath === null
        ? 'missing_source'
        : manifestHash === 'unverified' || !manifestHash
          ? 'unverified'
          : manifestHashVerified
            ? 'verified'
            : 'mismatch'

    return {
      name: dataset.name,
      datasetVersion: dataset.dataset_version,
      sourceUrl: dataset.source_url,
      downloadedAt: dataset.downloaded_at,
      manifestHash,
      computedHash,
      discoveredSourcePath,
      verificationStatus,
      hashMatchesManifest: manifestHashVerified,
      candidateDirectories: SOURCE_DIRECTORIES,
    }
  })

  return {
    checkedAt: new Date().toISOString(),
    datasets,
    summary: {
      verified: datasets.filter((dataset) => dataset.verificationStatus === 'verified').length,
      unverified: datasets.filter((dataset) => dataset.verificationStatus === 'unverified').length,
      missingSource: datasets.filter((dataset) => dataset.verificationStatus === 'missing_source').length,
      mismatch: datasets.filter((dataset) => dataset.verificationStatus === 'mismatch').length,
    },
  }
}

export function verifyWaterDatasetProvenance(options: { persistManifest?: boolean } = {}) {
  const { bundle, manifest } = loadWaterArtifacts(true)
  const inspected = inspectWaterDatasetProvenance()

  if (options.persistManifest) {
    let mutated = false
    const nextManifest = {
      ...manifest,
      datasets: manifest.datasets.map((dataset) => {
        const inspectedDataset = inspected.datasets.find((entry) => entry.name === dataset.name)
        if (!inspectedDataset?.computedHash) return dataset
        if (dataset.file_hash === inspectedDataset.computedHash) return dataset
        mutated = true
        return {
          ...dataset,
          file_hash: inspectedDataset.computedHash,
        }
      }),
    }

    if (mutated) {
      const manifestPath = path.join(ROOT, 'data', 'normalized', 'water', 'manifest.json')
      fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8')
      loadWaterArtifacts(true)
    }
  }

  return {
    bundleSchemaVersion: bundle.schema_version,
    manifestSchemaVersion: manifest.schema_version,
    ...inspected,
  }
}
