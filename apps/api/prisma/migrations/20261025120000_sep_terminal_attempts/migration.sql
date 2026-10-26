CREATE TYPE "TerminalAttemptStatus" AS ENUM ('PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED');
CREATE TABLE "terminal_payment_attempts" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdById" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "idempotencyKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "bridgeId" TEXT NOT NULL,
  "terminalId" TEXT NOT NULL,
  "cardAmount" INTEGER NOT NULL CHECK ("cardAmount" > 0),
  "expectedOrderVersion" INTEGER NOT NULL CHECK ("expectedOrderVersion" > 0),
  "checkoutSnapshot" JSONB NOT NULL,
  "nonce" TEXT NOT NULL,
  "status" "TerminalAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "authorizationExpiresAt" TIMESTAMP(3) NOT NULL,
  "dispatchedAt" TIMESTAMP(3),
  "resultReceivedAt" TIMESTAMP(3),
  "resultFingerprint" TEXT,
  "responseCode" TEXT CHECK ("responseCode" IS NULL OR "responseCode" ~ '^[0-9A-Z]{2,3}$'),
  "rrn" TEXT CHECK ("rrn" IS NULL OR "rrn" ~ '^[0-9]{1,12}$'),
  "trace" TEXT CHECK ("trace" IS NULL OR "trace" ~ '^[0-9]{1,12}$'),
  "resolvedById" TEXT REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resolvedAt" TIMESTAMP(3),
  "verificationBasis" TEXT,
  "settlementId" TEXT REFERENCES "payment_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "terminal_attempt_identity_check" CHECK ("terminalId" ~ '^[0-9]{8}$' AND "fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "terminal_attempt_resolution_check" CHECK (
    ("status" IN ('PENDING', 'UNKNOWN') AND "resolvedAt" IS NULL AND "resolvedById" IS NULL AND "settlementId" IS NULL)
    OR ("status" = 'SUCCEEDED' AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND "settlementId" IS NOT NULL)
    OR ("status" = 'FAILED' AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND "settlementId" IS NULL)
  )
);
CREATE UNIQUE INDEX "terminal_payment_attempts_createdById_idempotencyKey_key" ON "terminal_payment_attempts"("createdById", "idempotencyKey");
CREATE UNIQUE INDEX "terminal_payment_attempts_settlementId_key" ON "terminal_payment_attempts"("settlementId");
CREATE INDEX "terminal_payment_attempts_orderId_createdAt_idx" ON "terminal_payment_attempts"("orderId", "createdAt");
CREATE UNIQUE INDEX "terminal_attempt_order_reserved" ON "terminal_payment_attempts"("orderId") WHERE "status" IN ('PENDING','UNKNOWN');
CREATE UNIQUE INDEX "terminal_attempt_bridge_reserved" ON "terminal_payment_attempts"("bridgeId") WHERE "status" IN ('PENDING','UNKNOWN');
CREATE FUNCTION preserve_terminal_attempt_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."orderId",NEW."createdById",NEW."idempotencyKey",NEW."fingerprint",NEW."bridgeId",NEW."terminalId",NEW."cardAmount",NEW."expectedOrderVersion",NEW."checkoutSnapshot",NEW."nonce",NEW."authorizationExpiresAt",NEW."createdAt") IS DISTINCT FROM
     ROW(OLD."orderId",OLD."createdById",OLD."idempotencyKey",OLD."fingerprint",OLD."bridgeId",OLD."terminalId",OLD."cardAmount",OLD."expectedOrderVersion",OLD."checkoutSnapshot",OLD."nonce",OLD."authorizationExpiresAt",OLD."createdAt") THEN
    RAISE EXCEPTION 'Terminal authorization is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "terminal_attempt_authorization_immutable" BEFORE UPDATE ON "terminal_payment_attempts" FOR EACH ROW EXECUTE FUNCTION preserve_terminal_attempt_authorization();
