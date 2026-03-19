# Three Governance Planes Architecture
## Seked Stability Stack - Enterprise Platform Specification

**Document ID**: SSA-3PA-2026-001  
**Created**: February 18, 2026  
**Author**: ShortFormFactory  
**Classification**: Enterprise Platform Architecture  

---

## Executive Summary

The Seked Stability Stack implements three distinct governance planes that work together as a unified platform for enterprise AI decision flow control. This architecture provides the missing governance layer required for safe, cost-controlled, auditable enterprise AI deployment.

---

## Architecture Overview

```
Customer Application
    ↓
┌─────────────────────────────────────┐
│     Seked Control Plane Gateway     │
│         (Unified API Entry)         │
└─────────────┬───────────────────────┘
              │
              v
┌─────────────────────────────────────┐
│   1️⃣ Cognitive Governance Plane     │
│        (Seked Layer)                │
│   • Risk scoring                    │
│   • Escalation engine               │
│   • Fracture detection              │
│   • Drift detection                 │
│   • Policy engine                   │
└─────────────┬───────────────────────┘
              │ Governance metadata
              v
┌─────────────────────────────────────┐
│   2️⃣ Output Reliability Plane      │
│       (ConvergeOS Layer)            │
│   • JSON schema enforcement         │
│   • Deterministic retry loop        │
│   • Prompt patching                 │
│   • Quality scoring                 │
│   • Immutable audit trail           │
└─────────────┬───────────────────────┘
              │ Validated payload
              v
┌─────────────────────────────────────┐
│   3️⃣ Infrastructure & Resource     │
│        Plane (ECOBE Layer)          │
│   • Multi-cloud routing             │
│   • Carbon intensity optimization   │
│   • Cost threshold enforcement      │
│   • Latency-aware routing           │
│   • Execution forecasting            │
└─────────────┬───────────────────────┘
              │ Routing decision
              v
┌─────────────────────────────────────┐
│           Execution                 │
│    (Provider + Region Selection)     │
└─────────────┬───────────────────────┘
              │
              v
┌─────────────────────────────────────┐
│      Full Audit Log + Return         │
│   Structured Output + Governance    │
│              Trace                  │
└─────────────────────────────────────┘
```

---

## Plane 1: Cognitive Governance Plane (Seked Layer)

### Purpose
Controls decision formation before output exists. This is the pre-execution governance layer that evaluates intent, risk, and policy compliance.

### Core Services

#### 1. Risk Scoring (Detrimental Score)
```typescript
interface RiskScoring {
  calculateDetrimentalScore(input: GovernanceInput): number; // 0-1
  factors: {
    irreversibleAction: number;    // 0-0.3
    highImpactAction: number;     // 0-0.25
    overreachPattern: number;     // 0-0.2
    legitimacyRisk: number;       // 0-0.25
  };
}
```

#### 2. Escalation Engine
```typescript
interface EscalationEngine {
  thresholds: {
    tier0: number;  // 0-0.3 (Routine)
    tier1: number;  // 0.3-0.7 (Elevated)
    tier2: number;  // 0.7-1.0 (Full Stack)
  };
  escalate(score: number, context: GovernanceContext): EscalationLevel;
}
```

#### 3. Fracture Detection
```typescript
interface FractureDetection {
  detectConflicts(input: string, referenceStars: string[]): FracturePoint[];
  calculateFractureScore(conflicts: FracturePoint[]): number; // 0-1
}
```

#### 4. Drift Detection
```typescript
interface DriftDetection {
  calculateDrift(current: IntentVector, historical: IntentVector[]): number; // 0-1
  detectPatternShift(signals: Signal[]): DriftEvent[];
}
```

#### 5. Policy Engine
```typescript
interface PolicyEngine {
  policies: PolicyProfile[];
  evaluate(input: GovernanceInput, policy: PolicyProfile): PolicyResult;
}
```

### Enterprise Configuration

#### Risk Thresholds per Workflow
```yaml
workflows:
  customer_support:
    max_risk_score: 0.6
    escalation_depth: 2
  financial_advice:
    max_risk_score: 0.3
    escalation_depth: 3
  content_generation:
    max_risk_score: 0.8
    escalation_depth: 1
```

#### Escalation Depth
- **Level 1**: Automated retry with adjusted parameters
- **Level 2**: Human-in-the-loop review
- **Level 3**: Block and require explicit override

#### Allowed Reasoning Budget
```typescript
interface ReasoningBudget {
  max_tokens: number;
  max_time_ms: number;
  max_cost_usd: number;
}
```

