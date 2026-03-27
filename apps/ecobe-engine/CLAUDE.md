You are finishing the real ECOBE / CO₂ Router engine and dashboard.

This is a completion, alignment, and hardening task. It is NOT a rewrite task. Do NOT collapse the project into one file. Do NOT redesign the stack. Do NOT replace existing structure. Do NOT create mock servers. Do NOT prove success with fake/demo data. Extend the existing architecture and files only.

LOCKED STACK
- TypeScript
- Node
- Express
- Prisma
- Redis
- Next.js dashboard

LOCKED DATABASE RULE
- Keep the existing Prisma schema as the base.
- Add any needed tables / columns / indexes through Prisma migrations only.
- Do not replace Prisma.
- Do not introduce a new database or ORM.

LOCKED ARCHITECTURE RULE
- Preserve the current repo/file structure as much as possible.
- Make surgical changes.
- Reuse existing services, routes, models, and modules.
- No one-file rewrites.
- No framework swaps.
- No demo compatibility layer unless absolutely necessary and isolated.

LOCKED SIGNAL DOCTRINE
1. WattTime = primary causal routing signal
   - MOER current
   - MOER forecast
   - fast-path routing truth
   - delay scheduling
   - avoided-emissions math

2. Electricity Maps = coherent grid intelligence
   - flow-traced carbon intensity
   - electricity mix
   - renewable %
   - exchanges / cross-zone effects
   - 72h forecast
   - estimated / synthetic labels where applicable

3. Ember = validation / structural context only
   - monthly/yearly carbon intensity
   - monthly/yearly demand
   - monthly/yearly generation mix
   - monthly wind/solar capacity
   - structural carbon baseline
   - fossil/renewable dependence
   - demand trend
   - wind/solar capacity trends
   - NOT fast-path routing

4. EIA-930 = predictive telemetry
   - BALANCE
   - INTERCHANGE
   - SUBREGION
   - demandRampPct
   - fossilRatio
   - renewableRatio
   - carbonSpikeProbability
   - curtailmentProbability
   - importCarbonLeakageScore

LOCKED PRODUCT DOCTRINE
- Lowest defensible signal, not lowest raw signal.
- No provider averaging.
- Preserve provenance and trust flags.
- Preserve estimated / synthetic / fallback / disagreement state.
- Routing must be auditable and replayable.

LOCKED BUSINESS / CONSTRAINTS
Accuracy targets:
- carbon forecast variance <= 12% vs realized intensity
- clean window detection >= 85%
- confidence calibration error <= 10%
- provider disagreement detection >= 95%

Initial region scope:
- AWS / GCP / Azure
- us-east-1
- us-west-2
- eu-west-1
- eu-central-1
- ap-southeast-1
- ap-northeast-1

Billing:
- per-command optimization
- free: 1000 commands/month
- pro: 50k/month
- enterprise: unlimited with SLA
- overage: $0.0015/command
- simulation-only commands count at 0.5x
- billing failure must not block routing

Constraints:
- p99 latency ceiling 200 ms cross-region
- deadline buffer 10%
- missing/low-quality regions excluded unless fallback explicitly allowed

Intelligence layer:
- workload similarity must NOT directly change carbon score
- it may influence confidence, explanation, and recommended delay windows only
- max 1 embedding per command
- max 10 similarity lookups

DASHBOARD KPIS REQUIRED
- Carbon Reduction Multiplier
- Carbon Avoided Today
- Carbon Avoided This Month
- High Confidence Decision %
- Provider Disagreement Rate %
- Forecast accuracy vs realized
- Curtailment opportunity detection
- Carbon spike risk
- Per-org command usage
- Billing status
- Replay availability

YOUR JOB
Finish the real engine and dashboard end-to-end so they work together against the real backend and are production-grade, without structural drift.

PHASE 0 — AUDIT FIRST
Before making changes, audit the real codebase and return:
A. Implemented correctly
B. Partially implemented
C. Missing
D. Engine ↔ dashboard contract mismatches
E. Deployment / Docker / Prisma risks

For each item include:
- exact file(s)
- exact endpoint(s)
- status: implemented / partial / missing
- whether it affects routing, trust, replay, dashboard, or deploy

Then proceed with fixes.

PHASE 1 — ENGINE COMPLETION
Finish or verify the following in the real engine:

1. WattTime
- real MOER current + forecast adapter
- actually used in real routing path
- provenance preserved

2. Electricity Maps
- real current + forecast + mix/flow intelligence
- confidence/trust support
- estimated/synthetic labeling where applicable

3. Ember
Build or complete RegionStructuralProfile using Ember data:
- structuralCarbonBaseline
- carbonTrendDirection
- demandTrendTwh
- demandPerCapita
- fossilDependenceScore
- renewableDependenceScore
- generationMixProfile
- windCapacityTrend
- solarCapacityTrend

