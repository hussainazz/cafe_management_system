-- A physical table can have at most one operational table order. This protects
-- every write path, including settlement reversal, beyond advisory locks.
CREATE UNIQUE INDEX "orders_one_open_table_order_idx"
  ON "orders" ("tableId")
  WHERE "state" = 'OPEN' AND "channel" = 'TABLE' AND "tableId" IS NOT NULL;
