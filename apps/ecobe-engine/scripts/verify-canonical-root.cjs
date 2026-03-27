const fs = require('fs')
const path = require('path')

const cwd = path.resolve(process.cwd())
const normalized = cwd.replace(/\\/g, '/').toLowerCase()

const nestedDuplicatePath = '/ecobe-engine/ecobe-engine'
if (normalized.includes(nestedDuplicatePath)) {
  const strict = process.env.ECOBE_CANONICAL_STRICT === 'true'
  const message = `Canonical runtime warning: nested duplicate path detected (${cwd}).`
  if (strict) {
    console.error(message)
    console.error('Set ECOBE_CANONICAL_STRICT=false only when service root is intentionally nested.')
    process.exit(1)
  }
  console.warn(message)
}

const devRequiredFiles = ['src/routes/ci.ts', 'prisma/schema.prisma', 'src/server.ts']
const prodRequiredFiles = ['dist/server.js', 'prisma/schema.prisma', 'scripts/verify-canonical-root.cjs']
const isProductionRuntime =
  process.env.NODE_ENV === 'production' || fs.existsSync(path.join(cwd, 'dist', 'server.js'))

const requiredFiles = isProductionRuntime ? prodRequiredFiles : devRequiredFiles
const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(cwd, file)))

if (missing.length > 0) {
  console.error(`Canonical runtime verification failed. Missing files: ${missing.join(', ')}`)
  process.exit(1)
}

console.log(`Canonical runtime verified: ${cwd}`)
