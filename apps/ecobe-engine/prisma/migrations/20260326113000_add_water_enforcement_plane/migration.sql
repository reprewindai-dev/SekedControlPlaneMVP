-- AlterTable
ALTER TABLE "CIDecision"
ADD COLUMN "decisionMode" TEXT,
ADD COLUMN "waterAuthorityMode" TEXT,
ADD COLUMN "waterScenario" TEXT,
ADD COLUMN "facilityId" TEXT,
ADD COLUMN "proofHash" TEXT,
ADD COLUMN "waterEvidenceRefs" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "WaterProviderSnapshot" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "authorityRole" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "scenario" TEXT NOT NULL DEFAULT 'current',
  "authorityMode" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "evidenceRefs" JSONB NOT NULL DEFAULT '[]',
  "observedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WaterProviderSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityWaterTelemetry" (
  "id" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "scenario" TEXT NOT NULL DEFAULT 'current',
  "waterIntensityLPerKwh" DOUBLE PRECISION,
  "waterStressIndex" DOUBLE PRECISION,
  "scarcityImpact" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION,
  "telemetryRef" TEXT NOT NULL,
  "evidenceRefs" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FacilityWaterTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaterScenarioRun" (
  "id" TEXT NOT NULL,
  "decisionFrameId" TEXT NOT NULL,
  "scenario" TEXT NOT NULL,
  "requestPayload" JSONB NOT NULL,
  "resultPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WaterScenarioRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaterPolicyEvidence" (
  "id" TEXT NOT NULL,
  "decisionFrameId" TEXT NOT NULL,
  "proofHash" TEXT NOT NULL,
  "authorityMode" TEXT NOT NULL,
  "scenario" TEXT NOT NULL DEFAULT 'current',
  "facilityId" TEXT,
  "supplierRefs" JSONB NOT NULL DEFAULT '[]',
  "evidenceRefs" JSONB NOT NULL DEFAULT '[]',
  "providerSnapshotRefs" JSONB NOT NULL DEFAULT '[]',
  "externalPolicyRefs" JSONB NOT NULL DEFAULT '[]',
  "bundleHash" TEXT,
  "manifestHash" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WaterPolicyEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaterProviderSnapshot_provider_observedAt_idx" ON "WaterProviderSnapshot"("provider", "observedAt");

-- CreateIndex
CREATE INDEX "WaterProviderSnapshot_region_scenario_observedAt_idx" ON "WaterProviderSnapshot"("region", "scenario", "observedAt");

-- CreateIndex
CREATE INDEX "FacilityWaterTelemetry_facilityId_createdAt_idx" ON "FacilityWaterTelemetry"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "FacilityWaterTelemetry_region_scenario_createdAt_idx" ON "FacilityWaterTelemetry"("region", "scenario", "createdAt");

-- CreateIndex
CREATE INDEX "WaterScenarioRun_decisionFrameId_createdAt_idx" ON "WaterScenarioRun"("decisionFrameId", "createdAt");

-- CreateIndex
CREATE INDEX "WaterScenarioRun_scenario_createdAt_idx" ON "WaterScenarioRun"("scenario", "createdAt");

-- CreateIndex
CREATE INDEX "WaterPolicyEvidence_decisionFrameId_createdAt_idx" ON "WaterPolicyEvidence"("decisionFrameId", "createdAt");

-- CreateIndex
CREATE INDEX "WaterPolicyEvidence_proofHash_idx" ON "WaterPolicyEvidence"("proofHash");
