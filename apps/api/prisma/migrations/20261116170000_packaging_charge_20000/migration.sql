BEGIN;

SELECT pg_advisory_xact_lock(hashtext('catalog-price-history'));

CREATE TEMP TABLE "_packaging_price_change_snapshot" ON COMMIT DROP AS
SELECT
  p."id",
  p."name",
  p."priceAmount",
  p."saleDiscountKind",
  p."saleDiscountValue",
  LEAST(p."priceAmount", CASE
    WHEN p."saleDiscountKind" IS NULL OR p."saleDiscountValue" IS NULL OR p."saleDiscountValue" = 0 THEN p."priceAmount"
    ELSE floor((greatest(0, p."priceAmount" - CASE
      WHEN p."saleDiscountKind" = 'FIXED' THEN p."saleDiscountValue"
      ELSE floor((p."priceAmount"::numeric * p."saleDiscountValue"::numeric) / 100)::integer
    END)::numeric + 500) / 1000)::integer * 1000
  END) AS "previousEffectivePriceAmount",
  LEAST(20000, CASE
    WHEN p."saleDiscountKind" IS NULL OR p."saleDiscountValue" IS NULL OR p."saleDiscountValue" = 0 THEN 20000
    ELSE floor((greatest(0, 20000 - CASE
      WHEN p."saleDiscountKind" = 'FIXED' THEN p."saleDiscountValue"
      ELSE floor((20000::numeric * p."saleDiscountValue"::numeric) / 100)::integer
    END)::numeric + 500) / 1000)::integer * 1000
  END) AS "newEffectivePriceAmount"
FROM "products" p
WHERE p."systemKey" = 'PACKING'
  AND p."isActive" = true
  AND p."archivedAt" IS NULL
  AND p."priceAmount" <> 20000;

CREATE TEMP TABLE "_packaging_price_change_release" ON COMMIT DROP AS
SELECT
  gen_random_uuid()::text AS "changeSetId",
  'catalog-price-migration-20261116-packaging-20000'::text AS "requestId",
  GREATEST(
    CURRENT_TIMESTAMP,
    COALESCE((SELECT MAX("recordedAt") + INTERVAL '1 millisecond' FROM "catalog_price_changes"), CURRENT_TIMESTAMP)
  ) AS "occurredAt";

UPDATE "products" p
SET "priceAmount" = 20000
FROM "_packaging_price_change_snapshot" previous
WHERE p."id" = previous."id";

INSERT INTO "catalog_price_changes" (
  "id",
  "changeSetId",
  "productId",
  "productNameSnapshot",
  "dimension",
  "previousAmount",
  "newAmount",
  "previousEffectivePriceAmount",
  "newEffectivePriceAmount",
  "previousDiscountKind",
  "previousDiscountValue",
  "newDiscountKind",
  "newDiscountValue",
  "source",
  "effectiveAt",
  "recordedAt",
  "requestId"
)
SELECT
  gen_random_uuid()::text,
  release."changeSetId",
  previous."id",
  previous."name",
  'PACKAGING_CHARGE'::"CatalogPriceDimension",
  previous."priceAmount",
  20000,
  previous."previousEffectivePriceAmount",
  previous."newEffectivePriceAmount",
  previous."saleDiscountKind",
  previous."saleDiscountValue",
  previous."saleDiscountKind",
  previous."saleDiscountValue",
  'CATALOG_PRICE_MIGRATION'::"CatalogPriceChangeSource",
  release."occurredAt",
  release."occurredAt",
  release."requestId"
FROM "_packaging_price_change_snapshot" previous
CROSS JOIN "_packaging_price_change_release" release;

INSERT INTO "audit_logs" (
  "id",
  "actorId",
  "requestId",
  "operation",
  "entityType",
  "entityId",
  "beforeSnapshot",
  "afterSnapshot",
  "reason",
  "occurredAt"
)
SELECT
  gen_random_uuid()::text,
  NULL,
  release."requestId",
  'RELEASE_UPDATE_PACKAGING_CHARGE_PRICE',
  'PRODUCT',
  previous."id",
  jsonb_build_object(
    'name', previous."name",
    'systemKey', 'PACKING',
    'priceAmount', previous."priceAmount",
    'effectivePriceAmount', previous."previousEffectivePriceAmount",
    'saleDiscountKind', previous."saleDiscountKind",
    'saleDiscountValue', previous."saleDiscountValue"
  ),
  jsonb_build_object(
    'name', previous."name",
    'systemKey', 'PACKING',
    'priceAmount', 20000,
    'effectivePriceAmount', previous."newEffectivePriceAmount",
    'saleDiscountKind', previous."saleDiscountKind",
    'saleDiscountValue', previous."saleDiscountValue"
  ),
  'Authorized release price change for active packaging charges to 20,000 Toman.',
  release."occurredAt"
FROM "_packaging_price_change_snapshot" previous
CROSS JOIN "_packaging_price_change_release" release;

COMMIT;
