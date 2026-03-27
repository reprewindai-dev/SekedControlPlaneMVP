-- Add deterministic carbon+water proof fields to CI decisions
ALTER TABLE "CIDecision"
ADD COLUMN "decisionAction" TEXT,
ADD COLUMN "reasonCode" TEXT,
ADD COLUMN "signalConfidence" DOUBLE PRECISION,
ADD COLUMN "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "waterImpactLiters" DOUBLE PRECISION,
ADD COLUMN "waterBaselineLiters" DOUBLE PRECISION,
ADD COLUMN "waterScarcityImpact" DOUBLE PRECISION,
ADD COLUMN "waterStressIndex" DOUBLE PRECISION,
ADD COLUMN "waterConfidence" DOUBLE PRECISION,
ADD COLUMN "policyTrace" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "datasetVersions" JSONB NOT NULL DEFAULT '{}';
