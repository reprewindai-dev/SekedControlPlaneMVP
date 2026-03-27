import { once } from 'events'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import fs from 'fs'
import net from 'net'

import EmbeddedPostgres from 'embedded-postgres'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const mvpRoot = path.resolve(__dirname, '..')
const engineRoot = path.resolve(mvpRoot, '..', 'codexecobeengine-clean2', 'ecobe-engine')
const engineClaudeRoot = path.resolve(mvpRoot, '..', 'ecobe-engineclaude', 'ecobe-engine', 'ecobe-engine')
const freestyleWriterRoot = path.resolve(mvpRoot, '..', 'freestylewriter')

const postgresPort = 35432
const mvpPort = 3300
const enginePort = 38080
const freestyleWriterPort = 3400
const controlPlaneDatabaseName = 'ecobe_platform'
const freestyleWriterDatabaseName = 'freestylewriter'
const dbBaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}`
const mvpDbUrl = `${dbBaseUrl}/${controlPlaneDatabaseName}?schema=mvp`
const engineDbUrl = `${dbBaseUrl}/${controlPlaneDatabaseName}?schema=engine`
const freestyleWriterDbUrl = `${dbBaseUrl}/${freestyleWriterDatabaseName}`
const logDir = path.join(mvpRoot, '.local', 'freestyle-writer-demo', 'logs')
const postgresDir = path.join(mvpRoot, '.local', 'freestyle-writer-demo', 'postgres')
const sharedInternalKey = 'replace-with-shared-internal-key'
const benchmarkMode = process.argv.includes('--benchmark')

async function main() {
  fs.mkdirSync(logDir, { recursive: true })
  fs.mkdirSync(postgresDir, { recursive: true })

  const pg = new EmbeddedPostgres({
    databaseDir: postgresDir,
    port: postgresPort,
    user: 'postgres',
    password: 'postgres',
    persistent: true,
    onLog: () => undefined,
    onError: (error) => {
      console.error(error)
    },
  })

  const processes = []
  let ownsPostgres = false
  const readOnlyEngineEnv = loadReadOnlyEnv(path.join(engineClaudeRoot, '.env'))

  try {
    const postgresRunning = await isPortOpen(postgresPort)
    const hasExistingCluster = fs.existsSync(postgresDir) && fs.readdirSync(postgresDir).length > 0
    if (!postgresRunning && !hasExistingCluster) {
      console.log('Initializing embedded Postgres cluster...')
      await pg.initialise()
    }
    if (!postgresRunning) {
      console.log('Starting embedded Postgres...')
      await pg.start()
      ownsPostgres = true
    } else {
      console.log(`Reusing embedded Postgres already running on ${postgresPort}`)
    }

    console.log('Clearing stale local app processes...')
    await killListeningProcesses([enginePort, mvpPort, freestyleWriterPort])

    if (ownsPostgres) {
      console.log('Ensuring local databases exist...')
      await pg.createDatabase(controlPlaneDatabaseName).catch(() => undefined)
      await pg.createDatabase(freestyleWriterDatabaseName).catch(() => undefined)
    }

    console.log('Syncing ecobe-mvp schema...')
    await runCommand('npm', ['run', 'prisma:push'], {
      cwd: mvpRoot,
      env: {
        ...process.env,
        DATABASE_URL: mvpDbUrl,
      },
    })

    console.log('Syncing engine schema...')
    await runCommand('npm', ['run', 'prisma:push'], {
      cwd: engineRoot,
      env: {
        ...process.env,
        DATABASE_URL: engineDbUrl,
        DIRECT_DATABASE_URL: engineDbUrl,
      },
    })

    console.log('Syncing Freestyle Writer schema...')
    await runCommand('npm', ['run', 'db:push'], {
      cwd: freestyleWriterRoot,
      env: {
        ...process.env,
        DATABASE_URL: freestyleWriterDbUrl,
      },
    })

    if (!fs.existsSync(path.join(engineRoot, 'dist', 'server.js'))) {
      console.log('Building engine...')
      await runCommand('npm', ['run', 'build'], {
        cwd: engineRoot,
        env: {
          ...process.env,
          DATABASE_URL: engineDbUrl,
          DIRECT_DATABASE_URL: engineDbUrl,
        },
      })
    }

    if (!fs.existsSync(path.join(mvpRoot, '.next', 'BUILD_ID'))) {
      console.log('Building ecobe-mvp...')
      await runCommand('npm', ['run', 'build'], {
        cwd: mvpRoot,
        env: {
          ...process.env,
          DATABASE_URL: mvpDbUrl,
        },
      })
    }

    if (!fs.existsSync(path.join(freestyleWriterRoot, 'dist', 'index.cjs'))) {
      console.log('Building Freestyle Writer...')
      await runCommand('npm', ['run', 'build'], {
        cwd: freestyleWriterRoot,
        env: {
          ...process.env,
          DATABASE_URL: freestyleWriterDbUrl,
        },
      })
    }

    if (!(await isPortOpen(enginePort))) {
      console.log('Starting engine...')
      const engineProcess = spawnProcess('node', ['dist/server.js'], {
        cwd: engineRoot,
        env: {
          ...process.env,
          ...readOnlyEngineEnv,
          PORT: String(enginePort),
          DATABASE_URL: engineDbUrl,
          DIRECT_DATABASE_URL: engineDbUrl,
          REDIS_URL: 'disabled',
          ECOBE_INTERNAL_API_KEY: sharedInternalKey,
          ENGINE_BACKGROUND_WORKERS_ENABLED: 'false',
          ENGINE_OFFLINE_ROUTING_ENABLED: 'true',
        },
        label: 'engine',
        logFile: path.join(logDir, 'engine.log'),
      })
      processes.push(engineProcess)
    } else {
      console.log(`Reusing engine already running on ${enginePort}`)
    }

    await waitForHttp(`http://127.0.0.1:${enginePort}/internal/v1/health`, 60000, {
      authorization: `Bearer ${sharedInternalKey}`,
    })

    if (!(await isPortOpen(mvpPort))) {
      console.log('Starting ecobe-mvp...')
      const mvpProcess = spawnProcess('npm', ['run', 'start', '--', '-p', String(mvpPort), '-H', '0.0.0.0'], {
        cwd: mvpRoot,
        env: {
          ...process.env,
          PORT: String(mvpPort),
          HOST: '0.0.0.0',
          NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${mvpPort}`,
          DATABASE_URL: mvpDbUrl,
          ECOBE_ENGINE_URL: `http://127.0.0.1:${enginePort}`,
          ECOBE_ENGINE_INTERNAL_KEY: sharedInternalKey,
          SEKED_URL: '',
          SEKED_INTERNAL_KEY: '',
          CONVERGEOS_URL: '',
          CONVERGEOS_INTERNAL_KEY: '',
          AUDIT_SIGNING_SECRET: 'local-audit-secret',
          ECOBE_ADMIN_TOKEN: 'ecobe-admin-local',
          USE_LOCAL_GOVERNANCE_FALLBACK: 'true',
          OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
          OLLAMA_MODEL: 'qwen2.5:1.5b',
        },
        label: 'mvp',
        logFile: path.join(logDir, 'mvp.log'),
      })
      processes.push(mvpProcess)
    } else {
      console.log(`Reusing ecobe-mvp already running on ${mvpPort}`)
    }

    await waitForHttp(`http://127.0.0.1:${mvpPort}/api/v1/ready`, 60000)

    console.log('Bootstrapping local tenant...')
    const bootstrapPayload = await bootstrapTenant(`http://127.0.0.1:${mvpPort}`)
    console.log('Starting Freestyle Writer...')
    const freestyleWriterProcess = spawnProcess('node', ['dist/index.cjs'], {
      cwd: freestyleWriterRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(freestyleWriterPort),
        DATABASE_URL: freestyleWriterDbUrl,
        ECOBE_BASE_URL: `http://127.0.0.1:${mvpPort}`,
        ECOBE_API_KEY: bootstrapPayload.apiKey,
        ECOBE_ENVIRONMENT_SLUG: 'production',
      },
      label: 'freestylewriter',
      logFile: path.join(logDir, 'freestylewriter.log'),
    })
    processes.push(freestyleWriterProcess)

    await waitForHttp(`http://127.0.0.1:${freestyleWriterPort}/api/health`, 60000)
    if (benchmarkMode) {
      console.log('Running governed BarBank preservation benchmark...')
      await runCommand('npm', ['run', 'benchmark:preservation'], {
        cwd: freestyleWriterRoot,
        env: {
          ...process.env,
          BARBANK_BASE_URL: `http://127.0.0.1:${freestyleWriterPort}`,
          BARBANK_BENCHMARK_REPEATS: process.env.BARBANK_BENCHMARK_REPEATS ?? '1',
          BARBANK_BENCHMARK_LIMIT: process.env.BARBANK_BENCHMARK_LIMIT ?? '4',
          BARBANK_BENCHMARK_FILTER: process.env.BARBANK_BENCHMARK_FILTER ?? '',
        },
      })
    } else {
      console.log('Running governed Freestyle Writer demo...')
      await runFreestyleWriterDemo(`http://127.0.0.1:${freestyleWriterPort}`)
    }
  } finally {
    for (const child of processes.reverse()) {
      await terminateProcess(child)
    }

    if (ownsPostgres) {
      await pg.stop().catch(() => undefined)
    }
  }
}

