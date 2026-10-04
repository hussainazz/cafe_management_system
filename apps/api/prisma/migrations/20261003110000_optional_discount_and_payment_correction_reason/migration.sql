ALTER TABLE "orders"
  DROP CONSTRAINT "orders_discount_value_check",
  ADD CONSTRAINT "orders_discount_value_check"
    CHECK (
      ("discountKind" IS NULL AND "discountValue" IS NULL AND "discountReason" IS NULL)
      OR
      ("discountKind" = 'PERCENTAGE' AND "discountValue" BETWEEN 1 AND 100 AND ("discountReason" IS NULL OR btrim("discountReason") <> ''))
      OR
      ("discountKind" = 'FIXED' AND "discountValue" > 0 AND "discountValue" <= "subtotalAmount" AND ("discountReason" IS NULL OR btrim("discountReason") <> ''))
    );

ALTER TABLE "settlement_reversals"
  ALTER COLUMN "reason" DROP NOT NULL,
  DROP CONSTRAINT "settlement_reversals_reason_non_empty_check";
