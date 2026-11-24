ALTER TABLE "product_costing_configurations"
  DROP CONSTRAINT "product_costing_configurations_mode_source_consistent",
  ADD CONSTRAINT "product_costing_configurations_mode_source_consistent" CHECK (
    ("mode" = 'RECIPE' AND "purchasedStockItemId" IS NULL AND "purchasedQuantity" IS NULL
      AND (("recipeId" IS NULL AND "recipeQuantity" IS NULL)
        OR ("recipeId" IS NOT NULL AND "recipeQuantity" IS NOT NULL AND "recipeQuantity" > 0))
      AND ("useEstimatedCost" OR ("recipeId" IS NOT NULL AND "recipeQuantity" > 0)))
    OR ("mode" = 'PURCHASED_ITEM' AND "recipeId" IS NULL AND "recipeQuantity" IS NULL
      AND (("purchasedStockItemId" IS NULL AND "purchasedQuantity" IS NULL)
        OR ("purchasedStockItemId" IS NOT NULL
          AND ("purchasedQuantity" IS NULL OR "purchasedQuantity" > 0)))
      AND ("useEstimatedCost" OR "purchasedStockItemId" IS NOT NULL))
  );
