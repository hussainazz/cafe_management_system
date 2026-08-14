ALTER TABLE "products"
  ADD COLUMN "saleDiscountKind" "DiscountKind",
  ADD COLUMN "saleDiscountValue" INTEGER;

ALTER TABLE "order_items"
  ADD COLUMN "discountKind" "DiscountKind",
  ADD COLUMN "discountValue" INTEGER,
  ADD COLUMN "discountReason" TEXT;

ALTER TABLE "products" ADD CONSTRAINT "products_sale_discount_value_check"
  CHECK (
    ("saleDiscountKind" IS NULL AND "saleDiscountValue" IS NULL)
    OR ("saleDiscountKind" = 'PERCENTAGE' AND "saleDiscountValue" BETWEEN 1 AND 100)
    OR ("saleDiscountKind" = 'FIXED' AND "saleDiscountValue" > 0)
  );

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_value_check"
  CHECK (
    ("discountKind" IS NULL AND "discountValue" IS NULL)
    OR ("discountKind" = 'PERCENTAGE' AND "discountValue" BETWEEN 1 AND 100)
    OR ("discountKind" = 'FIXED' AND "discountValue" > 0)
  );
