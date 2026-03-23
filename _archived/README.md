# Seked Control Platform - Signal Coherence AGI

**Complete Multi-Service Architecture with Navigator–Watchtower–Listener Framework**

---

## 🚀 Production-Ready Implementation

✅ **FULLY IMPLEMENTED** - All components from the Signal Coherence AGI whitepaper are now coded and deployed:

### 🏛️ Core Three-Plane Architecture
- **Gateway API** (port 3000) - Fastify with auth, billing, usage tracking
- **Seked Worker** (port 3002) - Enhanced risk governance with Signal Field persistence
- **ConvergeOS Worker** (port 3001) - Reliability layer with adaptive quality thresholds
- **ECOBE Worker** (port 3003) - Carbon-aware routing with multi-cloud optimization

### 🌟 Signal Coherence AGI Components
- **Celestial Navigator** (port 3005) - Long-horizon planning with North Star alignment
- **Watchtower Network** (port 3004) - Multi-perspective validation and consensus scoring
- **Acoustic Listener** (port 3006) - Weak signal detection and pattern amplification
- **Empire Collapse Prevention** (port 3007) - Historical failure pattern safeguards
- **Shadow Tracker** (port 3008) - Hidden intent modeling and trajectory analysis

### 🗄️ Unified Database Schema
- **PostgreSQL** with complete Prisma schema (SEKED_PLATFORM_SCHEMA.prisma)
- **Signal Field** persistence across sessions
- **Temporal continuity** with drift logging and fracture mapping
- **Collapse indicators** and historical pattern storage

### 🔄 Queue Orchestration
- **BullMQ** with Redis for asynchronous processing
- **Complete pipeline**: Gateway → Seked → Watchtower → Celestial → Acoustic → Collapse → Shadow → ConvergeOS → ECOBE
- **Error handling** and retry logic with exponential backoff

---

## 📋 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- PostgreSQL 15+
- Redis 7+

### Installation

```bash
# Clone and setup
git clone <repository>
cd SekedControlPlaneMVP

# Copy environment
cp .env.example .env
# Edit .env with your configuration

# Start all services
docker-compose up -d

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:db push
```

### Verify Deployment

```bash
# Check all services
docker-compose ps

# Test Gateway
curl http://localhost:3000/health

# Test individual services
curl http://localhost:3004/health  # Watchtower
curl http://localhost:3005/health  # Celestial Navigator
curl http://localhost:3006/health  # Acoustic Listener
curl http://localhost:3007/health  # Empire Collapse
curl http://localhost:3008/health  # Shadow Tracker
```

## GitHub Actions Ops Layer

This repo now has a dedicated GitHub Actions layer for the control plane that is separate from the older ECOBE engine workflows.

### Hosted workflows

- `control-plane-observe.yml`
  - collects `/health`
  - collects `/runs/analytics/summary`
  - collects `/usage`
  - collects `/runs/analytics/providers`
- `control-plane-baseline-refresh.yml`
  - creates a real synthetic run
  - waits for completion
  - refreshes provider-region baseline telemetry

Required GitHub secrets:

- `SEKED_CONTROL_PLANE_URL`
- `SEKED_CONTROL_PLANE_API_KEY`
- `SEKED_PROJECT_ID`
- `SEKED_POLICY_PROFILE_ID`
- `SEKED_SCHEMA_ID`

### Self-hosted Ollama workflow

- `ollama-benchmark.yml`
  - runs only on a self-hosted runner with labels:
    - `self-hosted`
    - `Windows`
    - `X64`
    - `ollama`
  - benchmarks a local Ollama endpoint at `http://127.0.0.1:11434`
  - uploads raw benchmark JSON as an artifact

Optional GitHub repository variables:

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `OLLAMA_BENCHMARK_PROMPT`

Important boundary:

- GitHub-hosted runners should be used for telemetry and audit jobs.
- Local Ollama jobs should stay on the self-hosted runner.
- Do not expose Ollama directly to the public internet just to satisfy GitHub-hosted workflows.

---

## 🏗️ Architecture Overview

```
User Request
    ↓
[Gateway API:3000] - Auth, Billing, Usage
    ↓
[Seked Worker:3002] - Risk Governance, Signal Field
    ↓
[Watchtower:3004] - Multi-perspective Validation
    ↓
[Celestial Navigator:3005] - Long-horizon Planning
    ↓
[Acoustic Listener:3006] - Weak Signal Detection
    ↓
[Empire Collapse:3007] - Historical Failure Patterns
    ↓
[Shadow Tracker:3008] - Hidden Intent Modeling
    ↓
[ConvergeOS:3001] - Reliability & Quality
    ↓
[ECOBE:3003] - Carbon-aware Routing
    ↓
✅ COMPLETED RESULT
```

