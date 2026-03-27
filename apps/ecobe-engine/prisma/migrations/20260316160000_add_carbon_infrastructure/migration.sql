-- Carbon Ledger: Audit-grade carbon accounting
CREATE TABLE "CarbonLedgerEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "commandId" TEXT,
    "decisionFrameId" TEXT,
    "jobClass" TEXT NOT NULL DEFAULT 'realtime',
    "workloadType" TEXT,
    "baselineRegion" TEXT NOT NULL,
    "chosenRegion" TEXT NOT NULL,
    "baselineStartTs" TIMESTAMP(3),
    "chosenStartTs" TIMESTAMP(3),
    "baselineCarbonGPerKwh" DOUBLE PRECISION NOT NULL,
    "chosenCarbonGPerKwh" DOUBLE PRECISION NOT NULL,
    "energyEstimateKwh" DOUBLE PRECISION NOT NULL,
    "baselineCarbonG" DOUBLE PRECISION NOT NULL,
    "chosenCarbonG" DOUBLE PRECISION NOT NULL,
    "carbonSavedG" DOUBLE PRECISION NOT NULL,
    "actualCarbonGPerKwh" DOUBLE PRECISION,
    "actualCarbonG" DOUBLE PRECISION,
    "actualEnergykWh" DOUBLE PRECISION,
    "verifiedSavingsG" DOUBLE PRECISION,
    "accountingMethod" TEXT NOT NULL DEFAULT 'flow-traced',
    "sourceUsed" TEXT,
    "validationSource" TEXT,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "estimatedFlag" BOOLEAN NOT NULL DEFAULT false,
    "syntheticFlag" BOOLEAN NOT NULL DEFAULT false,
    "confidenceScore" DOUBLE PRECISION,
    "qualityTier" TEXT,
    "forecastStability" TEXT,
    "disagreementFlag" BOOLEAN NOT NULL DEFAULT false,
    "disagreementPct" DOUBLE PRECISION,
    "balancingAuthority" TEXT,
    "demandRampPct" DOUBLE PRECISION,
    "carbonSpikeProbability" DOUBLE PRECISION,
    "curtailmentProbability" DOUBLE PRECISION,
    "importCarbonLeakageScore" DOUBLE PRECISION,
    "rankScore" DOUBLE PRECISION,
    "candidatesEvaluated" INTEGER,
    "feasibleCandidates" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "CarbonLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- Routing Candidates: Full decision audit trail
CREATE TABLE "RoutingCandidate" (
    "id" TEXT NOT NULL,
    "decisionFrameId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "startTs" TIMESTAMP(3),
    "carbonEstimateGPerKwh" DOUBLE PRECISION,
    "latencyEstimateMs" DOUBLE PRECISION,
    "queueDelayEstimateSec" DOUBLE PRECISION,
    "costEstimateUsd" DOUBLE PRECISION,
    "confidenceScore" DOUBLE PRECISION,
    "retryRiskScore" DOUBLE PRECISION,
    "carbonScore" DOUBLE PRECISION,
    "latencyScore" DOUBLE PRECISION,
    "costScore" DOUBLE PRECISION,
    "queueScore" DOUBLE PRECISION,
    "uncertaintyScore" DOUBLE PRECISION,
    "rankScore" DOUBLE PRECISION,
    "wasSelected" BOOLEAN NOT NULL DEFAULT false,
    "wasFeasible" BOOLEAN NOT NULL DEFAULT true,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingCandidate_pkey" PRIMARY KEY ("id")
);

-- Provider Snapshots: Signal provenance
CREATE TABLE "ProviderSnapshot" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "signalValue" DOUBLE PRECISION NOT NULL,
    "forecastForTs" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL,
    "freshnessSec" INTEGER,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderSnapshot_pkey" PRIMARY KEY ("id")
);

-- Capacity Buckets: Fleet-aware resource management
CREATE TABLE "CapacityBucket" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "bucketStartTs" TIMESTAMP(3) NOT NULL,
    "cpuAvailable" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "gpuAvailable" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "reservedCpu" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedGpu" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allocatedCommands" INTEGER NOT NULL DEFAULT 0,
    "queueDepth" INTEGER NOT NULL DEFAULT 0,
    "costMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapacityBucket_pkey" PRIMARY KEY ("id")
);

-- Indexes: CarbonLedgerEntry
CREATE INDEX "CarbonLedgerEntry_orgId_createdAt_idx" ON "CarbonLedgerEntry"("orgId", "createdAt");
CREATE INDEX "CarbonLedgerEntry_decisionFrameId_idx" ON "CarbonLedgerEntry"("decisionFrameId");
CREATE INDEX "CarbonLedgerEntry_commandId_idx" ON "CarbonLedgerEntry"("commandId");
CREATE INDEX "CarbonLedgerEntry_chosenRegion_createdAt_idx" ON "CarbonLedgerEntry"("chosenRegion", "createdAt");
CREATE INDEX "CarbonLedgerEntry_jobClass_createdAt_idx" ON "CarbonLedgerEntry"("jobClass", "createdAt");

-- Indexes: RoutingCandidate
CREATE INDEX "RoutingCandidate_decisionFrameId_idx" ON "RoutingCandidate"("decisionFrameId");
CREATE INDEX "RoutingCandidate_region_createdAt_idx" ON "RoutingCandidate"("region", "createdAt");

-- Indexes: ProviderSnapshot
CREATE INDEX "ProviderSnapshot_provider_zone_observedAt_idx" ON "ProviderSnapshot"("provider", "zone", "observedAt");
CREATE INDEX "ProviderSnapshot_zone_signalType_observedAt_idx" ON "ProviderSnapshot"("zone", "signalType", "observedAt");
CREATE UNIQUE INDEX "ProviderSnapshot_provider_zone_signalType_observedAt_key" ON "ProviderSnapshot"("provider", "zone", "signalType", "observedAt");

-- Indexes: CapacityBucket
CREATE UNIQUE INDEX "CapacityBucket_region_bucketStartTs_key" ON "CapacityBucket"("region", "bucketStartTs");
CREATE INDEX "CapacityBucket_region_bucketStartTs_idx" ON "CapacityBucket"("region", "bucketStartTs");
