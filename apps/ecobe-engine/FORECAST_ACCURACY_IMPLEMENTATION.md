# Forecast Accuracy Tracking Implementation

## Overview

The forecast accuracy tracking pipeline compares stored carbon intensity forecasts against realized values to validate the 12% variance target and measure prediction quality over time.

**Status**: COMPLETE - All components implemented and integrated

## Components Implemented

### 1. Core Accuracy Module: `src/lib/forecast-accuracy.ts`

**Purpose**: Measures forecast accuracy by comparing predicted vs realized carbon intensity values.

**Key Functions**:

- `verifyForecasts(lookbackHours: number = 6): Promise<ForecastAccuracyResult[]>`
  - Finds forecasts whose `forecastTime` has passed (within the lookback window)
  - Retrieves realized carbon intensity from local DB or API
  - Calculates variance percentage (absolute error / realized * 100)
  - Updates `CarbonForecast.actualIntensity` and `CarbonForecast.error`
  - Returns array of accuracy results

- `getAccuracyMetrics(region?: string, days: number = 30): Promise<AccuracyMetrics>`
  - Queries verified forecasts from the last N days
  - Computes:
    - `totalVerified`: Number of forecasts with actual measurements
    - `withinTargetCount`: Forecasts where variance <= 12%
    - `withinTargetPct`: Percentage within target
    - `avgVariancePct`: Mean variance
    - `medianVariancePct`: Median variance
    - `p95VariancePct`: 95th percentile variance (worst case)
    - `byRegion`: Breakdown by region

- `getRealizedIntensity(region: string, timestamp: Date): Promise<number | null>`
  - Queries local `CarbonIntensity` records within ±60 minutes
  - Falls back to Electricity Maps API if not in DB
  - Returns null if no data available

**Key Features**:
- No modifications to existing forecast storage code
- Non-blocking verification (runs in separate worker)
- Graceful fallback to API when local data unavailable
- Null-safe handling of missing data
- Persists results to `CarbonForecast` model for training

### 2. Verification Worker: `src/workers/forecast-verification.ts`

**Purpose**: Runs on a schedule to verify forecasts and track accuracy metrics.

**Key Functions**:

- `startForecastVerificationWorker()`
  - Schedules periodic verification every 30 minutes
  - Runs with 2-minute startup delay to allow other services to warm up
  - Logs results to console and integration events

- `runForecastVerification()`
  - Calls `verifyForecasts(6)` to check recent forecasts
  - Stores each result in `IntegrationEvent` for audit trail
  - Logs summary statistics
  - Prevents concurrent runs with `isRunning` flag

- `getForecastVerificationStatus()`
  - Returns `{ lastRunAt, lastRunResults, isRunning }`
  - Used for monitoring and debugging

**Schedule**: Every 30 minutes (180 calls/day per region)

**Integration Events**: Stored as:
```json
{
  "source": "FORECAST_ACCURACY_${region}",
  "success": ${withinTarget},
  "message": "${JSON.stringify(result)}"
}
```

### 3. Dashboard Endpoint: `GET /api/v1/dashboard/forecast-accuracy`

**Purpose**: Exposes forecast accuracy metrics to the dashboard.

**Query Parameters**:
- `region` (optional): Filter by region code (e.g., "US-CAL-CISO")
- `days` (optional, default=30): Time range for metrics

**Response Schema**:
```typescript
{
  timeRange: "30d",
  region: "US-CAL-CISO",  // or "all"
  totalVerified: number,
  withinTargetCount: number,
  withinTargetPct: number,  // percentage
  avgVariancePct: number,
  medianVariancePct: number,
  p95VariancePct: number,
  byRegion: {
    "US-CAL-CISO": {
      count: number,
      avgVariance: number,
      withinTarget: number  // count, not percentage
    },
    ...
  },
  target: {
    maxVariancePct: 12,
    description: "Carbon forecast variance <= 12% vs realized intensity"
  }
}
```

**Example Request**:
```bash
curl "http://localhost:3000/api/v1/dashboard/forecast-accuracy?region=US-CAL-CISO&days=7"
```

