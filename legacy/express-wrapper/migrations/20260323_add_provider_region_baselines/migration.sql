CREATE TABLE "provider_region_baselines" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "avgLatencyMs" DOUBLE PRECISION NOT NULL,
  "avgCostUsd" DOUBLE PRECISION NOT NULL,
  "avgCarbonIntensityGco2Kwh" DOUBLE PRECISION NOT NULL,
  "lastObservedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_region_baselines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_region_baselines_orgId_provider_region_key"
  ON "provider_region_baselines"("orgId", "provider", "region");

CREATE INDEX "provider_region_baselines_orgId_provider_region_idx"
  ON "provider_region_baselines"("orgId", "provider", "region");

CREATE INDEX "provider_region_baselines_orgId_lastObservedAt_idx"
  ON "provider_region_baselines"("orgId", "lastObservedAt");

ALTER TABLE "provider_region_baselines"
  ADD CONSTRAINT "provider_region_baselines_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "orgs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
