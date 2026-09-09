ALTER TABLE "orders"
  DROP CONSTRAINT "orders_deletion_state_check",
  ADD CONSTRAINT "orders_deletion_state_check"
    CHECK (
      ("state" = 'OPEN' AND "deletedAt" IS NULL AND "deletedById" IS NULL)
      OR
      ("state" = 'CLOSED' AND "deletedAt" IS NULL AND "deletedById" IS NULL)
      OR
      ("state" = 'DELETED' AND "deletedAt" IS NOT NULL AND "deletedById" IS NOT NULL)
    );
