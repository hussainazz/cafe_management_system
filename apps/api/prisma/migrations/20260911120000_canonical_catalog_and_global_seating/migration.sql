-- Canonical option catalogs are retained independently from their per-product
-- visibility. Archived legacy rows remain addressable by historical order items.
ALTER TABLE "option_groups" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "product_option_groups"
  ADD COLUMN "minSelections" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "maxSelections" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "product_option_groups"
  ADD CONSTRAINT "product_option_groups_selection_range_check"
  CHECK ("minSelections" >= 0 AND "maxSelections" >= "minSelections" AND "maxSelections" > 0);

-- Existing local order rows reference option IDs. Keep that immutable history
-- and archive the pre-canonical catalog; the repeatable seed creates active
-- canonical groups after this migration.
UPDATE "option_groups"
SET "isActive" = false, "archivedAt" = NOW()
WHERE "archivedAt" IS NULL;

CREATE UNIQUE INDEX "option_groups_active_name_key"
  ON "option_groups" ("name")
  WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX "options_optionGroupId_name_key"
  ON "options" ("optionGroupId", "name");
CREATE UNIQUE INDEX "options_id_optionGroupId_key"
  ON "options" ("id", "optionGroupId");

CREATE TABLE "product_option_group_options" (
  "productId" TEXT NOT NULL,
  "optionGroupId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "priceAmountOverride" INTEGER,
  CONSTRAINT "product_option_group_options_pkey" PRIMARY KEY ("productId", "optionGroupId", "optionId"),
  CONSTRAINT "product_option_group_options_override_non_negative_check"
    CHECK ("priceAmountOverride" IS NULL OR "priceAmountOverride" >= 0),
  CONSTRAINT "product_option_group_options_product_group_fkey"
    FOREIGN KEY ("productId", "optionGroupId") REFERENCES "product_option_groups"("productId", "optionGroupId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "product_option_group_options_option_group_fkey"
    FOREIGN KEY ("optionId", "optionGroupId") REFERENCES "options"("id", "optionGroupId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "product_option_group_options_optionId_optionGroupId_idx"
  ON "product_option_group_options" ("optionId", "optionGroupId");

-- An order is its own timing record. Backfill any legacy table order before
-- removing the mutable table-level value.
UPDATE "orders" AS "order"
SET "tableSeatingLimitSnapshotMinutes" = "table"."seatingLimitMinutes"
FROM "cafe_tables" AS "table"
WHERE "order"."tableId" = "table"."id"
  AND "order"."channel" = 'TABLE'
  AND "order"."tableSeatingLimitSnapshotMinutes" IS NULL;

ALTER TABLE "cafe_settings"
  RENAME COLUMN "defaultTableSeatingLimitMinutes" TO "tableSeatingLimitMinutes";
ALTER TABLE "cafe_settings"
  ALTER COLUMN "tableSeatingLimitMinutes" DROP DEFAULT,
  ALTER COLUMN "tableSeatingLimitMinutes" DROP NOT NULL;
ALTER TABLE "cafe_tables" DROP COLUMN "seatingLimitMinutes";
