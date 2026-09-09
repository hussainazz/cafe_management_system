import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

const app = buildApp();
const databaseUrl = process.env.DATABASE_URL!;

beforeAll(async () => app.ready());
afterAll(async () => app.close());

async function explain(sql: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SET enable_seqscan = off");
    const result = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
    return JSON.stringify(result.rows[0]?.["QUERY PLAN"]);
  } finally {
    await client.end();
  }
}

describe("Manager reporting query plans", () => {
  it("has the measured indexes needed by payment history, daily report, and audit cursors", async () => {
    const indexes = await app.prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname::text FROM pg_indexes WHERE schemaname = 'public'`;
    const names = indexes.map((index) => index.indexname);
    expect(names).toEqual(expect.arrayContaining([
      "payment_settlements_recordedAt_id_idx",
      "settlement_reversals_recordedAt_idx",
      "audit_logs_occurredAt_id_idx",
      "audit_logs_entityType_entityId_occurredAt_id_idx",
      "orders_createdAt_idx",
    ]));
    const paymentPlan = await explain('SELECT "id" FROM "payment_settlements" ORDER BY "recordedAt" DESC, "id" DESC LIMIT 51');
    const auditPlan = await explain('SELECT "id" FROM "audit_logs" ORDER BY "occurredAt" DESC, "id" DESC LIMIT 51');
    const entityAuditPlan = await explain(`SELECT "id" FROM "audit_logs" WHERE "entityType" = 'ORDER' AND "entityId" = '00000000-0000-0000-0000-000000000000' ORDER BY "occurredAt" DESC, "id" DESC LIMIT 51`);
    for (const dayOffset of [0, 1]) {
      const from = `CURRENT_DATE - interval '${dayOffset} day'`;
      const to = `CURRENT_DATE - interval '${dayOffset - 1} day'`;
      const orderPlan = await explain(`SELECT "id" FROM "orders" WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`);
      const settlementPlan = await explain(`SELECT "id" FROM "payment_settlements" WHERE "recordedAt" >= ${from} AND "recordedAt" < ${to}`);
      const reversalPlan = await explain(`SELECT "id" FROM "settlement_reversals" WHERE "recordedAt" >= ${from} AND "recordedAt" < ${to}`);
      expect(orderPlan).toContain("orders_createdAt_idx");
      expect(settlementPlan).toContain("payment_settlements_recordedAt_id_idx");
      expect(reversalPlan).toContain("settlement_reversals_recordedAt_idx");
    }
    expect(paymentPlan).toContain("payment_settlements_recordedAt_id_idx");
    expect(auditPlan).toContain("audit_logs_occurredAt_id_idx");
    expect(entityAuditPlan).toContain("audit_logs_entityType_entityId_occurredAt_id_idx");
  });
});
