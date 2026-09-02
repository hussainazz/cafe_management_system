-- Complete the database-native invariants documented in
-- docs/planning/database-constraints.md and add the Stage 5 persistence
-- boundary. Cross-row financial reconciliation remains transactional service
-- logic and is covered by integration tests.

-- CreateEnum
CREATE TYPE "WaiterCallStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateTable
CREATE TABLE "table_qr_credentials" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "table_qr_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiter_calls" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "status" "WaiterCallStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "waiter_calls_pkey" PRIMARY KEY ("id")
);

-- Cafe settings is a singleton without requiring callers to know a fixed UUID.
ALTER TABLE "cafe_settings"
  ADD COLUMN "singletonKey" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "cafe_settings_singletonKey_key"
  ON "cafe_settings"("singletonKey");

ALTER TABLE "cafe_settings"
  ADD CONSTRAINT "cafe_settings_singleton_key_check"
  CHECK ("singletonKey" = true);

-- Identity and authentication constraints.
ALTER TABLE "users"
  ADD CONSTRAINT "users_passwordHash_non_empty_check"
  CHECK (btrim("passwordHash") <> '');

ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_tokenHash_non_empty_check"
    CHECK (btrim("tokenHash") <> ''),
  ADD CONSTRAINT "refresh_sessions_timestamp_order_check"
    CHECK ("expiresAt" > "createdAt" AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt"));

CREATE UNIQUE INDEX "refresh_sessions_tokenHash_key"
  ON "refresh_sessions"("tokenHash");

ALTER TABLE "auth_events"
  ADD CONSTRAINT "auth_events_eventType_non_empty_check"
    CHECK (btrim("eventType") <> ''),
  ADD CONSTRAINT "auth_events_requestId_non_empty_check"
    CHECK (btrim("requestId") <> '');

-- Catalog constraints.
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_name_non_empty_check"
    CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "categories_displayOrder_non_negative_check"
    CHECK ("displayOrder" >= 0),
  ADD CONSTRAINT "categories_archive_state_check"
    CHECK ("archivedAt" IS NULL OR "isActive" = false);

ALTER TABLE "products"
  ADD CONSTRAINT "products_name_non_empty_check"
    CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "products_displayOrder_non_negative_check"
    CHECK ("displayOrder" >= 0),
  ADD CONSTRAINT "products_archive_state_check"
    CHECK ("archivedAt" IS NULL OR "isActive" = false);

ALTER TABLE "products"
  DROP CONSTRAINT "products_sale_discount_value_check",
  ADD CONSTRAINT "products_sale_discount_value_check"
    CHECK (
      ("saleDiscountKind" IS NULL AND "saleDiscountValue" IS NULL)
      OR ("saleDiscountKind" = 'PERCENTAGE' AND "saleDiscountValue" BETWEEN 1 AND 100)
      OR ("saleDiscountKind" = 'FIXED' AND "saleDiscountValue" > 0 AND "saleDiscountValue" <= "priceAmount")
    );

ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_storageKey_non_empty_check"
    CHECK (btrim("storageKey") <> ''),
  ADD CONSTRAINT "product_images_altText_non_empty_check"
    CHECK (btrim("altText") <> '');

ALTER TABLE "option_groups"
  ADD CONSTRAINT "option_groups_name_non_empty_check"
    CHECK (btrim("name") <> '');

ALTER TABLE "product_option_groups"
  ADD CONSTRAINT "product_option_groups_displayOrder_non_negative_check"
    CHECK ("displayOrder" >= 0);

ALTER TABLE "options"
  ADD CONSTRAINT "options_name_non_empty_check"
    CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "options_displayOrder_non_negative_check"
    CHECK ("displayOrder" >= 0),
  ADD CONSTRAINT "options_archive_state_check"
    CHECK ("archivedAt" IS NULL OR "isActive" = false);

-- Table, credential, and waiter-call constraints.
ALTER TABLE "cafe_tables"
  ADD COLUMN "tableContextInvalidBefore" TIMESTAMP(3),
  ADD CONSTRAINT "cafe_tables_name_non_empty_check"
    CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "cafe_tables_displayOrder_non_negative_check"
    CHECK ("displayOrder" >= 0),
  ADD CONSTRAINT "cafe_tables_archive_state_check"
    CHECK ("archivedAt" IS NULL OR "isActive" = false);

CREATE UNIQUE INDEX "table_qr_credentials_tokenHash_key"
  ON "table_qr_credentials"("tokenHash");
CREATE INDEX "table_qr_credentials_tableId_idx"
  ON "table_qr_credentials"("tableId");
CREATE UNIQUE INDEX "table_qr_credentials_one_active_per_table_key"
  ON "table_qr_credentials"("tableId") WHERE "isActive" = true;

ALTER TABLE "table_qr_credentials"
  ADD CONSTRAINT "table_qr_credentials_tokenHash_non_empty_check"
    CHECK (btrim("tokenHash") <> ''),
  ADD CONSTRAINT "table_qr_credentials_rotation_state_check"
    CHECK ("rotatedAt" IS NULL OR ("isActive" = false AND "rotatedAt" >= "createdAt"));

CREATE INDEX "waiter_calls_status_requestedAt_idx"
  ON "waiter_calls"("status", "requestedAt");
CREATE INDEX "waiter_calls_tableId_requestedAt_idx"
  ON "waiter_calls"("tableId", "requestedAt");
CREATE UNIQUE INDEX "waiter_calls_one_pending_per_table_key"
  ON "waiter_calls"("tableId") WHERE "status" = 'PENDING';

ALTER TABLE "waiter_calls"
  ADD CONSTRAINT "waiter_calls_version_positive_check"
    CHECK ("version" >= 1),
  ADD CONSTRAINT "waiter_calls_lifecycle_check"
    CHECK (
      ("status" = 'PENDING' AND "acknowledgedAt" IS NULL AND "resolvedAt" IS NULL)
      OR
      ("status" = 'RESOLVED'
        AND "acknowledgedAt" IS NOT NULL
        AND "resolvedAt" = "acknowledgedAt"
        AND "acknowledgedAt" >= "requestedAt")
    );

ALTER TABLE "table_qr_credentials"
  ADD CONSTRAINT "table_qr_credentials_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "cafe_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "waiter_calls"
  ADD CONSTRAINT "waiter_calls_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "cafe_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Order and immutable snapshot constraints.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_orderNumber_non_empty_check"
    CHECK (btrim("orderNumber") <> ''),
  ADD CONSTRAINT "orders_version_positive_check"
    CHECK ("version" >= 1),
  ADD CONSTRAINT "orders_discount_value_check"
    CHECK (
      ("discountKind" IS NULL AND "discountValue" IS NULL AND "discountReason" IS NULL)
      OR
      ("discountKind" = 'PERCENTAGE' AND "discountValue" BETWEEN 1 AND 100 AND "discountReason" IS NOT NULL AND btrim("discountReason") <> '')
      OR
      ("discountKind" = 'FIXED' AND "discountValue" > 0 AND "discountValue" <= "subtotalAmount" AND "discountReason" IS NOT NULL AND btrim("discountReason") <> '')
    ),
  ADD CONSTRAINT "orders_amount_reconciliation_check"
    CHECK (
      "discountAmount" <= "subtotalAmount"
      AND "totalAmount" = "subtotalAmount" - "discountAmount"
      AND "paidAmount" <= "totalAmount"
      AND "balanceAmount" = "totalAmount" - "paidAmount"
    ),
  ADD CONSTRAINT "orders_deletion_state_check"
    CHECK (
      ("state" = 'OPEN' AND "deletedAt" IS NULL AND "deletedById" IS NULL)
      OR
      ("state" = 'DELETED' AND "deletedAt" IS NOT NULL AND "deletedById" IS NOT NULL)
    ),
  ADD CONSTRAINT "orders_payment_status_check"
    CHECK (
      ("paymentStatus" = 'UNPAID' AND "paidAmount" = 0)
      OR
      ("paymentStatus" = 'PARTIALLY_PAID' AND "paidAmount" > 0 AND "paidAmount" < "totalAmount")
      OR
      ("paymentStatus" = 'PAID' AND "paidAmount" = "totalAmount" AND "balanceAmount" = 0)
    );

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_productNameSnapshot_non_empty_check"
    CHECK (btrim("productNameSnapshot") <> ''),
  ADD CONSTRAINT "order_items_displayOrder_non_negative_check"
    CHECK ("displayOrder" >= 0),
  ADD CONSTRAINT "order_items_discount_reason_check"
    CHECK ("discountReason" IS NULL OR btrim("discountReason") <> '');

ALTER TABLE "order_item_options"
  ADD CONSTRAINT "order_item_options_name_non_empty_check"
    CHECK (btrim("optionNameSnapshot") <> '');

-- Payment, idempotency, audit, and operational constraints.
ALTER TABLE "payment_settlements"
  DROP CONSTRAINT "payment_settlements_totalAmount_non_negative_check",
  ADD CONSTRAINT "payment_settlements_totalAmount_positive_check"
    CHECK ("totalAmount" > 0),
  ADD CONSTRAINT "payment_settlements_idempotencyKey_non_empty_check"
    CHECK (btrim("idempotencyKey") <> '');

ALTER TABLE "settlement_reversals"
  ADD CONSTRAINT "settlement_reversals_reason_non_empty_check"
    CHECK (btrim("reason") <> '');

ALTER TABLE "payments"
  DROP CONSTRAINT "payments_reference_method_check",
  ADD CONSTRAINT "payments_reference_method_check"
    CHECK (
      ("method" = 'CARD_TRANSFER' AND ("reference" IS NULL OR btrim("reference") <> ''))
      OR
      ("method" IN ('CASH', 'CARD_TERMINAL') AND "reference" IS NULL)
    );

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_text_non_empty_check"
    CHECK (btrim("operation") <> '' AND btrim("key") <> '' AND btrim("requestFingerprint") <> ''),
  ADD CONSTRAINT "idempotency_records_responseStatus_check"
    CHECK ("responseStatus" BETWEEN 100 AND 599),
  ADD CONSTRAINT "idempotency_records_timestamp_order_check"
    CHECK ("expiresAt" > "createdAt");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_text_non_empty_check"
    CHECK (
      btrim("requestId") <> ''
      AND btrim("operation") <> ''
      AND btrim("entityType") <> ''
      AND btrim("entityId") <> ''
    );

-- Preserve actor attribution and business history if deletion is attempted.
ALTER TABLE "auth_events" DROP CONSTRAINT "auth_events_userId_fkey";
ALTER TABLE "orders" DROP CONSTRAINT "orders_deletedById_fkey";
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actorId_fkey";
ALTER TABLE "cafe_settings" DROP CONSTRAINT "cafe_settings_updatedById_fkey";

ALTER TABLE "auth_events"
  ADD CONSTRAINT "auth_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cafe_settings"
  ADD CONSTRAINT "cafe_settings_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
