ALTER TABLE "orders" ADD COLUMN "barTicketSnapshot" JSONB, ADD COLUMN "barTicketSequence" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "bar_ticket_preparations" (
  "id" TEXT PRIMARY KEY,
  "sequence" SERIAL NOT NULL UNIQUE,
  "orderId" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "bar_ticket_preparations_orderId_idx" ON "bar_ticket_preparations"("orderId");
