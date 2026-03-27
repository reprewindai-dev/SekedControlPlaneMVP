-- CreateTable
CREATE TABLE "CIDecision" (
    "id" TEXT NOT NULL,
    "decisionFrameId" TEXT NOT NULL,
    "selectedRunner" TEXT NOT NULL,
    "selectedRegion" TEXT NOT NULL,
    "carbonIntensity" DOUBLE PRECISION NOT NULL,
    "baseline" DOUBLE PRECISION NOT NULL,
    "savings" DOUBLE PRECISION NOT NULL,
    "jobType" TEXT NOT NULL,
    "preferredRegions" JSONB NOT NULL,
    "carbonWeight" DOUBLE PRECISION NOT NULL,
    "recommendation" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CIDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CIDecision_decisionFrameId_idx" ON "CIDecision"("decisionFrameId");

-- CreateIndex
CREATE INDEX "CIDecision_selectedRegion_createdAt_idx" ON "CIDecision"("selectedRegion", "createdAt");

-- CreateIndex
CREATE INDEX "CIDecision_jobType_createdAt_idx" ON "CIDecision"("jobType", "createdAt");

-- CreateIndex
CREATE INDEX "CIDecision_createdAt_idx" ON "CIDecision"("createdAt");