**Example Response**:
```json
{
  "timeRange": "7d",
  "region": "US-CAL-CISO",
  "totalVerified": 145,
  "withinTargetCount": 123,
  "withinTargetPct": 84.8,
  "avgVariancePct": 6.2,
  "medianVariancePct": 4.8,
  "p95VariancePct": 10.9,
  "byRegion": {
    "US-CAL-CISO": {
      "count": 145,
      "avgVariance": 6.2,
      "withinTarget": 123
    }
  },
  "target": {
    "maxVariancePct": 12,
    "description": "Carbon forecast variance <= 12% vs realized intensity"
  }
}
```

## Database Schema

**CarbonForecast Model** (existing, no migration needed):
```prisma
model CarbonForecast {
  id                 String   @id @default(cuid())
  region             String
  forecastTime       DateTime
  predictedIntensity Int      // gCO2eq/kWh
  confidence         Float    // 0.0 - 1.0
  modelVersion       String   @default("v1.0")
  features           Json     @default("{}")

  // NEW: Accuracy tracking fields
  actualIntensity    Int?     // Realized gCO2eq/kWh
  error              Float?   // Variance percentage

  createdAt          DateTime @default(now())

  @@index([region, forecastTime])
  @@index([forecastTime])
  @@unique([region, forecastTime], name: "region_forecastTime")
}
```

**IntegrationEvent Model** (existing, reused for audit trail):
```prisma
model IntegrationEvent {
  id         String   @id @default(cuid())
  source     String   // "FORECAST_ACCURACY_${region}"
  success    Boolean
  durationMs Float?
  statusCode Int?
  errorCode  String?
  message    String?  // JSON-serialized ForecastAccuracyResult
  createdAt  DateTime @default(now())

  @@index([source, createdAt])
  @@index([source, success, createdAt])
}
```

## Data Flow

### Forecast Creation (existing, unchanged)
1. `forecastCarbonIntensity()` in `src/lib/carbon-forecasting.ts` creates `CarbonForecast` records
2. Stores `predictedIntensity`, `confidence`, `modelVersion`, and `features`
3. Typical lookback: 7 days of historical data
4. Typical horizon: 24 hours ahead

### Accuracy Verification (new)
1. **Worker startup** (every 30 minutes):
   - `startForecastVerificationWorker()` triggers `runForecastVerification()`

2. **Forecast lookup**:
   - Query `CarbonForecast` with `forecastTime` in last 6 hours (lookback)
   - Only processes forecasts whose time has passed
   - Takes first 200 records to avoid timeouts

3. **Realized intensity lookup**:
   - Query `CarbonIntensity` within ±60 minutes of `forecastTime`
   - If not found locally, call `electricityMaps.getCarbonIntensity(region)`
   - Skip if no data available

4. **Variance calculation**:
   ```
   absoluteError = |predicted - realized|
   variancePct = (absoluteError / realized) * 100
   withinTarget = variancePct <= 12
   ```

5. **Result storage**:
   - Update `CarbonForecast.actualIntensity` and `CarbonForecast.error`
   - Create `IntegrationEvent` for audit trail

6. **Dashboard query**:
   - Filter `CarbonForecast` with `actualIntensity != null` and `error != null`
   - Aggregate by region or across all regions
   - Calculate percentiles for P95 variance

## Integration with Existing Systems

### Carbon Forecasting (`src/lib/carbon-forecasting.ts`)
- **No changes required**: Existing forecast creation works as-is
- Forecasts automatically become verifiable once their time passes
- Optional: Could enrich forecast model with post-hoc variance data

### Electricity Maps (`src/lib/electricity-maps.ts`)
- **Used as fallback**: If local intensity data unavailable
- **No changes required**: Module already has `getCarbonIntensity(zone)`

### Dashboard Routes (`src/routes/dashboard.ts`)
- **New endpoint**: `GET /dashboard/forecast-accuracy`
- **Complements existing endpoints**: Works alongside `/accuracy`, `/metrics`, `/decisions`

### Server Startup (`src/server.ts`)
- **New worker**: `startForecastVerificationWorker()`
- **Added after other workers**: EIA ingestion, forecast polling, intelligence jobs
- **Non-blocking**: Errors don't stop server startup

## Environment Variables

**Required**: None (all optional)

**Optional**:
- `INTELLIGENCE_ACCURACY_CRON`: Cron schedule for other accuracy jobs (not this module)

