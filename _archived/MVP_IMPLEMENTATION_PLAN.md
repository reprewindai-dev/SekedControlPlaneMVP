# Seked Control Plane - MVP Implementation Plan

**Phase 1: Foundation (Weeks 1-2)**  
**Stack**: Node.js + Fastify + TypeScript + PostgreSQL + Redis + Prisma  

---

## Build Order (Locked)

### 1️⃣ Gateway API (Week 1)
**Port**: 3000  
**Priority**: Core entry point for all requests

**Core Features**:
- API key authentication
- Request validation
- Basic run creation
- Event logging
- Health checks

**Key Files**:
```
gateway/
├── src/
│   ├── app.ts              # Fastify app setup
│   ├── routes/
│   │   ├── runs.ts         # /v1/runs endpoints
│   │   ├── policies.ts     # /v1/policies endpoints
│   │   └── health.ts       # /health endpoint
│   ├── middleware/
│   │   ├── auth.ts         # API key validation
│   │   └── validation.ts   # Request validation
│   └── services/
│       └── runProcessor.ts # Queue runs for processing
├── package.json
└── Dockerfile
```

**Implementation Priority**:
1. Fastify server with basic routes
2. API key authentication middleware
3. Prisma client setup
4. Run creation endpoint
5. Event logging
6. Health check

### 2️⃣ ConvergeOS Service (Week 2)
**Port**: 3001  
**Priority**: Output reliability - critical for demo

**Core Features**:
- Schema validation
- Retry loop with prompt patching
- Quality scoring
- Convergence tracking

**Key Files**:
```
convergeos/
├── src/
│   ├── app.ts
│   ├── routes/
│   │   └── converge.ts     # /converge endpoint
│   ├── services/
│   │   ├── convergence.ts  # Main convergence logic
│   │   ├── validator.ts    # JSON schema validation
│   │   └── scorer.ts       # Quality scoring
│   └── types/
│       └── convergence.ts   # Type definitions
├── package.json
└── Dockerfile
```

**Implementation Priority**:
1. Schema validation service
2. Quality scoring algorithm
3. Retry loop with backoff
4. Prompt patching logic
5. Convergence result tracking

### 3️⃣ Seked Scoring Service (Week 3)
**Port**: 3002  
**Priority**: Risk governance - key differentiator

**Core Features**:
- Detrimental scoring (simple heuristics)
- Fracture detection
- Drift delta calculation
- Escalation tier assignment

**Key Files**:
```
seked/
├── src/
│   ├── app.ts
│   ├── routes/
│   │   └── score.ts        # /score endpoint
│   ├── services/
│   │   ├── detrimental.ts  # Detrimental scoring
│   │   ├── fracture.ts     # Fracture detection
│   │   ├── drift.ts        # Drift calculation
│   │   └── escalation.ts   # Tier assignment
│   └── heuristics/
│       ├── riskFactors.ts  # Simple risk rules
│       └── thresholds.ts   # Escalation thresholds
├── package.json
└── Dockerfile
```

**Implementation Priority**:
1. Simple detrimental scoring (PII, risk level, task type)
2. Basic fracture detection (conflict patterns)
3. Drift delta (mock for MVP)
4. Escalation tier logic
5. Governance metadata generation

### 4️⃣ ECOBE Routing Service (Week 4)
**Port**: 3003  
**Priority**: Resource governance - completes the stack

**Core Features**:
- Provider/region selection
- Cost estimation
- Latency estimation
- Carbon intensity (mock for MVP)

**Key Files**:
```
ecobe/
├── src/
│   ├── app.ts
│   ├── routes/
│   │   └── route.ts        # /route endpoint
│   ├── services/
│   │   ├── router.ts       # Main routing logic
│   │   ├── cost.ts         # Cost estimation
│   │   └── carbon.ts       # Carbon intensity
│   └── data/
│       └── regions.ts      # Mock region data
├── package.json
└── Dockerfile
```

**Implementation Priority**:
1. Mock region data with costs/latencies
2. Simple routing algorithm
3. Cost estimation
4. Carbon intensity (mock values)
5. Routing decision API

---

## Service Communication

### Internal API Contract

```typescript
// Gateway -> Policy Engine
interface PolicyEvaluationRequest {
  orgId: string;
  policyProfileId: string;
  task: Task;
  constraints: Constraints;
}

// Gateway -> Seked
interface SekedScoreRequest {
  orgId: string;
  task: Task;
  policyThresholds: PolicyThresholds;
}

// Gateway -> ConvergeOS
interface ConvergenceRequest {
  task: string;
  schema: JsonSchema;
  maxAttempts: number;
  qualityThreshold: number;
}

// Gateway -> ECOBE
interface RoutingRequest {
  constraints: Constraints;
  preferences: ExecutionPreferences;
}
```

### Event Types (RunEvent.type)

```typescript
const EVENT_TYPES = {
  RUN_CREATED: 'RUN_CREATED',
  POLICY_EVALUATED: 'POLICY_EVALUATED',
  SEKED_SCORED: 'SEKED_SCORED',
  CONVERGE_ATTEMPTED: 'CONVERGE_ATTEMPTED',
  CONVERGE_PASSED: 'CONVERGE_PASSED',
  CONVERGE_FAILED: 'CONVERGE_FAILED',
  ECOBE_ROUTED: 'ECOBE_ROUTED',
  RUN_COMPLETED: 'RUN_COMPLETED',
  RUN_BLOCKED: 'RUN_BLOCKED'
} as const;
```