Ember is validation/structural only, not routing truth.

4. EIA-930
Complete ingestion/parsing and derived intelligence for:
- BALANCE
- INTERCHANGE
- SUBREGION

Implement or verify:
src/lib/grid-signals/
- balance-parser.ts
- interchange-parser.ts
- subregion-parser.ts
- grid-feature-engine.ts
- curtailment-detector.ts
- ramp-detector.ts
- interchange-analyzer.ts
- grid-signal-cache.ts
- grid-signal-audit.ts

IMPORTANT:
InterchangeAnalyzer must prefer real provider carbon intensities when available.
Hardcoded heuristics may exist only as a last-resort fallback and must be clearly marked as heuristic.

PHASE 2 — ROUTING CONTRACT
The real routing/scheduling responses must return these fields from real code paths:

{
  selectedRegion: string,
  carbonIntensity: number,
  score: number,
  qualityTier: "high" | "medium" | "low",
  carbon_delta_g_per_kwh: number | null,
  forecast_stability: string | null,
  provider_disagreement: { flag: boolean, pct: number | null },

  balancingAuthority: string | null,
  demandRampPct: number | null,
  carbonSpikeProbability: number | null,
  curtailmentProbability: number | null,
  importCarbonLeakageScore: number | null,

  source_used: string | null,
  validation_source: string | null,
  fallback_used: boolean | null,
  estimatedFlag: boolean | null,
  syntheticFlag: boolean | null,

  predicted_clean_window: object | null,
  decisionFrameId: string | null
}

Preserve replay / lease / governance fields already present.

PHASE 3 — REQUIRED ENGINE ENDPOINTS
Ensure these real endpoints exist and return actual data:

GET /api/v1/intelligence/grid/hero-metrics
GET /api/v1/intelligence/grid/summary
GET /api/v1/intelligence/grid/opportunities
GET /api/v1/intelligence/grid/region/:region
GET /api/v1/intelligence/grid/import-leakage
GET /api/v1/intelligence/grid/audit/:region

Document exact request/response schemas from the real code.

PHASE 4 — DASHBOARD ALIGNMENT
Align the real dashboard to the real engine only.

Do NOT preserve an outdated demo payload if it conflicts with the engine contract.

Audit every current dashboard panel/tab and list:
- endpoint used
- request shape
- response fields expected
- whether aligned, broken, or placeholder

Then fix the dashboard to consume the real engine endpoints and fields.

Required dashboard panels:
1. Hero / System State
2. Carbon Opportunity Timeline
3. Grid Signal Map / Regional Status
4. Live Decision Stream
5. Grid Stress / Opportunity Tables
6. Decision Detail / Replay Drawer
7. Provider Trust Panel
8. Ember Structural Region Profile
9. Budget / Governance Panel

Required labels:
- Carbon Reduction Multiplier
- Carbon Avoided
- Carbon Spike Probability
- Curtailment Probability
- Import Carbon Leakage
- Forecast Stability
- Provider Disagreement
- Quality Tier
- Lowest Defensible Signal
- Estimated
- Synthetic

Null-safe rendering required everywhere.

PHASE 5 — REPLAY / TRUST / GOVERNANCE
If a signal affects a decision, it must be present in replay/audit data:
- balancingAuthority
- demandRampPct
- carbonSpikeProbability
- curtailmentProbability
- importCarbonLeakageScore
- source_used
- validation_source
- referenceTime
- fallback_used
- disagreement_flag
- disagreement_pct
- estimatedFlag
- syntheticFlag

PHASE 6 — DOCKER / DEPLOY AUDIT
Audit and fix the real deploy path without drift.

Verify against real code:
- exact env vars referenced by code
- exact build command
- exact start command
- Prisma generate / migrate behavior
- no build-time secret leakage
- whether current Docker / container deployment path is valid
- whether the real app boots without mocks

Do not claim deploy-readiness without verifying actual commands and runtime needs.

PHASE 7 — TESTS
Add/update tests for:
- provider adapters
- EIA-930 parsing
- Ember structural profile derivation
- routing response contract
- intelligence endpoints
- null handling
- estimated/synthetic labeling
- replay includes intelligence fields
- dashboard contract alignment where applicable

SUCCESS CRITERIA
- No mock server required
- Dashboard runs against the real engine
- Real routing path uses the locked signal doctrine
- No structural rewrite
- No one-file collapse
- Prisma migrations are valid
- Build/deploy path is verified
- End-to-end works with real endpoints

FINAL OUTPUT
Return only:
1. Audit report: implemented / partial / missing / contract mismatches / deploy risks
2. Files changed
3. Migration names
4. Exact endpoints now available
5. Exact request/response schemas
6. Exact env vars actually required by code
7. Whether dashboard runs against the real engine: yes / partial / no
8. Remaining blockers, if any