#### Policy Profiles
```typescript
const policyProfiles = {
  finance: {
    max_risk: 0.2,
    required_consensus: 0.95,
    audit_frequency: 'always',
    retention_days: 2555  // 7 years
  },
  healthcare: {
    max_risk: 0.1,
    required_consensus: 0.99,
    audit_frequency: 'always',
    retention_days: 3650  // 10 years
  },
  support: {
    max_risk: 0.6,
    required_consensus: 0.8,
    audit_frequency: 'sampled',
    retention_days: 365
  }
};
```

### Output: Governance Metadata
```json
{
  "risk_score": 0.42,
  "fracture_detected": false,
  "escalation_level": 1,
  "drift_delta": 0.03,
  "policy_passed": true,
  "governance_trace": {
    "risk_factors": {
      "irreversible_action": 0.1,
      "high_impact": 0.2,
      "overreach": 0.07,
      "legitimacy": 0.05
    },
    "policy_matches": ["customer_support", "general"],
    "reference_star_violations": [],
    "drift_events": []
  }
}
```

---

## Plane 2: Output Reliability Plane (ConvergeOS Layer)

### Purpose
Controls what leaves the system. This is the output validation layer that ensures consistency, quality, and schema compliance.

### Core Services

#### 1. JSON Schema Enforcement
```typescript
interface SchemaEnforcement {
  validate(output: any, schema: JSONSchema): SchemaResult;
  enforce(output: any, schema: JSONSchema): any;
}
```

#### 2. Deterministic Retry Loop
```typescript
interface RetryLoop {
  maxAttempts: number;
  backoffStrategy: 'linear' | 'exponential' | 'adaptive';
  converge(task: ConvergenceTask): ConvergenceResult;
}
```

#### 3. Prompt Patching
```typescript
interface PromptPatching {
  generatePatch(error: ConvergenceError, context: ConvergenceContext): string;
  applyPatch(prompt: string, patch: string): string;
}
```

#### 4. Quality Scoring
```typescript
interface QualityScoring {
  weights: {
    completeness: number;    // 0-0.3
    relevance: number;       // 0-0.4
    structure: number;       // 0-0.3
  };
  score(output: any, task: string): number; // 0-1
}
```

#### 5. Immutable Audit Trail
```typescript
interface AuditTrail {
  record(attempt: ConvergenceAttempt): void;
  getHistory(sessionId: string): ConvergenceAttempt[];
}
```

### Enterprise Controls

#### Schema per Endpoint
```yaml
endpoints:
  /api/generate-report:
    schema:
      type: object
      required: [title, summary, recommendations]
      properties:
        title: {type: string, minLength: 10}
        summary: {type: string, minLength: 50}
        recommendations:
          type: array
          items: {type: string}
          minItems: 1
```

#### Retry Ceiling
```typescript
const retryLimits = {
  customer_facing: 3,
  internal_tools: 5,
  batch_processing: 10,
  critical_systems: 2
};
```

#### Scoring Weights
```typescript
const qualityWeights = {
  finance: { completeness: 0.4, relevance: 0.4, structure: 0.2 },
  healthcare: { completeness: 0.5, relevance: 0.3, structure: 0.2 },
  support: { completeness: 0.2, relevance: 0.5, structure: 0.3 }
};
```

#### Hard Fail vs Soft Fail Modes
```typescript
interface FailureMode {
  hard_fail: boolean;  // true = stop on first failure, false = continue with best effort
  fallback_response?: string;
  escalation_on_failure: boolean;
}
```

### Output: Validated Payload + Convergence Trace
```json
{
  "converged": true,
  "attempts": 2,
  "schema_valid": true,
  "quality_score": 0.91,
  "output": {
    "title": "Q4 Financial Analysis",
    "summary": "Revenue increased 23% YoY...",
    "recommendations": ["Expand to APAC", "Hire 5 more analysts"]
  },
  "convergence_trace": {
    "attempts": [
      {
        "attempt": 1,
        "error": "Schema validation failed: missing recommendations",
        "quality_score": 0.72,
        "patch_applied": "Add at least one recommendation"
      },
      {
        "attempt": 2,
        "error": null,
        "quality_score": 0.91,
        "patch_applied": null
      }
    ],
    "total_time_ms": 1250,
    "total_cost_usd": 0.0042
  }
}
```

---

## Plane 3: Infrastructure & Resource Plane (ECOBE Layer)

