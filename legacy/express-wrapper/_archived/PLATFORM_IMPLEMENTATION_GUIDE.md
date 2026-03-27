# Seked Control Platform - Implementation Guide

**Version**: 1.0  
**Date**: February 18, 2026  
**Stack**: Node.js + TypeScript + PostgreSQL + Redis  
**Architecture**: Three-Plane Governance Platform  

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Seked Control Platform                    │
│                  (Enterprise AI Governance)                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
              ┌───────▼───────┐
              │ Gateway API    │
              │ (Public Edge)  │
              └───────┬───────┘
                      │
        ┌─────────────▼─────────────┐
        │    Service Mesh            │
        │  (Internal Communication) │
        └───────┬───────┬───────┬───┘
                │       │       │
        ┌───────▼─┐ ┌─▼───────▼─┐ ┌─▼───────┐
        │ Policy  │ │ Seked     │ │ Converge │
        │ Engine  │ │ Governance│ │ OS       │
        └───────┬─┘ └───────┬───┘ └───────┬─┘
                │           │           │
        ┌───────▼─┐ ┌───────▼───┐ ┌───▼───────┐
        │ ECOBE   │ │ Audit     │ │ Redis     │
        │ Routing │ │ Ledger    │ │ (Cache)   │
        └─────────┘ └───────────┘ └───────────┘
                      │
              ┌───────▼───────┐
              │ PostgreSQL    │
              │ (Primary DB)  │
              └───────────────┘
```

---

## 2. Service Implementation Details

### 2.1 Gateway API (gateway-api)

**Port**: 3000  
**Framework**: Express.js + TypeScript  
**Responsibilities**:
- API key authentication
- Rate limiting & quotas
- Request routing
- Correlation ID generation

**Key Dependencies**:
```json
{
  "express": "^4.18.0",
  "jsonwebtoken": "^9.0.0",
  "bcrypt": "^5.1.0",
  "redis": "^4.6.0",
  "prisma": "^5.0.0",
  "express-rate-limit": "^6.7.0"
}
```

**Core Routes**:
```typescript
// POST /v1/runs
app.post('/v1/runs', authenticate, validateRequest, async (req, res) => {
  const runId = await createRun(req.body);
  await queueRun(runId);
  res.status(201).json({
    run_id: runId,
    status: 'queued',
    links: {
      self: `/v1/runs/${runId}`,
      events: `/v1/runs/${runId}/events`
    }
  });
});

// GET /v1/runs/:id
app.get('/v1/runs/:id', authenticate, async (req, res) => {
  const run = await getRunDetails(req.params.id);
  res.json(run);
});
```

### 2.2 Policy Engine (policy-engine)

**Port**: 3001  
**Framework**: Express.js + TypeScript  
**Responsibilities**:
- Policy evaluation
- Rule processing
- Version management

**Policy Evaluation Logic**:
```typescript
interface PolicyEvaluation {
  allowed: boolean;
  escalationLevel: number;
  requiredChecks: string[];
  rejectionReason?: string;
}

async function evaluatePolicy(
  request: CreateRunRequest,
  policy: Policy
): Promise<PolicyEvaluation> {
  const sekedConfig = policy.sekedConfig;
  const riskScore = calculateRiskScore(request.task);
  
  // Determine escalation level
  let escalationLevel = 0;
  if (riskScore > sekedConfig.escalationThresholds.tier0.detrimental_max) {
    escalationLevel = 1;
  }
  if (riskScore > sekedConfig.escalationThresholds.tier1.detrimental_max) {
    escalationLevel = 2;
  }
  
  return {
    allowed: escalationLevel < 3,
    escalationLevel,
    requiredChecks: getRequiredChecks(escalationLevel)
  };
}
```

### 2.3 Seked Governance (seked-governance)

**Port**: 3002  
**Framework**: Express.js + TypeScript  
**Responsibilities**:
- Signal Field management
- Detrimental scoring
- Fracture detection
- Drift calculation

**Signal Field Operations**:
```typescript
class SignalFieldManager {
  async loadSignalField(orgId: string, projectId?: string): Promise<SignalField> {
    return await prisma.signalField.findFirst({
      where: { orgId, scope: projectId ? 'project' : 'org', scopeId: projectId },
      include: {
        referenceStars: true,
        intentVectors: true,
        trustWeights: true,
        driftLogEntries: true,
        fractureMaps: true
      }
    });
  }

