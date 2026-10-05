CREATE TYPE "CategoryKind" AS ENUM ('SOURCE', 'PROMOTIONAL');

ALTER TABLE "categories"
ADD COLUMN "kind" "CategoryKind" NOT NULL DEFAULT 'SOURCE';

CREATE TABLE "product_category_memberships" (
    "categoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_category_memberships_pkey" PRIMARY KEY ("categoryId", "productId")
);

CREATE INDEX "product_category_memberships_productId_idx"
ON "product_category_memberships"("productId");

CREATE INDEX "product_category_memberships_categoryId_displayOrder_idx"
ON "product_category_memberships"("categoryId", "displayOrder");

ALTER TABLE "product_category_memberships"
ADD CONSTRAINT "product_category_memberships_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_category_memberships"
ADD CONSTRAINT "product_category_memberships_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