### Purpose
Controls where and how it executes. This is the resource optimization layer that handles routing, cost, and environmental impact.

### Core Services

#### 1. Multi-Cloud Routing
```typescript
interface CloudRouting {
  providers: Provider[];
  selectOptimal(workload: Workload, constraints: Constraints): RoutingDecision;
}
```

#### 2. Carbon Intensity Optimization
```typescript
interface CarbonOptimization {
  getCarbonIntensity(region: string): number; // gCO2/kWh
  optimizeByCarbon(regions: Region[]): Region[];
}
```

#### 3. Cost Threshold Enforcement
```typescript
interface CostControl {
  enforceBudget(workload: Workload, budget: Budget): boolean;
  predictCost(workload: Workload, routing: RoutingDecision): CostPrediction;
}
```

#### 4. Latency-Aware Routing
```typescript
interface LatencyRouting {
  measureLatency(region: string): number; // ms
  optimizeByLatency(regions: Region[], maxLatency: number): Region[];
}
```

#### 5. Execution Forecasting
```typescript
interface Forecasting {
  predict(workload: Workload, region: string): Forecast;
  factors: {
    historical_performance: number;
    current_load: number;
    carbon_intensity: number;
    cost_per_token: number;
  };
}
```

### Enterprise Controls

#### Cost Ceiling per Workflow
```yaml
workflows:
  daily_reports:
    max_cost_per_execution: 0.01
    monthly_budget: 100
  customer_chat:
    max_cost_per_execution: 0.002
    monthly_budget: 500
  batch_analysis:
    max_cost_per_execution: 1.00
    monthly_budget: 1000
```

#### Carbon Policy
```typescript
const carbonPolicies = {
  minimize: 'Select lowest carbon intensity regardless of cost',
  balance: 'Optimize for carbon:cost ratio',
  ignore: 'Optimize for cost and latency only'
};
```

#### Region Allow-List
```typescript
const regionPolicies = {
  eu_data_residency: ['eu-west-1', 'eu-central-1', 'eu-north-1'],
  us_only: ['us-east-1', 'us-west-1', 'us-west-2'],
  global: ['*']
};
```

#### Provider Preferences
```typescript
const providerPreferences = {
  primary: 'AWS',
  secondary: 'GCP',
  tertiary: 'Azure',
  fallback: 'Local'
};
```

### Output: Execution Routing Decision
```json
{
  "provider": "AWS",
  "region": "us-west-2",
  "carbon_intensity": 134,
  "estimated_cost": 0.0021,
  "policy_compliant": true,
  "routing_trace": {
    "considered_regions": [
      { "region": "us-west-2", "score": 0.92, "cost": 0.0021, "carbon": 134 },
      { "region": "us-east-1", "score": 0.85, "cost": 0.0018, "carbon": 198 },
      { "region": "eu-west-1", "score": 0.78, "cost": 0.0024, "carbon": 89 }
    ],
    "selection_factors": {
      "cost_weight": 0.3,
      "carbon_weight": 0.5,
      "latency_weight": 0.2
    },
    "policy_constraints": {
      "max_cost": 0.005,
      "max_carbon": 200,
      "allowed_regions": ["us-*", "eu-*"]
    }
  }
}
```

---

## Unified Request Flow

### Single API Endpoint
```typescript
POST /api/v1/execute
{
  "workflow": "customer_support",
  "input": "Generate a response to the customer complaint...",
  "options": {
    "governance": {
      "risk_threshold": 0.6,
      "escalation_depth": 2
    },
    "convergence": {
      "max_attempts": 3,
      "quality_threshold": 0.8
    },
    "infrastructure": {
      "carbon_policy": "balance",
      "cost_ceiling": 0.01
    }
  }
}
```

### Unified Response
```json
{
  "success": true,
  "request_id": "req_1234567890",
  "timestamp": "2026-02-18T18:05:00Z",
  "output": {
    "response": "I understand your frustration...",
    "metadata": {...}
  },
  "governance": {
    "risk_score": 0.42,
    "fracture_detected": false,
    "escalation_level": 1,
    "policy_passed": true
  },
  "convergence": {
    "converged": true,
    "attempts": 2,
    "quality_score": 0.91
  },
  "infrastructure": {
    "provider": "AWS",
    "region": "us-west-2",
    "carbon_intensity": 134,
    "cost": 0.0021
  },
  "audit": {
    "trace_id": "trace_abcdef",
    "full_log_url": "/api/v1/audit/trace_abcdef"
  }
}
```

