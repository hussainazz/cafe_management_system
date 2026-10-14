-- Keep archived item history while freeing its active display name for reuse.
-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN     "archivedName" TEXT;

UPDATE "stock_items"
SET "archivedName" = "name",
    "name" = '__archived_stock_' || "id"
WHERE "archivedAt" IS NOT NULL;
