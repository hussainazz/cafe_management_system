import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SalesAnalyticsResponseSchema } from "@cafe/contracts";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

type Cookies = Record<string, string>;
async function login(role: "MANAGER" | "STAFF"): Promise<Cookies> {
  const username = `${role.toLowerCase()}.${randomUUID()}`;
  await app.prisma.user.create({ data: { username, role, passwordHash: await hashPassword("CafePassword2026") } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  expect(response.statusCode, response.body).toBe(200);
  return Object.fromEntries(response.cookies.map(({ name, value }) => [name, value]));
}

describe("Manager sales analytics", () => {
  it("keeps order demand, first item entry, and financial recognition on their Tehran-local timestamps", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const category = await app.prisma.category.create({ data: { name: `Analytics ${randomUUID()}`, displayOrder: 1 } });
    const product = await app.prisma.product.create({ data: {
      categoryId: category.id, name: "Analytics drink", priceAmount: 10_000,
      preparationDeadlineMinutes: 1, displayOrder: 1,
    } });
    const group = await app.prisma.optionGroup.create({ data: { name: `Analytics size ${randomUUID()}` } });
    const optionA = await app.prisma.option.create({ data: { optionGroupId: group.id, name: "A", priceAmount: 0, displayOrder: 1 } });
    const optionB = await app.prisma.option.create({ data: { optionGroupId: group.id, name: "B", priceAmount: 0, displayOrder: 2 } });
    await app.prisma.productOptionGroup.create({ data: {
      productId: product.id, optionGroupId: group.id, displayOrder: 1, minSelections: 1, maxSelections: 1,
      allowedOptions: { create: [{ optionId: optionA.id, displayOrder: 1 }, { optionId: optionB.id, displayOrder: 2 }] },
    } });

    const created = await app.inject({
      method: "POST", url: "/api/v1/orders", cookies: staff,
      headers: { "idempotency-key": randomUUID() },
      payload: { channel: "TAKEAWAY", items: [
        { productId: product.id, quantity: 2, options: [{ optionId: optionA.id, quantity: 2 }] },
        { productId: product.id, quantity: 1, options: [{ optionId: optionB.id, quantity: 1 }] },
      ] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const initial = created.json().data;
    const discounted = await app.inject({
      method: "PATCH", url: `/api/v1/orders/${initial.id}`, cookies: staff,
      payload: { expectedVersion: initial.version, orderDiscount: { kind: "FIXED", value: 3_000 } },
    });
    expect(discounted.statusCode, discounted.body).toBe(200);
    expect(discounted.json().data.totalAmount).toBe(27_000);
    const paid = await app.inject({
      method: "POST", url: `/api/v1/orders/${initial.id}/record-settlement`, cookies: staff,
      headers: { "idempotency-key": randomUUID() },
      payload: { expectedVersion: discounted.json().data.version, allocationMode: "AMOUNT", amount: 27_000, payments: [{ method: "CASH", amount: 27_000 }] },
    });
    expect(paid.statusCode, paid.body).toBe(201);

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: initial.id }, include: { items: { orderBy: { displayOrder: "asc" } } } });
    await app.prisma.order.update({ where: { id: order.id }, data: { createdAt: new Date("2026-11-10T20:35:00.000Z") } });
    await app.prisma.orderItem.update({ where: { id: order.items[0]!.id }, data: { enteredAt: new Date("2026-11-10T20:50:00.000Z") } });
    await app.prisma.orderItem.update({ where: { id: order.items[1]!.id }, data: { enteredAt: new Date("2026-11-10T21:02:00.000Z") } });
    await app.prisma.orderConsumption.updateMany({ where: { orderId: order.id }, data: { recognizedAt: new Date("2026-11-11T18:30:00.000Z") } });

    const path = "/api/v1/admin/reports/sales-analytics?fromDate=2026-11-10&toDate=2026-11-11&intervalMinutes=30";
    const response = await app.inject({ method: "GET", url: path, cookies: manager });
    expect(response.statusCode, response.body).toBe(200);
    const report = SalesAnalyticsResponseSchema.parse(response.json());
    expect(report.meta.intervalMinutes).toBe(30);
    expect(report.data.operationalBuckets).toHaveLength(7 * 48);
    expect(report.data.financialBuckets).toHaveLength(7 * 48);
    expect(report.data.overview.operationalDemand).toMatchObject({ orderCount: 1, itemUnits: 3, netSalesAmount: 27_000, itemEntryFallbackCount: 0 });
    expect(report.data.overview.financialRecognition).toMatchObject({
      orderCount: 1, itemUnits: 3, netSalesAmount: 27_000, incompleteCostItemCount: 2,
      totalContributionAmount: null, isCostComplete: false,
    });

    const orderTime = report.data.operationalBuckets.find((row) => row.dayOfWeek === 4 && row.hour === 0 && row.minute === 0)!;
    const secondEntryTime = report.data.operationalBuckets.find((row) => row.dayOfWeek === 4 && row.hour === 0 && row.minute === 30)!;
    const recognitionTime = report.data.financialBuckets.find((row) => row.dayOfWeek === 4 && row.hour === 22 && row.minute === 0)!;
    const emptyBucket = report.data.financialBuckets.find((row) => row.dayOfWeek === 1 && row.hour === 1 && row.minute === 0)!;
    const beforeOpeningBucket = report.data.financialBuckets.find((row) => row.dayOfWeek === 1 && row.hour === 7 && row.minute === 30)!;
    const openEmptyBucket = report.data.financialBuckets.find((row) => row.dayOfWeek === 1 && row.hour === 8 && row.minute === 0)!;
    const lastOpenBucket = report.data.financialBuckets.find((row) => row.dayOfWeek === 1 && row.hour === 23 && row.minute === 30)!;
    expect(orderTime).toMatchObject({ orderCount: 1, itemUnits: 2, netSalesAmount: 18_000 });
    expect(secondEntryTime).toMatchObject({ orderCount: 0, itemUnits: 1, netSalesAmount: 9_000 });
    expect(recognitionTime).toMatchObject({ orderCount: 1, itemUnits: 3, netSalesAmount: 27_000, incompleteCostItemCount: 2, totalContributionAmount: null });
    expect(orderTime).toMatchObject({ isScheduledOpen: false, closureKnown: true });
    expect(recognitionTime).toMatchObject({ isScheduledOpen: true, closureKnown: true });
    expect(emptyBucket).toMatchObject({ orderCount: 0, itemUnits: 0, netSalesAmount: 0, hasSales: false, isScheduledOpen: false, closureKnown: true });
    expect(beforeOpeningBucket).toMatchObject({ hasSales: false, isScheduledOpen: false, closureKnown: true });
    expect(openEmptyBucket).toMatchObject({ hasSales: false, isScheduledOpen: true, closureKnown: true });
    expect(lastOpenBucket).toMatchObject({ isScheduledOpen: true, closureKnown: true });
    expect(report.data.timeSemantics.operatingSchedule).toEqual({ opensAtHour: 8, closesAtHour: 0, hoursPerDay: 16 });
    expect(report.data.insights.operatingHoursPerDay).toBe(16);
    expect(report.data.insights.operatingHoursInRange).toBe(32);
    expect(report.data.insights.contributionPerOperatingHourAmount).toBe(report.data.overview.financialRecognition.completeCostRevenueAmount > 0
      ? Math.trunc(report.data.overview.financialRecognition.knownContributionAmount / 32)
      : null);
    expect(report.data.financialBuckets.reduce((sum, row) => sum + row.netSalesAmount, 0)).toBe(report.data.overview.financialRecognition.netSalesAmount);
    expect(report.data.productDemandSeries).toEqual(expect.arrayContaining([
      expect.objectContaining({ hour: 0, minute: 0, productId: product.id, options: [expect.objectContaining({ optionId: optionA.id, quantity: 1 })], quantitySold: 2, uniqueOrdersContainingProduct: 1 }),
      expect.objectContaining({ hour: 0, minute: 30, productId: product.id, options: [expect.objectContaining({ optionId: optionB.id, quantity: 1 })], quantitySold: 1, uniqueOrdersContainingProduct: 1 }),
    ]));

    const filteredParams = new URLSearchParams({ fromDate: "2026-11-10", toDate: "2026-11-11", intervalMinutes: "30", channel: "TAKEAWAY", daysOfWeek: "4" });
    filteredParams.append("productIds", product.id);
    filteredParams.append("categoryIds", category.id);
    filteredParams.append("optionIds", optionA.id);
    const filtered = await app.inject({ method: "GET", url: `/api/v1/admin/reports/sales-analytics?${filteredParams}`, cookies: manager });
    expect(filtered.statusCode, filtered.body).toBe(200);
    const optionReport = SalesAnalyticsResponseSchema.parse(filtered.json()).data;
    expect(optionReport.overview.operationalDemand).toMatchObject({ itemUnits: 2, netSalesAmount: 18_000 });
    expect(optionReport.insights.operatingHoursPerDay).toBe(16);
    expect(optionReport.insights.operatingHoursInRange).toBe(16);
    expect(optionReport.productDemandSeries).toHaveLength(1);
    expect(optionReport.productDemandSeries[0]).toMatchObject({ options: [expect.objectContaining({ optionId: optionA.id })], quantitySold: 2 });

    await app.prisma.orderItem.update({ where: { id: order.items[1]!.id }, data: { enteredAt: null } });
    const legacy = await app.inject({ method: "GET", url: path, cookies: manager });
    expect(legacy.statusCode, legacy.body).toBe(200);
    const fallbackReport = SalesAnalyticsResponseSchema.parse(legacy.json()).data;
    expect(fallbackReport.overview.operationalDemand.itemEntryFallbackCount).toBe(1);
    expect(fallbackReport.timeSemantics.historicalItemEntryFallbackCount).toBe(1);
    expect(fallbackReport.productDemandSeries).toEqual(expect.arrayContaining([
      expect.objectContaining({ hour: 0, minute: 0, options: [expect.objectContaining({ optionId: optionB.id })], quantitySold: 1, itemEntryFallbackCount: 1 }),
    ]));

    const forbidden = await app.inject({ method: "GET", url: path, cookies: staff });
    expect(forbidden.statusCode).toBe(403);
    const tooWide = await app.inject({ method: "GET", url: "/api/v1/admin/reports/sales-analytics?fromDate=2026-01-01&toDate=2026-04-04", cookies: manager });
    expect(tooWide.statusCode).toBe(400);
  });

  it("reconciles multi-settlement orders and excludes reversed, deleted, and staff-consumption orders", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const category = await app.prisma.category.create({ data: { name: `Eligibility ${randomUUID()}`, displayOrder: 1 } });
    const product = await app.prisma.product.create({ data: {
      categoryId: category.id, name: "Eligibility drink", priceAmount: 10_000,
      preparationDeadlineMinutes: 1, displayOrder: 1,
    } });

    const createOrder = async (quantity = 1, channel: "TABLE" | "TAKEAWAY" = "TAKEAWAY") => {
      const table = channel === "TABLE" ? await app.prisma.cafeTable.create({ data: { name: `Analytics table ${randomUUID()}`, displayOrder: 1 } }) : null;
      const response = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff,
        headers: { "idempotency-key": randomUUID() }, payload: { channel, ...(table ? { tableId: table.id } : {}), items: [{ productId: product.id, quantity, options: [] }] } });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().data;
    };
    const settle = async (orderId: string, expectedVersion: number, amount: number) => {
      const response = await app.inject({ method: "POST", url: `/api/v1/orders/${orderId}/record-settlement`, cookies: staff,
        headers: { "idempotency-key": randomUUID() }, payload: { expectedVersion, allocationMode: "AMOUNT", amount, payments: [{ method: "CASH", amount }] } });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().data;
    };

    const splitPaid = await createOrder();
    const partial = await settle(splitPaid.id, splitPaid.version, 4_000);
    expect(partial.state).not.toBe("CLOSED");
    const fullyPaid = await settle(splitPaid.id, partial.version, 6_000);
    expect(fullyPaid).toMatchObject({ state: "CLOSED", paymentStatus: "PAID", paidAmount: 10_000 });
    expect(await app.prisma.paymentSettlement.count({ where: { orderId: splitPaid.id, reversal: null } })).toBe(2);
    const dineIn = await createOrder(1, "TABLE");
    await settle(dineIn.id, dineIn.version, 10_000);

    const reversedOrder = await createOrder();
    const reversedPaid = await settle(reversedOrder.id, reversedOrder.version, 10_000);
    const reversedSettlement = await app.prisma.paymentSettlement.findFirstOrThrow({ where: { orderId: reversedOrder.id } });
    const reversal = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${reversedSettlement.id}/reverse`, cookies: manager,
      payload: { expectedVersion: reversedPaid.version, reason: "Analytics verification" } });
    expect(reversal.statusCode, reversal.body).toBe(200);

    const deletedOrder = await createOrder();
    const deletedPaid = await settle(deletedOrder.id, deletedOrder.version, 10_000);
    const deleted = await app.inject({ method: "POST", url: `/api/v1/orders/${deletedOrder.id}/delete`, cookies: staff,
      payload: { expectedVersion: deletedPaid.version } });
    expect(deleted.statusCode, deleted.body).toBe(200);

    const staffConsumption = await app.inject({ method: "POST", url: "/api/v1/staff-consumption", cookies: manager,
      headers: { "idempotency-key": randomUUID() }, payload: { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] } });
    expect(staffConsumption.statusCode, staffConsumption.body).toBe(201);
    expect(await app.prisma.order.findUniqueOrThrow({ where: { id: staffConsumption.json().data.id } })).toMatchObject({ isStaffConsumption: true, state: "CLOSED", paymentStatus: "PAID" });

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const response = await app.inject({ method: "GET", url: `/api/v1/admin/reports/sales-analytics?fromDate=${today}&toDate=${today}`, cookies: manager });
    expect(response.statusCode, response.body).toBe(200);
    const result = SalesAnalyticsResponseSchema.parse(response.json()).data;
    expect(result.overview.operationalDemand).toMatchObject({ orderCount: 2, itemUnits: 2, netSalesAmount: 20_000 });
    expect(result.overview.financialRecognition).toMatchObject({ orderCount: 2, itemUnits: 2, netSalesAmount: 20_000 });
    expect(result.productPeaks[0]?.channelDistribution).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "TABLE", uniqueOrdersContainingProduct: 1, quantity: 1 }),
      expect.objectContaining({ channel: "TAKEAWAY", uniqueOrdersContainingProduct: 1, quantity: 1 }),
    ]));
  });
});
