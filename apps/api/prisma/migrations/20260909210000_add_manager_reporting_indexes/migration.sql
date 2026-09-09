CREATE INDEX "payment_settlements_recordedAt_id_idx"
  ON "payment_settlements"("recordedAt", "id");

CREATE INDEX "settlement_reversals_recordedAt_idx"
  ON "settlement_reversals"("recordedAt");

DROP INDEX "audit_logs_occurredAt_idx";

CREATE INDEX "audit_logs_occurredAt_id_idx"
  ON "audit_logs"("occurredAt", "id");

CREATE INDEX "audit_logs_entityType_entityId_occurredAt_id_idx"
  ON "audit_logs"("entityType", "entityId", "occurredAt", "id");