---

## Database Setup

### PostgreSQL Initialization

```sql
-- Create database
CREATE DATABASE seked_mvp;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Run Prisma migrations
npx prisma migrate dev --name init
```

### Redis Setup

```bash
# For development
docker run -d -p 6379:6379 redis:7-alpine

# For production
# Use managed Redis service (Railway, AWS ElastiCache, etc.)
```

---

## Development Workflow

### Local Development

```bash
# Terminal 1: Database
docker-compose up -d postgres redis

# Terminal 2: Gateway
cd gateway
npm install
npm run dev

# Terminal 3: ConvergeOS
cd convergeos
npm install
npm run dev

# Terminal 4: Seked
cd seked
npm install
npm run dev

# Terminal 5: ECOBE
cd ecobe
npm install
npm run dev
```

### Environment Variables

```bash
# .env (shared)
DATABASE_URL=postgresql://postgres:password@localhost:5432/seked_mvp
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret_here

# Gateway
PORT=3000
NODE_ENV=development

# ConvergeOS
PORT=3001
NODE_ENV=development

# Seked
PORT=3002
NODE_ENV=development

# ECOBE
PORT=3003
NODE_ENV=development
```

---

## Testing Strategy

### Unit Tests (Jest)

```typescript
// Gateway tests
describe('POST /v1/runs', () => {
  it('should create run with valid API key', async () => {
    const response = await request(app)
      .post('/v1/runs')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send(validRunRequest);
    
    expect(response.status).toBe(202);
    expect(response.body.run_id).toBeDefined();
  });
});

// ConvergeOS tests
describe('Convergence Service', () => {
  it('should converge on simple schema', async () => {
    const result = await convergeOutput({
      task: 'Generate name',
      schema: { type: 'object', required: ['name'] },
      maxAttempts: 3,
      qualityThreshold: 0.8
    });
    
    expect(result.converged).toBe(true);
    expect(result.output.name).toBeDefined();
  });
});
```

### Integration Tests

```typescript
// Full flow test
describe('Run Processing Flow', () => {
  it('should process run through all planes', async () => {
    // Create run
    const createResponse = await createRun(testRequest);
    const runId = createResponse.body.run_id;
    
    // Wait for processing
    await waitForRunStatus(runId, 'completed', 10000);
    
    // Verify results
    const result = await getRun(runId);
    expect(result.body.status).toBe('completed');
    expect(result.body.governance_metadata).toBeDefined();
    expect(result.body.convergence_metadata).toBeDefined();
    expect(result.body.routing_metadata).toBeDefined();
  });
});
```

---

## MVP Success Metrics

### Technical Metrics
- **API Response Time**: < 100ms for authentication, < 500ms for run creation
- **Run Processing Time**: < 5 seconds end-to-end
- **Convergence Rate**: > 95% for simple tasks
- **Uptime**: > 99% during business hours

### Business Metrics
- **API Calls**: Track usage per organization
- **Policy Adoption**: Number of policy profiles created
- **Escalation Rate**: Percentage of runs requiring escalation
- **Error Rate**: < 1% for valid requests

---

## Demo Scenario

### Enterprise Demo Flow

```typescript
// 1. Create policy
const policy = await fetch('/v1/policies', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({
    name: 'Finance-MediumRisk',
    config: {
      seked: {
        escalation_thresholds: {
          tier0: 0.25,
          tier1: 0.55,
          tier2: 1.0
        }
      },
      converge: {
        max_attempts: 3,
        quality_threshold: 0.8
      },
      ecobe: {
        carbon_mode: 'balance',
        weights: { carbon: 0.5, latency: 0.3, cost: 0.2 }
      }
    }
  })
});

// 2. Create run
const run = await fetch('/v1/runs', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({
    policy_profile_id: policy.id,
    schema_id: 'invoice_v1',
    task: { type: 'invoice_extraction', risk_level: 'medium' },
    inputs: { prompt: 'Extract invoice data' },
    constraints: { latency_ms_max: 3000, cost_usd_max: 0.05 }
  })
});

// 3. Monitor progress
const events = await fetch(`/v1/runs/${run.run_id}/events`);
console.log('Audit trail:', events);

// 4. Get final result
const result = await fetch(`/v1/runs/${run.run_id}`);
console.log('Governance metadata:', result.governance_metadata);
console.log('Final output:', result.final_output);
```

---

## Next Phase Preparation

### Week 5-6: Enterprise Features
- Organization isolation
- User management
- Billing integration
- Advanced policies

### Week 7-8: Production Readiness
- Load testing
- Security audit
- Monitoring setup
- Documentation

---

## Success Criteria

### MVP Complete When:
✅ Gateway accepts and authenticates requests  
✅ Runs flow through all four services  
✅ Convergence produces reliable output  
✅ Seked scoring provides risk metadata  
✅ ECOBE routing selects optimal resources  
✅ Audit trail captures all events  
✅ Demo runs end-to-end in < 5 seconds  

### Enterprise Ready When:
✅ Multi-tenancy works  
✅ Policies are versionable  
✅ Costs are predictable  
✅ Audit exports work  
✅ Security is validated  

---

## The Bottom Line

This MVP provides the **minimum viable enterprise platform** that demonstrates:
1. **Three-plane governance** in action
2. **Deterministic output** through convergence
3. **Risk containment** through Seked scoring
4. **Resource optimization** through ECOBE routing
5. **Complete auditability** through event logging

**This is not a demo - it's a real enterprise platform that can be sold today.**
