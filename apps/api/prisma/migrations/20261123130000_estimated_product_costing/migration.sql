ALTER TABLE "product_costing_configurations"
  ADD COLUMN "useEstimatedCost" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "estimatedCostAmount" INTEGER,
  ADD CONSTRAINT "product_costing_estimated_amount_nonnegative"
    CHECK ("estimatedCostAmount" IS NULL OR "estimatedCostAmount" >= 0),
  ADD CONSTRAINT "product_costing_estimate_requires_amount"
    CHECK (NOT "useEstimatedCost" OR "estimatedCostAmount" IS NOT NULL);

ALTER TABLE "product_costing_configurations"
  DROP CONSTRAINT "product_costing_configurations_mode_source_consistent",
  ADD CONSTRAINT "product_costing_configurations_mode_source_consistent" CHECK (
    ("mode" = 'RECIPE' AND "purchasedStockItemId" IS NULL AND "purchasedQuantity" IS NULL
      AND (("recipeId" IS NULL AND "recipeQuantity" IS NULL)
        OR ("recipeId" IS NOT NULL AND "recipeQuantity" > 0))
      AND ("useEstimatedCost" OR ("recipeId" IS NOT NULL AND "recipeQuantity" > 0)))
    OR ("mode" = 'PURCHASED_ITEM' AND "recipeId" IS NULL AND "recipeQuantity" IS NULL
      AND (("purchasedStockItemId" IS NULL AND "purchasedQuantity" IS NULL)
        OR ("purchasedStockItemId" IS NOT NULL
          AND ("purchasedQuantity" IS NULL OR "purchasedQuantity" > 0)))
      AND ("useEstimatedCost" OR "purchasedStockItemId" IS NOT NULL))
  );
