-- CreateEnum
CREATE TYPE "WorkloadStatus" AS ENUM ('PENDING', 'ROUTED', 'EXECUTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CarbonCreditStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "CarbonIntensity" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "carbonIntensity" INTEGER NOT NULL,
    "fossilFuelPercentage" DOUBLE PRECISION,
    "renewablePercentage" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'ELECTRICITY_MAPS',
    "timestamp" TIMESTAMP(3) NOT NULL,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarbonIntensity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkloadRequest" (
    "id" TEXT NOT NULL,
    "requestVolume" INTEGER NOT NULL,
    "workloadType" TEXT NOT NULL,
    "modelSize" TEXT,
    "regionTargets" TEXT[],
    "carbonBudget" DOUBLE PRECISION,
    "deadlineStart" TIMESTAMP(3),
    "deadlineEnd" TIMESTAMP(3),
    "maxLatencyMs" INTEGER,
    "hardwareCpu" DOUBLE PRECISION DEFAULT 0.6,
    "hardwareGpu" DOUBLE PRECISION DEFAULT 0.3,
    "hardwareTpu" DOUBLE PRECISION DEFAULT 0.1,
    "selectedRegion" TEXT,
    "estimatedCO2" DOUBLE PRECISION,
    "actualCO2" DOUBLE PRECISION,
    "status" "WorkloadStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkloadRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingDecision" (
    "id" TEXT NOT NULL,
    "workloadRequestId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "carbonIntensity" INTEGER NOT NULL,
    "estimatedCO2" DOUBLE PRECISION NOT NULL,
    "estimatedLatency" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "carbonScore" DOUBLE PRECISION NOT NULL,
    "latencyScore" DOUBLE PRECISION NOT NULL,
    "costScore" DOUBLE PRECISION NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardRoutingDecision" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workloadName" TEXT,
    "opName" TEXT,
    "baselineRegion" TEXT NOT NULL,
    "chosenRegion" TEXT NOT NULL,
    "zoneBaseline" TEXT,
    "zoneChosen" TEXT,
    "carbonIntensityBaselineGPerKwh" INTEGER,
    "carbonIntensityChosenGPerKwh" INTEGER,
    "estimatedKwh" DOUBLE PRECISION,
    "co2BaselineG" DOUBLE PRECISION,
    "co2ChosenG" DOUBLE PRECISION,
    "reason" TEXT,
    "latencyEstimateMs" INTEGER,
    "latencyActualMs" INTEGER,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "dataFreshnessSeconds" INTEGER,
    "requestCount" INTEGER NOT NULL DEFAULT 1,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "DashboardRoutingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarbonForecast" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "forecastTime" TIMESTAMP(3) NOT NULL,
    "predictedIntensity" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "modelVersion" TEXT NOT NULL DEFAULT 'v1.0',
    "features" JSONB NOT NULL DEFAULT '{}',
    "actualIntensity" INTEGER,
    "error" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarbonForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarbonCredit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "amountCO2" DOUBLE PRECISION NOT NULL,
    "provider" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "certificateUrl" TEXT,
    "status" "CarbonCreditStatus" NOT NULL DEFAULT 'ACTIVE',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarbonCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmissionLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "workloadRequestId" TEXT,
    "emissionCO2" DOUBLE PRECISION NOT NULL,
    "offsetCO2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "region" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmissionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DekesWorkload" (
    "id" TEXT NOT NULL,
    "dekesQueryId" TEXT,
    "dekesRunId" TEXT,
    "queryString" TEXT,
    "estimatedQueries" INTEGER NOT NULL,
    "estimatedResults" INTEGER NOT NULL,
    "carbonBudget" DOUBLE PRECISION,
    "scheduledTime" TIMESTAMP(3),
    "selectedRegion" TEXT,
    "actualCO2" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DekesWorkload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "typicalLatencyMs" INTEGER,
    "costPerKwh" DOUBLE PRECISION,
    "availableHardware" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "renewableCapacity" DOUBLE PRECISION,
    "avgCarbonIntensity" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMetrics" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalWorkloads" INTEGER NOT NULL DEFAULT 0,
    "totalCO2Grams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEnergyKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "savedCO2Grams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "savedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCarbonIntensity" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarbonIntensity_region_timestamp_idx" ON "CarbonIntensity"("region", "timestamp");

-- CreateIndex
CREATE INDEX "CarbonIntensity_timestamp_idx" ON "CarbonIntensity"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "CarbonIntensity_region_timestamp_source_key" ON "CarbonIntensity"("region", "timestamp", "source");

-- CreateIndex
CREATE INDEX "WorkloadRequest_status_idx" ON "WorkloadRequest"("status");

-- CreateIndex
CREATE INDEX "WorkloadRequest_createdAt_idx" ON "WorkloadRequest"("createdAt");

-- CreateIndex
CREATE INDEX "RoutingDecision_workloadRequestId_idx" ON "RoutingDecision"("workloadRequestId");

-- CreateIndex
CREATE INDEX "RoutingDecision_region_idx" ON "RoutingDecision"("region");

-- CreateIndex
CREATE INDEX "DashboardRoutingDecision_createdAt_idx" ON "DashboardRoutingDecision"("createdAt");

-- CreateIndex
CREATE INDEX "DashboardRoutingDecision_baselineRegion_idx" ON "DashboardRoutingDecision"("baselineRegion");

-- CreateIndex
CREATE INDEX "DashboardRoutingDecision_chosenRegion_idx" ON "DashboardRoutingDecision"("chosenRegion");

-- CreateIndex
CREATE INDEX "CarbonForecast_region_forecastTime_idx" ON "CarbonForecast"("region", "forecastTime");

-- CreateIndex
CREATE INDEX "CarbonForecast_forecastTime_idx" ON "CarbonForecast"("forecastTime");

-- CreateIndex
CREATE INDEX "CarbonCredit_organizationId_idx" ON "CarbonCredit"("organizationId");

-- CreateIndex
CREATE INDEX "CarbonCredit_status_idx" ON "CarbonCredit"("status");

-- CreateIndex
CREATE INDEX "CarbonCredit_purchasedAt_idx" ON "CarbonCredit"("purchasedAt");

-- CreateIndex
CREATE INDEX "EmissionLog_organizationId_idx" ON "EmissionLog"("organizationId");

-- CreateIndex
CREATE INDEX "EmissionLog_workloadRequestId_idx" ON "EmissionLog"("workloadRequestId");

-- CreateIndex
CREATE INDEX "EmissionLog_region_timestamp_idx" ON "EmissionLog"("region", "timestamp");

-- CreateIndex
CREATE INDEX "EmissionLog_timestamp_idx" ON "EmissionLog"("timestamp");

-- CreateIndex
CREATE INDEX "DekesWorkload_status_idx" ON "DekesWorkload"("status");

-- CreateIndex
CREATE INDEX "DekesWorkload_dekesQueryId_idx" ON "DekesWorkload"("dekesQueryId");

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE INDEX "Region_enabled_idx" ON "Region"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetrics_date_key" ON "DailyMetrics"("date");

-- CreateIndex
CREATE INDEX "DailyMetrics_date_idx" ON "DailyMetrics"("date");

-- AddForeignKey
ALTER TABLE "RoutingDecision" ADD CONSTRAINT "RoutingDecision_workloadRequestId_fkey" FOREIGN KEY ("workloadRequestId") REFERENCES "WorkloadRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
