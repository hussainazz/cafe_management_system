-- The idempotent Packing backfill derives IDs from category IDs. Normalize
-- those deterministic UUIDs so strict API UUID schemas accept them.
UPDATE "products"
SET "id" = overlay(overlay("id" placing '4' from 15 for 1) placing '8' from 20 for 1)
WHERE "systemKey" = 'PACKING'
  AND "id" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
