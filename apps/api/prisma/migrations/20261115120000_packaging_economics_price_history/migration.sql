CREATE TYPE "CatalogPriceDimension" AS ENUM (
  'PRODUCT_BASE_PRICE',
  'OPTION_PRICE',
  'PRODUCT_OPTION_OVERRIDE',
  'PRODUCT_DISCOUNT',
  'PACKAGING_CHARGE'
);

CREATE TYPE "CatalogPriceChangeSource" AS ENUM (
  'BASELINE',
  'POS_PRODUCT_CREATE',
  'POS_PRODUCT_UPDATE',
  'POS_OPTION_CREATE',
  'POS_OPTION_UPDATE',
  'POS_PRODUCT_DISCOUNT'
);

ALTER TABLE "stock_items"
  ADD COLUMN "isPackagingMaterial" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "catalog_price_changes" (
  "id" TEXT NOT NULL,
  "changeSetId" TEXT NOT NULL,
  "productId" TEXT,
  "productNameSnapshot" TEXT,
  "optionId" TEXT,
  "optionNameSnapshot" TEXT,
  "dimension" "CatalogPriceDimension" NOT NULL,
  "previousAmount" INTEGER,
  "newAmount" INTEGER,
  "previousEffectivePriceAmount" INTEGER,
  "newEffectivePriceAmount" INTEGER,
  "previousDiscountKind" "DiscountKind",
  "previousDiscountValue" INTEGER,
  "newDiscountKind" "DiscountKind",
  "newDiscountValue" INTEGER,
  "source" "CatalogPriceChangeSource" NOT NULL,
  "effectiveAt" TIMESTAMP(3),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT,
  "requestId" TEXT,
  CONSTRAINT "catalog_price_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalog_price_changes_amounts_nonnegative" CHECK (
    ("previousAmount" IS NULL OR "previousAmount" >= 0) AND
    ("newAmount" IS NULL OR "newAmount" >= 0) AND
    ("previousEffectivePriceAmount" IS NULL OR "previousEffectivePriceAmount" >= 0) AND
    ("newEffectivePriceAmount" IS NULL OR "newEffectivePriceAmount" >= 0) AND
    ("previousDiscountValue" IS NULL OR "previousDiscountValue" >= 0) AND
    ("newDiscountValue" IS NULL OR "newDiscountValue" >= 0)
  ),
  CONSTRAINT "catalog_price_changes_product_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "catalog_price_changes_option_fkey" FOREIGN KEY ("optionId") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "catalog_price_changes_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "catalog_price_changes_recordedAt_id_idx" ON "catalog_price_changes"("recordedAt", "id");
CREATE INDEX "catalog_price_changes_productId_recordedAt_id_idx" ON "catalog_price_changes"("productId", "recordedAt", "id");
CREATE INDEX "catalog_price_changes_optionId_recordedAt_id_idx" ON "catalog_price_changes"("optionId", "recordedAt", "id");
CREATE INDEX "catalog_price_changes_dimension_recordedAt_id_idx" ON "catalog_price_changes"("dimension", "recordedAt", "id");
CREATE INDEX "catalog_price_changes_changeSetId_idx" ON "catalog_price_changes"("changeSetId");

-- This records the migration-time baseline only. Prior values and effective
-- times remain unknown; existing order snapshots are preserved independently.
INSERT INTO "catalog_price_changes" (
  "id", "changeSetId", "productId", "productNameSnapshot", "dimension",
  "previousAmount", "newAmount", "previousEffectivePriceAmount", "newEffectivePriceAmount",
  "newDiscountKind", "newDiscountValue", "source", "effectiveAt", "recordedAt"
)
SELECT
  gen_random_uuid()::text,
  gen_random_uuid()::text,
  p."id",
  p."name",
  CASE WHEN p."systemKey" = 'PACKING' THEN 'PACKAGING_CHARGE'::"CatalogPriceDimension" ELSE 'PRODUCT_BASE_PRICE'::"CatalogPriceDimension" END,
  NULL,
  p."priceAmount",
  NULL,
  LEAST(p."priceAmount", CASE
    WHEN p."saleDiscountKind" IS NULL OR p."saleDiscountValue" IS NULL OR p."saleDiscountValue" = 0 THEN p."priceAmount"
    ELSE floor((greatest(0, p."priceAmount" - CASE
      WHEN p."saleDiscountKind" = 'FIXED' THEN p."saleDiscountValue"
      ELSE floor((p."priceAmount"::numeric * p."saleDiscountValue"::numeric) / 100)::integer
    END) + 500)::numeric / 1000)::integer * 1000
  END),
  p."saleDiscountKind",
  p."saleDiscountValue",
  'BASELINE'::"CatalogPriceChangeSource",
  NULL,
  CURRENT_TIMESTAMP
FROM "products" p
WHERE p."isActive" = true AND p."archivedAt" IS NULL;

INSERT INTO "catalog_price_changes" (
  "id", "changeSetId", "productId", "productNameSnapshot", "optionId", "optionNameSnapshot",
  "dimension", "previousAmount", "newAmount", "previousEffectivePriceAmount", "newEffectivePriceAmount",
  "source", "effectiveAt", "recordedAt"
)
SELECT
  gen_random_uuid()::text,
  gen_random_uuid()::text,
  p."id",
  p."name",
  o."id",
  o."name",
  CASE WHEN link."priceAmountOverride" IS NULL THEN 'OPTION_PRICE'::"CatalogPriceDimension" ELSE 'PRODUCT_OPTION_OVERRIDE'::"CatalogPriceDimension" END,
  NULL,
  COALESCE(link."priceAmountOverride", o."priceAmount"),
  NULL,
  COALESCE(link."priceAmountOverride", o."priceAmount"),
  'BASELINE'::"CatalogPriceChangeSource",
  NULL,
  CURRENT_TIMESTAMP
FROM "product_option_group_options" link
JOIN "products" p ON p."id" = link."productId"
JOIN "options" o ON o."id" = link."optionId"
WHERE p."isActive" = true AND p."archivedAt" IS NULL
  AND o."isActive" = true AND o."archivedAt" IS NULL;

INSERT INTO "catalog_price_changes" (
  "id", "changeSetId", "optionId", "optionNameSnapshot", "dimension",
  "previousAmount", "newAmount", "previousEffectivePriceAmount", "newEffectivePriceAmount",
  "source", "effectiveAt", "recordedAt"
)
SELECT
  gen_random_uuid()::text,
  gen_random_uuid()::text,
  o."id",
  o."name",
  'OPTION_PRICE'::"CatalogPriceDimension",
  NULL,
  o."priceAmount",
  NULL,
  o."priceAmount",
  'BASELINE'::"CatalogPriceChangeSource",
  NULL,
  CURRENT_TIMESTAMP
FROM "options" o
WHERE o."isActive" = true AND o."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "product_option_group_options" link WHERE link."optionId" = o."id");
