CREATE TABLE "PglSystem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT,
    "genomeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PglSystem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PglVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "versionIdentifier" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PglVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PglLineageEdge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "parentVersionId" TEXT NOT NULL,
    "childVersionId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'derived_from',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PglLineageEdge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PglLifecycleEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "versionId" TEXT,
    "runId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT,
    "signature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PglLifecycleEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PglSystem_organizationId_genomeId_key" ON "PglSystem"("organizationId", "genomeId");
CREATE INDEX "PglSystem_organizationId_createdAt_idx" ON "PglSystem"("organizationId", "createdAt");

CREATE UNIQUE INDEX "PglVersion_systemId_versionIdentifier_key" ON "PglVersion"("systemId", "versionIdentifier");
CREATE INDEX "PglVersion_systemId_createdAt_idx" ON "PglVersion"("systemId", "createdAt");
CREATE INDEX "PglVersion_organizationId_createdAt_idx" ON "PglVersion"("organizationId", "createdAt");

CREATE UNIQUE INDEX "PglLineageEdge_systemId_parentVersionId_childVersionId_key" ON "PglLineageEdge"("systemId", "parentVersionId", "childVersionId");
CREATE INDEX "PglLineageEdge_systemId_createdAt_idx" ON "PglLineageEdge"("systemId", "createdAt");
CREATE INDEX "PglLineageEdge_organizationId_createdAt_idx" ON "PglLineageEdge"("organizationId", "createdAt");

CREATE INDEX "PglLifecycleEvent_systemId_createdAt_idx" ON "PglLifecycleEvent"("systemId", "createdAt");
CREATE INDEX "PglLifecycleEvent_organizationId_createdAt_idx" ON "PglLifecycleEvent"("organizationId", "createdAt");
CREATE INDEX "PglLifecycleEvent_runId_createdAt_idx" ON "PglLifecycleEvent"("runId", "createdAt");

ALTER TABLE "PglSystem"
ADD CONSTRAINT "PglSystem_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PglSystem"
ADD CONSTRAINT "PglSystem_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PglVersion"
ADD CONSTRAINT "PglVersion_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PglVersion"
ADD CONSTRAINT "PglVersion_systemId_fkey"
FOREIGN KEY ("systemId") REFERENCES "PglSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PglVersion"
ADD CONSTRAINT "PglVersion_parentVersionId_fkey"
FOREIGN KEY ("parentVersionId") REFERENCES "PglVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PglLineageEdge"
ADD CONSTRAINT "PglLineageEdge_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PglLineageEdge"
ADD CONSTRAINT "PglLineageEdge_systemId_fkey"
FOREIGN KEY ("systemId") REFERENCES "PglSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PglLineageEdge"
ADD CONSTRAINT "PglLineageEdge_parentVersionId_fkey"
FOREIGN KEY ("parentVersionId") REFERENCES "PglVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PglLineageEdge"
ADD CONSTRAINT "PglLineageEdge_childVersionId_fkey"
FOREIGN KEY ("childVersionId") REFERENCES "PglVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PglLifecycleEvent"
ADD CONSTRAINT "PglLifecycleEvent_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PglLifecycleEvent"
ADD CONSTRAINT "PglLifecycleEvent_systemId_fkey"
FOREIGN KEY ("systemId") REFERENCES "PglSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PglLifecycleEvent"
ADD CONSTRAINT "PglLifecycleEvent_versionId_fkey"
FOREIGN KEY ("versionId") REFERENCES "PglVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PglLifecycleEvent"
ADD CONSTRAINT "PglLifecycleEvent_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
