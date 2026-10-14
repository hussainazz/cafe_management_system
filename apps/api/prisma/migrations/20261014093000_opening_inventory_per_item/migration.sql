-- New stock items can start tracking after existing items have been initialized.
-- Keep existing counts, movements, and balances; retain per-item opening safety.
DROP INDEX "inventory_counts_one_posted_opening";

CREATE UNIQUE INDEX "inventory_movements_one_opening_per_stock"
ON "inventory_movements" ("stockItemId")
WHERE "kind" = 'OPENING_COUNT';
