import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')
const bundlePath = path.join(root, 'data', 'normalized', 'water', 'water.bundle.json')
const manifestPath = path.join(root, 'data', 'normalized', 'water', 'manifest.json')

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const bundle = readJson(bundlePath)
const manifest = readJson(manifestPath)

bundle.schema_version = 'water_bundle_v2'
manifest.schema_version = 'water_bundle_v2'

writeJson(bundlePath, bundle)
writeJson(manifestPath, manifest)

console.log('Normalized water bundle artifacts to water_bundle_v2')
