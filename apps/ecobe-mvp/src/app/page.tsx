'use client'

import { useEffect, useState } from 'react'

type Overview = {
  organizations: number
  runs: number
  activePolicies: number
  estimatedRevenue: number
}

export default function HomePage() {
  const [health, setHealth] = useState<{ status: string; timestamp: string } | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)

  useEffect(() => {
    void fetch('/api/v1/health')
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'unavailable', timestamp: new Date().toISOString() }))

    void fetch('/api/v1/dashboard/overview')
      .then((response) => response.json())
      .then(setOverview)
      .catch(() =>
        setOverview({
          organizations: 0,
          runs: 0,
          activePolicies: 0,
          estimatedRevenue: 0,
        })
      )
  }, [])

  return (
    <main className="min-h-screen bg-shell text-shell-foreground">
      <section className="hero">
        <div className="hero__copy">
          <span className="eyebrow">Customer-Facing Control Plane</span>
          <h1>ECOBE governance, reliability, routing, audit, and billing in one product layer.</h1>
          <p>
            `ecobe-mvp` is the sellable SaaS. It authenticates tenants, enforces policy, runs Seked and
            ConvergeOS checks, calls the private engine, and records a full audit trail.
          </p>
          <div className="hero__actions">
            <a href="/api/v1/health" className="button button--primary">API Health</a>
            <a href="/api/v1/dashboard/overview" className="button button--ghost">Overview JSON</a>
          </div>
        </div>
        <div className="hero__panel">
          <div className="panel">
            <div className="panel__label">Runtime</div>
            <div className="panel__value">{health?.status ?? 'loading'}</div>
            <div className="panel__meta">{health?.timestamp ?? 'probing control plane'}</div>
          </div>
          <div className="panel">
            <div className="panel__label">Organizations</div>
            <div className="panel__value">{overview?.organizations ?? 0}</div>
            <div className="panel__meta">Tenant source of truth lives here</div>
          </div>
          <div className="panel">
            <div className="panel__label">Governed Runs</div>
            <div className="panel__value">{overview?.runs ?? 0}</div>
            <div className="panel__meta">Public `/v1/runs` enters here, not the engine</div>
          </div>
          <div className="panel">
            <div className="panel__label">Estimated Revenue</div>
            <div className="panel__value">${(overview?.estimatedRevenue ?? 0).toFixed(2)}</div>
            <div className="panel__meta">Usage metering and billing stay in MVP</div>
          </div>
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Public API</h2>
          <p>`POST /api/v1/runs`, policies, keys, usage, billing webhooks, and audit views are owned here.</p>
        </article>
        <article className="card">
          <h2>Governance Flow</h2>
          <p>Runs pass through Seked governance evaluation, ConvergeOS reliability checks, then the engine.</p>
        </article>
        <article className="card">
          <h2>Private Engine Boundary</h2>
          <p>`ecobe-engine` is called over `/internal/v1/*` with a shared internal key and no customer traffic.</p>
        </article>
      </section>

      <section className="flow">
        <div className="flow__item">Customer / SDK</div>
        <div className="flow__arrow">→</div>
        <div className="flow__item flow__item--active">ecobe-mvp</div>
        <div className="flow__arrow">→</div>
        <div className="flow__item">Seked</div>
        <div className="flow__arrow">→</div>
        <div className="flow__item">ConvergeOS</div>
        <div className="flow__arrow">→</div>
        <div className="flow__item">ecobe-engine</div>
      </section>
    </main>
  )
}
