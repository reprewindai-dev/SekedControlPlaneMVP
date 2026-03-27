ALTER TABLE "AuditExport"
ADD COLUMN "filters" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "artifact" JSONB,
ADD COLUMN "checksum" TEXT,
ADD COLUMN "periodStart" TIMESTAMP(3),
ADD COLUMN "periodEnd" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE INDEX "AuditExport_organizationId_createdAt_idx" ON "AuditExport"("organizationId", "createdAt");

ALTER TABLE "ComplianceReport"
ADD COLUMN "framework" TEXT NOT NULL DEFAULT 'seked_control_plane',
ADD COLUMN "summary" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "findings" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "periodStart" TIMESTAMP(3),
ADD COLUMN "periodEnd" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE INDEX "ComplianceReport_organizationId_createdAt_idx" ON "ComplianceReport"("organizationId", "createdAt");
