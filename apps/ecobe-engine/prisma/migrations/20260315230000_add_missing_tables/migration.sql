-- CreateEnum
CREATE TYPE "CarbonCommandMode" AS ENUM ('IMMEDIATE', 'SCHEDULED', 'ADVISORY');

-- CreateEnum
CREATE TYPE "CarbonCommandStatus" AS ENUM ('PENDING', 'RECOMMENDED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "CarbonMeasurementSource" AS ENUM ('ESTIMATED', 'PROVIDER_REPORTED', 'METERED');

-- CreateEnum
CREATE TYPE "PredictionQuality" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrgPlanTier" AS ENUM ('FREE', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "ForecastRefreshStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "SignalQuality" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "billingEmail" TEXT,
    "planTier" "OrgPlanTier" NOT NULL DEFAULT 'FREE',
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "monthlyCommandLimit" INTEGER NOT NULL DEFAULT 1000,
    "enforceCreditCoverage" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgUsageCounter" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "commandCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedEmissionsKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastCommandAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgUsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarbonCommand" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "workloadType" TEXT,
    "modelFamily" TEXT,
    "executionMode" TEXT,
    "mode" "CarbonCommandMode" NOT NULL DEFAULT 'IMMEDIATE',
    "status" "CarbonCommandStatus" NOT NULL DEFAULT 'PENDING',
    "candidateWindowHours" INTEGER,
    "allowTimeShifting" BOOLEAN NOT NULL DEFAULT true,
    "allowCrossRegion" BOOLEAN NOT NULL DEFAULT true,
    "requireCreditCoverage" BOOLEAN NOT NULL DEFAULT false,
    "selectedRegion" TEXT,
    "selectedStartAt" TIMESTAMP(3),
    "fallbackRegion" TEXT,
    "expectedCarbonIntensity" INTEGER,
    "expectedLatencyMs" INTEGER,
    "expectedCostIndex" DOUBLE PRECISION,
    "estimatedEmissionsKgCo2e" DOUBLE PRECISION,
    "estimatedSavingsKgCo2e" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "balancingAuthority" TEXT,
    "demandRampPct" DOUBLE PRECISION,
    "carbonSpikeProbability" DOUBLE PRECISION,
    "curtailmentProbability" DOUBLE PRECISION,
    "importCarbonLeakageScore" DOUBLE PRECISION,
    "summaryReason" TEXT,
    "tradeoffSummary" TEXT,
    "decisionId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarbonCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarbonCommandTrace" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "scoringModel" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "environment" JSONB NOT NULL,
    "candidates" JSONB NOT NULL,
    "rejected" JSONB NOT NULL,
    "selection" JSONB NOT NULL,
    "traceJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarbonCommandTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarbonCommandOutcome" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actualRegion" TEXT NOT NULL,
    "actualStartAt" TIMESTAMP(3) NOT NULL,
    "actualEndAt" TIMESTAMP(3),
    "actualLatencyMs" INTEGER,
    "actualGpuHours" DOUBLE PRECISION,
    "actualCpuHours" DOUBLE PRECISION,
    "actualMemoryGb" DOUBLE PRECISION,
    "actualCarbonIntensity" DOUBLE PRECISION,
    "actualEmissionsKgCo2e" DOUBLE PRECISION,
    "actualCostUsd" DOUBLE PRECISION,
    "costIndexObserved" DOUBLE PRECISION,
    "measurementSource" "CarbonMeasurementSource" NOT NULL DEFAULT 'ESTIMATED',
    "providerExecutionId" TEXT,
    "predictedEmissionsKgCo2e" DOUBLE PRECISION,
    "predictedLatencyMs" INTEGER,
    "predictedCostIndex" DOUBLE PRECISION,
    "actualBalancingAuthority" TEXT,
    "actualDemandRampPct" DOUBLE PRECISION,
    "actualCarbonSpikeProbability" DOUBLE PRECISION,
    "actualCurtailmentProbability" DOUBLE PRECISION,
    "actualImportCarbonLeakageScore" DOUBLE PRECISION,
    "emissionsVarianceKg" DOUBLE PRECISION,
    "emissionsVariancePct" DOUBLE PRECISION,
    "latencyVarianceMs" INTEGER,
    "latencyVariancePct" DOUBLE PRECISION,
    "costVariancePct" DOUBLE PRECISION,
    "regionMatch" BOOLEAN NOT NULL DEFAULT false,
    "slaMet" BOOLEAN,
    "fallbackTriggered" BOOLEAN DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "predictionQuality" "PredictionQuality" NOT NULL DEFAULT 'MEDIUM',
    "comparisonJson" JSONB NOT NULL DEFAULT '{}',
    "learningSignals" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarbonCommandOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarbonCommandAccuracyDaily" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,
    "workloadType" TEXT,
    "region" TEXT,
    "totalCommands" INTEGER NOT NULL DEFAULT 0,
    "regionMatchCount" INTEGER NOT NULL DEFAULT 0,
    "avgEmissionsVariancePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgLatencyVariancePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCostVariancePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "highQualityCount" INTEGER NOT NULL DEFAULT 0,
    "mediumQualityCount" INTEGER NOT NULL DEFAULT 0,
    "lowQualityCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedSavingsKgCo2e" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verifiedSavingsKgCo2e" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarbonCommandAccuracyDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkloadEmbeddingIndex" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "vectorId" TEXT,
    "workloadType" TEXT,
    "modelFamily" TEXT,
    "executionMode" TEXT,
    "gpuHoursBucket" TEXT,
    "gpuHours" DOUBLE PRECISION,
    "cpuHours" DOUBLE PRECISION,
    "memoryGb" DOUBLE PRECISION,
    "region" TEXT,
    "carbonIntensity" DOUBLE PRECISION,
    "emissionsKgCo2e" DOUBLE PRECISION,
    "savingsKgCo2e" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkloadEmbeddingIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdaptiveProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workloadType" TEXT,
    "modelFamily" TEXT,
    "region" TEXT,
    "weightModifiersJson" JSONB NOT NULL DEFAULT '{}',
    "regionAdjustmentsJson" JSONB NOT NULL DEFAULT '{}',
    "executionModeAdjustmentsJson" JSONB NOT NULL DEFAULT '{}',
    "confidenceModifiersJson" JSONB NOT NULL DEFAULT '{}',
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdaptiveProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdaptiveSignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "workloadType" TEXT,
    "modelFamily" TEXT,
    "region" TEXT,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdaptiveSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdaptiveRunLog" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "baseScoreJson" JSONB NOT NULL DEFAULT '{}',
    "adjustmentsJson" JSONB NOT NULL DEFAULT '{}',
    "finalScoreJson" JSONB NOT NULL DEFAULT '{}',
    "reasoningJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdaptiveRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastRefresh" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordsIngested" INTEGER NOT NULL DEFAULT 0,
    "forecastsGenerated" INTEGER NOT NULL DEFAULT 0,
    "status" "ForecastRefreshStatus" NOT NULL DEFAULT 'SUCCESS',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastRefresh_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationMetric" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastLatencyMs" DOUBLE PRECISION,
    "totalLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencySamples" INTEGER NOT NULL DEFAULT 0,
    "latencyP95Ms" DOUBLE PRECISION,
    "alertActive" BOOLEAN NOT NULL DEFAULT false,
    "alertMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "durationMs" DOUBLE PRECISION,
    "statusCode" INTEGER,
    "errorCode" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkloadDecisionOutcome" (
    "id" TEXT NOT NULL,
    "workloadId" TEXT NOT NULL,
    "region" TEXT,
    "carbonSaved" DOUBLE PRECISION NOT NULL,
    "latency" DOUBLE PRECISION NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkloadDecisionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GridSignalSnapshot" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "balancingAuthority" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "demandMwh" DOUBLE PRECISION,
    "demandChangeMwh" DOUBLE PRECISION,
    "demandChangePct" DOUBLE PRECISION,
    "netGenerationMwh" DOUBLE PRECISION,
    "netInterchangeMwh" DOUBLE PRECISION,
    "renewableRatio" DOUBLE PRECISION,
    "fossilRatio" DOUBLE PRECISION,
    "carbonSpikeProbability" DOUBLE PRECISION,
    "curtailmentProbability" DOUBLE PRECISION,
    "importCarbonLeakageScore" DOUBLE PRECISION,
    "signalQuality" "SignalQuality" NOT NULL DEFAULT 'MEDIUM',
    "estimatedFlag" BOOLEAN NOT NULL DEFAULT false,
    "syntheticFlag" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'eia930',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GridSignalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Eia930BalanceRaw" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "respondent" TEXT NOT NULL,
    "respondentName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "valueUnits" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "balancingAuthority" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Eia930BalanceRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Eia930InterchangeRaw" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "fromBa" TEXT NOT NULL,
    "fromBaName" TEXT NOT NULL,
    "toBa" TEXT NOT NULL,
    "toBaName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "valueUnits" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "balancingAuthority" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Eia930InterchangeRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Eia930SubregionRaw" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "respondent" TEXT NOT NULL,
    "respondentName" TEXT NOT NULL,
    "parent" TEXT NOT NULL,
    "parentName" TEXT NOT NULL,
    "subregion" TEXT NOT NULL,
    "subregionName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "valueUnits" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "balancingAuthority" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Eia930SubregionRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DekesLeadCandidate" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "company" TEXT,
    "primaryContactName" TEXT,
    "primaryContactRole" TEXT,
    "primaryContactEmail" TEXT,
    "primaryContactConfidence" DOUBLE PRECISION,
    "businessType" TEXT,
    "intentScore" DOUBLE PRECISION NOT NULL,
    "icpFitScore" DOUBLE PRECISION NOT NULL,
    "sourceSignals" JSONB NOT NULL DEFAULT '[]',
    "riskFlags" JSONB NOT NULL DEFAULT '[]',
    "verificationStatus" TEXT NOT NULL,
    "confidenceBreakdown" JSONB NOT NULL DEFAULT '{}',
    "rawAgentFindings" JSONB NOT NULL DEFAULT '[]',
    "verificationPayload" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DekesLeadCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (Unique constraints)
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "Organization_apiKey_key" ON "Organization"("apiKey");
CREATE UNIQUE INDEX "OrgUsageCounter_orgId_periodStart_key" ON "OrgUsageCounter"("orgId", "periodStart");
CREATE UNIQUE INDEX "CarbonCommandTrace_commandId_key" ON "CarbonCommandTrace"("commandId");
CREATE UNIQUE INDEX "CarbonCommandOutcome_commandId_key" ON "CarbonCommandOutcome"("commandId");
CREATE UNIQUE INDEX "CarbonCommandOutcome_providerExecutionId_key" ON "CarbonCommandOutcome"("providerExecutionId");
CREATE UNIQUE INDEX "CarbonCommandAccuracyDaily_date_orgId_workloadType_region_key" ON "CarbonCommandAccuracyDaily"("date", "orgId", "workloadType", "region");
CREATE UNIQUE INDEX "WorkloadEmbeddingIndex_commandId_key" ON "WorkloadEmbeddingIndex"("commandId");
CREATE UNIQUE INDEX "AdaptiveProfile_orgId_workloadType_modelFamily_region_key" ON "AdaptiveProfile"("orgId", "workloadType", "modelFamily", "region");
CREATE UNIQUE INDEX "AdaptiveRunLog_commandId_key" ON "AdaptiveRunLog"("commandId");
CREATE UNIQUE INDEX "IntegrationMetric_source_key" ON "IntegrationMetric"("source");
CREATE UNIQUE INDEX "GridSignalSnapshot_region_timestamp_source_key" ON "GridSignalSnapshot"("region", "timestamp", "source");
CREATE UNIQUE INDEX "DekesLeadCandidate_candidateId_key" ON "DekesLeadCandidate"("candidateId");

-- CreateIndex (Regular indexes)
CREATE INDEX "OrgUsageCounter_orgId_idx" ON "OrgUsageCounter"("orgId");
CREATE INDEX "CarbonCommand_orgId_idx" ON "CarbonCommand"("orgId");
CREATE INDEX "CarbonCommand_mode_idx" ON "CarbonCommand"("mode");
CREATE INDEX "CarbonCommand_status_idx" ON "CarbonCommand"("status");
CREATE INDEX "CarbonCommand_selectedRegion_idx" ON "CarbonCommand"("selectedRegion");
CREATE INDEX "CarbonCommand_workloadType_idx" ON "CarbonCommand"("workloadType");
CREATE INDEX "CarbonCommand_modelFamily_idx" ON "CarbonCommand"("modelFamily");
CREATE INDEX "CarbonCommandOutcome_orgId_idx" ON "CarbonCommandOutcome"("orgId");
CREATE INDEX "CarbonCommandOutcome_actualRegion_idx" ON "CarbonCommandOutcome"("actualRegion");
CREATE INDEX "WorkloadEmbeddingIndex_orgId_idx" ON "WorkloadEmbeddingIndex"("orgId");
CREATE INDEX "WorkloadEmbeddingIndex_workloadType_idx" ON "WorkloadEmbeddingIndex"("workloadType");
CREATE INDEX "WorkloadEmbeddingIndex_region_idx" ON "WorkloadEmbeddingIndex"("region");
CREATE INDEX "AdaptiveSignal_orgId_idx" ON "AdaptiveSignal"("orgId");
CREATE INDEX "AdaptiveSignal_signalType_idx" ON "AdaptiveSignal"("signalType");
CREATE INDEX "AdaptiveRunLog_orgId_idx" ON "AdaptiveRunLog"("orgId");
CREATE INDEX "ForecastRefresh_region_refreshedAt_idx" ON "ForecastRefresh"("region", "refreshedAt");
CREATE INDEX "ForecastRefresh_refreshedAt_idx" ON "ForecastRefresh"("refreshedAt");
CREATE INDEX "IntegrationEvent_source_createdAt_idx" ON "IntegrationEvent"("source", "createdAt");
CREATE INDEX "IntegrationEvent_source_success_createdAt_idx" ON "IntegrationEvent"("source", "success", "createdAt");
CREATE INDEX "WorkloadDecisionOutcome_workloadId_idx" ON "WorkloadDecisionOutcome"("workloadId");
CREATE INDEX "WorkloadDecisionOutcome_createdAt_idx" ON "WorkloadDecisionOutcome"("createdAt");
CREATE INDEX "GridSignalSnapshot_region_timestamp_idx" ON "GridSignalSnapshot"("region", "timestamp");
CREATE INDEX "GridSignalSnapshot_timestamp_idx" ON "GridSignalSnapshot"("timestamp");
CREATE INDEX "Eia930BalanceRaw_region_period_idx" ON "Eia930BalanceRaw"("region", "period");
CREATE INDEX "Eia930BalanceRaw_respondent_period_idx" ON "Eia930BalanceRaw"("respondent", "period");
CREATE INDEX "Eia930InterchangeRaw_region_period_idx" ON "Eia930InterchangeRaw"("region", "period");
CREATE INDEX "Eia930InterchangeRaw_fromBa_period_idx" ON "Eia930InterchangeRaw"("fromBa", "period");
CREATE INDEX "Eia930InterchangeRaw_toBa_period_idx" ON "Eia930InterchangeRaw"("toBa", "period");
CREATE INDEX "Eia930SubregionRaw_region_period_idx" ON "Eia930SubregionRaw"("region", "period");
CREATE INDEX "Eia930SubregionRaw_parent_period_idx" ON "Eia930SubregionRaw"("parent", "period");
CREATE INDEX "Eia930SubregionRaw_subregion_period_idx" ON "Eia930SubregionRaw"("subregion", "period");
CREATE INDEX "DekesLeadCandidate_orgId_idx" ON "DekesLeadCandidate"("orgId");
CREATE INDEX "DekesLeadCandidate_domain_idx" ON "DekesLeadCandidate"("domain");

-- AddForeignKey
ALTER TABLE "OrgUsageCounter" ADD CONSTRAINT "OrgUsageCounter_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarbonCommand" ADD CONSTRAINT "CarbonCommand_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarbonCommandTrace" ADD CONSTRAINT "CarbonCommandTrace_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "CarbonCommand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarbonCommandOutcome" ADD CONSTRAINT "CarbonCommandOutcome_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "CarbonCommand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarbonCommandOutcome" ADD CONSTRAINT "CarbonCommandOutcome_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkloadEmbeddingIndex" ADD CONSTRAINT "WorkloadEmbeddingIndex_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "CarbonCommand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdaptiveRunLog" ADD CONSTRAINT "AdaptiveRunLog_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "CarbonCommand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
