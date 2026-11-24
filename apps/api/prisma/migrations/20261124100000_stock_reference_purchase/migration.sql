ALTER TABLE "stock_items"
  ADD COLUMN "referencePurchaseQuantity" DECIMAL(20,6),
  ADD COLUMN "referencePurchasePriceAmount" INTEGER,
  ADD COLUMN "referencePurchaseUnitLabel" TEXT,
  ADD COLUMN "referencePurchaseConversionId" TEXT,
  ADD CONSTRAINT "stock_reference_purchase_quantity_positive"
    CHECK ("referencePurchaseQuantity" IS NULL OR "referencePurchaseQuantity" > 0),
  ADD CONSTRAINT "stock_reference_purchase_price_nonnegative"
    CHECK ("referencePurchasePriceAmount" IS NULL OR "referencePurchasePriceAmount" >= 0),
  ADD CONSTRAINT "stock_reference_purchase_requires_all_fields"
    CHECK (("referencePurchaseQuantity" IS NULL AND "referencePurchasePriceAmount" IS NULL AND "referencePurchaseUnitLabel" IS NULL AND "referencePurchaseConversionId" IS NULL)
      OR ("referencePurchaseQuantity" IS NOT NULL AND "referencePurchasePriceAmount" IS NOT NULL AND "referencePurchaseUnitLabel" IS NOT NULL
        AND (("referencePurchaseUnitLabel" = "baseUnit"::text AND "referencePurchaseConversionId" IS NULL)
          OR ("referencePurchaseUnitLabel" <> "baseUnit"::text AND "referencePurchaseConversionId" IS NOT NULL))));

CREATE UNIQUE INDEX "stock_items_referencePurchaseConversionId_key"
  ON "stock_items"("referencePurchaseConversionId");

ALTER TABLE "stock_items"
  ADD CONSTRAINT "stock_items_referencePurchaseConversionId_fkey"
    FOREIGN KEY ("referencePurchaseConversionId")
    REFERENCES "stock_unit_conversions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
