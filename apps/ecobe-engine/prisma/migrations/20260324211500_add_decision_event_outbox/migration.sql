-- Integration event typing for cleaner downstream filtering
ALTER TABLE "IntegrationEvent"
ADD COLUMN IF NOT EXISTS "eventType" TEXT;

DO $$
BEGIN
  CREATE TYPE "IntegrationWebhookSinkStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "DecisionEventOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD_LETTER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "IntegrationWebhookSink" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "authToken" TEXT,
  "signingSecret" TEXT,
  "status" "IntegrationWebhookSinkStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastResponseCode" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IntegrationWebhookSink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DecisionEventOutbox" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "sinkId" TEXT,
  "payload" JSONB NOT NULL,
  "status" "DecisionEventOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL,
  "lastResponseCode" INTEGER,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DecisionEventOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DecisionEventOutbox_sinkId_fkey" FOREIGN KEY ("sinkId") REFERENCES "IntegrationWebhookSink"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DecisionEventOutbox_eventKey_key"
  ON "DecisionEventOutbox"("eventKey");

CREATE INDEX IF NOT EXISTS "IntegrationWebhookSink_status_createdAt_idx"
  ON "IntegrationWebhookSink"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "DecisionEventOutbox_status_nextAttemptAt_createdAt_idx"
  ON "DecisionEventOutbox"("status", "nextAttemptAt", "createdAt");

CREATE INDEX IF NOT EXISTS "DecisionEventOutbox_sinkId_createdAt_idx"
  ON "DecisionEventOutbox"("sinkId", "createdAt");