  async updateSignalField(
    signalFieldId: string,
    updates: SignalFieldUpdates
  ): Promise<void> {
    // Update drift log
    if (updates.driftDelta > 0.25) {
      await prisma.driftLogEntry.create({
        data: {
          signalFieldId,
          runId: updates.runId,
          driftDelta: updates.driftDelta,
          dimension: updates.dimension || 'general'
        }
      });
    }
    
    // Update fracture map
    if (updates.fractureDetected) {
      await prisma.fractureMap.create({
        data: {
          signalFieldId,
          runId: updates.runId,
          fractureType: updates.fractureType,
          clustersJson: updates.clusters
        }
      });
    }
  }
}
```

**Detrimental Scoring**:
```typescript
function calculateDetrimentalScore(
  task: Task,
  signalField: SignalField
): number {
  let score = 0;
  
  // Irreversible actions (0-0.3)
  if (task.requires_pii) score += 0.15;
  if (task.risk_level === 'critical') score += 0.15;
  
  // High impact actions (0-0.25)
  if (task.risk_level === 'high') score += 0.1;
  if (task.risk_level === 'critical') score += 0.15;
  
  // Overreach patterns (0-0.2)
  const overreachRisk = detectOverreach(task, signalField);
  score += overreachRisk * 0.2;
  
  // Legitimacy risk (0-0.25)
  const legitimacyRisk = assessLegitimacy(task, signalField);
  score += legitimacyRisk * 0.25;
  
  return Math.min(score, 1.0);
}
```

### 2.4 ConvergeOS Reliability (convergeos-reliability)

**Port**: 3003  
**Framework**: Express.js + TypeScript  
**Responsibilities**:
- Schema validation
- Retry logic
- Quality scoring
- Prompt patching

**Convergence Engine**:
```typescript
class ConvergenceEngine {
  async convergeOutput(
    task: string,
    schema: JsonSchema,
    maxAttempts: number,
    qualityThreshold: number
  ): Promise<ConvergenceResult> {
    let attempts = 0;
    let lastError = '';
    
    while (attempts < maxAttempts) {
      attempts++;
      
      // Generate output (mock LLM call)
      const output = await generateOutput(task, lastError);
      
      // Validate schema
      const schemaValid = validateJsonSchema(output, schema);
      
      // Score quality
      const qualityScore = scoreQuality(output, task);
      
      // Check convergence
      if (schemaValid && qualityScore >= qualityThreshold) {
        return {
          converged: true,
          output,
          attempts,
          qualityScore,
          schemaValid: true
        };
      }
      
      // Prepare error context for next attempt
      lastError = buildErrorContext(output, schemaValid, qualityScore);
      
      // Log attempt
      await logConvergenceAttempt({
        attemptIndex: attempts,
        rawOutput: output,
        schemaValid,
        qualityScore,
        errors: lastError ? [lastError] : []
      });
    }
    
    return {
      converged: false,
      output: null,
      attempts,
      qualityScore: 0,
      schemaValid: false,
      error: 'Max attempts reached without convergence'
    };
  }
}
```

### 2.5 ECOBE Routing (ecobe-routing)

**Port**: 3004  
**Framework**: Express.js + TypeScript  
**Responsibilities**:
- Carbon-aware routing
- Region selection
- Cost optimization
- Grid intensity data

**Routing Engine**:
```typescript
class RoutingEngine {
  async selectOptimalRegion(
    constraints: RoutingConstraints,
    weights: RoutingWeights
  ): Promise<RoutingDecision> {
    // Fetch available regions with current data
    const regions = await this.getAvailableRegions(constraints);
    
    // Score each region
    const scoredRegions = regions.map(region => ({
      ...region,
      score: this.calculateRoutingScore(region, weights)
    }));
    
    // Select best (lowest score = best)
    scoredRegions.sort((a, b) => a.score - b.score);
    const selected = scoredRegions[0];
    
    return {
      provider: selected.provider,
      region: selected.region,
      carbonIntensityGco2Kwh: selected.carbonIntensity,
      estimatedCostUsd: selected.estimatedCost,
      estimatedLatencyMs: selected.latency,
      decisionTrace: {
        considered: scoredRegions,
        selectedFactors: weights,
        constraints
      }
    };
  }

