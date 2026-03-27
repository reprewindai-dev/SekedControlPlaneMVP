# ECOBE Engine Testing Guide

Comprehensive guide for testing the ECOBE Engine API and functionality.

## Table of Contents

- [Unit Testing](#unit-testing)
- [API Testing](#api-testing)
- [Integration Testing](#integration-testing)
- [Load Testing](#load-testing)
- [Manual Testing](#manual-testing)

## Unit Testing

### Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Structure

```
src/
└── __tests__/
    ├── setup.ts                    # Global test configuration
    ├── green-routing.test.ts       # Green routing algorithm tests
    ├── energy-equation.test.ts     # Energy calculation tests
    ├── carbon-forecasting.test.ts  # ML forecasting tests
    └── dekes-integration.test.ts   # DEKES integration tests
```

### Writing Tests

```typescript
import { routeGreen } from '../lib/green-routing'

describe('Green Routing', () => {
  it('should select lowest carbon region', async () => {
    const result = await routeGreen({
      preferredRegions: ['FR', 'DE'],
      carbonWeight: 1.0,
    })

    expect(result).toHaveProperty('selectedRegion')
    expect(result.carbonIntensity).toBeGreaterThan(0)
  })
})
```

## API Testing

### Health Check

```bash
curl http://localhost:3000/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "ECOBE Engine",
  "version": "1.0.0",
  "timestamp": "2026-02-17T10:30:00.000Z"
}
```

### Energy Equation

```bash
curl -X POST http://localhost:3000/api/v1/energy/equation \
  -H "Content-Type: application/json" \
  -d '{
    "requestVolume": 1000,
    "workloadType": "inference",
    "modelSize": "mixtral-70b",
    "regionTargets": ["FR", "DE", "US-CAL-CISO"],
    "carbonBudget": 1000000
  }'
```

**Expected Response:**
```json
{
  "routingRecommendation": [
    {
      "region": "FR",
      "rank": 1,
      "carbonIntensity": 58,
      "estimatedCO2": 2320,
      "estimatedEnergyKwh": 0.04,
      "score": 0.95
    }
  ],
  "totalEstimatedCO2": 2320,
  "withinBudget": true
}
```

### Green Routing

```bash
curl -X POST http://localhost:3000/api/v1/route/green \
  -H "Content-Type: application/json" \
  -d '{
    "preferredRegions": ["FR", "DE", "US-CAL-CISO"],
    "maxCarbonGPerKwh": 400,
    "latencyMsByRegion": {
      "FR": 80,
      "DE": 60,
      "US-CAL-CISO": 140
    },
    "carbonWeight": 0.5,
    "latencyWeight": 0.3,
    "costWeight": 0.2
  }'
```

**Expected Response:**
```json
{
  "selectedRegion": "FR",
  "carbonIntensity": 58,
  "estimatedLatency": 80,
  "score": 0.92,
  "alternatives": [
    {
      "region": "DE",
      "carbonIntensity": 120,
      "score": 0.85
    }
  ]
}
```

### DEKES Optimization

```bash
# Optimize single query
curl -X POST http://localhost:3000/api/v1/dekes/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "id": "query_123",
      "query": "sustainable tech companies",
      "estimatedResults": 500
    },
    "carbonBudget": 10000,
    "regions": ["US-CAL-CISO", "FR", "DE"]
  }'

# Schedule batch queries
curl -X POST http://localhost:3000/api/v1/dekes/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "queries": [
      {
        "id": "q1",
        "query": "AI companies",
        "estimatedResults": 300
      },
      {
        "id": "q2",
        "query": "clean energy startups",
        "estimatedResults": 200
      }
    ],
    "regions": ["FR", "DE"],
    "lookAheadHours": 24
  }'

# Get analytics
curl http://localhost:3000/api/v1/dekes/analytics
```

### Carbon Credits

```bash
# Purchase credits
curl -X POST http://localhost:3000/api/v1/credits/purchase \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "org_123",
    "amountCO2": 10000,
    "provider": "Gold Standard",
    "priceUsd": 150
  }'

# List credits
curl "http://localhost:3000/api/v1/credits?organizationId=org_123&status=ACTIVE"

# Get balance
curl http://localhost:3000/api/v1/credits/balance/org_123

# Retire credits
curl -X POST http://localhost:3000/api/v1/credits/retire \
  -H "Content-Type: application/json" \
  -d '{
    "creditIds": ["credit_id_1", "credit_id_2"],
    "reason": "Q1 2026 offset"
  }'

# Auto-offset
curl -X POST http://localhost:3000/api/v1/credits/auto-offset \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "org_123",
    "targetOffsetPercentage": 100
  }'
```

## Integration Testing

### Database Setup

```bash
# Create test database
createdb ecobe_test

# Apply schema
DATABASE_URL="postgresql://user:pass@localhost:5432/ecobe_test" npx prisma db push

# Seed test data
npm run prisma:seed
```

### Redis Setup

```bash
# Use separate Redis database for testing
redis-cli SELECT 1
```

### End-to-End Test Scenario

```bash
#!/bin/bash

# 1. Health check
curl http://localhost:3000/health

# 2. Calculate energy for workload
RESPONSE=$(curl -s -X POST http://localhost:3000/api/v1/energy/equation \
  -H "Content-Type: application/json" \
  -d '{
    "requestVolume": 1000,
    "workloadType": "inference",
    "regionTargets": ["FR", "DE"]
  }')

echo "$RESPONSE" | jq '.'

# 3. Extract best region
BEST_REGION=$(echo "$RESPONSE" | jq -r '.routingRecommendation[0].region')
echo "Best region: $BEST_REGION"

# 4. Get DEKES analytics
curl http://localhost:3000/api/v1/dekes/analytics | jq '.'

# 5. Check carbon balance
curl http://localhost:3000/api/v1/credits/balance/org_123 | jq '.'
```

## Load Testing

### Apache Bench

```bash
# Test health endpoint
ab -n 1000 -c 10 http://localhost:3000/health

# Test routing endpoint
ab -n 100 -c 5 -p route-payload.json -T application/json \
  http://localhost:3000/api/v1/route/green
```

### k6 Load Testing

```javascript
import http from 'k6/http'
import { check } from 'k6'

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0 },
  ],
}

export default function () {
  const payload = JSON.stringify({
    preferredRegions: ['FR', 'DE', 'US-CAL-CISO'],
    carbonWeight: 0.5,
    latencyWeight: 0.3,
    costWeight: 0.2,
  })

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  }

  const res = http.post('http://localhost:3000/api/v1/route/green', payload, params)

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has selected region': (r) => JSON.parse(r.body).selectedRegion !== undefined,
  })
}
```

Run: `k6 run load-test.js`

## Manual Testing

### Postman Collection

Import `ecobe-postman-collection.json` into Postman for manual API testing.

Collection includes:
- All API endpoints
- Request examples
- Environment variables
- Test assertions

### Testing Checklist

#### Core Functionality
- [ ] Health check returns 200 OK
- [ ] Database connection working
- [ ] Redis connection working
- [ ] Electricity Maps API accessible (if key provided)

#### Energy Equation
- [ ] Calculates CO2 for inference workload
- [ ] Calculates CO2 for training workload
- [ ] Calculates CO2 for batch workload
- [ ] Respects carbon budget
- [ ] Ranks regions correctly
- [ ] Handles hardware mix

#### Green Routing
- [ ] Selects lowest carbon region
- [ ] Respects max carbon threshold
- [ ] Balances multiple weights
- [ ] Returns alternatives
- [ ] Handles single region
- [ ] Validates input

#### DEKES Integration
- [ ] Optimizes single query
- [ ] Schedules batch queries
- [ ] Returns analytics
- [ ] Logs workloads to database

#### Carbon Credits
- [ ] Purchase creates credit record
- [ ] List filters by status/provider
- [ ] Balance shows correct totals
- [ ] Retire updates status
- [ ] Auto-offset calculates correctly

#### Edge Cases
- [ ] Handles missing API key gracefully
- [ ] Returns 400 for invalid input
- [ ] Returns 404 for unknown endpoints
- [ ] Returns 500 for server errors
- [ ] Handles database connection failure
- [ ] Handles Redis connection failure

#### Performance
- [ ] Response time < 200ms (health)
- [ ] Response time < 500ms (routing)
- [ ] Response time < 1s (energy equation)
- [ ] Handles 100 concurrent requests
- [ ] No memory leaks under load

#### Security
- [ ] No sensitive data in logs
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention
- [ ] XSS prevention
- [ ] Rate limiting (if configured)

## Continuous Integration

### GitHub Actions

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Generate Prisma client
        run: npx prisma generate

      - name: Run tests
        run: npm test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/ecobe_test
          REDIS_URL: redis://localhost:6379

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Debugging

### View Logs

```bash
# Docker logs
docker logs ecobe-engine

# Production logs (Back4App)
back4app logs ecobe-engine --tail 100

# Database queries
DATABASE_URL="postgresql://..." psql -c "SELECT * FROM \"CarbonIntensity\" LIMIT 10;"

# Redis cache
redis-cli
> KEYS carbon:*
> GET carbon:FR
```

### Common Issues

**Issue: Health check fails**
- Check database connection
- Check Redis connection
- Verify environment variables

**Issue: Carbon intensity returns null**
- Check Electricity Maps API key
- Verify region code is valid
- Check API rate limits

**Issue: Slow response times**
- Check Redis cache hit rate
- Review database query performance
- Monitor API latency to Electricity Maps

**Issue: Tests failing**
- Clear test database
- Verify test environment variables
- Check mock configurations

## Support

- GitHub Issues: Report bugs and feature requests
- Documentation: https://docs.ecobe.com
- API Reference: https://api.ecobe.yourdomain.com

---

**Test Coverage Goal**: >80% for all modules

Ensuring reliability through comprehensive testing.
