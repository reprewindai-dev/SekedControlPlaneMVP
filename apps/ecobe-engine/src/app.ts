import express from 'express'
import cors from 'cors'

import { env } from './config/env'
import { prisma } from './lib/db'
import { redis } from './lib/redis'
import energyRoutes from './routes/energy'
import dekesRoutes from './routes/dekes'
import routingRoutes from './routes/routing'
import creditsRoutes from './routes/credits'
import decisionsRoutes from './routes/decisions'
import dashboardRoutes from './routes/dashboard'
import dashboardApiRoutes from './routes/dashboard-api'
import forecastingRoutes from './routes/forecasting'
import carbonRoutes from './routes/carbon-command'
import organizationsRoutes from './routes/organizations'
import intelligenceRoutes from './routes/intelligence'
import gridIntelligenceRoutes from './routes/intelligence/grid'
import integrationsRoutes from './routes/integrations'
import systemRoutes from './routes/system'
import dekesHandoffRoutes from './routes/dekes-handoff'
import carbonLedgerRoutes from './routes/carbon-ledger'
import routeSimpleRoutes from './routes/route-simple'
import routeTestRoutes from './routes/route-test'
import simpleTestRoutes from './routes/simple-test'
import healthRoutes from './routes/health'
import metricsRoutes from './routes/metrics'
import regionMappingRoutes from './routes/region-mapping'
import patternsRoutes from './routes/patterns'
import dksRoutes from './routes/dks'
import testPostRoutes from './routes/test-post'
import routeDebugRoutes from './routes/route-debug'
import ciRoutes from './routes/ci'
import waterRoutes from './routes/water'
import eventsRoutes from './routes/events'
import adaptersRoutes from './routes/adapters'
import { recordTelemetryMetric, telemetryMetricNames } from './lib/observability/telemetry'
import { validateWaterArtifacts } from './lib/water/bundle'

function rawBodySaver(_req: express.Request, _res: express.Response, buf: Buffer) {
  if (buf?.length) {
    const rawReq = _req as { rawBody?: string }
    rawReq.rawBody = buf.toString('utf8')
  }
}

