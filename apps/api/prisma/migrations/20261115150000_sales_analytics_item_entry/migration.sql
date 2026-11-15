ALTER TABLE "order_items"
ADD COLUMN "enteredAt" TIMESTAMP(3);

CREATE INDEX "order_items_enteredAt_idx" ON "order_items"("enteredAt");