**Implied**:
- `DATABASE_URL`: Standard Prisma connection (required by app)
- `ELECTRICITY_MAPS_API_KEY`: Used as fallback in accuracy verification

## Testing

**Test File**: `src/lib/forecast-accuracy.test.ts`

**Test Cases**:
1. Create test forecasts and intensities
2. Verify forecasts within tolerance (< 5% variance)
3. Calculate accuracy metrics over time range
4. Handle null realized intensity gracefully
5. Detect variance exceeding 12% target

**Run Tests**:
```bash
npm run test -- forecast-accuracy.test.ts
```

## Deployment Notes

### No Prisma Migration Needed
- `actualIntensity` and `error` fields already exist in schema
- Fields are optional (`Int?` and `Float?`)
- No new indexes required

### Worker Startup
- Worker starts with 2-minute delay
- Runs every 30 minutes after startup
- Non-blocking: Continues even if verification fails

### Dashboard Integration
- New endpoint at `/api/v1/dashboard/forecast-accuracy`
- Query params: `region`, `days`
- Response: Metrics object with per-region breakdown

## Monitoring

**Key Metrics to Track**:
1. `withinTargetPct` - Should be >= 85%
2. `avgVariancePct` - Should be <= 12%
3. `p95VariancePct` - Should be <= 20% (tail risk)
4. `totalVerified` - Should grow steadily (180+ per day per region)

**Integration Events**:
- Query `IntegrationEvent` table with `source LIKE 'FORECAST_ACCURACY_%'`
- Filter by `success = false` to find underperforming regions
- Track success rate by region

**Worker Health**:
- Check `getForecastVerificationStatus()` for last run time
- Monitor server logs for "Forecast verification complete" messages
- Alert if no verification runs in 60+ minutes

## Future Enhancements

1. **Machine Learning**:
   - Use `error` field to retrain forecast models
   - Bias correction by time of day, season, region

2. **Dashboarding**:
   - Real-time accuracy charts
   - Regional heatmap of forecast quality
   - Provider comparison (Electricity Maps vs WattTime)

3. **Alerting**:
   - Alert when region accuracy drops below threshold
   - Trigger model retraining on systemic bias

4. **Optimization**:
   - Reduce lookback window if accuracy metrics are stale
   - Prioritize high-variance regions

5. **Integration**:
   - Feed accuracy scores to routing decisions
   - Adjust confidence weights based on historical error

## Troubleshooting

### No Verification Running
- Check `startForecastVerificationWorker()` was called in `server.ts`
- Verify 2-minute startup delay hasn't elapsed
- Check server logs for "Forecast verification worker started" message

### All Results Returning Null Realized Intensity
- Ensure `CarbonIntensity` records are being created
- Check `electricityMaps.getCarbonIntensity()` for API failures
- Verify `ELECTRICITY_MAPS_API_KEY` is set

### Variance Always Exceeding Target
- Forecast model may be biased (check `predictedIntensity` vs average realized)
- Ensure forecast time range matches actual usage
- Check for seasonal patterns requiring different models

### High Memory Usage from Worker
- Reduce `take: 200` in `verifyForecasts()` if memory is constrained
- Add pagination to process forecasts in batches

## Files Changed

1. **Created**:
   - `src/lib/forecast-accuracy.ts` (6.2 KB)
   - `src/workers/forecast-verification.ts` (2.5 KB)
   - `src/lib/forecast-accuracy.test.ts` (3.2 KB)
   - `FORECAST_ACCURACY_IMPLEMENTATION.md` (this file)

2. **Modified**:
   - `src/server.ts`: Added import and startup hook
   - `src/routes/dashboard.ts`: Added `/forecast-accuracy` endpoint

3. **Unchanged**:
   - `prisma/schema.prisma`: Uses existing `CarbonForecast` fields
   - All other modules and workers

## Verification Checklist

- [x] Accuracy calculation logic correct (variance % formula)
- [x] Database queries use proper indexes
- [x] Null-safe handling of missing data
- [x] Worker prevents concurrent runs
- [x] Startup hook added and tested
- [x] Dashboard endpoint returns proper schema
- [x] Test cases cover main scenarios
- [x] Audit trail recorded in IntegrationEvent
- [x] No migration required
- [x] Documentation complete
