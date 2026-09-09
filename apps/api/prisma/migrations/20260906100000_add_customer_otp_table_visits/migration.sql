CREATE TYPE "CustomerOtpPurpose" AS ENUM ('TABLE_WAITER_CALL');

CREATE TABLE "customers" (
  "id" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "phoneLookupHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_otp_challenges" (
  "id" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "phoneLookupHash" TEXT NOT NULL,
  "tableCredentialId" TEXT NOT NULL,
  "purpose" "CustomerOtpPurpose" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "resendAvailableAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_otp_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_otp_challenges_attempt_nonnegative" CHECK ("attemptCount" >= 0),
  CONSTRAINT "customer_otp_challenges_expiry_after_create" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "customer_otp_challenges_resend_after_create" CHECK ("resendAvailableAt" >= "createdAt")
);

CREATE TABLE "customer_auth_sessions" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_auth_sessions_expiry_after_create" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "customer_table_visits" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "tableCredentialId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "invalidatedAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_table_visits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_table_visits_expiry_after_create" CHECK ("expiresAt" > "createdAt")
);

ALTER TABLE "waiter_calls" ADD COLUMN "customerTableVisitId" TEXT;

CREATE UNIQUE INDEX "customers_phoneLookupHash_key" ON "customers"("phoneLookupHash");
CREATE UNIQUE INDEX "customer_auth_sessions_tokenHash_key" ON "customer_auth_sessions"("tokenHash");
CREATE INDEX "customer_otp_challenges_phoneLookupHash_purpose_createdAt_idx" ON "customer_otp_challenges"("phoneLookupHash", "purpose", "createdAt");
CREATE INDEX "customer_otp_challenges_tableCredentialId_expiresAt_idx" ON "customer_otp_challenges"("tableCredentialId", "expiresAt");
CREATE INDEX "customer_auth_sessions_customerId_expiresAt_idx" ON "customer_auth_sessions"("customerId", "expiresAt");
CREATE INDEX "customer_table_visits_tableId_expiresAt_idx" ON "customer_table_visits"("tableId", "expiresAt");
CREATE INDEX "customer_table_visits_tableCredentialId_expiresAt_idx" ON "customer_table_visits"("tableCredentialId", "expiresAt");
CREATE INDEX "waiter_calls_customerTableVisitId_idx" ON "waiter_calls"("customerTableVisitId");

CREATE UNIQUE INDEX "one_active_customer_table_visit" ON "customer_table_visits"("customerId") WHERE "invalidatedAt" IS NULL;

ALTER TABLE "customer_otp_challenges" ADD CONSTRAINT "customer_otp_challenges_tableCredentialId_fkey" FOREIGN KEY ("tableCredentialId") REFERENCES "table_qr_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_auth_sessions" ADD CONSTRAINT "customer_auth_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_table_visits" ADD CONSTRAINT "customer_table_visits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_table_visits" ADD CONSTRAINT "customer_table_visits_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "cafe_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_table_visits" ADD CONSTRAINT "customer_table_visits_tableCredentialId_fkey" FOREIGN KEY ("tableCredentialId") REFERENCES "table_qr_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waiter_calls" ADD CONSTRAINT "waiter_calls_customerTableVisitId_fkey" FOREIGN KEY ("customerTableVisitId") REFERENCES "customer_table_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