  private calculateRoutingScore(
    region: RegionData,
    weights: RoutingWeights
  ): number {
    // Normalize values (lower is better)
    const normalizedCost = region.estimatedCost / 0.01; // Normalize to $0.01
    const normalizedCarbon = region.carbonIntensity / 500; // Normalize to 500 gCO2/kWh
    const normalizedLatency = region.latency / 1000; // Normalize to 1000ms
    
    return (
      normalizedCost * weights.cost +
      normalizedCarbon * weights.carbon +
      normalizedLatency * weights.latency
    );
  }
}
```

---

## 3. Database Setup

### 3.1 PostgreSQL Configuration

```sql
-- Create database
CREATE DATABASE seked_control_platform;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create indexes for performance
CREATE INDEX CONCURRENTLY idx_runs_org_created ON runs(org_id, created_at);
CREATE INDEX CONCURRENTLY idx_run_events_run_ts ON run_events(run_id, ts);
CREATE INDEX CONCURRENTLY idx_signal_fields_org_scope ON signal_fields(org_id, scope);
CREATE INDEX CONCURRENTLY idx_drift_log_signal_ts ON drift_log_entries(signal_field_id, created_at);
```

### 3.2 Redis Configuration

```redis
# Rate limiting
SETEX rate_limit:org_123:requests_per_minute 60 1000

# Cache policy profiles
SETEX policy:pol_prof_001 3600 "cached_policy_json"

# Cache schemas
SETEX schema:sch_invoice_v3 7200 "cached_schema_json"

# Session state for runs
SETEX run:run_uuid:status 1800 "running"
```

---

## 4. Deployment Configuration

### 4.1 Docker Compose

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: seked_control_platform
      POSTGRES_USER: seked
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  gateway-api:
    build: ./services/gateway-api
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://seked:${DB_PASSWORD}@postgres:5432/seked_control_platform
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - postgres
      - redis

  policy-engine:
    build: ./services/policy-engine
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://seked:${DB_PASSWORD}@postgres:5432/seked_control_platform
    depends_on:
      - postgres

  seked-governance:
    build: ./services/seked-governance
    ports:
      - "3002:3002"
    environment:
      - DATABASE_URL=postgresql://seked:${DB_PASSWORD}@postgres:5432/seked_control_platform
    depends_on:
      - postgres

  convergeos-reliability:
    build: ./services/convergeos-reliability
    ports:
      - "3003:3003"
    environment:
      - DATABASE_URL=postgresql://seked:${DB_PASSWORD}@postgres:5432/seked_control_platform
    depends_on:
      - postgres

  ecobe-routing:
    build: ./services/ecobe-routing
    ports:
      - "3004:3004"
    environment:
      - DATABASE_URL=postgresql://seked:${DB_PASSWORD}@postgres:5432/seked_control_platform
      - ELECTRICITY_MAPS_API_KEY=${ELECTRICITY_MAPS_API_KEY}
    depends_on:
      - postgres

volumes:
  postgres_data:
```

### 4.2 Environment Variables