function attachHealthRoutes(app: express.Express) {
  async function healthHandler(req: express.Request, res: express.Response) {
    try {
      await prisma.$queryRaw`SELECT 1`

      let redisOk = true
      try {
        await redis.ping()
      } catch {
        redisOk = false
      }

      const waterArtifacts = validateWaterArtifacts()
      const ok = redisOk && waterArtifacts.healthy

      res.status(ok ? 200 : 503).json({
        status: ok ? 'ok' : 'degraded',
        engine: 'online',
        router: true,
        fingrid: Boolean(env.FINGRID_API_KEY),
        providers: {
          watttime: Boolean(env.WATTTIME_USERNAME && env.WATTTIME_PASSWORD),
          gridstatus: Boolean(env.GRIDSTATUS_API_KEY || env.EIA_API_KEY),
          ember: Boolean(env.EMBER_API_KEY),
          gbCarbon: true,
          dkCarbon: true,
          fiCarbon: Boolean(env.FINGRID_API_KEY),
          static: true
        },
        timestamp: new Date().toISOString(),
        checks: {
          database: true,
          redis: redisOk,
          waterArtifacts: waterArtifacts.checks,
        },
        waterArtifactErrors: waterArtifacts.errors,
      })
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  app.get('/health', healthHandler)
  app.get('/api/v1/health', healthHandler)
}

function attachUiRoute(app: express.Express) {
  app.get('/ui', (req, res) => {
    if (!env.UI_ENABLED) {
      return res.status(404).json({ error: 'Not found' })
    }

    if (env.UI_TOKEN) {
      const auth = req.headers.authorization
      const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : undefined
      if (!token || token !== env.UI_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
    }

    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ECOBE Engine UI</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; padding: 24px; background: #0b1020; color: #e7eaf3; }
      a { color: #9ecbff; }
      h1 { font-size: 20px; margin: 0 0 16px; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 16px; max-width: 1100px; }
      .card { background: #121a33; border: 1px solid #25305a; border-radius: 10px; padding: 14px; }
      .row { display: flex; flex-wrap: wrap; gap: 10px; }
      button { background: #2c6bed; border: 0; color: white; padding: 10px 12px; border-radius: 8px; cursor: pointer; font-weight: 600; }
      button.secondary { background: #394164; }
      button.danger { background: #b42318; }
      input, select { background: #0b1020; border: 1px solid #25305a; color: #e7eaf3; padding: 10px 10px; border-radius: 8px; }
      pre { margin: 10px 0 0; white-space: pre-wrap; word-break: break-word; background: #0b1020; border: 1px solid #25305a; border-radius: 10px; padding: 12px; }
      .muted { color: #aab2d5; font-size: 13px; }
    </style>
  </head>
  <body>
    <h1>ECOBE Engine UI</h1>
    <div class="muted">Use this page to test the deployed engine without any separate dashboard deploy. Same-origin API base: <code id="base"></code></div>
    <div class="grid" style="margin-top: 16px;">
      <div class="card">
        <div class="row">
          <button id="health">GET /api/v1/health</button>
          <button class="secondary" id="metrics">GET /api/v1/dashboard/metrics</button>
          <button class="secondary" id="regions">GET /api/v1/dashboard/regions</button>
          <button class="secondary" id="decisions">GET /api/v1/dashboard/decisions</button>
          <button class="secondary" id="mapping">GET /api/v1/dashboard/region-mapping</button>
        </div>
        <pre id="out">Click a button…</pre>
      </div>

      <div class="card">
        <div class="row" style="align-items: center;">
          <strong>Energy Equation</strong>
          <button class="secondary" id="energyEquation">POST /api/v1/energy/equation</button>
        </div>
        <div class="muted" style="margin-top: 8px;">Calculate carbon footprint for workload.</div>
      </div>

      <div class="card">
        <div class="row" style="align-items: center; gap: 12px;">
          <strong>Green Routing</strong>
          <label class="muted">Regions</label>
          <input id="routingRegions" style="min-width: 260px;" value="US-EAST-4,FR,DE" />
          <label class="muted">Max gCO2/kWh</label>
          <input id="routingBudget" style="width: 140px;" value="500" />
          <button id="routingGreen">POST /api/v1/route/green</button>
        </div>
      </div>

      <div class="card">
        <div class="row" style="align-items: center;">
          <button id="seedDecision">POST /api/v1/decisions (sample)</button>
          <span class="muted">Creates a decision so the dashboard endpoints return data.</span>
        </div>
      </div>

      <div class="card">
        <div class="row" style="align-items: center; gap: 12px;">
          <strong>What-if intensities</strong>
          <label class="muted">Zones</label>
          <input id="zones" style="min-width: 320px;" value="FR,DE,GB" />
          <button class="secondary" id="whatif">POST /api/v1/dashboard/what-if/intensities</button>
        </div>
        <div class="muted" style="margin-top: 8px;">Comma-separated zones. Example: <code>US-CAL-CISO,FR,DE</code></div>
      </div>
    </div>

    <script>
      const base = window.location.origin
      document.getElementById('base').textContent = base

      const out = document.getElementById('out')
      function show(v) { out.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2) }

      async function get(path) {
        const r = await fetch(path)
        const t = await r.text()
        let data
        try { data = JSON.parse(t) } catch { data = t }
        return { status: r.status, data }
      }

      async function post(path, body) {
        const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const t = await r.text()
        let data
        try { data = JSON.parse(t) } catch { data = t }
        return { status: r.status, data }
      }

      async function run(fn) {
        out.textContent = 'Loading…'
        try {
          const res = await fn()
          show(res)
        } catch (e) {
          show({ error: String(e) })
        }
      }

      document.getElementById('health').onclick = () => run(() => get('/api/v1/health'))
      document.getElementById('metrics').onclick = () => run(() => get('/api/v1/dashboard/metrics'))
      document.getElementById('regions').onclick = () => run(() => get('/api/v1/dashboard/regions'))
      document.getElementById('decisions').onclick = () => run(() => get('/api/v1/dashboard/decisions'))
      document.getElementById('mapping').onclick = () => run(() => get('/api/v1/dashboard/region-mapping'))

      document.getElementById('dekesHealth').onclick = () => run(() => get('/api/v1/dekes/health'))
      document.getElementById('dekesPing').onclick = () => run(() => get('/api/v1/dekes/health?ping=true'))
      document.getElementById('dekesAnalytics').onclick = () => run(() => get('/api/v1/dekes/analytics'))

      document.getElementById('seedDecision').onclick = () => run(async () => {
        const now = new Date().toISOString()
        const body = {
          ts: now,
          workloadName: 'ui-demo',
          opName: 'click-test',
          baselineRegion: 'US-EAST-4',
          chosenRegion: 'FR',
          zoneBaseline: 'US-NEISO',
          zoneChosen: 'FR',
          carbonIntensityBaselineGPerKwh: 500,
          carbonIntensityChosenGPerKwh: 150,
          estimatedKwh: 0.2,
          co2BaselineG: 100,
          co2ChosenG: 30,
          requestCount: 1,
          reason: 'ui-seed',
          meta: { source: 'ui' }
        }
        return await post('/api/v1/decisions', body)
      })

      document.getElementById('whatif').onclick = () => run(async () => {
        const zonesRaw = document.getElementById('zones').value
        const zones = zonesRaw.split(',').map(s => s.trim()).filter(Boolean)
        return await post('/api/v1/dashboard/what-if/intensities', { zones })
      })

      document.getElementById('dekesOptimize').onclick = () => run(async () => {
        const query = String(document.getElementById('dekesQuery').value || '')
        const estimatedResults = parseInt(String(document.getElementById('dekesEstimated').value || '1000'), 10)
        const carbonBudget = parseFloat(String(document.getElementById('dekesBudget').value || '200'))
        const regionsRaw = String(document.getElementById('dekesRegions').value || '')
        const regions = regionsRaw.split(',').map(s => s.trim()).filter(Boolean)

        const body = {
          query: { id: 'ui-' + Date.now(), query, estimatedResults },
          carbonBudget,
          regions,
        }

        return await post('/api/v1/dekes/optimize', body)
      })

      document.getElementById('dekesSchedule').onclick = () => run(async () => {
        const lookAheadHours = parseFloat(String(document.getElementById('dekesLookAhead').value || '24'))
        const regionsRaw = String(document.getElementById('dekesScheduleRegions').value || '')
        const regions = regionsRaw.split(',').map(s => s.trim()).filter(Boolean)
        const body = {
          queries: [
            { id: 'demo-query-1', query: 'Find carbon-efficient plans', estimatedResults: 1000 },
            { id: 'demo-query-2', query: 'List regions with low CI', estimatedResults: 500 },
          ],
          regions,
          lookAheadHours,
        }
        return await post('/api/v1/dekes/schedule', body)
      })

      document.getElementById('dekesReport').onclick = () => run(async () => {
        const queryId = String(document.getElementById('dekesReportId').value || '')
        const actualCO2 = parseFloat(String(document.getElementById('dekesReportCO2').value || '0'))
        return await post('/api/v1/dekes/report', { queryId, actualCO2 })
      })
    </script>
  </body>
</html>`)
  })
}

function attachApiRoutes(app: express.Express) {
  app.use('/api/v1/energy', energyRoutes)
  app.use('/api/v1/dekes', dekesRoutes)
  app.use('/api/v1/route', routingRoutes)
  app.use('/api/v1/credits', creditsRoutes)
  app.use('/api/v1/decisions', decisionsRoutes)
  app.use('/api/v1/dashboard', dashboardRoutes)
  app.use('/api/v1/dashboard', dashboardApiRoutes) // New dashboard API routes
  app.use('/api/v1/forecasting', forecastingRoutes)
  app.use('/api/v1/carbon', carbonRoutes)
  app.use('/api/v1/organizations', organizationsRoutes)
  app.use('/api/v1/intelligence', intelligenceRoutes)
  app.use('/api/v1/intelligence/grid', gridIntelligenceRoutes)
  app.use('/api/v1/integrations', integrationsRoutes)
  app.use('/api/v1/system', systemRoutes)
  // DEKES SaaS integration endpoints (prospects, tenants, demos, handoffs, route, workloads)
  app.use('/api/v1', dekesHandoffRoutes)
  // Carbon Ledger — audit-grade accounting + reporting
  app.use('/api/v1/carbon-ledger', carbonLedgerRoutes)
  // CI/CD green routing
  app.use('/api/v1/ci', ciRoutes)
  app.use('/api/v1/events', eventsRoutes)
  app.use('/api/v1/adapters', adaptersRoutes)
  app.use('/api/v1/water', waterRoutes)
  // Additional routes from remote merge
  app.use('/api/v1/route-simple', routeSimpleRoutes)
  app.use('/api/v1/route-test', routeTestRoutes)
  app.use('/api/v1/simple-test', simpleTestRoutes)
  app.use('/api/v1/health-ext', healthRoutes)
  app.use('/api/v1/metrics', metricsRoutes)
  app.use('/api/v1/region-mapping', regionMappingRoutes)
  app.use('/api/v1/patterns', patternsRoutes)
  app.use('/api/v1/dks', dksRoutes)
  app.use('/api/v1/test-post', testPostRoutes)
  app.use('/api/v1/route-debug', routeDebugRoutes)
}

function attachFallbackHandlers(app: express.Express) {
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next
    console.error('Server error:', err)
    res.status(500).json({ error: 'Internal server error' })
  })
}

export function createApp() {
  const app = express()

  app.set('trust proxy', 1)
  app.use(cors())
  app.use(express.json({ limit: '1mb', verify: rawBodySaver }))
  app.use(express.urlencoded({ extended: true, limit: '1mb', verify: rawBodySaver }))
  app.use((req, res, next) => {
    const started = Date.now()
    res.on('finish', () => {
      recordTelemetryMetric(telemetryMetricNames.httpServerDurationMs, 'histogram', Date.now() - started, {
        method: req.method,
        route: req.path,
        status_code: res.statusCode,
      })
    })
    next()
  })

  attachHealthRoutes(app)
  attachUiRoute(app)
  attachApiRoutes(app)
  attachFallbackHandlers(app)

  return app
}

export default createApp
