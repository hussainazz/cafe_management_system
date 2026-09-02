-- CreateEnum
CREATE TYPE "TableOccupancyState" AS ENUM ('AVAILABLE', 'OCCUPIED');

-- AlterTable
ALTER TABLE "cafe_tables"
  ADD COLUMN "waiterCallEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "occupancyState" "TableOccupancyState" NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN "occupiedAt" TIMESTAMP(3),
  ADD COLUMN "occupancyReminderAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "cafe_tables_waiterCallEnabled_occupancyState_idx"
  ON "cafe_tables"("waiterCallEnabled", "occupancyState");

-- Seed the physical layout used by the shared POS dashboard. Static IDs make
-- this forward migration deterministic and allow an interrupted deployment to
-- be retried safely by Prisma's migration tracking.
INSERT INTO "cafe_tables" (
  "id",
  "name",
  "seatingLimitMinutes",
  "displayOrder",
  "isActive",
  "waiterCallEnabled",
  "occupancyState",
  "occupiedAt",
  "occupancyReminderAt",
  "archivedAt"
) VALUES
  ('40000000-0000-4000-8000-000000000001', '1', 45, 1, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000002', '2', 45, 2, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000003', '3', 45, 3, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000004', '4', 45, 4, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000005', 'کانتر وسط', 45, 5, true, false, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000006', '5', 45, 6, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000007', '6', 45, 7, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000008', 'جگوار', 45, 8, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000009', '7', 45, 9, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000010', '8', 45, 10, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000011', 'سوشال', 45, 11, true, false, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000012', 'سوشال سوشال', 45, 12, true, false, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000013', '9', 45, 13, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000014', '10', 45, 14, true, true, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000015', '11', 45, 15, true, false, 'AVAILABLE', NULL, NULL, NULL),
  ('40000000-0000-4000-8000-000000000016', '12', 45, 16, true, false, 'AVAILABLE', NULL, NULL, NULL)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "displayOrder" = EXCLUDED."displayOrder",
  "waiterCallEnabled" = EXCLUDED."waiterCallEnabled";

-- AddCheckConstraint
ALTER TABLE "cafe_tables"
  ADD CONSTRAINT "cafe_tables_occupancy_state_check"
  CHECK (
    ("occupancyState" = 'AVAILABLE' AND "occupiedAt" IS NULL)
    OR
    ("occupancyState" = 'OCCUPIED' AND "occupiedAt" IS NOT NULL AND "occupancyReminderAt" IS NULL)
  );

-- AddCheckConstraint
ALTER TABLE "cafe_tables"
  ADD CONSTRAINT "cafe_tables_waiter_call_reminder_eligibility_check"
  CHECK ("waiterCallEnabled" OR "occupancyReminderAt" IS NULL);
