-- Seating timing is an opt-in Manager setting. NULL means the POS does not
-- display or require a seating countdown.
ALTER TABLE "cafe_settings"
  ALTER COLUMN "tableSeatingLimitMinutes" DROP DEFAULT,
  ALTER COLUMN "tableSeatingLimitMinutes" DROP NOT NULL;
