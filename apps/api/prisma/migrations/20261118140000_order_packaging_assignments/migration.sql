ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_id_orderId_key" UNIQUE ("id", "orderId");

CREATE TABLE "order_item_packaging_assignments" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "packagingItemId" TEXT NOT NULL,
  "productItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "order_item_packaging_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_item_packaging_assignments_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "order_item_packaging_assignments_distinct_items" CHECK ("packagingItemId" <> "productItemId"),
  CONSTRAINT "order_item_packaging_assignments_packagingItemId_productItemId_key" UNIQUE ("packagingItemId", "productItemId"),
  CONSTRAINT "order_item_packaging_assignments_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_item_packaging_assignments_packagingItemId_orderId_fkey"
    FOREIGN KEY ("packagingItemId", "orderId") REFERENCES "order_items"("id", "orderId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_item_packaging_assignments_productItemId_orderId_fkey"
    FOREIGN KEY ("productItemId", "orderId") REFERENCES "order_items"("id", "orderId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "order_item_packaging_assignments_orderId_idx"
  ON "order_item_packaging_assignments"("orderId");

CREATE INDEX "order_item_packaging_assignments_productItemId_orderId_idx"
  ON "order_item_packaging_assignments"("productItemId", "orderId");