---

## What Enterprises Actually Buy

### Core Value Propositions
1. **AI Output Reliability** - Consistent, predictable results
2. **Cost Predictability** - Budget control with no surprises
3. **Risk Containment** - Multi-layer safety mechanisms
4. **Auditability** - Complete decision traceability
5. **Explainability** - Clear reasoning for every action
6. **Carbon Reporting** - Environmental impact tracking
7. **Governance Compliance** - Regulatory adherence

### Market Position
**Not**: "We built AGI"  
**Instead**: "We provide the missing governance layer required for safe, cost-controlled, auditable enterprise AI"

### The Kubernetes Analogy
Just as Kubernetes became the standard for container orchestration, Seked becomes the standard for AI decision flow governance.

---

## Core Platform Components

### 1. Unified Gateway API
```typescript
interface GatewayAPI {
  execute(request: UnifiedRequest): UnifiedResponse;
  getStatus(requestId: string): RequestStatus;
  cancel(requestId: string): void;
}
```

### 2. Policy Engine
```typescript
interface PolicyEngine {
  createPolicy(policy: PolicyDefinition): Policy;
  updatePolicy(id: string, policy: Partial<Policy>): void;
  evaluatePolicy(request: Request, policy: Policy): PolicyResult;
}
```

### 3. Governance Metadata Schema
```typescript
interface GovernanceMetadata {
  request_id: string;
  timestamp: string;
  governance: GovernanceResult;
  convergence: ConvergenceResult;
  infrastructure: InfrastructureResult;
  audit: AuditInfo;
}
```

### 4. Central Audit Ledger
```typescript
interface AuditLedger {
  record(event: AuditEvent): void;
  query(filter: AuditFilter): AuditEvent[];
  export(format: 'json' | 'csv' | 'pdf'): Blob;
}
```

### 5. Dashboard UI
- Live request monitoring
- Risk heatmaps
- Convergence metrics
- Drift alerts
- Carbon + cost analytics
- Policy violation tracking

### 6. Org Isolation + RBAC
```typescript
interface Organization {
  id: string;
  policies: Policy[];
  users: User[];
  isolation: IsolationLevel;
}

interface Role {
  permissions: Permission[];
  scopes: Scope[];
}
```

### 7. Billing + Usage Metering
```typescript
interface UsageMetering {
  recordUsage(orgId: string, usage: UsageRecord): void;
  generateBill(orgId: string, period: BillingPeriod): Invoice;
  getUsageStats(orgId: string, period: Period): UsageStats;
}
```

---

## Dashboard UI (Enterprise View)

### Main Tabs

#### 1. Live Requests
- Real-time request flow
- Status indicators
- Performance metrics
- Error rates

#### 2. Risk Heatmap
- Risk scores by workflow
- Fracture points visualization
- Drift indicators
- Escalation events

#### 3. Convergence Metrics
- Success rates by endpoint
- Average attempts to convergence
- Quality score distributions
- Schema compliance rates

#### 4. Drift Alerts
- Pattern shift notifications
- Intent vector changes
- Reference star violations
- Trend analysis

#### 5. Fracture Log
- Conflict point history
- Resolution tracking
- Impact assessment
- Prevention recommendations

#### 6. Carbon + Cost Analytics
- Carbon intensity trends
- Cost optimization opportunities
- Provider comparisons
- Budget utilization

#### 7. Policy Violations
- Real-time violations
- Compliance reports
- Remediation actions
- Audit trails

#### 8. Audit Export
- Full audit log access
- Custom report generation
- Compliance package creation
- Historical analysis

---

## Pricing Model

### Tier 1 — Reliability Only ($0.01/1K requests)
- Output Reliability Plane (ConvergeOS)
- Basic audit logging
- Schema enforcement
- Up to 100K requests/month

### Tier 2 — Reliability + Governance ($0.05/1K requests)
- Everything in Tier 1
- Cognitive Governance Plane (Seked)
- Risk scoring and escalation
- Policy engine
- Up to 1M requests/month

### Tier 3 — Full Stack Governance ($0.15/1K requests)
- Everything in Tier 2
- Infrastructure & Resource Plane (ECOBE)
- Carbon optimization
- Cost control
- Multi-cloud routing
- Unlimited requests

### Enterprise Add-ons

#### On-Premise Deployment
- $50K setup fee
- $10K/month maintenance
- Full air-gapped deployment

