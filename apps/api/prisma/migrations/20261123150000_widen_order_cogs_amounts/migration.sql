ALTER TABLE "order_consumptions"
  ALTER COLUMN "theoreticalCogsAmount" TYPE BIGINT USING "theoreticalCogsAmount"::BIGINT,
  ALTER COLUMN "knownCogsAmount" TYPE BIGINT USING "knownCogsAmount"::BIGINT;

ALTER TABLE "order_consumption_items"
  ALTER COLUMN "theoreticalCogsAmount" TYPE BIGINT USING "theoreticalCogsAmount"::BIGINT,
  ALTER COLUMN "knownCogsAmount" TYPE BIGINT USING "knownCogsAmount"::BIGINT;
