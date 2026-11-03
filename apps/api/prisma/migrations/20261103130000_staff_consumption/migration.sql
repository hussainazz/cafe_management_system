ALTER TABLE "orders" ADD COLUMN "isStaffConsumption" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "order_consumptions" ALTER COLUMN "paymentSettlementId" DROP NOT NULL;
CREATE INDEX "orders_isStaffConsumption_createdAt_idx" ON "orders"("isStaffConsumption", "createdAt");
