ALTER TABLE "api_keys"
ADD COLUMN IF NOT EXISTS "keyPrefix" TEXT,
ADD COLUMN IF NOT EXISTS "keyDigest" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_keyDigest_key" ON "api_keys"("keyDigest");
CREATE INDEX IF NOT EXISTS "api_keys_orgId_revokedAt_expiresAt_idx" ON "api_keys"("orgId", "revokedAt", "expiresAt");
