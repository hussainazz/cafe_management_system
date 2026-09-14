-- PostgreSQL accepts arbitrary UUID-shaped values, but the API contract uses
-- RFC UUID version/variant validation. The prior deterministic MD5-derived
-- family IDs therefore need their version and variant nibbles normalized.
-- Updating the primary key is safe: both QR-family foreign keys cascade.
UPDATE "table_qr_families"
SET "id" = overlay(overlay("id" placing '4' from 15 for 1) placing '8' from 20 for 1)
WHERE "name" LIKE 'table:%'
  AND "id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND "id" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
