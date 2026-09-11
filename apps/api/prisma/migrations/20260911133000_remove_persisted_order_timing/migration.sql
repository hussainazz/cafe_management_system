ALTER TABLE "orders"
  DROP COLUMN "estimatedPreparationMinutes",
  DROP COLUMN "tableSeatingLimitSnapshotMinutes",
  DROP COLUMN "estimatedTableReleaseAt";

ALTER TABLE "order_items"
  DROP COLUMN "preparationDeadlineSnapshotMinutes";
