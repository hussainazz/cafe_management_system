ALTER TABLE "orders" ADD COLUMN "deferredAt" TIMESTAMP(3), ADD COLUMN "deferredCustomerName" TEXT;
CREATE INDEX "orders_deferredAt_idx" ON "orders"("deferredAt");
