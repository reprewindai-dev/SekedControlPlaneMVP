import { spawn, spawnSync } from 'child_process'

const port = process.env.PORT ?? '3000'
const host = process.env.HOST ?? '0.0.0.0'

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const next = process.platform === 'win32' ? 'node_modules/.bin/next.cmd' : 'node_modules/.bin/next'

const migrate = spawnSync(npx, ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
})

if (migrate.status !== 0) {
  process.exit(migrate.status ?? 1)
}

const child = spawn(next, ['start', '-p', port, '-H', host], {
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
