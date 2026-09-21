-- CreateEnum
CREATE TYPE "ProductPricingMode" AS ENUM ('FIXED', 'WEIGHTED_PER_KG');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "pricingMode" "ProductPricingMode" NOT NULL DEFAULT 'FIXED';

-- AlterTable
ALTER TABLE "order_items"
  ADD COLUMN "pricingModeSnapshot" "ProductPricingMode" NOT NULL DEFAULT 'FIXED',
  ADD COLUMN "weightGrams" INTEGER;

-- Preserve the domain invariant at the database boundary.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_weight_pricing_consistency_check"
  CHECK (
    ("pricingModeSnapshot" = 'FIXED' AND "weightGrams" IS NULL)
    OR ("pricingModeSnapshot" = 'WEIGHTED_PER_KG' AND "weightGrams" IS NOT NULL AND "weightGrams" > 0)
  );