#### VPC Isolation
- $5K/month
- Dedicated infrastructure
- Enhanced security

#### SLA
- 99.9% uptime: +$2K/month
- 99.99% uptime: +$10K/month
- 99.999% uptime: +$25K/month

#### Compliance Module
- HIPAA: +$3K/month
- SOX: +$2K/month
- GDPR: +$1K/month

---

## Hard Reality Check: Required Formalizations

To make this viable and not just branding, we must formalize:

### 1. Escalation Math
```typescript
function calculateEscalation(
  riskScore: number,
  fractureScore: number,
  driftScore: number,
  policyViolations: number
): EscalationLevel {
  const weightedScore = (
    riskScore * 0.4 +
    fractureScore * 0.3 +
    driftScore * 0.2 +
    policyViolations * 0.1
  );
  
  if (weightedScore < 0.3) return EscalationLevel.TIER_0;
  if (weightedScore < 0.7) return EscalationLevel.TIER_1;
  return EscalationLevel.TIER_2;
}
```

### 2. Trust Weight Math
```typescript
function calculateTrustWeight(
  source: Source,
  recency: number,
  corroboration: number,
  accuracy: number
): number {
  const recencyDecay = Math.exp(-recency / (24 * 60 * 60 * 1000)); // 24 hour half-life
  const corroborationBonus = Math.log(1 + corroboration) / Math.log(10);
  const accuracyMultiplier = accuracy;
  
  return baseWeight * recencyDecay * corroborationBonus * accuracyMultiplier;
}
```

### 3. Risk Scoring Formula
```typescript
function calculateRiskScore(
  irreversibleAction: boolean,
  impactLevel: number,
  overreachPattern: boolean,
  legitimacyRisk: number
): number {
  const irreversibleWeight = irreversibleAction ? 0.3 : 0;
  const impactWeight = Math.min(impactLevel / 100, 0.25);
  const overreachWeight = overreachPattern ? 0.2 : 0;
  const legitimacyWeight = legitimacyRisk * 0.25;
  
  return irreversibleWeight + impactWeight + overreachWeight + legitimacyWeight;
}
```

### 4. Routing Weighting Formula
```typescript
function calculateRoutingScore(
  cost: number,
  carbon: number,
  latency: number,
  weights: RoutingWeights
): number {
  const normalizedCost = cost / maxCost;
  const normalizedCarbon = carbon / maxCarbon;
  const normalizedLatency = latency / maxLatency;
  
  return (
    normalizedCost * weights.cost +
    normalizedCarbon * weights.carbon +
    normalizedLatency * weights.latency
  );
}
```

### 5. Cross-Plane Event Schema
```typescript
interface CrossPlaneEvent {
  event_id: string;
  timestamp: string;
  plane: 'governance' | 'convergence' | 'infrastructure';
  event_type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  data: any;
  correlations: string[]; // Related event IDs
  trace_id: string;
}
```

---

## Implementation Status

### ✅ Completed Components
1. **Cognitive Governance Plane** - Full implementation in SEKED_IMPLEMENTATION_GUIDE.md
2. **Output Reliability Plane** - Complete ConvergeOS integration
3. **Infrastructure & Resource Plane** - ECOBE routing and optimization
4. **Unified API** - Single endpoint design in API_ENDPOINTS.md
5. **Data Models** - Complete schema in schema.prisma
6. **Demo Implementation** - Working three-plane flow in seked_stack_demo.html

### 🔄 In Progress
1. **Enterprise Dashboard** - UI mockups in landing page
2. **Billing System** - Usage tracking infrastructure designed
3. **RBAC System** - Organization isolation framework

### 📋 Next Steps
1. Formalize all mathematical formulas (shown above)
2. Build enterprise dashboard UI
3. Implement billing and metering
4. Add organization isolation
5. Create deployment automation

---

## Conclusion

The Three Governance Planes architecture transforms the Seked Stability Stack from a theoretical framework into a practical enterprise platform. By separating concerns into three distinct but coordinated planes, we provide:

1. **Clear Value Proposition** - Each plane solves specific enterprise pain points
2. **Flexible Pricing** - Customers can adopt incrementally
3. **Credible Positioning** - We're not selling AGI, we're selling governance
4. **Platform Viability** - With the core components, it's a unified platform

This is the Kubernetes of AI Decision Flow - the missing layer that makes enterprise AI adoption safe, predictable, and auditable.

---

*"Enterprises don't buy AGI. They buy control. Seked provides that control."*
