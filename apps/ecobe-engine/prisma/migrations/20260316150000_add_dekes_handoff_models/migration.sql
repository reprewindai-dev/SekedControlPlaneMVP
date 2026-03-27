-- CreateTable
CREATE TABLE "DekesProspect" (
    "id" TEXT NOT NULL,
    "externalLeadId" TEXT,
    "externalOrgId" TEXT,
    "orgName" TEXT,
    "orgDomain" TEXT,
    "orgSizeLabel" TEXT,
    "orgRegion" TEXT,
    "intentScore" DOUBLE PRECISION,
    "intentReason" TEXT,
    "intentKeywords" JSONB NOT NULL DEFAULT '[]',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactLinkedin" TEXT,
    "sourceLeadId" TEXT,
    "sourceQueryId" TEXT,
    "sourceRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DekesProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DekesTenant" (
    "id" TEXT NOT NULL,
    "externalOrgId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DekesTenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DekesDemo" (
    "id" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "workloadSummary" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DekesDemo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DekesHandoffEvent" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT,
    "externalLeadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "qualificationScore" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DekesHandoffEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DekesProspect_externalLeadId_idx" ON "DekesProspect"("externalLeadId");

-- CreateIndex
CREATE INDEX "DekesProspect_externalOrgId_idx" ON "DekesProspect"("externalOrgId");

-- CreateIndex
CREATE INDEX "DekesProspect_status_idx" ON "DekesProspect"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DekesTenant_externalOrgId_key" ON "DekesTenant"("externalOrgId");

-- CreateIndex
CREATE INDEX "DekesTenant_status_idx" ON "DekesTenant"("status");

-- CreateIndex
CREATE INDEX "DekesDemo_status_idx" ON "DekesDemo"("status");

-- CreateIndex
CREATE INDEX "DekesDemo_contactEmail_idx" ON "DekesDemo"("contactEmail");

-- CreateIndex
CREATE INDEX "DekesHandoffEvent_prospectId_idx" ON "DekesHandoffEvent"("prospectId");

-- CreateIndex
CREATE INDEX "DekesHandoffEvent_externalLeadId_idx" ON "DekesHandoffEvent"("externalLeadId");

-- CreateIndex
CREATE INDEX "DekesHandoffEvent_status_idx" ON "DekesHandoffEvent"("status");
