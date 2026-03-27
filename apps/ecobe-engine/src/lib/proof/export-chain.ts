import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const EXPORT_DIR = path.resolve(process.cwd(), 'data', 'exports', 'ci')
const EXPORT_INDEX = path.join(EXPORT_DIR, 'index.json')

interface ExportIndexEntry {
  batchId: string
  batchHash: string
  previousBatchHash: string | null
  createdAt: string
  path: string
}

interface ExportIndexFile {
  entries: ExportIndexEntry[]
}

function ensureExportDir() {
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true })
  }
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(record[k])}`).join(',')}}`
}

export function sha256Canonical(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex')
}

function readIndex(): ExportIndexFile {
  ensureExportDir()
  if (!fs.existsSync(EXPORT_INDEX)) {
    return { entries: [] }
  }
  try {
    const raw = fs.readFileSync(EXPORT_INDEX, 'utf8')
    const parsed = JSON.parse(raw) as ExportIndexFile
    if (!Array.isArray(parsed.entries)) {
      return { entries: [] }
    }
    return parsed
  } catch {
    return { entries: [] }
  }
}

function writeIndex(index: ExportIndexFile) {
  ensureExportDir()
  fs.writeFileSync(EXPORT_INDEX, JSON.stringify(index, null, 2))
}

export function persistExportBatch(batchId: string, payload: unknown): {
  batchPath: string
  batchHash: string
  previousBatchHash: string | null
  chainPosition: number
} {
  ensureExportDir()
  const index = readIndex()
  const previousBatchHash = index.entries.length > 0 ? index.entries[index.entries.length - 1].batchHash : null
  const batchHash = sha256Canonical({ previousBatchHash, payload })
  const fileName = `${batchId}.json`
  const batchPath = path.join(EXPORT_DIR, fileName)

  const exportEnvelope = {
    batchId,
    previousBatchHash,
    batchHash,
    createdAt: new Date().toISOString(),
    payload,
  }

  fs.writeFileSync(batchPath, JSON.stringify(exportEnvelope, null, 2))

  index.entries.push({
    batchId,
    batchHash,
    previousBatchHash,
    createdAt: exportEnvelope.createdAt,
    path: batchPath,
  })
  writeIndex(index)

  return {
    batchPath,
    batchHash,
    previousBatchHash,
    chainPosition: index.entries.length,
  }
}

export function readExportChainHead(): ExportIndexEntry | null {
  const index = readIndex()
  return index.entries.length > 0 ? index.entries[index.entries.length - 1] : null
}

