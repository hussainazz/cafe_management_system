CREATE TYPE "SettlementAllocationMode" AS ENUM ('ITEM_QUANTITY', 'AMOUNT');

ALTER TABLE "payment_settlements"
  ADD COLUMN "allocationMode" "SettlementAllocationMode";

-- A fractional allocation proves an old payment used amount mode. Whole-item
-- allocations can also come from amount mode, so leave their old mode unknown.
UPDATE "payment_settlements" AS settlement
SET "allocationMode" = 'AMOUNT'
WHERE EXISTS (
  SELECT 1 FROM "settlement_allocations" AS allocation
  WHERE allocation."settlementId" = settlement."id" AND allocation."quantity" = 0
);
