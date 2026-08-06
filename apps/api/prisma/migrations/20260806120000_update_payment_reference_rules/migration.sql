-- Enforce that only card-to-card transfers can carry an optional reference.
-- Card-terminal payments are manually keyed into the physical terminal and
-- are not synchronized with the application.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_reference_method_check"
  CHECK (
    (
      "method" = 'CARD_TRANSFER'
      AND ("reference" IS NULL OR "reference" <> '')
    )
    OR (
      "method" IN ('CASH', 'CARD_TERMINAL')
      AND "reference" IS NULL
    )
  );
