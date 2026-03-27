-- Add grid signal fields to DashboardRoutingDecision
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "balancingAuthority" TEXT;
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "demandRampPct" DOUBLE PRECISION;
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "carbonSpikeProbability" DOUBLE PRECISION;
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "curtailmentProbability" DOUBLE PRECISION;
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "importCarbonLeakageScore" DOUBLE PRECISION;

-- Add provenance fields
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "sourceUsed" TEXT;
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "validationSource" TEXT;
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "referenceTime" TIMESTAMP(3);
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "disagreementFlag" BOOLEAN;
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "disagreementPct" DOUBLE PRECISION;
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "estimatedFlag" BOOLEAN;
ALTER TABLE "DashboardRoutingDecision" ADD COLUMN "syntheticFlag" BOOLEAN;
