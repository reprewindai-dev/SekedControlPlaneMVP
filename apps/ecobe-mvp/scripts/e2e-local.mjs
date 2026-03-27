import { once } from 'events'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import fs from 'fs'

import EmbeddedPostgres from 'embedded-postgres'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const mvpRoot = path.resolve(__dirname, '..')
const engineRoot = path.resolve(mvpRoot, '..', 'ecobe-engineclaude', 'ecobe-engine')

const postgresPort = 35432
const mvpPort = 3300
const enginePort = 38080
const databaseName = 'ecobe_platform'
const dbBaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/${databaseName}`
const mvpDbUrl = `${dbBaseUrl}?schema=mvp`
const engineDbUrl = `${dbBaseUrl}?schema=engine`
const logDir = path.join(mvpRoot, '.local', 'logs')
const postgresDir = path.join(mvpRoot, '.local', 'postgres')

async function main() {
  fs.mkdirSync(logDir, { recursive: true })
  fs.rmSync(postgresDir, { recursive: true, force: true })

  const pg = new EmbeddedPostgres({
    databaseDir: postgresDir,
    port: postgresPort,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    onLog: () => undefined,
    onError: (error) => {
      console.error(error)
    },
  })

  const processes = []

  try {
    await pg.initialise()
    await pg.start()
    await pg.createDatabase(databaseName).catch(() => undefined)

    await runCommand('npm', ['run', 'prisma:push'], {
      cwd: mvpRoot,
      env: {
        ...process.env,
        DATABASE_URL: mvpDbUrl,
      },
    })

    await runCommand('npm', ['run', 'prisma:push'], {
      cwd: engineRoot,
      env: {
        ...process.env,
        DATABASE_URL: engineDbUrl,
        DIRECT_DATABASE_URL: engineDbUrl,
      },
    })

    await runCommand('npm', ['run', 'build'], {
      cwd: engineRoot,
      env: {
        ...process.env,
        DATABASE_URL: engineDbUrl,
        DIRECT_DATABASE_URL: engineDbUrl,
      },
    })

    await runCommand('npm', ['run', 'build'], {
      cwd: mvpRoot,
      env: {
        ...process.env,
        DATABASE_URL: mvpDbUrl,
      },
    })

    const engineProcess = spawnProcess('node', ['dist/server.js'], {
      cwd: engineRoot,
      env: {
        ...process.env,
        PORT: String(enginePort),
        DATABASE_URL: engineDbUrl,
        DIRECT_DATABASE_URL: engineDbUrl,
        REDIS_URL: 'redis://127.0.0.1:6379',
        ECOBE_INTERNAL_API_KEY: 'replace-with-shared-internal-key',
        ENGINE_BACKGROUND_WORKERS_ENABLED: 'false',
        ENGINE_OFFLINE_ROUTING_ENABLED: 'true',
      },
      label: 'engine',
      logFile: path.join(logDir, 'engine.log'),
    })
    processes.push(engineProcess)

    await waitForHttp(`http://127.0.0.1:${enginePort}/internal/v1/health`, 60000, {
      authorization: 'Bearer replace-with-shared-internal-key',
    })

    const mvpProcess = spawnProcess('npm', ['run', 'start', '--', '-p', String(mvpPort), '-H', '0.0.0.0'], {
      cwd: mvpRoot,
      env: {
        ...process.env,
        PORT: String(mvpPort),
        DATABASE_URL: mvpDbUrl,
        ECOBE_ENGINE_URL: `http://127.0.0.1:${enginePort}`,
        ECOBE_ENGINE_INTERNAL_KEY: 'replace-with-shared-internal-key',
        AUDIT_SIGNING_SECRET: 'local-audit-secret',
        ECOBE_ADMIN_TOKEN: 'ecobe-admin-local',
        USE_LOCAL_GOVERNANCE_FALLBACK: 'true',
      },
      label: 'mvp',
      logFile: path.join(logDir, 'mvp.log'),
    })
    processes.push(mvpProcess)

    await waitForHttp(`http://127.0.0.1:${mvpPort}/api/v1/ready`, 60000)

    await runCommand('node', ['scripts/happy-path.mjs'], {
      cwd: mvpRoot,
      env: {
        ...process.env,
        ECOBE_MVP_URL: `http://127.0.0.1:${mvpPort}`,
        ECOBE_ADMIN_TOKEN: 'ecobe-admin-local',
      },
    })
  } finally {
    for (const child of processes.reverse()) {
      await terminateProcess(child)
    }

    await pg.stop().catch(() => undefined)
  }
}

function spawnProcess(command, args, options) {
  const logStream = fs.createWriteStream(options.logFile, { flags: 'a' })
  const { label, logFile, ...spawnOptions } = options
  const invocation = resolveInvocation(command, args)
  const child = spawn(invocation.command, invocation.args, {
    ...spawnOptions,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`)
    logStream.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`)
    logStream.write(chunk)
  })

  child.on('exit', (code, signal) => {
    logStream.write(`\n[process-exit] code=${code} signal=${signal}\n`)
    logStream.end()
  })

  return child
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const invocation = resolveInvocation(command, args)
    const child = spawn(invocation.command, invocation.args, {
      ...options,
      shell: false,
      stdio: 'inherit',
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}`))
    })
  })
}

async function waitForHttp(url, timeoutMs, headers = {}) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers,
      })
      if (response.ok) {
        return
      }
    } catch {
      // Keep waiting until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${url}`)
}

function resolveInvocation(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args],
    }
  }

  return { command, args }
}

async function terminateProcess(child) {
  if (!child?.pid) {
    return
  }

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      })
      killer.on('exit', () => resolve())
      killer.on('error', () => resolve())
    })
    await once(child, 'exit').catch(() => undefined)
    return
  }

  child.kill('SIGTERM')
  await once(child, 'exit').catch(() => undefined)
}

await main()
