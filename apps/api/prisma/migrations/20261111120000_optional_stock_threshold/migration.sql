ALTER TABLE "stock_items" ADD COLUMN "lowStockThreshold" DECIMAL(20,6);
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_low_stock_threshold_nonnegative" CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0);
