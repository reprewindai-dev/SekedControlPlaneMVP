import { once } from 'events'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import fs from 'fs'
import EmbeddedPostgres from 'embedded-postgres'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const mvpRoot = __dirname
const engineRoot = path.resolve(mvpRoot, '..', 'ecobe-engine')
const postgresPort = 36432
const mvpPort = 3301
const enginePort = 38081
const databaseName = 'ecobe_platform'
const dbBaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/${databaseName}`
const mvpDbUrl = `${dbBaseUrl}?schema=mvp`
const engineDbUrl = `${dbBaseUrl}?schema=engine`
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const logDir = path.join(mvpRoot, '.local', 'manual-verify-logs', runId)
const postgresDir = path.join(mvpRoot, '.local', 'manual-verify-postgres', runId)
const progressLogFile = path.join(logDir, 'progress.log')
const sharedInternalKey = 'replace-with-shared-internal-key'

fs.mkdirSync(logDir, { recursive: true })
fs.mkdirSync(postgresDir, { recursive: true })

const pg = new EmbeddedPostgres({
  databaseDir: postgresDir,
  port: postgresPort,
  user: 'postgres',
  password: 'postgres',
  persistent: false,
})

const processes = []

async function main() {
  logProgress(`run id: ${runId}`)
  logProgress('manual-verify: initialise postgres')
  await pg.initialise()
  logProgress('manual-verify: start postgres')
  await pg.start()
  await pg.createDatabase(databaseName).catch(() => undefined)

  logProgress('manual-verify: prisma push mvp')
  await runCommand('npm', ['run', 'prisma:push'], {
    cwd: mvpRoot,
    env: { ...process.env, DATABASE_URL: mvpDbUrl },
  })

  logProgress('manual-verify: prisma push engine')
  await runCommand('npm', ['run', 'prisma:push'], {
    cwd: engineRoot,
    env: { ...process.env, DATABASE_URL: engineDbUrl, DIRECT_DATABASE_URL: engineDbUrl },
  })

  logProgress('manual-verify: start engine')
  const engineProcess = spawnProcess('node', ['dist/server.js'], {
    cwd: engineRoot,
    env: {
      ...process.env,
      PORT: String(enginePort),
      DATABASE_URL: engineDbUrl,
      DIRECT_DATABASE_URL: engineDbUrl,
      REDIS_URL: 'disabled',
      ECOBE_INTERNAL_API_KEY: sharedInternalKey,
      ENGINE_BACKGROUND_WORKERS_ENABLED: 'false',
      FORECAST_REFRESH_ENABLED: 'false',
      LEARNING_LOOP_ENABLED: 'false',
      RUNTIME_SUPERVISOR_ENABLED: 'false',
      DECISION_EVENT_DISPATCH_ENABLED: 'false',
      JWT_SECRET: '12345678901234567890123456789012',
      NODE_ENV: 'development',
    },
    label: 'engine',
    logFile: path.join(logDir, 'engine.log'),
  })
  processes.push(engineProcess)

  await waitForHttp(`http://127.0.0.1:${enginePort}/internal/v1/health`, 120000, {
    authorization: `Bearer ${sharedInternalKey}`,
  })
  logProgress('manual-verify: engine healthy')

  logProgress('manual-verify: start mvp')
  const mvpProcess = spawnProcess('npm', ['run', 'start', '--', '-p', String(mvpPort), '-H', '127.0.0.1'], {
    cwd: mvpRoot,
    env: {
      ...process.env,
      PORT: String(mvpPort),
      HOST: '127.0.0.1',
      NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${mvpPort}`,
      DATABASE_URL: mvpDbUrl,
      ECOBE_ENGINE_URL: `http://127.0.0.1:${enginePort}`,
      ECOBE_ENGINE_INTERNAL_KEY: sharedInternalKey,
      AUDIT_SIGNING_SECRET: 'local-audit-secret',
      ECOBE_ADMIN_TOKEN: 'ecobe-admin-local',
      USE_LOCAL_GOVERNANCE_FALLBACK: 'true',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      OLLAMA_MODEL: 'qwen2.5:1.5b',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      NODE_ENV: 'development',
    },
    label: 'mvp',
    logFile: path.join(logDir, 'mvp.log'),
  })
  processes.push(mvpProcess)

  await waitForHttp(`http://127.0.0.1:${mvpPort}/api/v1/ready`, 120000)
  logProgress('manual-verify: mvp ready')

  const bootstrap = await fetchJson(`http://127.0.0.1:${mvpPort}/api/v1/bootstrap`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ecobe-admin-token': 'ecobe-admin-local',
    },
    body: JSON.stringify({
      organizationName: 'Acme Governance',
      organizationSlug: 'acme-governance',
      projectName: 'Support Copilot',
      projectSlug: 'support-copilot',
      environmentSlug: 'production',
    }),
  })
  logProgress(`manual-verify: bootstrap ${bootstrap.status}`)
  if (bootstrap.status >= 400) {
    throw new Error(`Bootstrap failed: ${JSON.stringify(bootstrap.body)}`)
  }

  const run = await fetchJson(`http://127.0.0.1:${mvpPort}/api/v1/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': bootstrap.body.apiKey,
    },
    body: JSON.stringify({
      environmentSlug: 'production',
      operation: 'support.reply',
      input: {
        prompt: 'Return a JSON support response with a short summary and a compliant reply.',
        transcript: 'Customer says the payment failed twice and they need help today.',
      },
      providerConstraints: {
        preferredRegions: ['US-EAST-1'],
        providers: ['ollama'],
      },
      latencyCeiling: 250,
      costCeiling: 0.08,
      model: 'qwen2.5:1.5b',
      tokenCount: 1200,
      schema: {
        type: 'object',
        required: ['summary', 'reply'],
        properties: {
          summary: { type: 'string' },
          reply: { type: 'string' },
        },
      },
      temperature: 0.3,
    }),
  }, 300000)

  logProgress(`manual-verify: run status ${run.status}`)
  console.log(JSON.stringify(run.body, null, 2))

  if (run.status >= 400) {
    throw new Error(`Run failed: ${JSON.stringify(run.body)}`)
  }

  const envelope = run.body
  if (envelope?.status !== 'completed') {
    throw new Error(`Expected completed run, got ${JSON.stringify(envelope)}`)
  }

  logProgress('manual-verify: success')
}

function logProgress(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  fs.appendFileSync(progressLogFile, `${line}\n`)
}

function spawnProcess(command, args, options) {
  const logStream = fs.createWriteStream(options.logFile, { flags: 'a' })
  const { label, ...spawnOptions } = options
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
    process.stderr.write(`[${label}:err] ${chunk}`)
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

function resolveInvocation(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] }
  }
  return { command, args }
}

async function waitForHttp(url, timeoutMs, headers = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store', headers })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function fetchJson(url, init, timeoutMs = 60000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    return { status: response.status, body }
  } finally {
    clearTimeout(timeout)
  }
}

async function terminateProcess(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      killer.on('exit', () => resolve())
      killer.on('error', () => resolve())
    })
    await once(child, 'exit').catch(() => undefined)
    return
  }
  child.kill('SIGTERM')
  await once(child, 'exit').catch(() => undefined)
}

main()
  .catch((error) => {
    console.error('manual-verify:error', error)
    process.exitCode = 1
  })
  .finally(async () => {
    for (const child of processes.reverse()) {
      await terminateProcess(child)
    }
    await pg.stop().catch(() => undefined)
  })
