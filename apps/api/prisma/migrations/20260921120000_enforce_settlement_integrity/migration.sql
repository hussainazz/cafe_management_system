CREATE OR REPLACE FUNCTION validate_settlement_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_order_id text;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    IF TG_OP = 'DELETE' THEN affected_order_id := OLD."id"; ELSE affected_order_id := NEW."id"; END IF;
  ELSIF TG_TABLE_NAME = 'payment_settlements' THEN
    IF TG_OP = 'DELETE' THEN affected_order_id := OLD."orderId"; ELSE affected_order_id := NEW."orderId"; END IF;
  ELSIF TG_TABLE_NAME = 'settlement_allocations' THEN
    SELECT ps."orderId"
      INTO affected_order_id
      FROM "payment_settlements" ps
     WHERE ps."id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."settlementId" ELSE NEW."settlementId" END;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    SELECT ps."orderId"
      INTO affected_order_id
      FROM "payment_settlements" ps
     WHERE ps."id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."settlementId" ELSE NEW."settlementId" END;
  ELSIF TG_TABLE_NAME = 'settlement_reversals' THEN
    SELECT ps."orderId"
      INTO affected_order_id
      FROM "payment_settlements" ps
     WHERE ps."id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."settlementId" ELSE NEW."settlementId" END;
  END IF;

  IF affected_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "settlement_allocations" sa
      JOIN "payment_settlements" ps ON ps."id" = sa."settlementId"
      JOIN "order_items" oi ON oi."id" = sa."orderItemId"
     WHERE ps."orderId" = affected_order_id
       AND oi."orderId" <> affected_order_id
  ) THEN
    RAISE EXCEPTION 'Settlement allocation must reference an item from its order'
      USING ERRCODE = '23514', CONSTRAINT = 'settlement_allocations_order_ownership_check';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "payment_settlements" ps
     WHERE ps."orderId" = affected_order_id
       AND ps."totalAmount" <> COALESCE((SELECT SUM(sa."amount") FROM "settlement_allocations" sa WHERE sa."settlementId" = ps."id"), 0)
  ) THEN
    RAISE EXCEPTION 'Settlement total must equal allocation totals'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_settlements_allocation_sum_check';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "payment_settlements" ps
     WHERE ps."orderId" = affected_order_id
       AND ps."totalAmount" <> COALESCE((SELECT SUM(p."amount") FROM "payments" p WHERE p."settlementId" = ps."id"), 0)
  ) THEN
    RAISE EXCEPTION 'Settlement total must equal tender totals'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_settlements_payment_sum_check';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "settlement_allocations" sa
      JOIN "payment_settlements" ps ON ps."id" = sa."settlementId"
      JOIN "order_items" oi ON oi."id" = sa."orderItemId"
      LEFT JOIN "settlement_reversals" sr ON sr."settlementId" = ps."id"
     WHERE ps."orderId" = affected_order_id
     GROUP BY sa."orderItemId", oi."quantity"
    HAVING COALESCE(SUM(sa."quantity") FILTER (WHERE sr."id" IS NULL), 0) > oi."quantity"
  ) THEN
    RAISE EXCEPTION 'Active settlement allocation quantity exceeds order item quantity'
      USING ERRCODE = '23514', CONSTRAINT = 'settlement_allocations_quantity_limit_check';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER settlement_integrity_settlements
AFTER INSERT OR UPDATE OR DELETE ON "payment_settlements"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_settlement_integrity();

CREATE CONSTRAINT TRIGGER settlement_integrity_allocations
AFTER INSERT OR UPDATE OR DELETE ON "settlement_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_settlement_integrity();

CREATE CONSTRAINT TRIGGER settlement_integrity_payments
AFTER INSERT OR UPDATE OR DELETE ON "payments"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_settlement_integrity();

CREATE CONSTRAINT TRIGGER settlement_integrity_reversals
AFTER INSERT OR UPDATE OR DELETE ON "settlement_reversals"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_settlement_integrity();
