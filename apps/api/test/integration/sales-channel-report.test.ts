import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { SalesChannelReportResponseSchema } from "@cafe/contracts";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

type Cookies = Record<string, string>;
async function login(role: "MANAGER" | "STAFF") {
  const username = `${role.toLowerCase()}.${randomUUID()}`;
  await app.prisma.user.create({ data: { username, role, passwordHash: await hashPassword("CafePassword2026") } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  expect(response.statusCode, response.body).toBe(200);
  return Object.fromEntries(response.cookies.map(({ name, value }) => [name, value]));
}

async function product(name: string, priceAmount: number, systemKey: string | null = null) {
  const category = await app.prisma.category.create({ data: { name: `${name} category ${randomUUID()}`, displayOrder: 1 } });
  return app.prisma.product.create({ data: {
    categoryId: category.id,
    name,
    priceAmount,
    systemKey,
    isPublic: systemKey === null,
    preparationDeadlineMinutes: 1,
    displayOrder: 1,
  } });
}

async function table() {
  return app.prisma.cafeTable.create({ data: { name: `Table ${randomUUID()}`, displayOrder: 1 } });
}

async function createOrder(cookies: Cookies, channel: "TABLE" | "TAKEAWAY", items: Array<{ productId: string; quantity: number }>, tableId?: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/orders",
    cookies,
    headers: { "idempotency-key": randomUUID() },
    payload: {
      channel,
      ...(channel === "TABLE" ? { tableId } : {}),
      items: items.map((item) => ({ ...item, options: [] })),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data;
}

async function settle(cookies: Cookies, order: any, amount = order.balanceAmount) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/orders/${order.id}/record-settlement`,
    cookies,
    headers: { "idempotency-key": randomUUID() },
    payload: {
      expectedVersion: order.version,
      allocationMode: "AMOUNT",
      amount,
      payments: [{ method: "CASH", amount }],
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data;
}

async function recordPaidAt(orderId: string, recordedAt: string) {
  await app.prisma.paymentSettlement.updateMany({ where: { orderId }, data: { recordedAt: new Date(recordedAt) } });
}

async function readReport(cookies: Cookies, fromDate = "2026-11-10", toDate = fromDate) {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/admin/reports/sales-channels?fromDate=${fromDate}&toDate=${toDate}`,
    cookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return SalesChannelReportResponseSchema.parse(response.json());
}

describe("Manager takeaway and dine-in sales report", () => {
  it("classifies orders by original channel and structured packaging identity, once per order", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const espresso = await product("Espresso", 10_000);
    const meal = await product("Meal", 40_000);
    const packing = await product("Hidden service line", 5_000, "PACKING");
    const lookalike = await product("بسته‌بندی", 3_000);
    const sharedTable = await table();

    const direct = await createOrder(staff, "TAKEAWAY", [
      { productId: espresso.id, quantity: 1 },
      { productId: packing.id, quantity: 1 },
      { productId: packing.id, quantity: 1 },
    ]);
    const directPaid = await settle(staff, direct);
    await recordPaidAt(direct.id, "2026-11-10T10:00:00.000Z");

    const tablePackaged = await createOrder(staff, "TABLE", [
      { productId: meal.id, quantity: 1 },
      { productId: packing.id, quantity: 1 },
      { productId: packing.id, quantity: 1 },
    ], sharedTable.id);
    expect(tablePackaged.totalAmount).toBe(50_000);
    const discounted = await app.inject({
      method: "PATCH",
      url: `/api/v1/orders/${tablePackaged.id}`,
      cookies: staff,
      payload: { expectedVersion: tablePackaged.version, orderDiscount: { kind: "FIXED", value: 5_000 } },
    });
    expect(discounted.statusCode, discounted.body).toBe(200);
    expect(discounted.json().data.totalAmount).toBe(45_000);
    const tablePackagedPaid = await settle(staff, discounted.json().data);
    await recordPaidAt(tablePackaged.id, "2026-11-10T11:00:00.000Z");
    await app.prisma.order.update({ where: { id: tablePackaged.id }, data: { tableId: null } });

    const dineIn = await createOrder(staff, "TABLE", [{ productId: meal.id, quantity: 1 }], sharedTable.id);
    await settle(staff, dineIn);
    await recordPaidAt(dineIn.id, "2026-11-10T12:00:00.000Z");

    const namedLikePackaging = await createOrder(staff, "TABLE", [
      { productId: meal.id, quantity: 1 },
      { productId: lookalike.id, quantity: 1 },
    ], sharedTable.id);
    await settle(staff, namedLikePackaging);
    await recordPaidAt(namedLikePackaging.id, "2026-11-10T13:00:00.000Z");

    const response = await readReport(manager);
    expect(response.data).toEqual({
      orderDistribution: {
        totalCount: 4,
        takeawayCount: 2,
        dineInCount: 2,
        takeawayPercent: "50.00",
        dineInPercent: "50.00",
      },
      averageOrderValue: {
        takeawayAmount: 32_500,
        dineInAmount: 41_500,
        absoluteDifferenceAmount: 9_000,
        differencePercent: "21.69",
      },
      revenue: {
        totalAmount: 148_000,
        takeawayAmount: 65_000,
        dineInAmount: 83_000,
        takeawayPercent: "43.92",
        dineInPercent: "56.08",
      },
      takeawayOrigin: {
        directTakeawayCount: 1,
        tableOriginatedTakeawayCount: 1,
        directTakeawayRevenueAmount: 20_000,
        tableOriginatedTakeawayRevenueAmount: 45_000,
      },
      unclassifiedHistoricalOrigin: { count: 0, revenueAmount: 0 },
    });
    expect(response.data.orderDistribution.takeawayCount + response.data.orderDistribution.dineInCount).toBe(response.data.orderDistribution.totalCount);
    expect(response.data.takeawayOrigin.directTakeawayCount + response.data.takeawayOrigin.tableOriginatedTakeawayCount).toBe(response.data.orderDistribution.takeawayCount);
    expect(response.meta.range).toMatchObject({ from: "2026-11-09T20:30:00.000Z", to: "2026-11-10T20:30:00.000Z" });
    expect(directPaid.state).toBe("CLOSED");
    expect(tablePackagedPaid.state).toBe("CLOSED");
  });

  it("uses the channel fallback for ordinary legacy orders without a saved origin", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const espresso = await product("Legacy fallback espresso", 10_000);
    const packing = await product("Legacy fallback packaging", 2_000, "PACKING");
    const direct = await createOrder(staff, "TAKEAWAY", [{ productId: espresso.id, quantity: 1 }]);
    const tablePackaged = await createOrder(staff, "TABLE", [
      { productId: espresso.id, quantity: 1 },
      { productId: packing.id, quantity: 1 },
    ], (await table()).id);
    const tableDineIn = await createOrder(staff, "TABLE", [{ productId: espresso.id, quantity: 1 }], (await table()).id);

    for (const [order, hour] of [[direct, 10], [tablePackaged, 11], [tableDineIn, 12]] as const) {
      await app.prisma.order.update({ where: { id: order.id }, data: { inventorySaleChannel: null } });
      await settle(staff, order);
      await recordPaidAt(order.id, `2026-11-10T${hour}:00:00.000Z`);
    }

    const report = await readReport(manager);
    expect(report.data.orderDistribution).toMatchObject({ totalCount: 3, takeawayCount: 2, dineInCount: 1, takeawayPercent: "66.67", dineInPercent: "33.33" });
    expect(report.data.takeawayOrigin).toEqual({ directTakeawayCount: 1, tableOriginatedTakeawayCount: 1, directTakeawayRevenueAmount: 10_000, tableOriginatedTakeawayRevenueAmount: 12_000 });
    expect(report.data.unclassifiedHistoricalOrigin).toEqual({ count: 0, revenueAmount: 0 });
  });

  it("excludes unpaid, partially paid, fully reversed, deleted and staff-consumption records", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const espresso = await product("Eligible espresso", 10_000);
    const packing = await product("Packaging", 2_000, "PACKING");
    const unpaid = await createOrder(staff, "TAKEAWAY", [{ productId: espresso.id, quantity: 1 }, { productId: packing.id, quantity: 1 }]);
    const partial = await createOrder(staff, "TAKEAWAY", [{ productId: espresso.id, quantity: 1 }, { productId: packing.id, quantity: 1 }]);
    const partialPaid = await settle(staff, partial, 1_000);
    await recordPaidAt(partial.id, "2026-11-10T10:00:00.000Z");

    const reversed = await createOrder(staff, "TAKEAWAY", [{ productId: espresso.id, quantity: 1 }, { productId: packing.id, quantity: 1 }]);
    const reversedPaid = await settle(staff, reversed);
    await recordPaidAt(reversed.id, "2026-11-10T10:00:00.000Z");
    expect((await readReport(manager)).data.orderDistribution.totalCount).toBe(1);
    const settlement = await app.prisma.paymentSettlement.findFirstOrThrow({ where: { orderId: reversed.id } });
    const reversal = await app.inject({
      method: "POST",
      url: `/api/v1/admin/settlements/${settlement.id}/reverse`,
      cookies: manager,
      payload: { expectedVersion: reversedPaid.version },
    });
    expect(reversal.statusCode, reversal.body).toBe(200);

    const deleted = await createOrder(staff, "TAKEAWAY", [{ productId: espresso.id, quantity: 1 }, { productId: packing.id, quantity: 1 }]);
    const deletedPaid = await settle(staff, deleted);
    await recordPaidAt(deleted.id, "2026-11-10T11:00:00.000Z");
    expect((await readReport(manager)).data.orderDistribution.totalCount).toBe(1);
    const removal = await app.inject({ method: "POST", url: `/api/v1/orders/${deleted.id}/delete`, cookies: staff, payload: { expectedVersion: deletedPaid.version } });
    expect(removal.statusCode, removal.body).toBe(200);

    const staffConsumption = await app.inject({
      method: "POST",
      url: "/api/v1/staff-consumption",
      cookies: manager,
      headers: { "idempotency-key": randomUUID() },
      payload: { channel: "TAKEAWAY", items: [{ productId: espresso.id, quantity: 1, options: [] }] },
    });
    expect(staffConsumption.statusCode, staffConsumption.body).toBe(201);
    const staffOrder = await app.prisma.order.findUniqueOrThrow({ where: { id: staffConsumption.json().data.id } });
    expect(staffOrder).toMatchObject({ isStaffConsumption: true, state: "CLOSED", paymentStatus: "PAID" });
    const managerUser = await app.prisma.user.findFirstOrThrow({ where: { role: "MANAGER" } });
    const staffOrderItem = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId: staffOrder.id } });
    await app.prisma.paymentSettlement.create({ data: {
      orderId: staffOrder.id,
      recordedById: managerUser.id,
      idempotencyKey: randomUUID(),
      totalAmount: staffOrder.totalAmount,
      recordedAt: new Date("2026-11-10T12:00:00.000Z"),
      allocationMode: "AMOUNT",
      allocations: { create: [{ orderItemId: staffOrderItem.id, quantity: 0, amount: staffOrder.totalAmount }] },
      payments: { create: [{ method: "CASH", amount: staffOrder.totalAmount }] },
    } });

    const response = await readReport(manager);
    expect(response.data.orderDistribution).toMatchObject({ totalCount: 0, takeawayCount: 0, dineInCount: 0, takeawayPercent: null, dineInPercent: null });
    expect(response.data.revenue).toMatchObject({ totalAmount: 0, takeawayAmount: 0, dineInAmount: 0, takeawayPercent: null, dineInPercent: null });
    expect(response.data.averageOrderValue).toEqual({ takeawayAmount: null, dineInAmount: null, absoluteDifferenceAmount: null, differencePercent: null });
    expect(response.data.takeawayOrigin).toMatchObject({ directTakeawayCount: 0, tableOriginatedTakeawayCount: 0 });
    expect(response.data.unclassifiedHistoricalOrigin).toEqual({ count: 0, revenueAmount: 0 });
    expect(unpaid.paymentStatus).toBe("UNPAID");
    expect(partialPaid.paymentStatus).toBe("PARTIALLY_PAID");
  });

  it("uses the final active settlement time and Tehran half-open date boundaries", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const espresso = await product("Boundary espresso", 10_000);
    const partialOrder = await createOrder(staff, "TAKEAWAY", [{ productId: espresso.id, quantity: 1 }]);
    const firstPayment = await settle(staff, partialOrder, 2_000);
    const firstSettlement = await app.prisma.paymentSettlement.findFirstOrThrow({ where: { orderId: partialOrder.id } });
    const finalPayment = await settle(staff, firstPayment, 8_000);
    expect(finalPayment.paymentStatus).toBe("PAID");
    await app.prisma.paymentSettlement.update({ where: { id: firstSettlement.id }, data: { recordedAt: new Date("2026-11-09T20:29:59.999Z") } });
    const finalSettlement = await app.prisma.paymentSettlement.findFirstOrThrow({ where: { orderId: partialOrder.id, id: { not: firstSettlement.id } } });
    await app.prisma.paymentSettlement.update({ where: { id: finalSettlement.id }, data: { recordedAt: new Date("2026-11-09T20:30:00.000Z") } });

    const nextDayOrder = await createOrder(staff, "TAKEAWAY", [{ productId: espresso.id, quantity: 1 }]);
    await settle(staff, nextDayOrder);
    await recordPaidAt(nextDayOrder.id, "2026-11-10T20:30:00.000Z");
    await app.prisma.order.updateMany({ where: { id: { in: [partialOrder.id, nextDayOrder.id] } }, data: { createdAt: new Date("2026-11-01T00:00:00.000Z") } });

    const dayTen = await readReport(manager, "2026-11-10");
    expect(dayTen.data.orderDistribution).toMatchObject({ totalCount: 1, takeawayCount: 1, dineInCount: 0 });
    expect(dayTen.data.revenue).toMatchObject({ totalAmount: 10_000, takeawayAmount: 10_000, dineInAmount: 0 });
    const dayNine = await readReport(manager, "2026-11-09");
    expect(dayNine.data.orderDistribution.totalCount).toBe(0);
    const dayEleven = await readReport(manager, "2026-11-11");
    expect(dayEleven.data.orderDistribution).toMatchObject({ totalCount: 1, takeawayCount: 1, dineInCount: 0 });
  });

  it("reports a repaid order once using its replacement settlement and final active date", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const espresso = await product("Replacement settlement espresso", 10_000);
    const order = await createOrder(staff, "TAKEAWAY", [{ productId: espresso.id, quantity: 1 }]);
    const originalPayment = await settle(staff, order);
    const originalSettlement = await app.prisma.paymentSettlement.findFirstOrThrow({ where: { orderId: order.id } });
    await app.prisma.paymentSettlement.update({ where: { id: originalSettlement.id }, data: { recordedAt: new Date("2026-11-09T12:00:00.000Z") } });

    const reversed = await app.inject({
      method: "POST",
      url: `/api/v1/admin/settlements/${originalSettlement.id}/reverse`,
      cookies: manager,
      payload: { expectedVersion: originalPayment.version, reason: "Report replacement fixture" },
    });
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(reversed.json().data).toMatchObject({ state: "OPEN", paymentStatus: "UNPAID" });

    const repaid = await settle(staff, reversed.json().data);
    const replacement = await app.prisma.paymentSettlement.findFirstOrThrow({ where: { orderId: order.id, id: { not: originalSettlement.id } } });
    await app.prisma.paymentSettlement.update({ where: { id: replacement.id }, data: { recordedAt: new Date("2026-11-10T12:00:00.000Z") } });

    const dayNine = await readReport(manager, "2026-11-09");
    expect(dayNine.data.orderDistribution.totalCount).toBe(0);
    const dayTen = await readReport(manager, "2026-11-10");
    expect(dayTen.data.orderDistribution).toMatchObject({ totalCount: 1, takeawayCount: 1, dineInCount: 0 });
    expect(dayTen.data.averageOrderValue).toMatchObject({ takeawayAmount: 10_000, dineInAmount: null });
    expect(dayTen.data.revenue).toMatchObject({ totalAmount: 10_000, takeawayAmount: 10_000, dineInAmount: 0 });
    expect(await app.prisma.paymentSettlement.count({ where: { orderId: order.id, reversal: null } })).toBe(1);
    expect(repaid.state).toBe("CLOSED");
  });

  it("stops classifying a table order as takeaway after its packaging line is removed", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const espresso = await product("Removable packaging espresso", 10_000);
    const packing = await product("Removable packaging item", 5_000, "PACKING");
    const currentTable = await table();
    const order = await createOrder(staff, "TABLE", [
      { productId: espresso.id, quantity: 1 },
      { productId: packing.id, quantity: 1 },
    ], currentTable.id);
    const itemPaid = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies: staff,
      headers: { "idempotency-key": randomUUID() },
      payload: {
        expectedVersion: order.version,
        allocations: [{ orderItemId: order.items[0].id, quantity: 1 }],
        payments: [{ method: "CASH", amount: 10_000 }],
      },
    });
    expect(itemPaid.statusCode, itemPaid.body).toBe(201);
    const removed = await app.inject({
      method: "PATCH",
      url: `/api/v1/orders/${order.id}`,
      cookies: staff,
      payload: { expectedVersion: itemPaid.json().data.version, itemUpdates: [{ orderItemId: order.items[1].id, quantity: 0 }] },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    await recordPaidAt(order.id, "2026-11-10T10:00:00.000Z");
    expect(removed.json().data).toMatchObject({ totalAmount: 10_000, paymentStatus: "PAID", state: "CLOSED" });
    const report = await readReport(manager);
    expect(report.data.orderDistribution).toMatchObject({ totalCount: 1, takeawayCount: 0, dineInCount: 1, takeawayPercent: "0.00", dineInPercent: "100.00" });
    expect(report.data.takeawayOrigin).toMatchObject({ directTakeawayCount: 0, tableOriginatedTakeawayCount: 0 });
  });

  it("uses the saved original channel after a table order is set aside", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const espresso = await product("Deferred channel espresso", 10_000);
    const packing = await product("Deferred channel packaging", 2_000, "PACKING");

    const packagedTableOrder = await createOrder(staff, "TABLE", [
      { productId: espresso.id, quantity: 1 },
      { productId: packing.id, quantity: 1 },
    ], (await table()).id);
    const deferredPackaged = await app.inject({ method: "POST", url: `/api/v1/orders/${packagedTableOrder.id}/defer`, cookies: staff, payload: { expectedVersion: packagedTableOrder.version } });
    expect(deferredPackaged.statusCode, deferredPackaged.body).toBe(200);
    expect(deferredPackaged.json().data.channel).toBe("TAKEAWAY");
    expect(await app.prisma.order.findUniqueOrThrow({ where: { id: packagedTableOrder.id }, select: { inventorySaleChannel: true } })).toEqual({ inventorySaleChannel: "TABLE" });
    await settle(staff, deferredPackaged.json().data);
    await recordPaidAt(packagedTableOrder.id, "2026-11-10T10:00:00.000Z");

    const dineInTableOrder = await createOrder(staff, "TABLE", [{ productId: espresso.id, quantity: 1 }], (await table()).id);
    const deferredDineIn = await app.inject({ method: "POST", url: `/api/v1/orders/${dineInTableOrder.id}/defer`, cookies: staff, payload: { expectedVersion: dineInTableOrder.version } });
    expect(deferredDineIn.statusCode, deferredDineIn.body).toBe(200);
    await settle(staff, deferredDineIn.json().data);
    await recordPaidAt(dineInTableOrder.id, "2026-11-10T11:00:00.000Z");

    const report = await readReport(manager);
    expect(report.data.orderDistribution).toMatchObject({ totalCount: 2, takeawayCount: 1, dineInCount: 1, takeawayPercent: "50.00", dineInPercent: "50.00" });
    expect(report.data.takeawayOrigin).toMatchObject({ directTakeawayCount: 0, tableOriginatedTakeawayCount: 1, directTakeawayRevenueAmount: 0, tableOriginatedTakeawayRevenueAmount: 12_000 });
    expect(report.data.revenue).toMatchObject({ totalAmount: 22_000, takeawayAmount: 12_000, dineInAmount: 10_000 });
  });

  it("surfaces legacy deferred orders whose original channel was never saved", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const espresso = await product("Legacy deferred espresso", 10_000);
    const legacy = await createOrder(staff, "TABLE", [{ productId: espresso.id, quantity: 1 }], (await table()).id);
    await settle(staff, legacy);
    await app.prisma.order.update({ where: { id: legacy.id }, data: { channel: "TAKEAWAY", inventorySaleChannel: null, tableId: null, deferredAt: new Date("2026-11-01T12:00:00.000Z") } });
    await recordPaidAt(legacy.id, "2026-11-10T10:00:00.000Z");

    const report = await readReport(manager);
    expect(report.data.orderDistribution).toMatchObject({ totalCount: 0, takeawayCount: 0, dineInCount: 0 });
    expect(report.data.revenue).toMatchObject({ totalAmount: 0, takeawayAmount: 0, dineInAmount: 0 });
    expect(report.data.unclassifiedHistoricalOrigin).toEqual({ count: 1, revenueAmount: 10_000 });
  });

  it("denies Staff and rejects a reversed date range", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const forbidden = await app.inject({ method: "GET", url: "/api/v1/admin/reports/sales-channels?fromDate=2026-11-10&toDate=2026-11-10", cookies: staff });
    expect(forbidden.statusCode).toBe(403);
    const invalid = await app.inject({ method: "GET", url: "/api/v1/admin/reports/sales-channels?fromDate=2026-11-11&toDate=2026-11-10", cookies: manager });
    expect(invalid.statusCode).toBe(400);
  });

  it("keeps the dine-in AOV and its comparison undefined when the period has only takeaway orders", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const espresso = await product("Takeaway-only espresso", 10_001);
    const discountedEspresso = await product("Takeaway-only discounted espresso", 10_000);
    const first = await createOrder(staff, "TAKEAWAY", [{ productId: espresso.id, quantity: 1 }]);
    await settle(staff, first);
    await recordPaidAt(first.id, "2026-11-10T10:00:00.000Z");
    const second = await createOrder(staff, "TAKEAWAY", [{ productId: discountedEspresso.id, quantity: 1 }]);
    await settle(staff, second);
    await recordPaidAt(second.id, "2026-11-10T11:00:00.000Z");

    const response = await readReport(manager);
    expect(response.data.orderDistribution).toMatchObject({ totalCount: 2, takeawayCount: 2, dineInCount: 0, takeawayPercent: "100.00", dineInPercent: "0.00" });
    expect(response.data.averageOrderValue).toEqual({ takeawayAmount: 10_001, dineInAmount: null, absoluteDifferenceAmount: null, differencePercent: null });
    expect(response.data.revenue).toMatchObject({ totalAmount: 20_001, takeawayAmount: 20_001, dineInAmount: 0, takeawayPercent: "100.00", dineInPercent: "0.00" });
    expect(response.data.unclassifiedHistoricalOrigin).toEqual({ count: 0, revenueAmount: 0 });
  });
});
