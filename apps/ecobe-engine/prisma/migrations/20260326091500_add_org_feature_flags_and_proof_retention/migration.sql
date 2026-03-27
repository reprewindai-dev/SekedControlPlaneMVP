ALTER TABLE "Organization"
ADD COLUMN "featureFlags" JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN "proofRetentionDays" INTEGER NOT NULL DEFAULT 30;
