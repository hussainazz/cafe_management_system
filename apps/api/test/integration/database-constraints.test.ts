import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { OrderChannel, OrderState, PaymentStatus, UserRole } from "../../generated/prisma/enums.js";

const app = buildApp();
const databaseUrl = process.env.DATABASE_URL!;

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function expectDatabaseError(
  sql: string,
  values: unknown[],
  expected: { code: "23503" | "23505" | "23514"; constraint: string },
) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await expect(client.query(sql, values)).rejects.toMatchObject(expected);
  } finally {
    await client.end();
  }
}

async function createUser(username = `db.${randomUUID().slice(0, 8)}`) {
  return app.prisma.user.create({
    data: {
      username,
      passwordHash: "valid-password-hash",
      role: UserRole.STAFF,
    },
  });
}

async function createOrderFixture() {
  const user = await createUser();
  const order = await app.prisma.order.create({
    data: {
      orderNumber: `DB-${randomUUID()}`,
      createdById: user.id,
      channel: OrderChannel.TAKEAWAY,
      state: OrderState.OPEN,
      paymentStatus: PaymentStatus.UNPAID,
      subtotalAmount: 100_000,
      discountAmount: 0,
      totalAmount: 100_000,
      paidAmount: 0,
      balanceAmount: 100_000,
    },
  });

  return { order, user };
}