```bash
# .env
DATABASE_URL=postgresql://seked:your_password@localhost:5432/seked_control_platform
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret_key
ELECTRICITY_MAPS_API_KEY=your_api_key

# Service ports
GATEWAY_PORT=3000
POLICY_ENGINE_PORT=3001
SEKED_GOVERNANCE_PORT=3002
CONVERGEOS_PORT=3003
ECOBE_PORT=3004

# Rate limits
DEFAULT_REQUESTS_PER_MINUTE=1000
DEFAULT_TIER2_PER_MINUTE=10

# Encryption
ENCRYPTION_KEY=your_32_byte_encryption_key
```

---

## 5. API Implementation Examples

### 5.1 Create Run Flow

```typescript
// gateway-api/src/controllers/runController.ts
export class RunController {
  async createRun(req: Request, res: Response) {
    const { orgId } = req.auth;
    const runData: CreateRunRequest = req.body;
    
    // 1. Validate request
    const validation = await validateRunRequest(runData);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.errors });
    }
    
    // 2. Check rate limits
    const rateLimitOk = await checkRateLimit(orgId, 'requests_per_minute');
    if (!rateLimitOk) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    // 3. Create run record
    const run = await prisma.run.create({
      data: {
        orgId,
        projectId: runData.project_id,
        requestId: runData.request_id,
        correlationId: generateCorrelationId(),
        policyProfileId: runData.policy_profile_id,
        schemaId: runData.schema_id,
        status: 'queued'
      }
    });
    
    // 4. Queue for processing
    await queueRun(run.id, runData);
    
    // 5. Return response
    res.status(201).json({
      run_id: run.id,
      status: run.status,
      links: {
        self: `/v1/runs/${run.id}`,
        events: `/v1/runs/${run.id}/events`
      }
    });
  }
}
```

### 5.2 Run Processing Pipeline

```typescript
// gateway-api/src/processors/runProcessor.ts
export class RunProcessor {
  async processRun(runId: string) {
    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (!run) throw new Error('Run not found');
    
    try {
      // Update status
      await prisma.run.update({
        where: { id: runId },
        data: { status: 'running', startedAt: new Date() }
      });
      
      // Emit RUN_CREATED event
      await emitRunEvent(runId, 'RUN_CREATED', { runId });
      
      // 1. Policy Evaluation
      const policyResult = await this.evaluatePolicy(run);
      await emitRunEvent(runId, 'POLICY_EVALUATED', policyResult);
      
      if (!policyResult.allowed) {
        await this.blockRun(runId, policyResult.rejectionReason);
        return;
      }
      
      // 2. Seked Governance
      const sekedResult = await this.runSekedGovernance(run, policyResult);
      await emitRunEvent(runId, 'SEKED_SCORED', sekedResult);
      
      if (sekedResult.escalationLevel === 2 && !policyResult.allowTier2) {
        await this.blockRun(runId, 'Tier 2 escalation not allowed');
        return;
      }
      
      // 3. ConvergeOS Processing
      const convergenceResult = await this.runConvergence(run);
      if (!convergenceResult.converged) {
        await this.failRun(runId, convergenceResult.error);
        return;
      }
      
      // 4. ECOBE Routing
      const routingDecision = await this.selectRouting(run);
      await emitRunEvent(runId, 'ECOBE_ROUTED', routingDecision);
      
      // 5. Execute (mock)
      const executionResult = await this.executeWorkload(
        convergenceResult.output,
        routingDecision
      );
      
      // 6. Complete
      await this.completeRun(runId, executionResult);
      
    } catch (error) {
      await this.failRun(runId, error.message);
    }
  }
  
  private async runSekedGovernance(
    run: Run,
    policyResult: PolicyEvaluation
  ): Promise<SekedScore> {
    // Load signal field
    const signalField = await this.signalFieldManager.loadSignalField(
      run.orgId,
      run.projectId
    );
    
    // Calculate scores
    const detrimentalScore = calculateDetrimentalScore(run.task, signalField);
    const fractureDetected = detectFracture(run.task, signalField);
    const driftDelta = calculateDrift(run.task, signalField);
    
    // Determine escalation level
    const escalationLevel = Math.max(
      policyResult.escalationLevel,
      detrimentalScore > 0.7 ? 2 : detrimentalScore > 0.3 ? 1 : 0
    );
    
    // Save result
    const sekedScore = await prisma.sekedScore.create({
      data: {
        runId: run.id,
        escalationLevel,
        detrimentalScore,
        fractureDetected,
        driftDelta,
        requiredValidations: {
          watchtower_confirmations: escalationLevel >= 1 ? 1 : 0,
          shadow_tracking_depth: escalationLevel >= 2 ? 'deep' : 'light'
        }
      }
    });
    
    // Update signal field
    await this.signalFieldManager.updateSignalField(signalField.id, {
      runId: run.id,
      driftDelta,
      fractureDetected,
      dimension: 'task_execution'
    });
    
    return sekedScore;
  }
}
```