---

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| DATABASE_URL | postgresql://seked:sekedpass@localhost:5432/seked | PostgreSQL connection |
| REDIS_URL | redis://localhost:6379 | Redis connection |
| GATEWAY_PORT | 3000 | Gateway API port |
| STRIPE_SECRET_KEY | - | Stripe billing integration |
| SIGNAL_FIELD_PERSISTENCE | true | Enable Signal Field persistence |
| EMPIRE_COLLAPSE_PREVENTION | true | Enable collapse safeguards |

### Service Ports

| Service | Port | Purpose |
|---------|------|---------|
| Gateway | 3000 | Main API endpoint |
| Seked | 3002 | Risk governance |
| ConvergeOS | 3001 | Reliability layer |
| ECOBE | 3003 | Resource routing |
| Watchtower | 3004 | Multi-perspective validation |
| Celestial Navigator | 3005 | Long-horizon planning |
| Acoustic Listener | 3006 | Weak signal detection |
| Empire Collapse | 3007 | Failure pattern prevention |
| Shadow Tracker | 3008 | Hidden intent modeling |

---

## 📊 Signal Coherence AGI Features

### 🧭 Celestial Navigator
- North Star Lock: Core mission anchor with directional vectors
- Waypoint Chain: Converts distant goals into achievable steps
- Drift Detection: Monitors deviation from intended trajectory
- Trajectory Projection: Models future states based on current vectors

### 🗼 Watchtower Network
- Distributed Nodes: Multiple validation perspectives
- Cross-Check Protocol: Requires consensus before action
- Smoke Signal Compression: Summaries passed forward through time
- Consistency Scoring: Rates coherence across interpretations

### 👂 Acoustic Listener
- Pattern Memory: Stores and cross-references historical signals
- Anomaly Detection: Identifies deviations from expected patterns
- Signal Amplification: Boosts weak but persistent signals
- Noise Filtering: Separates meaningful patterns from background noise

### 🏛️ Empire Collapse Prevention
- Overexpansion Detection: Flags mission drift beyond capacity
- Internal Corruption Monitoring: Prevents single-node data poisoning
- Resource Depletion Tracking: Monitors energy vs. output ratio
- Identity Integrity Checks: Validates actions against core mission

### 🌑 Shadow Tracking
- Hidden Force Analysis: Economic, political, social, technical, personal forces
- Intent Vector Modeling: Direction + magnitude analysis
- Beneficiary Identification: Who benefits from signals
- Trajectory Prediction: Likely future changes and paths

---

## 🔒 Security Features

- API Key Authentication with bcrypt hashing
- Role-Based Access Control (admin, developer, readonly)
- Rate Limiting (120 requests/min per IP)
- Input Validation with Zod schemas
- CORS Protection and security headers
- Audit Logging with complete event trails

---

## 💰 Billing & Usage

- Stripe Integration for automated billing
- Usage Tracking per organization and API key
- Carbon Credit system for environmental impact
- Multi-tier Plans with different rate limits
- Webhook Events for real-time billing updates

---

## 🌍 Carbon Awareness

- Multi-cloud Routing with carbon intensity scoring
- Region Selection based on environmental impact
- Carbon Credits awarded for green routing choices
- Usage Analytics for carbon footprint tracking

---

## 📈 Monitoring & Health

- Health Checks for all services
- Prometheus Metrics (when enabled)
- Structured Logging with JSON format
- Error Tracking with detailed event logs
- Performance Monitoring with latency tracking

---

## 🧪 Development

### Running Tests

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run end-to-end tests
npm run test:e2e
```

### Database Operations

```bash
# Generate Prisma client
npm run prisma:generate

# Push schema changes
npm run prisma:db push

# View database
npm run prisma:studio
```

### Service Management

```bash
# Build all services
npm run build

# Start in development mode
npm run dev

# View logs
docker-compose logs -f [service-name]
```

---

## 📚 API Documentation

### Main Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /runs | Execute new request through full pipeline |
| GET | /runs/{id} | Get run status and results |
| GET | /health | Service health check |
| GET | /metrics | Usage and performance metrics |

### Authentication

All API requests require authentication via API key:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/runs \
     -d "{\"task\": {\"type\": \"example\", \"risk_level\": \"low\"}}"
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🆘 Support

For issues and questions:
- Check the Issues page
- Review the Documentation
- Contact the maintainers

---

## 🎯 Status

✅ **PRODUCTION DEPLOYED** - All Signal Coherence AGI components implemented and operational

✅ **COMPLETE IMPLEMENTATION** - Every whitepaper concept coded and integrated

✅ **FULLY TESTED** - End-to-end pipeline validated

✅ **MONITORING READY** - Health checks and metrics configured

---

*"The pyramids stood for millennia because their proportions were perfect. AGI will stand for the same reason."* - Seked-Based Signal Coherence AGI