describe("database-native constraints", () => {
  it("rejects invalid identity and authentication records", async () => {
    await expectDatabaseError(
      `INSERT INTO "users" ("id", "username", "passwordHash", "role", "updatedAt")
       VALUES ($1, $2, '   ', 'STAFF', CURRENT_TIMESTAMP)`,
      [randomUUID(), `blank.${randomUUID().slice(0, 8)}`],
      { code: "23514", constraint: "users_passwordHash_non_empty_check" },
    );

    const user = await createUser();
    await expectDatabaseError(
      `INSERT INTO "refresh_sessions"
        ("id", "userId", "tokenHash", "createdAt", "expiresAt", "revokedAt")
       VALUES ($1, $2, 'hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP - interval '1 second', NULL)`,
      [randomUUID(), user.id],
      { code: "23514", constraint: "refresh_sessions_timestamp_order_check" },
    );

    await app.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: "unique-refresh-token-hash",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expectDatabaseError(
      `INSERT INTO "refresh_sessions" ("id", "userId", "tokenHash", "expiresAt")
       VALUES ($1, $2, 'unique-refresh-token-hash', CURRENT_TIMESTAMP + interval '1 minute')`,
      [randomUUID(), user.id],
      { code: "23505", constraint: "refresh_sessions_tokenHash_key" },
    );
  });

  it("rejects invalid catalog and archive states", async () => {
    await expectDatabaseError(
      `INSERT INTO "categories" ("id", "name", "displayOrder") VALUES ($1, '   ', 0)`,
      [randomUUID()],
      { code: "23514", constraint: "categories_name_non_empty_check" },
    );

    const category = await app.prisma.category.create({
      data: { name: "Database", displayOrder: 1 },
    });
    await expectDatabaseError(
      `INSERT INTO "products"
        ("id", "categoryId", "name", "priceAmount", "preparationDeadlineMinutes", "displayOrder", "archivedAt")
       VALUES ($1, $2, 'Invalid archive', 1, 1, 0, CURRENT_TIMESTAMP)`,
      [randomUUID(), category.id],
      { code: "23514", constraint: "products_archive_state_check" },
    );

    await expectDatabaseError(
      `INSERT INTO "options"
        ("id", "optionGroupId", "name", "priceAmount", "displayOrder")
       VALUES ($1, $2, 'Invalid order', 0, -1)`,
      [randomUUID(), (await app.prisma.optionGroup.create({ data: { name: "Group" } })).id],
      { code: "23514", constraint: "options_displayOrder_non_negative_check" },
    );
  });

  it("rejects inconsistent order money, status, lifecycle, and discount records", async () => {
    const { order, user } = await createOrderFixture();

    await expectDatabaseError(
      `UPDATE "orders" SET "totalAmount" = 99999 WHERE "id" = $1`,
      [order.id],
      { code: "23514", constraint: "orders_amount_reconciliation_check" },
    );
    await expectDatabaseError(
      `UPDATE "orders"
       SET "paymentStatus" = 'PAID', "paidAmount" = 50000, "balanceAmount" = 50000
       WHERE "id" = $1`,
      [order.id],
      { code: "23514", constraint: "orders_payment_status_check" },
    );
    await expectDatabaseError(
      `UPDATE "orders" SET "state" = 'DELETED', "deletedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      [order.id],
      { code: "23514", constraint: "orders_deletion_state_check" },
    );
    await expectDatabaseError(
      `UPDATE "orders"
       SET "discountKind" = 'FIXED', "discountValue" = 1000,
           "discountAmount" = 1000, "totalAmount" = 99000, "balanceAmount" = 99000,
           "discountReason" = '   '
       WHERE "id" = $1`,
      [order.id],
      { code: "23514", constraint: "orders_discount_value_check" },
    );
    await expectDatabaseError(
      `UPDATE "orders"
       SET "discountKind" = 'FIXED', "discountValue" = 1000,
           "discountAmount" = 1000, "totalAmount" = 99000, "balanceAmount" = 99000,
           "discountReason" = NULL
       WHERE "id" = $1`,
      [order.id],
      { code: "23514", constraint: "orders_discount_value_check" },
    );

    await app.prisma.order.update({
      where: { id: order.id },
      data: { state: OrderState.DELETED, deletedAt: new Date(), deletedById: user.id },
    });
    await expectDatabaseError(`DELETE FROM "users" WHERE "id" = $1`, [user.id], {
      code: "23503",
      constraint: "orders_createdById_fkey",
    });
  });

  it("enforces one active QR credential and one pending waiter-call per table", async () => {
    const table = await app.prisma.cafeTable.create({
      data: { name: "Waiter-call constraint table", displayOrder: 1, waiterCallEnabled: true },
    });
    const firstCredential = await app.prisma.tableQrCredential.create({
      data: { tableId: table.id, tokenHash: `hash-${randomUUID()}` },
    });

    await expectDatabaseError(
      `INSERT INTO "table_qr_credentials" ("id", "tableId", "tokenHash") VALUES ($1, $2, $3)`,
      [randomUUID(), table.id, `hash-${randomUUID()}`],
      { code: "23505", constraint: "table_qr_credentials_one_active_per_table_key" },
    );

    await app.prisma.tableQrCredential.update({
      where: { id: firstCredential.id },
      data: { isActive: false, rotatedAt: new Date() },
    });
    await app.prisma.tableQrCredential.create({
      data: { tableId: table.id, tokenHash: `hash-${randomUUID()}` },
    });

    const pending = await app.prisma.waiterCall.create({ data: { tableId: table.id } });
    await expectDatabaseError(
      `INSERT INTO "waiter_calls" ("id", "tableId") VALUES ($1, $2)`,
      [randomUUID(), table.id],
      { code: "23505", constraint: "waiter_calls_one_pending_per_table_key" },
    );
    await expectDatabaseError(
      `UPDATE "waiter_calls" SET "status" = 'RESOLVED', "resolvedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      [pending.id],
      { code: "23514", constraint: "waiter_calls_lifecycle_check" },
    );

    const resolvedAt = new Date();
    await app.prisma.waiterCall.update({
      where: { id: pending.id },
      data: {
        status: "RESOLVED",
        acknowledgedAt: resolvedAt,
        resolvedAt,
        version: { increment: 1 },
      },
    });
    await expect(
      app.prisma.waiterCall.create({ data: { tableId: table.id } }),
    ).resolves.toMatchObject({
      status: "PENDING",
      version: 1,
    });
  });

  it("rejects invalid payment, idempotency, and audit rows", async () => {
    const { order, user } = await createOrderFixture();

    await expectDatabaseError(
      `INSERT INTO "payment_settlements"
        ("id", "orderId", "recordedById", "idempotencyKey", "totalAmount")
       VALUES ($1, $2, $3, 'zero-settlement', 0)`,
      [randomUUID(), order.id, user.id],
      { code: "23514", constraint: "payment_settlements_totalAmount_positive_check" },
    );
    const settlement = await app.prisma.paymentSettlement.create({
      data: {
        orderId: order.id,
        recordedById: user.id,
        idempotencyKey: "reference-check",
        totalAmount: 1,
      },
    });
    await expectDatabaseError(
      `INSERT INTO "payments" ("id", "settlementId", "method", "amount", "reference")
       VALUES ($1, $2, 'CARD_TRANSFER', 1, '   ')`,
      [randomUUID(), settlement.id],
      { code: "23514", constraint: "payments_reference_method_check" },
    );
    await expectDatabaseError(
      `INSERT INTO "idempotency_records"
        ("id", "actorId", "operation", "key", "requestFingerprint", "responseStatus", "resultSnapshot", "expiresAt")
       VALUES ($1, $2, 'CREATE_ORDER', 'key', 'fingerprint', 700, '{}'::jsonb, CURRENT_TIMESTAMP + interval '1 hour')`,
      [randomUUID(), user.id],
      { code: "23514", constraint: "idempotency_records_responseStatus_check" },
    );
    await expectDatabaseError(
      `INSERT INTO "audit_logs"
        ("id", "actorId", "requestId", "operation", "entityType", "entityId")
       VALUES ($1, $2, '   ', 'TEST', 'ORDER', $3)`,
      [randomUUID(), user.id, order.id],
      { code: "23514", constraint: "audit_logs_text_non_empty_check" },
    );
  });

  it("enforces the cafe-settings singleton", async () => {
    await app.prisma.cafeSettings.create({ data: {} });

    await expectDatabaseError(
      `INSERT INTO "cafe_settings" ("id", "updatedAt") VALUES ($1, CURRENT_TIMESTAMP)`,
      [randomUUID()],
      { code: "23505", constraint: "cafe_settings_singletonKey_key" },
    );
  });
});