---

## 6. Monitoring & Observability

### 6.1 Metrics Collection

```typescript
// shared/src/metrics.ts
export class MetricsCollector {
  // Business metrics
  static incrementRunCount(orgId: string, status: string) {
    prometheusCounter
      .withLabelValues('runs_total', orgId, status)
      .inc();
  }
  
  static recordRunDuration(orgId: string, duration: number) {
    prometheusHistogram
      .withLabelValues('run_duration_seconds', orgId)
      .observe(duration / 1000);
  }
  
  static recordEscalationLevel(orgId: string, level: number) {
    prometheusCounter
      .withLabelValues('escalation_total', orgId, level.toString())
      .inc();
  }
  
  // Technical metrics
  static recordApiLatency(endpoint: string, method: string, duration: number) {
    prometheusHistogram
      .withLabelValues('api_latency_seconds', endpoint, method)
      .observe(duration / 1000);
  }
  
  static recordDatabaseQuery(query: string, duration: number) {
    prometheusHistogram
      .withLabelValues('db_query_duration_seconds', query)
      .observe(duration / 1000);
  }
}
```

### 6.2 Health Checks

```typescript
// gateway-api/src/health.ts
export class HealthChecker {
  static async check(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkDependencies()
    ]);
    
    const allHealthy = checks.every(check => check.status === 'fulfilled');
    
    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: checks[0].status === 'fulfilled' ? 'ok' : 'error',
        redis: checks[1].status === 'fulfilled' ? 'ok' : 'error',
        dependencies: checks[2].status === 'fulfilled' ? 'ok' : 'error'
      }
    };
  }
  
  private static async checkDatabase(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  }
  
  private static async checkRedis(): Promise<void> {
    const redis = new Redis(process.env.REDIS_URL);
    await redis.ping();
  }
  
  private static async checkDependencies(): Promise<void> {
    // Check policy engine, seked governance, etc.
    const services = ['policy-engine', 'seked-governance', 'convergeos-reliability', 'ecobe-routing'];
    await Promise.all(
      services.map(service => axios.get(`http://${service}:300${service === 'policy-engine' ? '1' : service === 'seked-governance' ? '2' : service === 'convergeos-reliability' ? '3' : '4'}/health`))
    );
  }
}
```

---

## 7. Security Considerations

### 7.1 API Key Management

```typescript
// gateway-api/src/auth/apiKeyAuth.ts
export class ApiKeyAuth {
  static async authenticate(req: Request): Promise<AuthContext> {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey) {
      throw new UnauthorizedError('API key required');
    }
    
    // Hash and lookup
    const hashedKey = bcrypt.hashSync(apiKey, 10);
    const keyRecord = await prisma.apiKey.findFirst({
      where: {
        hashedKey,
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      include: {
        organization: true
      }
    });
    
    if (!keyRecord) {
      throw new UnauthorizedError('Invalid API key');
    }
    
    // Update last used
    await prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() }
    });
    
    return {
      orgId: keyRecord.orgId,
      role: keyRecord.role,
      scopes: keyRecord.scopes
    };
  }
}
```

### 7.2 Data Encryption

```typescript
// shared/src/encryption.ts
export class Encryption {
  private static algorithm = 'aes-256-gcm';
  private static key = crypto.scryptSync(process.env.ENCRYPTION_KEY!, 'salt', 32);
  
