ALTER TABLE "cafe_tables"
  ADD COLUMN "customerAuthBypassEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "daily_order_sequences" (
  "businessDate" TEXT NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "daily_order_sequences_pkey" PRIMARY KEY ("businessDate"),
  CONSTRAINT "daily_order_sequences_lastNumber_positive_check" CHECK ("lastNumber" >= 0)
);

ALTER TABLE "orders"
  ADD COLUMN "dailyOrderNumber" INTEGER NOT NULL DEFAULT 0;

WITH numbered_orders AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY ("createdAt" AT TIME ZONE 'Asia/Tehran')::date
      ORDER BY "createdAt" ASC, id ASC
    )::INTEGER AS "dailyOrderNumber"
  FROM "orders"
)
UPDATE "orders"
SET "dailyOrderNumber" = numbered_orders."dailyOrderNumber"
FROM numbered_orders
WHERE "orders".id = numbered_orders.id;

INSERT INTO "daily_order_sequences" ("businessDate", "lastNumber")
SELECT
  to_char(("createdAt" AT TIME ZONE 'Asia/Tehran')::date, 'YYYY-MM-DD'),
  max("dailyOrderNumber")
FROM "orders"
GROUP BY ("createdAt" AT TIME ZONE 'Asia/Tehran')::date
ON CONFLICT ("businessDate") DO UPDATE
SET "lastNumber" = EXCLUDED."lastNumber";

CREATE INDEX "orders_dailyOrderNumber_idx" ON "orders"("dailyOrderNumber");
