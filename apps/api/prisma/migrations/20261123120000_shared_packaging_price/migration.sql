BEGIN;

ALTER TABLE "cafe_settings"
  ADD COLUMN "packagingPriceAmount" INTEGER NOT NULL DEFAULT 20000;

ALTER TABLE "cafe_settings"
  ADD CONSTRAINT "cafe_settings_packaging_price_nonnegative"
  CHECK ("packagingPriceAmount" >= 0);

-- Restore the system rows as internal order-line anchors. The shared feature
-- is priced by CafeSettings and can no longer be removed through the catalog.
UPDATE "products"
SET "isActive" = true,
    "isAvailable" = true,
    "isPublic" = false,
    "archivedAt" = NULL
WHERE "systemKey" = 'PACKING';

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_packing_inactive";

ALTER TABLE "products"
  ADD CONSTRAINT "products_packing_active"
  CHECK ("systemKey" IS DISTINCT FROM 'PACKING' OR ("isActive" = true AND "isAvailable" = true AND "isPublic" = false AND "archivedAt" IS NULL));

COMMIT;