async function bootstrapTenant(baseUrl) {
  const response = await fetchWithTimeout(`${baseUrl}/api/v1/bootstrap`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ecobe-admin-token': 'ecobe-admin-local',
    },
    body: JSON.stringify({
      organizationName: 'BarBankz',
      organizationSlug: 'barbankz',
      projectName: 'Freestyle Writer',
      projectSlug: 'freestyle-writer',
      environmentSlug: 'production',
    }),
  }, 30000)

  if (!response.ok) {
    throw new Error(`Bootstrap failed: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

async function runFreestyleWriterDemo(baseUrl) {
  const response = await fetchWithTimeout(`${baseUrl}/api/generate-lyrics`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      transcript:
        "I been up all night with these thoughts on my chest, trying to turn pain into motion, trying to make this pressure pay off before it breaks me.",
    }),
  }, 300000)

  const payload = await response.json()
  console.log(`Freestyle Writer demo status: ${response.status}`)
  console.log(JSON.stringify(payload, null, 2))

  if (!response.ok) {
    throw new Error(`Freestyle Writer demo failed: ${JSON.stringify(payload)}`)
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
      // keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function isPortOpen(port) {
  return await new Promise((resolve) => {
    const socket = new net.Socket()

    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })

    socket.connect(port, '127.0.0.1')
  })
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function killListeningProcesses(ports) {
  const uniquePorts = [...new Set(ports)]
  const pids = new Set()

  for (const port of uniquePorts) {
    const listeners = await getListeningPids(port)
    for (const pid of listeners) {
      if (pid && pid !== process.pid) {
        pids.add(pid)
      }
    }
  }

  for (const pid of pids) {
    await killPid(pid)
  }
}

async function getListeningPids(port) {
  if (process.platform === 'win32') {
    const output = await captureCommand('netstat', ['-ano', '-p', 'tcp'])
    const matches = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('TCP'))
      .map((line) => line.split(/\s+/))
      .filter((parts) => {
        const localAddress = parts[1] ?? ''
        const state = parts[3] ?? ''
        return localAddress.endsWith(`:${port}`) && state === 'LISTENING'
      })
      .map((parts) => Number(parts[4]))
      .filter((pid) => Number.isInteger(pid) && pid > 0)

    return [...new Set(matches)]
  }

  const output = await captureCommand('lsof', ['-ti', `tcp:${port}`]).catch(() => '')
  return output
    .split(/\r?\n/)
    .map((value) => Number(value.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

function captureCommand(command, args) {
  return new Promise((resolve, reject) => {
    const invocation = resolveInvocation(command, args)
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }

      reject(new Error(stderr || `${command} ${args.join(' ')} failed with code ${code}`))
    })

    child.on('error', reject)
  })
}

async function killPid(pid) {
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      })
      killer.on('exit', () => resolve())
      killer.on('error', () => resolve())
    })
    return
  }

  await new Promise((resolve) => {
    const killer = spawn('kill', ['-TERM', String(pid)], {
      stdio: 'ignore',
    })
    killer.on('exit', () => resolve())
    killer.on('error', () => resolve())
  })
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

function loadReadOnlyEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const parsed = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    parsed[key] = value
  }

  return parsed
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

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
