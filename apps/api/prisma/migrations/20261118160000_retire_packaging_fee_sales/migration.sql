BEGIN;

UPDATE "products"
SET "isActive" = false,
    "isAvailable" = false,
    "archivedAt" = COALESCE("archivedAt", CURRENT_TIMESTAMP)
WHERE "systemKey" = 'PACKING';

ALTER TABLE "products"
  ADD CONSTRAINT "products_packing_inactive"
  CHECK ("systemKey" IS DISTINCT FROM 'PACKING' OR ("isActive" = false AND "isAvailable" = false AND "archivedAt" IS NOT NULL));

DROP TABLE "order_item_packaging_assignments";

ALTER TABLE "order_items"
  DROP CONSTRAINT "order_items_id_orderId_key";

COMMIT;
