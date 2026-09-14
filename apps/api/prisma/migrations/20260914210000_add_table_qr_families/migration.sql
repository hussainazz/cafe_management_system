-- Model physical QR families separately from logical POS tables. Existing QR
-- credentials remain attached to their original logical table and therefore
-- remain valid as the family's default entry point.
CREATE TABLE "table_qr_families" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assignmentTargetTableId" TEXT,
    "assignmentActivatedAt" TIMESTAMP(3),
    "assignmentFirstScanAt" TIMESTAMP(3),
    "assignmentExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "table_qr_families_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "table_qr_families_name_key" ON "table_qr_families"("name");
CREATE INDEX "table_qr_families_assignmentExpiresAt_idx" ON "table_qr_families"("assignmentExpiresAt");

ALTER TABLE "cafe_tables" ADD COLUMN "qrFamilyId" TEXT;
ALTER TABLE "table_qr_credentials" ADD COLUMN "qrFamilyId" TEXT;
ALTER TABLE "customer_otp_challenges" ADD COLUMN "tableId" TEXT;

-- Give every existing logical table an independent family first, then merge
-- only the two explicitly shared physical tables below.
INSERT INTO "table_qr_families" ("id", "name", "updatedAt")
SELECT md5('table-family:' || "id")::uuid, 'table:' || "id", CURRENT_TIMESTAMP
FROM "cafe_tables";

UPDATE "cafe_tables"
SET "qrFamilyId" = md5('table-family:' || "id")::uuid;

INSERT INTO "table_qr_families" ("id", "name", "updatedAt") VALUES
  ('50000000-0000-4000-8000-000000000001', 'shared-table-a', CURRENT_TIMESTAMP),
  ('50000000-0000-4000-8000-000000000002', 'shared-table-b', CURRENT_TIMESTAMP);

UPDATE "cafe_tables"
SET "qrFamilyId" = '50000000-0000-4000-8000-000000000001'
WHERE "id" IN (
  '40000000-0000-4000-8000-000000000009',
  '40000000-0000-4000-8000-000000000010',
  '40000000-0000-4000-8000-000000000011',
  '40000000-0000-4000-8000-000000000012'
);
UPDATE "cafe_tables"
SET "waiterCallEnabled" = true
WHERE "id" IN (
  '40000000-0000-4000-8000-000000000009',
  '40000000-0000-4000-8000-000000000010',
  '40000000-0000-4000-8000-000000000011',
  '40000000-0000-4000-8000-000000000012'
);

UPDATE "cafe_tables"
SET "qrFamilyId" = '50000000-0000-4000-8000-000000000002'
WHERE "id" IN (
  '40000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000004',
  '40000000-0000-4000-8000-000000000005'
);
UPDATE "cafe_tables"
SET "waiterCallEnabled" = true
WHERE "id" IN (
  '40000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000004',
  '40000000-0000-4000-8000-000000000005'
);

UPDATE "table_qr_credentials" AS credential
SET "qrFamilyId" = table_row."qrFamilyId"
FROM "cafe_tables" AS table_row
WHERE table_row."id" = credential."tableId";

UPDATE "customer_otp_challenges" AS challenge
SET "tableId" = credential."tableId"
FROM "table_qr_credentials" AS credential
WHERE credential."id" = challenge."tableCredentialId";

ALTER TABLE "customer_otp_challenges" ALTER COLUMN "tableId" SET NOT NULL;
CREATE INDEX "cafe_tables_qrFamilyId_idx" ON "cafe_tables"("qrFamilyId");
CREATE INDEX "table_qr_credentials_qrFamilyId_idx" ON "table_qr_credentials"("qrFamilyId");
CREATE INDEX "customer_otp_challenges_tableId_expiresAt_idx" ON "customer_otp_challenges"("tableId", "expiresAt");

ALTER TABLE "cafe_tables"
  ADD CONSTRAINT "cafe_tables_qrFamilyId_fkey"
  FOREIGN KEY ("qrFamilyId") REFERENCES "table_qr_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "table_qr_credentials"
  ADD CONSTRAINT "table_qr_credentials_qrFamilyId_fkey"
  FOREIGN KEY ("qrFamilyId") REFERENCES "table_qr_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_otp_challenges"
  ADD CONSTRAINT "customer_otp_challenges_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "cafe_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
