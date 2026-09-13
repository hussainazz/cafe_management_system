ALTER TABLE "settlement_allocations"
  DROP CONSTRAINT "settlement_allocations_positive_quantity_and_amount_check";

ALTER TABLE "settlement_allocations"
  ADD CONSTRAINT "settlement_allocations_non_negative_quantity_positive_amount_check"
  CHECK ("quantity" >= 0 AND "amount" > 0);
