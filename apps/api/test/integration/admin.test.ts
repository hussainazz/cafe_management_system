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
      dailyOrderNumber: 1,
      createdById: input.actorId,
      channel: input.tableId ? "TABLE" : "TAKEAWAY",
      tableId: input.tableId ?? null,
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

  it("revokes an existing Staff session when a Manager resets its password", async () => {
    const manager = await session(UserRole.MANAGER, "password-reset.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/users", cookies: manager, payload: { username: "password-reset.staff", password: "CafePassword2026" } });
    const loggedIn = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "password-reset.staff", password: "CafePassword2026" } });
    const oldCookies = Object.fromEntries(loggedIn.cookies.map((cookie) => [cookie.name, cookie.value]));
    const updated = await app.inject({ method: "PATCH", url: `/api/v1/admin/users/${created.json().data.id}`, cookies: manager, payload: { password: "DifferentPassword2026" } });
    expect(updated.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/me", cookies: oldCookies })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "password-reset.staff", password: "DifferentPassword2026" } })).statusCode).toBe(200);
  });

  it("configures products, option groups, tables, and settings through Manager-only routes", async () => {
    const manager = await session(UserRole.MANAGER, "catalog.manager");
    const defaults = await app.inject({ method: "GET", url: "/api/v1/admin/settings", cookies: manager });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json().data.tableSeatingLimitMinutes).toBeNull();
    const category = await app.inject({ method: "POST", url: "/api/v1/admin/categories", cookies: manager, payload: { name: "نوشیدنی", displayOrder: 2 } });
    const group = await app.inject({ method: "POST", url: "/api/v1/admin/option-groups", cookies: manager, payload: { name: "سایز" } });
    const groupId = group.json().data.id;
    const option = await app.inject({ method: "POST", url: `/api/v1/admin/option-groups/${groupId}/options`, cookies: manager, payload: { name: "بزرگ", priceAmount: 5_000, displayOrder: 1 } });
    expect(option.statusCode).toBe(200);
    const product = await app.inject({ method: "POST", url: "/api/v1/admin/products", cookies: manager, payload: { categoryId: category.json().data.id, name: "لاته", priceAmount: 10_000, preparationDeadlineMinutes: 5, displayOrder: 1, optionGroups: [{ optionGroupId: groupId, displayOrder: 1, minSelections: 1, maxSelections: 1, options: [{ optionId: option.json().data.id, displayOrder: 1 }] }] } });
    expect(product.statusCode).toBe(200);
    const productId = product.json().data.id;
    expect((await app.prisma.productOptionGroup.findUnique({ where: { productId_optionGroupId: { productId, optionGroupId: groupId } } }))).not.toBeNull();
    const table = await app.inject({ method: "POST", url: "/api/v1/admin/tables", cookies: manager, payload: { name: "۱۴", displayOrder: 14 } });
    expect(table.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/admin/tables/${table.json().data.id}/archive`, cookies: manager })).json().data).toMatchObject({ isActive: false });
    const setting = await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", cookies: manager, payload: { tableSeatingLimitMinutes: 60 } });
    expect(setting.statusCode).toBe(200);
    expect(setting.json().data.tableSeatingLimitMinutes).toBe(60);
    const disabled = await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", cookies: manager, payload: { tableSeatingLimitMinutes: null } });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().data.tableSeatingLimitMinutes).toBeNull();
  });

  it("returns safe client errors for malformed paths, missing rows, duplicates, and foreign keys", async () => {
    const manager = await session(UserRole.MANAGER, "errors.manager");
    const malformed = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/categories/not-a-uuid",
      cookies: manager,
      payload: { name: "نام جدید" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("VALIDATION_ERROR");

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/categories/00000000-0000-4000-8000-000000000099",
      cookies: manager,
      payload: { name: "نام جدید" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");

    const staffPayload = { username: "duplicate.staff", password: "CafePassword2026" };
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/users", cookies: manager, payload: staffPayload })).statusCode).toBe(200);
    const duplicate = await app.inject({ method: "POST", url: "/api/v1/admin/users", cookies: manager, payload: staffPayload });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("CONFLICT");
    expect(duplicate.body).not.toContain("Unique constraint");

    const invalidReference = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      cookies: manager,
      payload: {
        categoryId: "00000000-0000-4000-8000-000000000098",
        name: "محصول بدون دسته",
        priceAmount: 10_000,
        preparationDeadlineMinutes: 5,
        displayOrder: 1,
      },
    });
    expect(invalidReference.statusCode).toBe(422);
    expect(invalidReference.json().error.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(await app.prisma.auditLog.count({ where: { requestId: invalidReference.json().error.requestId } })).toBe(0);
  });

  it("refuses to archive a table with an open table order", async () => {
    const manager = await session(UserRole.MANAGER, "archive-table.manager");
    const staffUser = await app.prisma.user.create({ data: { username: "archive-table.staff", passwordHash: await hashPassword("CafePassword2026"), role: "STAFF" } });
    const category = await app.prisma.category.create({ data: { name: "Archive guard", displayOrder: 90 } });
    const product = await app.prisma.product.create({ data: { categoryId: category.id, name: "Archive guard coffee", priceAmount: 10_000, preparationDeadlineMinutes: 5, displayOrder: 90 } });
    const table = await app.prisma.cafeTable.create({ data: { name: "Archive guard table", displayOrder: 90, occupancyState: "OCCUPIED", occupiedAt: new Date() } });
    await app.prisma.order.create({ data: { orderNumber: "ARCHIVE-GUARD-001", createdById: staffUser.id, channel: "TABLE", tableId: table.id, state: "OPEN", paymentStatus: "UNPAID", subtotalAmount: 10_000, totalAmount: 10_000, balanceAmount: 10_000, items: { create: { productId: product.id, productNameSnapshot: product.name, basePriceSnapshot: 10_000, quantity: 1, lineTotalAmount: 10_000, displayOrder: 1 } } } });
    const archived = await app.inject({ method: "POST", url: `/api/v1/admin/tables/${table.id}/archive`, cookies: manager });
    expect(archived.statusCode).toBe(409);
    expect((await app.prisma.cafeTable.findUniqueOrThrow({ where: { id: table.id } })).isActive).toBe(true);
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
        dailyOrderNumber: 1,
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
        paidAmount: 100_000,
        orderCount: 3,
        paymentMethodTotals: { cashAmount: 30_000, cardTerminalAmount: 50_000, cardTransferAmount: 20_000 },
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

  it("keeps yesterday's tender while reporting its reversal today", async () => {
    const manager = await session(UserRole.MANAGER, "cross-day.manager");
    const staffUser = await app.prisma.user.create({ data: { username: "cross-day.staff", passwordHash: await hashPassword("CafePassword2026"), role: "STAFF" } });
    const managerUser = await app.prisma.user.findUniqueOrThrow({ where: { username: "cross-day.manager" } });
    const emptyToday = await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily?period=today", cookies: manager });
    const emptyYesterday = await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily?period=yesterday", cookies: manager });
    const settlement = await recordedSettlement({ orderNumber: "CROSS-DAY-001", actorId: staffUser.id, recordedAt: new Date(new Date(emptyYesterday.json().meta.range.from).getTime() + 3_600_000), amount: 12_000 });
    await app.prisma.settlementReversal.create({ data: { settlementId: settlement.settlement.id, recordedById: managerUser.id, reason: "Next-day correction", recordedAt: new Date(new Date(emptyToday.json().meta.range.from).getTime() + 3_600_000) } });
    const yesterday = await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily?period=yesterday", cookies: manager });
    const today = await app.inject({ method: "GET", url: "/api/v1/admin/reports/daily?period=today", cookies: manager });
    expect(yesterday.json().data).toMatchObject({ paidAmount: 12_000, paymentMethodTotals: { cardTransferAmount: 12_000 }, reversals: { count: 0, amount: 0 } });
    expect(today.json().data.reversals).toMatchObject({ count: 1, amount: 12_000 });
  });

  it("lists safe filtered audit history only for Managers with stable cursors", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/audit-log" })).statusCode).toBe(401);
    const staff = await session(UserRole.STAFF, "audit.staff");
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/audit-log", cookies: staff })).statusCode).toBe(403);
    const manager = await session(UserRole.MANAGER, "audit.manager");
    const staffUser = await app.prisma.user.findUniqueOrThrow({ where: { username: "audit.staff" } });
    const category = await app.prisma.category.create({ data: { name: "Audit category", displayOrder: 1 } });
    const otherCategory = await app.prisma.category.create({ data: { name: "Other audit category", displayOrder: 2 } });
    const sameTime = new Date("2026-09-09T12:00:00.000Z");
    await app.prisma.auditLog.create({ data: { actorId: staffUser.id, requestId: "audit-event-0001", operation: "UPDATE_CATEGORY", entityType: "CATEGORY", entityId: category.id, reason: "Corrected name", afterSnapshot: { secret: "must-not-leak" }, occurredAt: new Date("2026-09-09T11:00:00.000Z") } });
    await app.prisma.auditLog.create({ data: { actorId: staffUser.id, requestId: "audit-event-0002", operation: "ARCHIVE_CATEGORY", entityType: "CATEGORY", entityId: category.id, beforeSnapshot: { secret: "must-not-leak" }, occurredAt: sameTime } });
    await app.prisma.auditLog.create({ data: { requestId: "audit-event-0003", operation: "CREATE_CATEGORY", entityType: "CATEGORY", entityId: otherCategory.id, occurredAt: sameTime } });
    const expected = await app.prisma.auditLog.findMany({ orderBy: [{ occurredAt: "desc" }, { id: "desc" }], select: { id: true } });
    const firstPage = await app.inject({ method: "GET", url: "/api/v1/admin/audit-log?limit=2", cookies: manager });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().data.entries.map((entry: { id: string }) => entry.id)).toEqual(expected.slice(0, 2).map((entry) => entry.id));
    expect(firstPage.json().data.entries).toEqual(expect.arrayContaining([expect.objectContaining({ actor: { id: staffUser.id, username: "audit.staff", role: "STAFF" }, operation: "ARCHIVE_CATEGORY", entityId: category.id, reason: null, occurredAt: sameTime.toISOString() })]));
    expect(JSON.stringify(firstPage.json().data)).not.toContain("must-not-leak");
    const secondPage = await app.inject({ method: "GET", url: `/api/v1/admin/audit-log?limit=2&cursor=${encodeURIComponent(firstPage.json().meta.page.nextCursor)}`, cookies: manager });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().data.entries.map((entry: { id: string }) => entry.id)).toEqual(expected.slice(2).map((entry) => entry.id));
    for (const sortDirection of ["asc", "desc"] as const) {
      const actorPage = await app.inject({ method: "GET", url: `/api/v1/admin/audit-log?limit=1&sortBy=actor&sortDirection=${sortDirection}`, cookies: manager });
      expect(actorPage.statusCode).toBe(200);
      const actorNext = await app.inject({ method: "GET", url: `/api/v1/admin/audit-log?limit=1&sortBy=actor&sortDirection=${sortDirection}&cursor=${encodeURIComponent(actorPage.json().meta.page.nextCursor)}`, cookies: manager });
      expect(actorNext.statusCode).toBe(200);
    }
    const filtered = await app.inject({ method: "GET", url: `/api/v1/admin/audit-log?entityType=CATEGORY&entityId=${category.id}&actorId=${staffUser.id}&operation=UPDATE_CATEGORY`, cookies: manager });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().data.entries).toHaveLength(1);
    expect(filtered.json().data.entries[0]).toMatchObject({ operation: "UPDATE_CATEGORY", entityId: category.id });
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/audit-log?cursor=not-a-cursor", cookies: manager })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/audit-log?from=2026-09-10T00:00:00.000Z&to=2026-09-09T00:00:00.000Z", cookies: manager })).statusCode).toBe(400);
  });
});