  static encrypt(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.key);
    cipher.setAAD(Buffer.from('seked-platform'));
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }
  
  static decrypt(encryptedData: string): string {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipher(this.algorithm, this.key);
    decipher.setAAD(Buffer.from('seked-platform'));
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

```typescript
// seked-governance/tests/detrimentalScoring.test.ts
describe('Detrimental Scoring', () => {
  it('should calculate high score for PII processing', async () => {
    const task = {
      type: 'data_processing',
      risk_level: 'medium',
      requires_pii: true
    };
    
    const signalField = createMockSignalField();
    const score = calculateDetrimentalScore(task, signalField);
    
    expect(score).toBeGreaterThan(0.15); // PII adds 0.15
    expect(score).toBeLessThanOrEqual(1.0);
  });
  
  it('should calculate maximum score for critical risk tasks', async () => {
    const task = {
      type: 'financial_decision',
      risk_level: 'critical',
      requires_pii: true
    };
    
    const signalField = createMockSignalField();
    const score = calculateDetrimentalScore(task, signalField);
    
    expect(score).toBeGreaterThan(0.5);
  });
});
```

### 8.2 Integration Tests

```typescript
// gateway-api/tests/integration/runFlow.test.ts
describe('Run Flow Integration', () => {
  it('should complete a simple run through all planes', async () => {
    // Create run
    const createResponse = await request(app)
      .post('/v1/runs')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({
        policy_profile_id: 'test_policy',
        schema_id: 'test_schema',
        task: { type: 'simple_test', risk_level: 'low' },
        inputs: { prompt: 'Test prompt' },
        constraints: { latency_ms_max: 5000 },
        execution: { provider_preference: ['openai'] }
      });
    
    expect(createResponse.status).toBe(201);
    const runId = createResponse.body.run_id;
    
    // Wait for completion
    await waitForRunStatus(runId, 'completed', 10000);
    
    // Check final result
    const resultResponse = await request(app)
      .get(`/v1/runs/${runId}`)
      .set('Authorization', `Bearer ${testApiKey}`);
    
    expect(resultResponse.status).toBe(200);
    expect(resultResponse.body.status).toBe('completed');
    expect(resultResponse.body.governance.escalation_level).toBe(0);
    expect(resultResponse.body.convergence.converged).toBe(true);
    expect(resultResponse.body.routing.provider).toBeDefined();
  });
});
```

---

## 9. Performance Optimization

### 9.1 Database Indexes

```sql
-- Critical indexes for performance
CREATE INDEX CONCURRENTLY idx_runs_org_status_created ON runs(org_id, status, created_at);
CREATE INDEX CONCURRENTLY idx_run_events_run_type_ts ON run_events(run_id, type, ts);
CREATE INDEX CONCURRENTLY idx_signal_fields_org_scope_updated ON signal_fields(org_id, scope, updated_at);
CREATE INDEX CONCURRENTLY idx_convergence_attempts_run_attempt ON convergence_attempts(convergence_run_id, attempt_index);
CREATE INDEX CONCURRENTLY idx_usage_records_org_timestamp_metric ON usage_records(org_id, timestamp, metric);
```

### 9.2 Caching Strategy

```typescript
// shared/src/cache.ts
export class CacheManager {
  private static redis = new Redis(process.env.REDIS_URL);
  
  // Policy profiles (change rarely)
  static async getPolicy(policyId: string): Promise<Policy | null> {
    const cached = await this.redis.get(`policy:${policyId}`);
    if (cached) return JSON.parse(cached);
    
    const policy = await prisma.policy.findUnique({ where: { id: policyId } });
    if (policy) {
      await this.redis.setex(`policy:${policyId}`, 3600, JSON.stringify(policy));
    }
    return policy;
  }
  
  // Schemas (change rarely)
  static async getSchema(schemaId: string): Promise<Schema | null> {
    const cached = await this.redis.get(`schema:${schemaId}`);
    if (cached) return JSON.parse(cached);
    
    const schema = await prisma.schema.findUnique({ where: { id: schemaId } });
    if (schema) {
      await this.redis.setex(`schema:${schemaId}`, 7200, JSON.stringify(schema));
    }
    return schema;
  }
  
  // Rate limits (high frequency)
  static async checkRateLimit(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<boolean> {
    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, Math.ceil(windowMs / 1000));
    }
    return current <= limit;
  }
}
```

---

## 10. Migration & Rollout Strategy

### 10.1 Blue-Green Deployment

```bash
# Deploy to green environment
kubectl apply -f k8s/green/ -n seked-green

# Wait for health checks
kubectl wait --for=condition=ready pod -l app=seked-gateway -n seked-green --timeout=300s

# Switch traffic
kubectl patch service seked-gateway -p '{"spec":{"selector":{"version":"green"}}}'

# Monitor for 5 minutes
# If issues: rollback to blue
# If stable: clean up blue environment
```

### 10.2 Database Migrations

```typescript
// migrations/001_initial_schema.sql
-- Initial schema - handled by Prisma

// migrations/002_add_indexes.sql
-- Performance indexes
CREATE INDEX CONCURRENTLY idx_runs_org_created ON runs(org_id, created_at);

// migrations/003_add_encryption.sql
-- Add encryption for sensitive data
ALTER TABLE runs ADD COLUMN final_output_encrypted TEXT;
UPDATE runs SET final_output_encrypted = encrypt(final_output_json::text);
ALTER TABLE runs DROP COLUMN final_output_json;
ALTER TABLE runs RENAME COLUMN final_output_encrypted TO final_output_json;
```

---

## 11. Troubleshooting Guide

### 11.1 Common Issues

**Issue**: Runs stuck in "queued" status
```bash
# Check queue processor
kubectl logs -f deployment/gateway-api -n seked | grep "RunProcessor"

# Check Redis connection
redis-cli -h redis -p 6379 ping

# Check database connections
kubectl exec -it deployment/gateway-api -- psql $DATABASE_URL -c "SELECT count(*) FROM runs WHERE status = 'queued'"
```

**Issue**: High latency on policy evaluation
```bash
# Check policy cache hit rate
redis-cli -h redis -p 6379 info stats | grep keyspace

# Add more cache if needed
redis-cli -h redis -p 6379 config set maxmemory 2gb
```

**Issue**: Seked governance timeouts
```bash
# Check signal field size
psql $DATABASE_URL -c "SELECT pg_size_pretty(pg_total_relation_size('signal_fields'))"

# Archive old drift logs
psql $DATABASE_URL -c "DELETE FROM drift_log_entries WHERE created_at < NOW() - INTERVAL '30 days'"
```

### 11.2 Performance Tuning

```sql
-- Check slow queries
SELECT query, mean_time, calls 
FROM pg_stat_statements 
WHERE mean_time > 100 
ORDER BY mean_time DESC;

-- Analyze table statistics
ANALYZE runs;
ANALYZE run_events;
ANALYZE signal_fields;
```

---

## 12. Next Steps

1. **Implement core services** using the provided Docker setup
2. **Add comprehensive tests** for each plane
3. **Set up monitoring** with Prometheus + Grafana
4. **Configure CI/CD** with automated testing and deployment
5. **Create customer onboarding** documentation and templates
6. **Implement billing** integration with usage tracking

---

## Conclusion

This implementation guide provides a complete, production-ready foundation for the Seked Control Platform. The three-plane architecture ensures proper separation of concerns while maintaining the cohesive governance model required for enterprise AI deployment.

The platform is designed to scale horizontally, maintain high availability, and provide the audit trails and compliance features required by enterprise customers.

**Ready to build: The Kubernetes of AI Decision Flow.**
