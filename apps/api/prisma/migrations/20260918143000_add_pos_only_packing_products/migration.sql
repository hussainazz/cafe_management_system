ALTER TABLE "products"
  ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "systemKey" TEXT;

CREATE UNIQUE INDEX "products_categoryId_systemKey_key"
  ON "products"("categoryId", "systemKey");

INSERT INTO "products" (
  "id",
  "categoryId",
  "name",
  "priceAmount",
  "isPublic",
  "systemKey",
  "preparationDeadlineMinutes",
  "displayOrder",
  "isActive",
  "isAvailable"
)
SELECT
  md5('packing:' || category."id")::uuid,
  category."id",
  'بسته‌بندی',
  15000,
  false,
  'PACKING',
  1,
  COALESCE((SELECT MAX(product."displayOrder") FROM "products" AS product WHERE product."categoryId" = category."id" AND product."archivedAt" IS NULL), 0) + 1,
  true,
  true
FROM "categories" AS category
WHERE category."isActive" = true
  AND category."archivedAt" IS NULL
ON CONFLICT ("categoryId", "systemKey") DO NOTHING;
