import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserRole } from "../../generated/prisma/client.js";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();
beforeAll(async () => app.ready());
afterAll(async () => app.close());

async function session(role: UserRole, username: string) {
  await app.prisma.user.create({ data: { username, passwordHash: await hashPassword("CafePassword2026"), role } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

async function recordedSettlement(input: {
  orderNumber: string;
  actorId: string;
  recordedAt: Date;
  amount: number;
  tableId?: string;
  reversedById?: string;
}) {
  const order = await app.prisma.order.create({
    data: {
      orderNumber: input.orderNumber,
      createdById: input.actorId,
      channel: input.tableId ? "TABLE" : "TAKEAWAY",
      tableId: input.tableId ?? null,
      tableSeatingLimitSnapshotMinutes: input.tableId ? 45 : null,
      estimatedTableReleaseAt: input.tableId ? new Date(input.recordedAt.getTime() + 45 * 60_000) : null,
      state: "CLOSED",
      paymentStatus: "PAID",
      subtotalAmount: input.amount,
      totalAmount: input.amount,
      paidAmount: input.amount,
      balanceAmount: 0,
    },
  });
  const settlement = await app.prisma.paymentSettlement.create({
    data: {
      orderId: order.id,
      recordedById: input.actorId,
      idempotencyKey: `history-${input.orderNumber}`,
      totalAmount: input.amount,
      recordedAt: input.recordedAt,
      payments: { create: [{ method: "CARD_TRANSFER", amount: input.amount, reference: `REF-${input.orderNumber}` }] },
    },
  });
  if (input.reversedById) {
    await app.prisma.settlementReversal.create({ data: { settlementId: settlement.id, recordedById: input.reversedById, reason: "Test reversal" } });
  }
  return { order, settlement };
}

async function reportOrder(input: {
  orderNumber: string;
  actorId: string;
  productId: string;
  createdAt: Date;
  subtotalAmount: number;
  totalAmount: number;
  paidAmount: number;
  orderDiscountAmount?: number;
  itemDiscountAmount?: number;
  deleted?: boolean;
}) {
  return app.prisma.order.create({
    data: {
      orderNumber: input.orderNumber,
      createdById: input.actorId,
      channel: "TAKEAWAY",
      state: input.deleted ? "DELETED" : input.paidAmount === input.totalAmount ? "CLOSED" : "OPEN",
      paymentStatus: input.paidAmount === 0 ? "UNPAID" : input.paidAmount === input.totalAmount ? "PAID" : "PARTIALLY_PAID",
      subtotalAmount: input.subtotalAmount,
      discountAmount: input.orderDiscountAmount ?? 0,
      totalAmount: input.totalAmount,
      paidAmount: input.paidAmount,
      balanceAmount: input.totalAmount - input.paidAmount,
      createdAt: input.createdAt,
      ...(input.deleted ? { deletedAt: input.createdAt, deletedById: input.actorId } : {}),
      items: {
        create: {
          productId: input.productId,
          productNameSnapshot: "Report coffee",
          basePriceSnapshot: 100_000,
          preparationDeadlineSnapshotMinutes: 5,
          quantity: 1,
          discountAmount: input.itemDiscountAmount ?? 0,
          lineTotalAmount: input.subtotalAmount,
          displayOrder: 0,
        },
      },
    },
  });
}

describe("Manager administration", () => {
  it("rejects anonymous and Staff catalog writes, then audits Manager catalog lifecycle", async () => {
    const payload = { name: "مدیریت", displayOrder: 1 };
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/categories", payload })).statusCode).toBe(401);
    const staff = await session(UserRole.STAFF, "admin.staff");
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/categories", cookies: staff, payload })).statusCode).toBe(403);
    const manager = await session(UserRole.MANAGER, "admin.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/categories", cookies: manager, payload });
    expect(created.statusCode).toBe(200);
    const categoryId = created.json().data.id;
    const archived = await app.inject({ method: "POST", url: `/api/v1/admin/categories/${categoryId}/archive`, cookies: manager });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data).toMatchObject({ isActive: false });
    await expect(app.prisma.auditLog.findFirstOrThrow({ where: { entityId: categoryId, operation: "ARCHIVE_CATEGORY" } })).resolves.toBeDefined();
  });

  it("manages Staff accounts only and revokes sessions on deactivation", async () => {
    const manager = await session(UserRole.MANAGER, "accounts.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/users", cookies: manager, payload: { username: "new.staff", password: "CafePassword2026" } });
    expect(created.statusCode).toBe(200);
    const userId = created.json().data.id;
    expect(created.json().data).not.toHaveProperty("passwordHash");
    const active = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "new.staff", password: "CafePassword2026" } });
    const cookies = Object.fromEntries(active.cookies.map((cookie) => [cookie.name, cookie.value]));
    expect((await app.inject({ method: "POST", url: `/api/v1/admin/users/${userId}/deactivate`, cookies: manager })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/me", cookies })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/v1/admin/users/${userId}/reactivate`, cookies: manager })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "new.staff", password: "CafePassword2026" } })).statusCode).toBe(200);
  });

  it("configures products, option groups, tables, and settings through Manager-only routes", async () => {
    const manager = await session(UserRole.MANAGER, "catalog.manager");
    await app.prisma.cafeSettings.create({ data: { defaultTableSeatingLimitMinutes: 45 } });
    const category = await app.inject({ method: "POST", url: "/api/v1/admin/categories", cookies: manager, payload: { name: "نوشیدنی", displayOrder: 2 } });
    const group = await app.inject({ method: "POST", url: "/api/v1/admin/option-groups", cookies: manager, payload: { name: "سایز" } });
    const groupId = group.json().data.id;
    const option = await app.inject({ method: "POST", url: `/api/v1/admin/option-groups/${groupId}/options`, cookies: manager, payload: { name: "بزرگ", priceAmount: 5_000, displayOrder: 1 } });
    expect(option.statusCode).toBe(200);
    const product = await app.inject({ method: "POST", url: "/api/v1/admin/products", cookies: manager, payload: { categoryId: category.json().data.id, name: "لاته", priceAmount: 10_000, preparationDeadlineMinutes: 5, displayOrder: 1, optionGroupIds: [groupId] } });
    expect(product.statusCode).toBe(200);
    const productId = product.json().data.id;
    expect((await app.prisma.productOptionGroup.findUnique({ where: { productId_optionGroupId: { productId, optionGroupId: groupId } } }))).not.toBeNull();
    const table = await app.inject({ method: "POST", url: "/api/v1/admin/tables", cookies: manager, payload: { name: "۱۴", seatingLimitMinutes: 55, displayOrder: 14 } });
    expect(table.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/admin/tables/${table.json().data.id}/archive`, cookies: manager })).json().data).toMatchObject({ isActive: false });
    const setting = await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", cookies: manager, payload: { defaultTableSeatingLimitMinutes: 60 } });
    expect(setting.statusCode).toBe(200);
    expect(setting.json().data.defaultTableSeatingLimitMinutes).toBe(60);
  });

  it("lists retained payment settlements only for Managers with stable cursor pagination", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/payments" })).statusCode).toBe(401);
    const staff = await session(UserRole.STAFF, "payments.staff");
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/payments", cookies: staff })).statusCode).toBe(403);
    const manager = await session(UserRole.MANAGER, "payments.manager");
    const staffUser = await app.prisma.user.findUniqueOrThrow({ where: { username: "payments.staff" } });
    const managerUser = await app.prisma.user.findUniqueOrThrow({ where: { username: "payments.manager" } });
    const table = await app.prisma.cafeTable.create({ data: { name: "۱۲", displayOrder: 12 } });
    const sameTime = new Date("2026-09-09T08:00:00.000Z");
    await recordedSettlement({ orderNumber: "PAY-001", actorId: staffUser.id, recordedAt: new Date("2026-09-09T07:00:00.000Z"), amount: 10_000 });
    const second = await recordedSettlement({ orderNumber: "PAY-002", actorId: staffUser.id, recordedAt: sameTime, amount: 20_000, tableId: table.id, reversedById: managerUser.id });
    await recordedSettlement({ orderNumber: "PAY-003", actorId: managerUser.id, recordedAt: sameTime, amount: 30_000 });

    const expected = await app.prisma.paymentSettlement.findMany({ orderBy: [{ recordedAt: "desc" }, { id: "desc" }], select: { id: true } });
    const firstPage = await app.inject({ method: "GET", url: "/api/v1/admin/payments?limit=2", cookies: manager });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().meta.page).toMatchObject({ limit: 2, hasMore: true, nextCursor: expect.any(String) });
    expect(firstPage.json().data.payments.map((payment: { id: string }) => payment.id)).toEqual(expected.slice(0, 2).map((payment) => payment.id));
    expect(firstPage.json().data.payments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: second.settlement.id,
        orderId: second.order.id,
        orderNumber: "PAY-002",
        channel: "TABLE",
        table: { id: table.id, name: "۱۲" },
        totalAmount: 20_000,
        recordedBy: { id: staffUser.id, username: "payments.staff", role: "STAFF" },
        reversedAt: expect.any(String),
        payments: [{ method: "CARD_TRANSFER", amount: 20_000, reference: "REF-PAY-002" }],
        settlementReceiptPath: `/api/v1/orders/${second.order.id}/settlements/${second.settlement.id}/receipt`,
      }),
    ]));
    const secondPage = await app.inject({ method: "GET", url: `/api/v1/admin/payments?limit=2&cursor=${encodeURIComponent(firstPage.json().meta.page.nextCursor)}`, cookies: manager });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().data.payments.map((payment: { id: string }) => payment.id)).toEqual(expected.slice(2).map((payment) => payment.id));
    expect(secondPage.json().meta.page).toMatchObject({ limit: 2, hasMore: false, nextCursor: null });
    const invalidCursor = await app.inject({ method: "GET", url: "/api/v1/admin/payments?cursor=not-a-cursor", cookies: manager });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json().error.code).toBe("BAD_REQUEST");
  });

  it("returns only the requested Tehran day with sales, tenders, discounts, reversals, and deleted-order treatment", async () => {
    const staff = await session(UserRole.STAFF, "report.staff");
    const manager = await session(UserRole.MANAGER, "report.manager");
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily?period=today", cookies: staff })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily", cookies: manager })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily?period=week", cookies: manager })).statusCode).toBe(400);
    const todayEmpty = await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily?period=today", cookies: manager });
    const yesterdayEmpty = await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily?period=yesterday", cookies: manager });
    const todayStart = new Date(todayEmpty.json().meta.range.from);
    const yesterdayStart = new Date(yesterdayEmpty.json().meta.range.from);
    const category = await app.prisma.category.create({ data: { name: "Report category", displayOrder: 1 } });
    const product = await app.prisma.product.create({ data: { categoryId: category.id, name: "Report coffee", priceAmount: 100_000, preparationDeadlineMinutes: 5, displayOrder: 1 } });
    const staffUser = await app.prisma.user.findUniqueOrThrow({ where: { username: "report.staff" } });
    const managerUser = await app.prisma.user.findUniqueOrThrow({ where: { username: "report.manager" } });
    const activeOrder = await reportOrder({ orderNumber: "RPT-001", actorId: staffUser.id, productId: product.id, createdAt: new Date(todayStart.getTime() + 60 * 60_000), subtotalAmount: 90_000, totalAmount: 80_000, paidAmount: 80_000, orderDiscountAmount: 10_000, itemDiscountAmount: 10_000 });
    const reversedOrder = await reportOrder({ orderNumber: "RPT-002", actorId: staffUser.id, productId: product.id, createdAt: new Date(todayStart.getTime() + 2 * 60 * 60_000), subtotalAmount: 20_000, totalAmount: 20_000, paidAmount: 0 });
    await reportOrder({ orderNumber: "RPT-003", actorId: staffUser.id, productId: product.id, createdAt: new Date(todayStart.getTime() + 3 * 60 * 60_000), subtotalAmount: 40_000, totalAmount: 40_000, paidAmount: 40_000, deleted: true });
    const yesterdayOrder = await reportOrder({ orderNumber: "RPT-004", actorId: staffUser.id, productId: product.id, createdAt: new Date(yesterdayStart.getTime() + 60 * 60_000), subtotalAmount: 70_000, totalAmount: 70_000, paidAmount: 70_000 });
    await app.prisma.paymentSettlement.create({ data: { orderId: activeOrder.id, recordedById: staffUser.id, idempotencyKey: "report-active", totalAmount: 80_000, recordedAt: new Date(todayStart.getTime() + 4 * 60 * 60_000), payments: { create: [{ method: "CASH", amount: 30_000 }, { method: "CARD_TERMINAL", amount: 50_000 }] } } });
    const reversedSettlement = await app.prisma.paymentSettlement.create({ data: { orderId: reversedOrder.id, recordedById: staffUser.id, idempotencyKey: "report-reversed", totalAmount: 20_000, recordedAt: new Date(todayStart.getTime() + 5 * 60 * 60_000), payments: { create: { method: "CARD_TRANSFER", amount: 20_000, reference: "REPORT-REVERSAL" } } } });
    await app.prisma.settlementReversal.create({ data: { settlementId: reversedSettlement.id, recordedById: managerUser.id, reason: "Report fixture", recordedAt: new Date(todayStart.getTime() + 6 * 60 * 60_000) } });
    await app.prisma.paymentSettlement.create({ data: { orderId: yesterdayOrder.id, recordedById: staffUser.id, idempotencyKey: "report-yesterday", totalAmount: 70_000, recordedAt: new Date(yesterdayStart.getTime() + 2 * 60 * 60_000), payments: { create: { method: "CASH", amount: 70_000 } } } });

    const today = await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily?period=today", cookies: manager });
    expect(today.statusCode).toBe(200);
    expect(today.json()).toMatchObject({
      data: {
        salesAmount: 140_000,
        paidAmount: 80_000,
        orderCount: 3,
        paymentMethodTotals: { cashAmount: 30_000, cardTerminalAmount: 50_000, cardTransferAmount: 0 },
        discounts: { orderAmount: 10_000, itemAmount: 10_000, totalAmount: 20_000 },
        reversals: { count: 1, amount: 20_000 },
        deletedOrders: { count: 1, totalAmount: 40_000, paidAmount: 40_000 },
      },
      meta: { period: "today", range: { from: todayEmpty.json().meta.range.from, to: todayEmpty.json().meta.range.to } },
    });
    const yesterday = await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily?period=yesterday", cookies: manager });
    expect(yesterday.statusCode).toBe(200);
    expect(yesterday.json().data).toMatchObject({ salesAmount: 70_000, paidAmount: 70_000, orderCount: 1, paymentMethodTotals: { cashAmount: 70_000, cardTerminalAmount: 0, cardTransferAmount: 0 }, reversals: { count: 0, amount: 0 }, deletedOrders: { count: 0, totalAmount: 0, paidAmount: 0 } });
  });
});
