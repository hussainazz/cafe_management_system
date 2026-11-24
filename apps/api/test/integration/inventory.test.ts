import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { UserRole } from "../../generated/prisma/client.js";
import {
  GrossProfitReportResponseSchema,
  InventoryCountResponseSchema,
  InventoryCountsResponseSchema,
  InventoryMovementSchema,
  InventoryMovementsResponseSchema,
  PendingConsumptionsResponseSchema,
  ProductCostingConfigurationResponseSchema,
  ProductCostingPreviewResponseSchema,
  SalesAnalyticsResponseSchema,
  PurchaseResponseSchema,
  PurchasesResponseSchema,
  RecipeResponseSchema,
  RecipesResponseSchema,
  StockItemResponseSchema,
  StockItemsResponseSchema,
} from "@cafe/contracts";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await app.prisma.cafeSettings.create({ data: { inventoryActivatedAt: new Date("2020-01-01T00:00:00.000Z") } }); });

function cookieJar(response: { cookies: Array<{ name: string; value: string }> }) {
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}
async function session(role: UserRole, username: string) {
  await app.prisma.user.create({ data: { username, passwordHash: await hashPassword("CafePassword2026"), role } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  expect(response.statusCode).toBe(200);
  return cookieJar(response);
}
async function productFixture(name: string, systemKey: string | null = null, priceAmount = 1_000) {
  const category = await app.prisma.category.create({ data: { name: `${name} category`, displayOrder: 1 } });
  return app.prisma.product.create({ data: { categoryId: category.id, name, priceAmount, systemKey, preparationDeadlineMinutes: 5, displayOrder: 1 } });
}
async function stockFixture(manager: Record<string, string>, name: string, quantity: string, value: number, isPackagingMaterial = false) {
  const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name, category: "Ingredients", baseUnit: "GRAM", isPackagingMaterial, openingQuantity: quantity, openingValueAmount: value, conversions: [{ label: "kg", baseQuantityPerPack: "1000", isActive: true }] } });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().data.id as string;
}
async function recipeFixture(manager: Record<string, string>, productId: string, stockItemId: string, quantity = "80") {
  const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/recipes", cookies: manager, payload: { name: `Recipe ${productId}`, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "beans",  sourceKind: "STOCK_ITEM", stockItemId, quantity, displayOrder: 0 }] } });
  expect(created.statusCode, created.body).toBe(201);
  const recipe = created.json().data;
  const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${productId}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: recipe.id, recipeQuantity: "1", optionRules: [], combinations: [] } });
  expect(configured.statusCode, configured.body).toBe(200);
  return recipe;
}
async function estimatedCostFixture(manager: Record<string, string>, productId: string, estimatedCostAmount: number, servedAlongside?: unknown[]) {
  const response = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${productId}/costing`, cookies: manager, payload: {
    expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount,
    ...(servedAlongside === undefined ? {} : { servedAlongside }), optionRules: [], combinations: [],
  } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data;
}
function tehranToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
async function orderFixture(staff: Record<string, string>, productId: string, quantity: number, key: string, channel: "TABLE" | "TAKEAWAY" = "TAKEAWAY") {
  const tableId = channel === "TABLE"
    ? (await app.prisma.cafeTable.create({ data: { name: `${key} table`, displayOrder: 1 } })).id
    : undefined;
  const response = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": key }, payload: { channel, ...(tableId ? { tableId } : {}), items: [{ productId, quantity, options: [] }] } });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data;
}
async function settleAmount(staff: Record<string, string>, order: any, amount: number, key: string) {
  return app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staff, headers: { "idempotency-key": key }, payload: { expectedVersion: order.version, allocationMode: "AMOUNT", amount, payments: [{ method: "CASH", amount }] } });
}

async function withOverlappingRequests<T>(
  holdLock: (client: Client) => Promise<unknown>,
  first: () => Promise<T>,
  second: () => Promise<T>,
) {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  const requests: Promise<T>[] = [];
  await client.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const pid = rows[0]!.pid;
    await holdLock(client);

    // Wait for actual PostgreSQL lock contention before starting each next step.
    const expectBlocked = async (count: number) => {
      await expect.poll(async () => {
        const result = await client.query(`
          WITH RECURSIVE blocked(pid) AS (
            SELECT $1::integer
            UNION
            SELECT waiting.pid FROM pg_locks AS waiting
            JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(waiting.pid))
            WHERE NOT waiting.granted
          )
          SELECT pid FROM blocked WHERE pid <> $1
        `, [pid]);
        return result.rowCount;
      }, { interval: 15, timeout: 2_000 }).toBe(count);
    };
    requests.push(first());
    await expectBlocked(1);
    requests.push(second());
    await expectBlocked(2);
  } finally {
    await client.end(); // Release the test lock and let both requests finish.
    await Promise.allSettled(requests);
  }
  return Promise.all([requests[0]!, requests[1]!]);
}

async function purchaseToPost(manager: Record<string, string>, stockItemId: string, quantity: string, cost: number, key: string) {
  const draft = await app.inject({
    method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager,
    payload: { receivedAt: new Date().toISOString(), lines: [{ stockItemId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: quantity, directCostAmount: cost }] },
  });
  expect(draft.statusCode, draft.body).toBe(201);
  return () => app.inject({
    method: "POST", url: `/api/v1/admin/inventory/purchases/${draft.json().data.id}/post`, cookies: manager,
    headers: { "idempotency-key": key }, payload: { expectedVersion: 1 },
  });
}

describe("inventory costing and settlement integration", () => {
  it("fully settles both concurrent checkouts when shared stock can cover only one", async () => {
    const manager = await session(UserRole.MANAGER, "concurrent-checkout.manager");
    const staff = await session(UserRole.STAFF, "concurrent-checkout.staff");
    const product = await productFixture("Concurrent checkout latte");
    const stockItemId = await stockFixture(manager, "Concurrent checkout beans", "100", 10_000);
    await recipeFixture(manager, product.id, stockItemId);
    const firstOrder = await orderFixture(staff, product.id, 1, "concurrent-checkout-order-one");
    const secondOrder = await orderFixture(staff, product.id, 1, "concurrent-checkout-order-two");

    const [first, second] = await withOverlappingRequests(
      (client) => client.query('SELECT 1 FROM inventory_balances WHERE "stockItemId" = $1 FOR NO KEY UPDATE', [stockItemId]),
      () => settleAmount(staff, firstOrder, 1_000, "concurrent-checkout-settlement-one"),
      () => settleAmount(staff, secondOrder, 1_000, "concurrent-checkout-settlement-two"),
    );
    for (const response of [first, second]) {
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().data).toMatchObject({ paymentStatus: "PAID", state: "CLOSED" });
    }
    const posted = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: firstOrder.id } });
    const pending = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: secondOrder.id } });
    expect(posted.status).toBe("POSTED");
    expect(pending.status).toBe("PENDING");
    const movements = await app.prisma.inventoryMovement.findMany({ where: { stockItemId, kind: "ORDER_CONSUMPTION" } });
    expect(movements).toMatchObject([{ orderConsumptionId: posted.id, valueDeltaAmount: -8_000 }]);
    expect(movements[0]?.quantityDelta.toString()).toBe("-80");
    const balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("20");
    expect(balance.carryingValueAmount).toBe(2_000);
  });

  it("preserves both a checkout deduction and a concurrent settlement reversal on the same stock", async () => {
    const manager = await session(UserRole.MANAGER, "concurrent-reversal.manager");
    const staff = await session(UserRole.STAFF, "concurrent-reversal.staff");
    const product = await productFixture("Concurrent reversal cappuccino");
    const stockItemId = await stockFixture(manager, "Concurrent reversal beans", "200", 20_000);
    await recipeFixture(manager, product.id, stockItemId);
    const paidOrder = await orderFixture(staff, product.id, 1, "concurrent-reversal-paid-order");
    const paid = await settleAmount(staff, paidOrder, 1_000, "concurrent-reversal-paid-settlement");
    expect(paid.statusCode, paid.body).toBe(201);
    const { version, settlements: [settlement] } = paid.json().data;
    const nextOrder = await orderFixture(staff, product.id, 1, "concurrent-reversal-new-order");

    const [checkout, reversal] = await withOverlappingRequests(
      (client) => client.query('SELECT 1 FROM inventory_balances WHERE "stockItemId" = $1 FOR NO KEY UPDATE', [stockItemId]),
      () => settleAmount(staff, nextOrder, 1_000, "concurrent-reversal-new-settlement"),
      () => app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlement.id}/reverse`, cookies: manager, payload: { expectedVersion: version } }),
    );
    expect(checkout.statusCode, checkout.body).toBe(201);
    expect(reversal.statusCode, reversal.body).toBe(200);
    const reversed = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: paidOrder.id } });
    expect(reversed.status).toBe("CANCELLED");
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: reversed.id, kind: "ORDER_RESTORATION" } })).toBe(1);
    const balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("120");
    expect(balance.carryingValueAmount).toBe(12_000);
  });

  it.each([
    { firstToCommit: "receipt", shouldRestore: true },
    { firstToCommit: "deletion", shouldRestore: false },
  ])("keeps stock correct when $firstToCommit commits first for a pending order", async ({ shouldRestore }) => {
    const manager = await session(UserRole.MANAGER, "concurrent-receipt-delete.manager");
    const staff = await session(UserRole.STAFF, "concurrent-receipt-delete.staff");
    const product = await productFixture("Concurrent receipt deletion mocha");
    const stockItemId = await stockFixture(manager, "Concurrent receipt deletion beans", "50", 5_000);
    await recipeFixture(manager, product.id, stockItemId);
    const order = await orderFixture(staff, product.id, 1, "concurrent-receipt-delete-order");
    const paid = await settleAmount(staff, order, 1_000, "concurrent-receipt-delete-settlement");
    expect(paid.statusCode, paid.body).toBe(201);
    const pending = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });
    expect(pending.status).toBe("PENDING");
    const postPurchase = await purchaseToPost(manager, stockItemId, "50", 15_000, "concurrent-receipt-delete-purchase");
    const deleteOrder = () => app.inject({
      method: "POST", url: `/api/v1/orders/${order.id}/delete`, cookies: staff, payload: { expectedVersion: paid.json().data.version },
    });

    const [first, second] = await withOverlappingRequests(
      // Both requests write their audit entries after changing consumption status.
      (client) => client.query("LOCK TABLE audit_logs IN SHARE MODE"),
      shouldRestore ? postPurchase : deleteOrder,
      shouldRestore ? deleteOrder : postPurchase,
    );
    const [receipt, deletion] = shouldRestore ? [first, second] : [second, first];
    expect(receipt.statusCode, receipt.body).toBe(200);
    expect(deletion.statusCode, deletion.body).toBe(200);
    expect(deletion.json().data.state).toBe("DELETED");
    const cancelled = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: pending.id } });
    expect(cancelled.status).toBe("CANCELLED");
    const movements = await app.prisma.inventoryMovement.findMany({ where: { orderConsumptionId: pending.id }, orderBy: { kind: "asc" } });
    if (shouldRestore) {
      expect(movements).toHaveLength(2);
      const [deduction, restoration] = movements;
      expect(deduction).toMatchObject({ kind: "ORDER_CONSUMPTION", valueDeltaAmount: -16_000 });
      expect(restoration).toMatchObject({ kind: "ORDER_RESTORATION", valueDeltaAmount: 16_000, compensatesMovementId: deduction!.id });
      expect(restoration?.quantityDelta.toString()).toBe("80");
    } else {
      expect(movements).toHaveLength(0);
    }
    const balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("100");
    expect(balance.carryingValueAmount).toBe(20_000);
  });

  it("values a checkout using the receipt that commits ahead of its deduction", async () => {
    const manager = await session(UserRole.MANAGER, "concurrent-receipt-cost.manager");
    const staff = await session(UserRole.STAFF, "concurrent-receipt-cost.staff");
    const product = await productFixture("Concurrent receipt costing espresso");
    const stockItemId = await stockFixture(manager, "Concurrent receipt costing beans", "100", 10_000);
    await recipeFixture(manager, product.id, stockItemId);
    const order = await orderFixture(staff, product.id, 1, "concurrent-receipt-cost-order");
    const postPurchase = await purchaseToPost(manager, stockItemId, "100", 30_000, "concurrent-receipt-cost-purchase");

    const [receipt, checkout] = await withOverlappingRequests(
      (client) => client.query("LOCK TABLE audit_logs IN SHARE MODE"),
      postPurchase,
      () => settleAmount(staff, order, 1_000, "concurrent-receipt-cost-settlement"),
    );
    expect(receipt.statusCode, receipt.body).toBe(200);
    expect(checkout.statusCode, checkout.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });
    expect(consumption).toMatchObject({ status: "POSTED", theoreticalCogsAmount: 16_000n });
    const movement = await app.prisma.inventoryMovement.findFirstOrThrow({ where: { orderConsumptionId: consumption.id } });
    expect(movement.valueDeltaAmount).toBe(-16_000);
  });

  it("retries a pending checkout that commits while a receipt waits for its ingredient", async () => {
    const manager = await session(UserRole.MANAGER, "concurrent-shortage-receipt.manager");
    const staff = await session(UserRole.STAFF, "concurrent-shortage-receipt.staff");
    const product = await productFixture("Concurrent shortage latte");
    const stockItemId = await stockFixture(manager, "Concurrent shortage beans", "50", 5_000);
    await recipeFixture(manager, product.id, stockItemId);
    const order = await orderFixture(staff, product.id, 1, "concurrent-shortage-receipt-order");
    const postPurchase = await purchaseToPost(manager, stockItemId, "50", 15_000, "concurrent-shortage-receipt-purchase");

    const [checkout, receipt] = await withOverlappingRequests(
      (client) => client.query("LOCK TABLE audit_logs IN SHARE MODE"),
      () => settleAmount(staff, order, 1_000, "concurrent-shortage-receipt-settlement"),
      postPurchase,
    );
    expect(checkout.statusCode, checkout.body).toBe(201);
    expect(receipt.statusCode, receipt.body).toBe(200);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });
    expect(consumption).toMatchObject({ status: "POSTED", theoreticalCogsAmount: 8_000n });
    const movements = await app.prisma.inventoryMovement.findMany({ where: { orderConsumptionId: consumption.id } });
    expect(movements).toMatchObject([{ kind: "ORDER_CONSUMPTION", valueDeltaAmount: -16_000 }]);
    const balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("20");
    expect(balance.carryingValueAmount).toBe(4_000);
  });

  it("reports revenue-weighted coverage for discounted multi-settlement sales, mixed historical snapshots, and both channels", async () => {
    const manager = await session(UserRole.DEVELOPER, "coverage-weighted.manager");
    const staff = await session(UserRole.STAFF, "coverage-weighted.staff");
    const mixed = await productFixture("Coverage mixed history");
    const takeaway = await productFixture("Coverage takeaway complete");
    await app.prisma.product.update({ where: { id: mixed.id }, data: { priceAmount: 50_000 } });
    await app.prisma.product.update({ where: { id: takeaway.id }, data: { priceAmount: 100_000 } });
    const stock = await stockFixture(manager, "Coverage weighted beans", "100", 10_000);

    // The first sale is recognized before recipe setup. Its pending snapshot
    // should be resolved and deducted when the product costing is configured.
    const oldMixedOrder = await orderFixture(staff, mixed.id, 1, "coverage-mixed-old-order", "TABLE");
    const oldMixedPayment = await settleAmount(staff, oldMixedOrder, 50_000, "coverage-mixed-old-payment");
    expect(oldMixedPayment.statusCode, oldMixedPayment.body).toBe(201);
    const oldConsumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: oldMixedOrder.id }, include: { items: true } });
    expect(oldConsumption.status).toBe("PENDING");
    expect(oldConsumption.items[0]).toMatchObject({ isCostComplete: false, theoreticalCogsAmount: null });
    await recipeFixture(manager, mixed.id, stock, "10");
    const resolvedOldConsumption = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: oldConsumption.id }, include: { items: true } });
    expect(resolvedOldConsumption).toMatchObject({ status: "POSTED", theoreticalCogsAmount: 1_000n, isCostComplete: true });
    expect(resolvedOldConsumption.items[0]).toMatchObject({ isCostComplete: true, theoreticalCogsAmount: 1_000n });

    const discountedOrder = await orderFixture(staff, mixed.id, 1, "coverage-mixed-new-order", "TAKEAWAY");
    const discount = await app.inject({ method: "PATCH", url: `/api/v1/orders/${discountedOrder.id}`, cookies: staff, payload: { expectedVersion: discountedOrder.version, orderDiscount: { kind: "FIXED", value: 10_000 } } });
    expect(discount.statusCode, discount.body).toBe(200);
    const firstPart = await settleAmount(staff, discount.json().data, 20_000, "coverage-mixed-new-first-payment");
    expect(firstPart.statusCode, firstPart.body).toBe(201);
    const secondPart = await settleAmount(staff, firstPart.json().data, 20_000, "coverage-mixed-new-second-payment");
    expect(secondPart.statusCode, secondPart.body).toBe(201);
    const newConsumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: discountedOrder.id }, include: { items: true } });
    expect(newConsumption.items[0]).toMatchObject({ isCostComplete: true, theoreticalCogsAmount: 1_000n });

    await recipeFixture(manager, takeaway.id, stock, "20");
    const mixedTableOrder = await orderFixture(staff, mixed.id, 1, "coverage-mixed-table-complete-order", "TABLE");
    const mixedTablePaid = await settleAmount(staff, mixedTableOrder, 50_000, "coverage-mixed-table-complete-payment");
    expect(mixedTablePaid.statusCode, mixedTablePaid.body).toBe(201);
    const takeawayOrder = await orderFixture(staff, takeaway.id, 1, "coverage-takeaway-order", "TAKEAWAY");
    const takeawayPaid = await settleAmount(staff, takeawayOrder, 100_000, "coverage-takeaway-payment");
    expect(takeawayPaid.statusCode, takeawayPaid.body).toBe(201);

    const reportDate = "2026-11-10";
    await app.prisma.orderConsumption.updateMany({ where: { orderId: { in: [oldMixedOrder.id, discountedOrder.id, mixedTableOrder.id, takeawayOrder.id] } }, data: { recognizedAt: new Date("2026-11-11T08:00:00.000Z") } });
    const report = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${reportDate}&toDate=2026-11-11`, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    const data = report.json().data;
    expect(data.totals.netSalesAmount).toBe(240_000);
    expect(data.costCoverage).toMatchObject({
      totalEligibleNetSalesAmount: 240_000,
      completeCostRevenueAmount: 240_000,
      incompleteCostRevenueAmount: 0,
      coveragePercent: "100.00",
      incompleteCoveragePercent: "0.00",
      completeOrderItemCount: 4,
      incompleteOrderItemCount: 0,
      channels: expect.arrayContaining([
        expect.objectContaining({ channel: "TABLE", netSalesAmount: 100_000, completeCostRevenueAmount: 100_000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00" }),
        expect.objectContaining({ channel: "TAKEAWAY", netSalesAmount: 140_000, completeCostRevenueAmount: 140_000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00" }),
      ]),
    });
    expect(data.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: mixed.id, channel: "TABLE", soldQuantity: 2, soldWeightGrams: 0, netSalesAmount: 100_000, completeCostRevenueAmount: 100_000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCostRevenueOfTotalSalesPercent: "0.00", completeOrderItemCount: 2, incompleteOrderItemCount: 0 }),
      expect.objectContaining({ productId: mixed.id, channel: "TAKEAWAY", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 40_000, completeCostRevenueAmount: 40_000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCostRevenueOfTotalSalesPercent: "0.00", incompleteCostRevenueSharePercent: null, completeOrderItemCount: 1, incompleteOrderItemCount: 0 }),
      expect.objectContaining({ productId: takeaway.id, channel: "TAKEAWAY", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 100_000, completeCostRevenueAmount: 100_000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCostRevenueOfTotalSalesPercent: "0.00", incompleteCostRevenueSharePercent: null }),
    ]));
    expect(data.products.reduce((sum: number, product: any) => sum + product.netSalesAmount, 0)).toBe(data.totals.netSalesAmount);
    expect(data.products.reduce((sum: number, product: any) => sum + product.incompleteCostRevenueAmount, 0)).toBe(data.costCoverage.incompleteCostRevenueAmount);
    expect(GrossProfitReportResponseSchema.safeParse(report.json()).success).toBe(true);
  });

  it("reports sold item quantities and weighted grams separately for each sales channel", async () => {
    const manager = await session(UserRole.DEVELOPER, "sold-quantity.manager");
    const staff = await session(UserRole.STAFF, "sold-quantity.staff");
    const fixed = await productFixture("Sold quantity fixed product", null, 1_000);
    const weighted = await productFixture("Sold quantity weighted product", null, 2_000_000);
    await app.prisma.product.update({ where: { id: weighted.id }, data: { pricingMode: "WEIGHTED_PER_KG" } });

    const tableOrder = await orderFixture(staff, fixed.id, 2, "sold-quantity-table-order", "TABLE");
    const tableSettled = await settleAmount(staff, tableOrder, tableOrder.totalAmount, "sold-quantity-table-payment");
    expect(tableSettled.statusCode, tableSettled.body).toBe(201);
    const takeawayOrder = await orderFixture(staff, fixed.id, 3, "sold-quantity-takeaway-order");
    const takeawaySettled = await settleAmount(staff, takeawayOrder, takeawayOrder.totalAmount, "sold-quantity-takeaway-payment");
    expect(takeawaySettled.statusCode, takeawaySettled.body).toBe(201);

    const weightedOrderResponse = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "sold-quantity-weighted-order" }, payload: { channel: "TAKEAWAY", items: [{ productId: weighted.id, quantity: 2, weightGrams: 250, options: [] }] } });
    expect(weightedOrderResponse.statusCode, weightedOrderResponse.body).toBe(201);
    const weightedOrder = weightedOrderResponse.json().data;
    const weightedSettled = await settleAmount(staff, weightedOrder, weightedOrder.totalAmount, "sold-quantity-weighted-payment");
    expect(weightedSettled.statusCode, weightedSettled.body).toBe(201);

    await app.prisma.orderConsumption.updateMany({
      where: { orderId: { in: [tableOrder.id, takeawayOrder.id, weightedOrder.id] } },
      data: { recognizedAt: new Date("2026-11-10T08:00:00.000Z") },
    });
    const reportDate = "2026-11-10";
    const response = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${reportDate}&toDate=${reportDate}`, cookies: manager });
    expect(response.statusCode, response.body).toBe(200);
    const products = response.json().data.products;
    expect(products).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: fixed.id, channel: "TABLE", soldQuantity: 2, soldWeightGrams: 0 }),
      expect.objectContaining({ productId: fixed.id, channel: "TAKEAWAY", soldQuantity: 3, soldWeightGrams: 0 }),
      expect.objectContaining({ productId: weighted.id, channel: "TAKEAWAY", soldQuantity: 2, soldWeightGrams: 500 }),
    ]));
    expect(GrossProfitReportResponseSchema.safeParse(response.json()).success).toBe(true);
  });

  it("keeps zero-cost items complete, returns null percentages for zero revenue, and excludes reversed, deleted, and staff-consumption sales", async () => {
    const manager = await session(UserRole.DEVELOPER, "coverage-edge.manager");
    const staff = await session(UserRole.STAFF, "coverage-edge.staff");
    const free = await productFixture("Coverage real zero cost");
    const zeroStock = await stockFixture(manager, "Coverage zero-cost stock", "10", 0);
    await recipeFixture(manager, free.id, zeroStock, "1");
    const freeOrder = await orderFixture(staff, free.id, 1, "coverage-zero-cost-order");
    const freePaid = await settleAmount(staff, freeOrder, freeOrder.totalAmount, "coverage-zero-cost-payment");
    expect(freePaid.statusCode, freePaid.body).toBe(201);
    const freeConsumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: freeOrder.id }, include: { items: true } });
    expect(freeConsumption.items[0]).toMatchObject({ isCostComplete: true, theoreticalCogsAmount: 0n });

    const reversedProduct = await productFixture("Coverage reversed sale");
    const reversedOrder = await orderFixture(staff, reversedProduct.id, 1, "coverage-reversed-order");
    const reversedPayment = await settleAmount(staff, reversedOrder, reversedOrder.totalAmount, "coverage-reversed-payment");
    expect(reversedPayment.statusCode, reversedPayment.body).toBe(201);
    const reversal = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${reversedPayment.json().data.settlements[0].id}/reverse`, cookies: manager, payload: { expectedVersion: reversedPayment.json().data.version } });
    expect(reversal.statusCode, reversal.body).toBe(200);

    const deletedProduct = await productFixture("Coverage deleted sale");
    const deletedOrder = await orderFixture(staff, deletedProduct.id, 1, "coverage-deleted-order");
    const deletedPayment = await settleAmount(staff, deletedOrder, deletedOrder.totalAmount, "coverage-deleted-payment");
    expect(deletedPayment.statusCode, deletedPayment.body).toBe(201);
    const deleted = await app.inject({ method: "POST", url: `/api/v1/orders/${deletedOrder.id}/delete`, cookies: staff, payload: { expectedVersion: deletedPayment.json().data.version } });
    expect(deleted.statusCode, deleted.body).toBe(200);

    const staffProduct = await productFixture("Coverage staff consumption");
    const staffBenefit = await app.inject({ method: "POST", url: "/api/v1/staff-consumption", cookies: staff, headers: { "idempotency-key": "coverage-staff-consumption" }, payload: { channel: "TAKEAWAY", items: [{ productId: staffProduct.id, quantity: 1, options: [] }] } });
    expect(staffBenefit.statusCode, staffBenefit.body).toBe(201);

    const quietDate = "2026-11-01";
    const zeroSales = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${quietDate}&toDate=${quietDate}`, cookies: manager });
    expect(zeroSales.statusCode, zeroSales.body).toBe(200);
    expect(zeroSales.json().data.costCoverage).toMatchObject({ totalEligibleNetSalesAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0, coveragePercent: null, incompleteCoveragePercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 0, channels: [{ channel: "TABLE", netSalesAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0, coveragePercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 0 }, { channel: "TAKEAWAY", netSalesAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0, coveragePercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 0 }] });

    const reportDate = "2026-11-12";
    // Keep every candidate exclusion in-range so this still exercises the
    // exclusion predicates after the fixtures' real creation date has passed.
    await app.prisma.orderConsumption.updateMany({ where: { orderId: { in: [freeOrder.id, reversedOrder.id, deletedOrder.id, staffBenefit.json().data.id] } }, data: { recognizedAt: new Date("2026-11-12T08:00:00.000Z") } });
    const report = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${reportDate}&toDate=${reportDate}`, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data.costCoverage).toMatchObject({ totalEligibleNetSalesAmount: freeOrder.totalAmount, completeCostRevenueAmount: freeOrder.totalAmount, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCoveragePercent: "0.00", completeOrderItemCount: 1, incompleteOrderItemCount: 0 });
    expect(report.json().data.products).toEqual([expect.objectContaining({ productId: free.id, theoreticalCogsAmount: 0, completeCostRevenueAmount: freeOrder.totalAmount, incompleteCostRevenueAmount: 0, coveragePercent: "100.00" })]);
  });

  it("allocates a one-Toman discount remainder across a mixed-cost order and reconciles two settlements exactly", async () => {
    const manager = await session(UserRole.DEVELOPER, "coverage-allocation.manager");
    const staff = await session(UserRole.STAFF, "coverage-allocation.staff");
    const incomplete = await productFixture("Coverage allocation incomplete", null, 33_000);
    const complete = await productFixture("Coverage allocation complete", null, 68_000);
    const stock = await stockFixture(manager, "Coverage allocation beans", "10", 0);
    await recipeFixture(manager, complete.id, stock, "1");

    const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "coverage-allocation-order" }, payload: { channel: "TAKEAWAY", items: [{ productId: incomplete.id, quantity: 1, options: [] }, { productId: complete.id, quantity: 1, options: [] }] } });
    expect(created.statusCode, created.body).toBe(201);
    const discounted = await app.inject({ method: "PATCH", url: `/api/v1/orders/${created.json().data.id}`, cookies: staff, payload: { expectedVersion: created.json().data.version, orderDiscount: { kind: "FIXED", value: 1_000 } } });
    expect(discounted.statusCode, discounted.body).toBe(200);
    expect(discounted.json().data.totalAmount).toBe(100_000);

    // The first line's exact order-discount share is 326.732... Toman. The
    // cumulative-floor allocation assigns 326, leaving 674 for the next line.
    const first = await settleAmount(staff, discounted.json().data, 40_000, "coverage-allocation-first-payment");
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().data.settlements.at(-1).allocations.map((row: { amount: number }) => row.amount)).toEqual([32_674, 7_326]);
    const second = await settleAmount(staff, first.json().data, 60_000, "coverage-allocation-second-payment");
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().data.settlements.at(-1).allocations.map((row: { amount: number }) => row.amount)).toEqual([60_000]);
    await app.prisma.orderConsumption.updateMany({ where: { orderId: created.json().data.id }, data: { recognizedAt: new Date("2026-11-11T08:00:00.000Z") } });

    const report = await app.inject({ method: "GET", url: "/api/v1/admin/reports/gross-profit?fromDate=2026-11-11&toDate=2026-11-11", cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data).toMatchObject({
      totals: { netSalesAmount: 100_000 },
      costCoverage: { totalEligibleNetSalesAmount: 100_000, completeCostRevenueAmount: 67_326, incompleteCostRevenueAmount: 32_674, coveragePercent: "67.33", completeOrderItemCount: 1, incompleteOrderItemCount: 1,
        channels: [expect.objectContaining({ channel: "TABLE", netSalesAmount: 0, coveragePercent: null }), expect.objectContaining({ channel: "TAKEAWAY", netSalesAmount: 100_000, completeCostRevenueAmount: 67_326, incompleteCostRevenueAmount: 32_674, coveragePercent: "67.33" })] },
    });
    expect(report.json().data.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: incomplete.id, channel: "TAKEAWAY", netSalesAmount: 32_674, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 32_674 }),
      expect.objectContaining({ productId: complete.id, channel: "TAKEAWAY", netSalesAmount: 67_326, completeCostRevenueAmount: 67_326, incompleteCostRevenueAmount: 0 }),
    ]));
  });

  it("rounds an exact half-hundredth of weighted coverage upward and leaves empty channels undefined", async () => {
    const manager = await session(UserRole.DEVELOPER, "coverage-rounding.manager");
    const staff = await session(UserRole.STAFF, "coverage-rounding.staff");
    const incomplete = await productFixture("Coverage rounding incomplete", null, 19_999);
    const complete = await productFixture("Coverage rounding complete", null, 1);
    const freeStock = await stockFixture(manager, "Coverage rounding free stock", "1", 0);
    await recipeFixture(manager, complete.id, freeStock, "1");
    const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "coverage-rounding-order" }, payload: { channel: "TAKEAWAY", items: [{ productId: incomplete.id, quantity: 1, options: [] }, { productId: complete.id, quantity: 1, options: [] }] } });
    expect(created.statusCode, created.body).toBe(201);
    const settled = await settleAmount(staff, created.json().data, 20_000, "coverage-rounding-payment");
    expect(settled.statusCode, settled.body).toBe(201);
    await app.prisma.orderConsumption.updateMany({ where: { orderId: created.json().data.id }, data: { recognizedAt: new Date("2026-11-11T08:00:00.000Z") } });

    const report = await app.inject({ method: "GET", url: "/api/v1/admin/reports/gross-profit?fromDate=2026-11-11&toDate=2026-11-11", cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data.costCoverage).toMatchObject({ totalEligibleNetSalesAmount: 20_000, completeCostRevenueAmount: 1, incompleteCostRevenueAmount: 19_999, coveragePercent: "0.01", incompleteCoveragePercent: "100.00", channels: [
      expect.objectContaining({ channel: "TABLE", netSalesAmount: 0, coveragePercent: null }),
      expect.objectContaining({ channel: "TAKEAWAY", netSalesAmount: 20_000, completeCostRevenueAmount: 1, coveragePercent: "0.01" }),
    ] });
  });

  it("includes direct and nested takeaway packaging materials in product COGS", async () => {
    const manager = await session(UserRole.DEVELOPER, "packaging-cogs.manager");
    const staff = await session(UserRole.STAFF, "packaging-cogs.staff");
    const coffee = await productFixture("Packaging COGS coffee", null, 10_000);
    const baseStock = await stockFixture(manager, "Packaging COGS table recipe", "100", 50_000);
    const takeawayIngredient = await stockFixture(manager, "Packaging COGS takeaway ingredient", "100", 10_000);
    const nestedPackaging = await stockFixture(manager, "Packaging COGS nested cup", "100", 10_000, true);
    const groupedHolder = await stockFixture(manager, "Packaging COGS holder", "100", 20_000);
    const createRecipe = async (name: string, components: Array<Record<string, unknown>>) => {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/recipes", cookies: manager, payload: { name, outputUnit: "PIECE", yieldQuantity: "1", components } });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().data;
    };
    const baseRecipe = await createRecipe("Packaging COGS base recipe", [{ componentKey: "base", sourceKind: "STOCK_ITEM", stockItemId: baseStock, quantity: "1", displayOrder: 0 }]);
    const nestedRecipe = await createRecipe("Packaging COGS nested cup", [{ componentKey: "cup", sourceKind: "STOCK_ITEM", stockItemId: nestedPackaging, quantity: "2", displayOrder: 0 }]);
    const takeawayRecipe = await createRecipe("Packaging COGS takeaway override", [
      { componentKey: "tea", sourceKind: "STOCK_ITEM", stockItemId: takeawayIngredient, quantity: "5", displayOrder: 0 },
      { componentKey: "nested-cup", sourceKind: "RECIPE", nestedRecipeId: nestedRecipe.id, quantity: "1", displayOrder: 1 },
    ]);
    const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${coffee.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", takeawayRecipeId: takeawayRecipe.id, takeawayPackaging: [{ stockItemId: groupedHolder, quantity: "1", mode: "PER_GROUP", groupSize: 2, minQuantity: 2 }], optionRules: [], combinations: [] } });
    expect(configured.statusCode, configured.body).toBe(200);
    const discount = await app.inject({ method: "PATCH", url: `/api/v1/admin/products/${coffee.id}/sale-discount`, cookies: manager, payload: { saleDiscount: { kind: "FIXED", value: 1_000 } } });
    expect(discount.statusCode, discount.body).toBe(200);

    const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "packaging-cogs-order" }, payload: { channel: "TAKEAWAY", items: [{ productId: coffee.id, quantity: 2, options: [] }] } });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().data.totalAmount).toBe(18_000);
    const settled = await settleAmount(staff, created.json().data, 18_000, "packaging-cogs-payment");
    expect(settled.statusCode, settled.body).toBe(201);
    const settlementId = settled.json().data.settlements[0].id as string;
    const consumption = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { orderId_paymentSettlementId: { orderId: created.json().data.id, paymentSettlementId: settlementId } }, include: { items: true } });
    const coffeeOrderItem = created.json().data.items.find((item: any) => item.productId === coffee.id);
    const coffeeConsumption = consumption.items.find((item) => item.orderItemId === coffeeOrderItem.id)!;
    expect(coffeeConsumption.costSnapshot).toMatchObject({ components: expect.arrayContaining([
      expect.objectContaining({ stockItemId: nestedPackaging, quantity: "4", packagingQuantity: "4", packagingKnownCostAmount: 400, nonPackagingKnownCostAmount: 0 }),
      expect.objectContaining({ stockItemId: groupedHolder, quantity: "1", packagingQuantity: "1", packagingKnownCostAmount: 200 }),
      expect.objectContaining({ stockItemId: takeawayIngredient, quantity: "10", packagingQuantity: "0", nonPackagingKnownCostAmount: 1_000 }),
    ]) });
    await app.prisma.orderConsumption.update({ where: { id: consumption.id }, data: { recognizedAt: new Date("2026-11-11T08:00:00.000Z") } });
    const reportUrl = "/api/v1/admin/reports/gross-profit?fromDate=2026-11-11&toDate=2026-11-11";
    const report = await app.inject({ method: "GET", url: reportUrl, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data.totals).toMatchObject({ netSalesAmount: 18_000, knownCogsAmount: 1_600, theoreticalCogsAmount: 1_600, grossProfitAmount: 16_400 });
    expect(GrossProfitReportResponseSchema.safeParse(report.json()).success).toBe(true);

    const reversed = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/reverse`, cookies: manager, payload: { expectedVersion: settled.json().data.version, reason: "Order reversal" } });
    expect(reversed.statusCode, reversed.body).toBe(200);
    const afterReversal = await app.inject({ method: "GET", url: reportUrl, cookies: manager });
    expect(afterReversal.statusCode).toBe(200);
    expect(afterReversal.json().data.totals.netSalesAmount).toBe(0);
  });

  it("keeps a takeaway product cost incomplete when a packaging material has no recorded valuation", async () => {
    const manager = await session(UserRole.DEVELOPER, "packaging-unvalued.manager");
    const staff = await session(UserRole.STAFF, "packaging-unvalued.staff");
    const product = await productFixture("Unvalued packaging coffee");
    const ingredient = await stockFixture(manager, "Unvalued packaging coffee beans", "100", 10_000);
    const unvaluedPackaging = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Unvalued paper cup", category: "Packaging", baseUnit: "PIECE", isPackagingMaterial: true, conversions: [] } });
    expect(unvaluedPackaging.statusCode, unvaluedPackaging.body).toBe(201);
    // New stock records with a zero opening value are still tracked at zero
    // cost. Simulate a legacy stock row that has never received a valuation.
    await app.prisma.inventoryBalance.update({ where: { stockItemId: unvaluedPackaging.json().data.id }, data: { trackingStartedAt: null } });
    const recipe = await recipeFixture(manager, product.id, ingredient, "1");
    const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: recipe.id, recipeQuantity: "1", takeawayPackaging: [{ stockItemId: unvaluedPackaging.json().data.id, quantity: "1" }], optionRules: [], combinations: [] } });
    expect(configured.statusCode, configured.body).toBe(200);
    const order = await orderFixture(staff, product.id, 1, "unvalued-packaging-order");
    const settled = await settleAmount(staff, order, order.totalAmount, "unvalued-packaging-settlement");
    expect(settled.statusCode, settled.body).toBe(201);
    await app.prisma.orderConsumption.updateMany({ where: { orderId: order.id }, data: { recognizedAt: new Date("2026-11-11T08:00:00.000Z") } });

    const report = await app.inject({ method: "GET", url: "/api/v1/admin/reports/gross-profit?fromDate=2026-11-11&toDate=2026-11-11", cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data.costCoverage).toMatchObject({ totalEligibleNetSalesAmount: order.totalAmount, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: order.totalAmount, coveragePercent: "0.00" });
    expect(report.json().data.products).toEqual(expect.arrayContaining([expect.objectContaining({ productId: product.id, incompleteCostRevenueAmount: order.totalAmount, grossProfitAmount: null })]));
  });

  it("keeps stock thresholds optional, exact, versioned and audited for Manager and Developer", async () => {
    const manager = await session(UserRole.DEVELOPER, "threshold.manager");
    const staff = await session(UserRole.STAFF, "threshold.staff");
    const id = await stockFixture(manager, "Threshold beans", "12.125001", 500);
    const url = `/api/v1/admin/inventory/stock-items/${id}`;
    const read = async () => (await app.inject({ method: "GET", url: "/api/v1/admin/inventory/stock-items", cookies: manager })).json().data.stockItems.find((item: any) => item.id === id);
    expect((await read()).lowStockThreshold).toBeNull();
    const payload = { expectedVersion: 1, lowStockThreshold: "12.125001" };
    expect((await app.inject({ method: "PATCH", url, cookies: staff, payload })).statusCode).toBe(403);
    const saved = await app.inject({ method: "PATCH", url, cookies: manager, payload });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data).toMatchObject({ lowStockThreshold: "12.125001", version: 2, balance: { quantityOnHand: "12.125001", carryingValueAmount: 500 } });
    expect((await app.inject({ method: "PATCH", url, cookies: manager, payload })).statusCode).toBe(409);
    for (const invalid of ["-1", "0.0000001", "100000000000000"]) {
      expect((await app.inject({ method: "PATCH", url, cookies: manager, payload: { expectedVersion: 2, lowStockThreshold: invalid } })).statusCode).toBe(400);
    }
    const cleared = await app.inject({ method: "PATCH", url, cookies: manager, payload: { expectedVersion: 2, lowStockThreshold: null } });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().data.lowStockThreshold).toBeNull();
    expect(await app.prisma.inventoryMovement.count({ where: { stockItemId: id } })).toBe(1);
    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { operation: "UPDATE_STOCK_ITEM", entityId: id }, orderBy: { occurredAt: "asc" } });
    expect(audit.afterSnapshot).toMatchObject({ lowStockThreshold: "12.125001" });
  });

  it("groups daily profit by Tehran recognition date with quiet days and exact aggregate reconciliation", async () => {
    const manager = await session(UserRole.DEVELOPER, "daily-profit.manager");
    const staff = await session(UserRole.STAFF, "daily-profit.staff");
    const product = await productFixture("Daily profit coffee");
    const stockId = await stockFixture(manager, "Daily beans", "1000", 10000);
    await recipeFixture(manager, product.id, stockId, "20");
    for (const [index, recognizedAt] of ["2026-01-02T20:29:59.999Z", "2026-01-02T20:30:00.000Z"].entries()) {
      const order = await orderFixture(staff, product.id, 1, `daily-profit-order-${index}`);
      const settled = await settleAmount(staff, order, order.totalAmount, `daily-profit-settle-${index}`);
      expect(settled.statusCode, settled.body).toBe(201);
      await app.prisma.orderConsumption.updateMany({ where: { orderId: order.id }, data: { recognizedAt: new Date(recognizedAt) } });
    }
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/reports/gross-profit?fromDate=2026-01-01&toDate=2026-01-03", cookies: manager });
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data;
    expect(data.daily).toEqual([
      { date: "2026-01-01", netSalesAmount: 0, theoreticalCogsAmount: 0, grossProfitAmount: 0, grossMarginPercent: null, incompleteOrderItemCount: 0 },
      { date: "2026-01-02", netSalesAmount: 1000, theoreticalCogsAmount: 200, grossProfitAmount: 800, grossMarginPercent: "80.00", incompleteOrderItemCount: 0 },
      { date: "2026-01-03", netSalesAmount: 1000, theoreticalCogsAmount: 200, grossProfitAmount: 800, grossMarginPercent: "80.00", incompleteOrderItemCount: 0 },
    ]);
    expect(data.daily.reduce((sum: number, day: any) => sum + day.netSalesAmount, 0)).toBe(data.totals.netSalesAmount);
    expect(data.daily.reduce((sum: number, day: any) => sum + day.grossProfitAmount, 0)).toBe(data.totals.grossProfitAmount);
    expect(data.costCoverage).toMatchObject({ totalEligibleNetSalesAmount: data.totals.netSalesAmount, completeCostRevenueAmount: data.totals.netSalesAmount, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCoveragePercent: "0.00" });
  });

  it("consumes stock for staff benefits and restores it on manager removal", async () => {
    const manager = await session(UserRole.DEVELOPER, "benefit-inventory.manager");
    const staff = await session(UserRole.STAFF, "benefit-inventory.staff");
    const product = await productFixture("Staff benefit coffee");
    const stockItemId = await stockFixture(manager, "Benefit beans", "1000", 10_000);
    await recipeFixture(manager, product.id, stockItemId);
    const created = await app.inject({ method: "POST", url: "/api/v1/staff-consumption", cookies: staff, headers: { "idempotency-key": "staff-benefit-inventory-001" }, payload: { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] } });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.id;
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } })).quantityOnHand.toString()).toBe("920");
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: id } })).toMatchObject({ status: "POSTED", paymentSettlementId: null });
    const removed = await app.inject({ method: "POST", url: `/api/v1/orders/${id}/delete`, cookies: manager, payload: { expectedVersion: 1 } });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } })).quantityOnHand.toString()).toBe("1000");
  });
  it("consumes only retained items when removing the final unpaid line closes an item-paid order", async () => {
    const manager = await session(UserRole.DEVELOPER, "unpaid-removal.manager");
    const staff = await session(UserRole.STAFF, "unpaid-removal.staff");
    const paid = await productFixture("Retained coffee");
    const unpaid = await productFixture("Removed coffee");
    const stockItemId = await stockFixture(manager, "Removal beans", "1000", 10_000);
    await recipeFixture(manager, paid.id, stockItemId);
    await recipeFixture(manager, unpaid.id, stockItemId);
    const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "inventory-unpaid-removal-order" }, payload: { channel: "TAKEAWAY", items: [{ productId: paid.id, quantity: 1, options: [] }, { productId: unpaid.id, quantity: 1, options: [] }] } });
    expect(created.statusCode, created.body).toBe(201);
    const order = created.json().data;
    const settled = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staff, headers: { "idempotency-key": "inventory-unpaid-removal-payment" }, payload: { expectedVersion: order.version, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 1_000 }] } });
    expect(settled.statusCode, settled.body).toBe(201);
    expect(await app.prisma.orderConsumption.count()).toBe(0);
    const payload = { expectedVersion: settled.json().data.version, itemUpdates: [{ orderItemId: order.items[1].id, quantity: 0 }] };
    const removed = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().data).toMatchObject({ state: "CLOSED", paymentStatus: "PAID", totalAmount: 1_000, paidAmount: 1_000, balanceAmount: 0 });
    const balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("920");
    expect(balance.carryingValueAmount).toBe(9_200);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(consumption).toMatchObject({ status: "POSTED", theoreticalCogsAmount: 800n });
    expect(consumption.items.map((item) => item.orderItemId)).toEqual([order.items[0].id]);
    const retry = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload });
    expect(retry.statusCode).toBe(409);
    expect(await app.prisma.inventoryMovement.count({ where: { kind: "ORDER_CONSUMPTION" } })).toBe(1);
  });

  it("initializes a new stock item after other items are tracked while preventing a tracked item from being reopened", async () => {
    const manager = await session(UserRole.DEVELOPER, "opening-per-item.manager");
    const first = await stockFixture(manager, "Existing opening beans", "100", 1000);
    const second = await stockFixture(manager, "Later opening beans", "200", 2000);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: first } })).quantityOnHand.toString()).toBe("100");
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: second } })).quantityOnHand.toString()).toBe("200");
    const reset = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/stock-items/${first}`, cookies: manager, payload: { expectedVersion: 1, openingQuantity: "0", openingValueAmount: 0 } });
    expect(reset.statusCode, reset.body).toBe(409);
    expect(reset.json().error.code).toBe("INVALID_STATE");
    const zero = await stockFixture(manager, "Empty opening beans", "0", 0);
    expect(await app.prisma.inventoryMovement.count({ where: { stockItemId: zero, kind: "OPENING_COUNT" } })).toBe(0);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: zero } })).trackingStartedAt).not.toBeNull();
    const resetZero = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/stock-items/${zero}`, cookies: manager, payload: { expectedVersion: 1, openingQuantity: "10", openingValueAmount: 100 } });
    expect(resetZero.statusCode, resetZero.body).toBe(409);
  });
  it("values package-count and direct opening stock from the saved reference purchase price", async () => {
    const manager = await session(UserRole.DEVELOPER, "reference-package.manager");
    const payload = {
      name: "Hot chocolate powder",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "kg", packageQuantity: "2", priceAmount: 400_000 },
      openingStock: { method: "PACKAGE_COUNT", packageCount: 3, looseQuantity: "300" },
      conversions: [{ label: "kg", baseQuantityPerPack: "1000", isActive: true }],
    };
    const packaged = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload });
    expect(packaged.statusCode, packaged.body).toBe(201);
    expect(packaged.json().data).toMatchObject({
      referencePurchase: { conversionLabel: "kg", packageQuantity: "2", baseQuantityPerPack: "1000", priceAmount: 400_000 },
      balance: { quantityOnHand: "6300", carryingValueAmount: 1_260_000, movingAverageCostPerBaseUnit: "200.000000" },
    });

    const direct = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      ...payload,
      name: "Hot chocolate powder direct",
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "6300" },
    } });
    expect(direct.statusCode, direct.body).toBe(201);
    expect(direct.json().data.balance).toMatchObject({ quantityOnHand: "6300", carryingValueAmount: 1_260_000 });

    const opening = await app.prisma.inventoryCount.findFirstOrThrow({ where: { lines: { some: { stockItemId: packaged.json().data.id } } }, include: { lines: true } });
    expect(opening.lines[0]!.observedQuantity.toString()).toBe("6300");
    expect(opening.lines[0]!.observedValueAmount).toBe(1_260_000);
    const movement = await app.prisma.inventoryMovement.findFirstOrThrow({ where: { stockItemId: packaged.json().data.id, kind: "OPENING_COUNT" } });
    expect(movement.quantityDelta.toString()).toBe("6300");
    expect(movement.valueDeltaAmount).toBe(1_260_000);
  });
  it("supports volume and piece packages, zero opening stock, and half-up opening-value rounding", async () => {
    const manager = await session(UserRole.DEVELOPER, "package-units.manager");
    const volume = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Oat milk",
      category: "Ingredients",
      baseUnit: "MILLILITER",
      referencePurchase: { conversionLabel: "liter", packageQuantity: "1.5", priceAmount: 180_000 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "2250" },
      conversions: [{ label: "liter", baseQuantityPerPack: "1000", isActive: true }],
    } });
    expect(volume.statusCode, volume.body).toBe(201);
    expect(volume.json().data.balance).toMatchObject({ quantityOnHand: "2250", carryingValueAmount: 270_000 });

    const pieces = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Paper cups",
      category: "Packaging",
      baseUnit: "PIECE",
      referencePurchase: { conversionLabel: "PIECE", packageQuantity: "12", priceAmount: 2_400 },
      openingStock: { method: "PACKAGE_COUNT", packageCount: 2, looseQuantity: "3" },
      conversions: [],
    } });
    expect(pieces.statusCode, pieces.body).toBe(201);
    expect(pieces.json().data.balance).toMatchObject({ quantityOnHand: "27", carryingValueAmount: 5_400 });

    const cases = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Cases of cups",
      category: "Packaging",
      baseUnit: "PIECE",
      referencePurchase: { conversionLabel: "case", packageQuantity: "1", priceAmount: 12_000 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0" },
      conversions: [{ label: "case", baseQuantityPerPack: "24", isActive: true }],
    } });
    expect(cases.statusCode, cases.body).toBe(201);
    expect(cases.json().data.referencePurchase).toMatchObject({ conversionLabel: "case", baseQuantityPerPack: "24", priceAmount: 12_000 });

    const zero = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Zero opening cups",
      category: "Packaging",
      baseUnit: "PIECE",
      referencePurchase: { conversionLabel: "PIECE", packageQuantity: "12", priceAmount: 2_400 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0" },
      conversions: [],
    } });
    expect(zero.statusCode, zero.body).toBe(201);
    expect(zero.json().data.balance).toMatchObject({ quantityOnHand: "0", carryingValueAmount: 0 });
    expect(await app.prisma.inventoryMovement.count({ where: { stockItemId: zero.json().data.id, kind: "OPENING_COUNT" } })).toBe(0);

    const rounded = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Rounding test",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "GRAM", packageQuantity: "3", priceAmount: 1 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "1.5" },
      conversions: [],
    } });
    expect(rounded.statusCode, rounded.body).toBe(201);
    expect(rounded.json().data.balance).toMatchObject({ quantityOnHand: "1.5", carryingValueAmount: 1 });
  });
  it("rejects positive opening stock without a usable reference package and preserves tracked balances when package settings change", async () => {
    const manager = await session(UserRole.DEVELOPER, "reference-validation.manager");
    const missingCost = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Unpriced opening stock",
      category: "Ingredients",
      baseUnit: "GRAM",
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "1" },
      conversions: [],
    } });
    expect(missingCost.statusCode, missingCost.body).toBe(422);

    const imprecisePackage = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Inexact package size",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "fraction", packageQuantity: "0.123456", priceAmount: 100 },
      openingStock: { method: "PACKAGE_COUNT", packageCount: 0, looseQuantity: "0" },
      conversions: [{ label: "fraction", baseQuantityPerPack: "0.123456", isActive: true }],
    } });
    expect(imprecisePackage.statusCode, imprecisePackage.body).toBe(422);

    const inactiveUnit = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Inactive package unit",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "bag", packageQuantity: "1", priceAmount: 100 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "10" },
      conversions: [{ label: "bag", baseQuantityPerPack: "1000", isActive: false }],
    } });
    expect(inactiveUnit.statusCode, inactiveUnit.body).toBe(422);

    const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Reference price edit",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "kg", packageQuantity: "1", priceAmount: 100_000 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "500" },
      conversions: [{ label: "kg", baseQuantityPerPack: "1000", isActive: true }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const item = created.json().data;
    const before = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: item.id } });
    const movementCount = await app.prisma.inventoryMovement.count({ where: { stockItemId: item.id } });
    const changed = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/stock-items/${item.id}`, cookies: manager, payload: {
      expectedVersion: item.version,
      referencePurchase: { conversionLabel: "kg", packageQuantity: "2", priceAmount: 250_000 },
      conversions: item.conversions,
    } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().data.referencePurchase).toMatchObject({ packageQuantity: "2", priceAmount: 250_000 });
    const after = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: item.id } });
    expect(after.quantityOnHand.eq(before.quantityOnHand)).toBe(true);
    expect(after.carryingValueAmount).toBe(before.carryingValueAmount);
    expect(await app.prisma.inventoryMovement.count({ where: { stockItemId: item.id } })).toBe(movementCount);
  });
  it("keeps omitted classification unchanged, validates opening discriminators before AJV cleanup, and preserves legacy opening defaults", async () => {
    const manager = await session(UserRole.DEVELOPER, "opening-compatibility.manager");
    const malformed = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Wrong opening fields",
      category: "Ingredients",
      baseUnit: "GRAM",
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0", packageCount: 0, looseQuantity: "0" },
      conversions: [],
    } });
    expect(malformed.statusCode, malformed.body).toBe(400);
    expect(await app.prisma.stockItem.count({ where: { name: "Wrong opening fields" } })).toBe(0);

    const legacy = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Legacy single opening field",
      category: "Ingredients",
      baseUnit: "GRAM",
      isPackagingMaterial: true,
      openingQuantity: "5",
      conversions: [],
    } });
    expect(legacy.statusCode, legacy.body).toBe(201);
    expect(legacy.json().data).toMatchObject({
      isPackagingMaterial: true,
      balance: { quantityOnHand: "5", carryingValueAmount: 0 },
    });

    const onlyReferenceUpdate = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/stock-items/" + legacy.json().data.id, cookies: manager, payload: {
      expectedVersion: legacy.json().data.version,
      referencePurchase: { conversionLabel: "GRAM", packageQuantity: "1", priceAmount: 100 },
    } });
    expect(onlyReferenceUpdate.statusCode, onlyReferenceUpdate.body).toBe(200);
    expect(onlyReferenceUpdate.json().data.isPackagingMaterial).toBe(true);
  });
  it("rejects a large conversion product that only appears exact after decimal rounding", async () => {
    const manager = await session(UserRole.DEVELOPER, "large-exactness.manager");
    const response = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Large inexact package",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "pack", packageQuantity: "99999999999.999999", priceAmount: 100 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0" },
      conversions: [{ label: "pack", baseQuantityPerPack: "1.000001", isActive: true }],
    } });
    expect(response.statusCode, response.body).toBe(422);
    expect(await app.prisma.stockItem.count({ where: { name: "Large inexact package" } })).toBe(0);

    const purchasable = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Large purchase precision",
      category: "Ingredients",
      baseUnit: "GRAM",
      conversions: [{ label: "pack", baseQuantityPerPack: "1.000001", isActive: true }],
    } });
    expect(purchasable.statusCode, purchasable.body).toBe(201);
    const rejectedPurchase = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: {
      receivedAt: new Date().toISOString(),
      lines: [{ stockItemId: purchasable.json().data.id, conversionId: purchasable.json().data.conversions[0].id, purchaseUnitLabel: "pack", purchaseQuantity: "99999999999.999999", directCostAmount: 100 }],
    } });
    expect(rejectedPurchase.statusCode, rejectedPurchase.body).toBe(422);

    const valid = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Large exact package",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "pack", packageQuantity: "99999999999.999999", priceAmount: 100 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0" },
      conversions: [{ label: "pack", baseQuantityPerPack: "1.000000", isActive: true }],
    } });
    expect(valid.statusCode, valid.body).toBe(201);
    const item = valid.json().data;
    const changedConversion = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/stock-items/" + item.id, cookies: manager, payload: {
      expectedVersion: item.version,
      conversions: [{ id: item.conversions[0].id, label: "pack", baseQuantityPerPack: "1.000001", isActive: true }],
    } });
    expect(changedConversion.statusCode, changedConversion.body).toBe(422);
    expect((await app.prisma.stockUnitConversion.findUniqueOrThrow({ where: { id: item.conversions[0].id } })).baseQuantityPerPack.toString()).toBe("1");
  });
  it("rejects a named conversion that collides with the base-unit selector token", async () => {
    const manager = await session(UserRole.DEVELOPER, "base-token-collision.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Token collision stock",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "pack", packageQuantity: "2", priceAmount: 400_000 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0" },
      conversions: [{ label: "pack", baseQuantityPerPack: "1000", isActive: true }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const item = created.json().data;
    const renamed = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/stock-items/" + item.id, cookies: manager, payload: {
      expectedVersion: item.version,
      conversions: [{ id: item.conversions[0].id, label: "GRAM", baseQuantityPerPack: "1000", isActive: true }],
    } });
    expect(renamed.statusCode, renamed.body).toBe(422);
    expect((await app.prisma.stockUnitConversion.findUniqueOrThrow({ where: { id: item.conversions[0].id } })).label).toBe("pack");

    const legacyId = await stockFixture(manager, "Legacy token collision", "0", 0);
    const legacy = await app.prisma.stockItem.findUniqueOrThrow({ where: { id: legacyId }, include: { conversions: true } });
    const legacyConversion = legacy.conversions[0]!;
    await app.prisma.stockUnitConversion.update({ where: { id: legacyConversion.id }, data: { label: "GRAM" } });
    const preservedLegacy = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/stock-items/" + legacyId, cookies: manager, payload: {
      expectedVersion: legacy.version,
      isPackagingMaterial: true,
      conversions: [{ id: legacyConversion.id, label: "GRAM", baseQuantityPerPack: "1000", isActive: true }],
    } });
    expect(preservedLegacy.statusCode, preservedLegacy.body).toBe(200);
    expect(preservedLegacy.json().data.isPackagingMaterial).toBe(true);

    const createCollision = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "New token collision stock",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "GRAM", packageQuantity: "2", priceAmount: 400_000 },
      conversions: [{ label: "GRAM", baseQuantityPerPack: "1000", isActive: true }],
    } });
    expect(createCollision.statusCode, createCollision.body).toBe(422);
  });
  it("keeps recorded purchase conversions and costs fixed when the reference package is changed", async () => {
    const manager = await session(UserRole.DEVELOPER, "reference-history.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Snapshot cocoa",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "kg", packageQuantity: "2", priceAmount: 400_000 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0" },
      conversions: [{ label: "kg", baseQuantityPerPack: "1000", isActive: true }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const item = created.json().data;
    const conversionId = item.conversions[0].id as string;
    const firstDraft = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: {
      receivedAt: new Date().toISOString(),
      lines: [{ stockItemId: item.id, conversionId, purchaseUnitLabel: "kg", purchaseQuantity: "2", directCostAmount: 400_000 }],
    } });
    expect(firstDraft.statusCode, firstDraft.body).toBe(201);
    expect(firstDraft.json().data.lines[0]).toMatchObject({ baseQuantityPerPack: "1000", baseQuantityReceived: "2000", directCostAmount: 400_000 });

    const changed = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/stock-items/" + item.id, cookies: manager, payload: {
      expectedVersion: item.version,
      referencePurchase: { conversionLabel: "sack", packageQuantity: "1", priceAmount: 500_000 },
      conversions: [{ id: conversionId, label: "sack", baseQuantityPerPack: "2000", isActive: true }],
    } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().data.referencePurchase).toMatchObject({ conversionId, conversionLabel: "sack", packageQuantity: "1", baseQuantityPerPack: "2000", priceAmount: 500_000 });

    const metadataEdit = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/purchases/" + firstDraft.json().data.id, cookies: manager, payload: {
      expectedVersion: firstDraft.json().data.version,
      supplier: "Metadata-only edit",
      receivedAt: firstDraft.json().data.receivedAt,
      lines: firstDraft.json().data.lines.map((line: any) => ({
        id: line.id,
        stockItemId: line.stockItemId,
        conversionId: line.conversionId,
        purchaseUnitLabel: line.purchaseUnitLabel,
        purchaseQuantity: line.purchaseQuantity,
        directCostAmount: line.directCostAmount,
      })),
    } });
    expect(metadataEdit.statusCode, metadataEdit.body).toBe(200);
    expect(metadataEdit.json().data.lines[0]).toMatchObject({ purchaseUnitLabel: "kg", baseQuantityPerPack: "1000", baseQuantityReceived: "2000", directCostAmount: 400_000 });

    const postedOld = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases/" + firstDraft.json().data.id + "/post", cookies: manager, headers: { "idempotency-key": "reference-history-old-receipt" }, payload: { expectedVersion: metadataEdit.json().data.version } });
    expect(postedOld.statusCode, postedOld.body).toBe(200);
    expect(postedOld.json().data.lines[0]).toMatchObject({ purchaseUnitLabel: "kg", baseQuantityPerPack: "1000", baseQuantityReceived: "2000", directCostAmount: 400_000 });

    const secondDraft = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: {
      receivedAt: new Date().toISOString(),
      lines: [{ stockItemId: item.id, conversionId, purchaseUnitLabel: "sack", purchaseQuantity: "1", directCostAmount: 500_000 }],
    } });
    expect(secondDraft.statusCode, secondDraft.body).toBe(201);
    expect(secondDraft.json().data.lines[0]).toMatchObject({ purchaseUnitLabel: "sack", baseQuantityPerPack: "2000", baseQuantityReceived: "2000", directCostAmount: 500_000 });
    const postedNew = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases/" + secondDraft.json().data.id + "/post", cookies: manager, headers: { "idempotency-key": "reference-history-new-receipt" }, payload: { expectedVersion: 1 } });
    expect(postedNew.statusCode, postedNew.body).toBe(200);
    const balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: item.id } });
    expect(balance.quantityOnHand.toString()).toBe("4000");
    expect(balance.carryingValueAmount).toBe(900_000);
  });
  it("preserves a draft's saved quantity factor across a factor-only conversion edit", async () => {
    const manager = await session(UserRole.DEVELOPER, "factor-only-snapshot.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Factor-only cocoa",
      category: "Ingredients",
      baseUnit: "GRAM",
      referencePurchase: { conversionLabel: "kg", packageQuantity: "2", priceAmount: 400_000 },
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0" },
      conversions: [{ label: "kg", baseQuantityPerPack: "1000", isActive: true }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const item = created.json().data;
    const conversionId = item.conversions[0].id as string;
    const draft = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: {
      receivedAt: new Date().toISOString(),
      lines: [{ stockItemId: item.id, conversionId, purchaseUnitLabel: "kg", purchaseQuantity: "2", directCostAmount: 400_000 }],
    } });
    expect(draft.statusCode, draft.body).toBe(201);
    const changed = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/stock-items/" + item.id, cookies: manager, payload: {
      expectedVersion: item.version,
      referencePurchase: { conversionLabel: "kg", packageQuantity: "1", priceAmount: 500_000 },
      conversions: [{ id: conversionId, label: "kg", baseQuantityPerPack: "2000", isActive: true }],
    } });
    expect(changed.statusCode, changed.body).toBe(200);

    const saved = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/purchases/" + draft.json().data.id, cookies: manager, payload: {
      expectedVersion: draft.json().data.version,
      supplier: "Metadata only",
      lines: draft.json().data.lines.map((line: any) => ({
        id: line.id,
        stockItemId: line.stockItemId,
        conversionId: line.conversionId,
        purchaseUnitLabel: line.purchaseUnitLabel,
        purchaseQuantity: line.purchaseQuantity,
        directCostAmount: line.directCostAmount,
      })),
    } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data.lines[0]).toMatchObject({ baseQuantityPerPack: "1000", baseQuantityReceived: "2000", directCostAmount: 400_000 });

    const reapplied = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/purchases/" + draft.json().data.id, cookies: manager, payload: {
      expectedVersion: saved.json().data.version,
      lines: saved.json().data.lines.map((line: any) => ({
        id: line.id,
        stockItemId: line.stockItemId,
        conversionId: line.conversionId,
        purchaseUnitLabel: line.purchaseUnitLabel,
        purchaseQuantity: line.purchaseQuantity,
        directCostAmount: line.directCostAmount,
        useCurrentConversion: true,
      })),
    } });
    expect(reapplied.statusCode, reapplied.body).toBe(200);
    expect(reapplied.json().data.lines[0]).toMatchObject({ baseQuantityPerPack: "2000", baseQuantityReceived: "4000", directCostAmount: 400_000 });

    const subsequent = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: {
      receivedAt: new Date().toISOString(),
      lines: [{ stockItemId: item.id, conversionId, purchaseUnitLabel: "kg", purchaseQuantity: "2", directCostAmount: 500_000 }],
    } });
    expect(subsequent.statusCode, subsequent.body).toBe(201);
    expect(subsequent.json().data.lines[0]).toMatchObject({ baseQuantityPerPack: "2000", baseQuantityReceived: "4000", directCostAmount: 500_000 });
  });
  it("keeps line snapshots distinct when a new duplicate precedes an identified row", async () => {
    const manager = await session(UserRole.DEVELOPER, "duplicate-line-snapshot.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Duplicate snapshot cocoa",
      category: "Ingredients",
      baseUnit: "GRAM",
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0" },
      conversions: [{ label: "pack", baseQuantityPerPack: "1000", isActive: true }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const item = created.json().data;
    const conversionId = item.conversions[0].id as string;
    const draft = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: {
      receivedAt: new Date().toISOString(),
      lines: [{ stockItemId: item.id, conversionId, purchaseUnitLabel: "pack", purchaseQuantity: "3", directCostAmount: 300_000 }],
    } });
    expect(draft.statusCode, draft.body).toBe(201);
    const factorEdit = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/stock-items/" + item.id, cookies: manager, payload: {
      expectedVersion: item.version,
      conversions: [{ id: conversionId, label: "pack", baseQuantityPerPack: "2000", isActive: true }],
    } });
    expect(factorEdit.statusCode, factorEdit.body).toBe(200);

    const twoRows = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/purchases/" + draft.json().data.id, cookies: manager, payload: {
      expectedVersion: draft.json().data.version,
      lines: [
        { stockItemId: item.id, conversionId, purchaseUnitLabel: "pack", purchaseQuantity: "3", directCostAmount: 300_000 },
        {
          id: draft.json().data.lines[0].id,
          stockItemId: draft.json().data.lines[0].stockItemId,
          conversionId: draft.json().data.lines[0].conversionId,
          purchaseUnitLabel: draft.json().data.lines[0].purchaseUnitLabel,
          purchaseQuantity: draft.json().data.lines[0].purchaseQuantity,
          directCostAmount: draft.json().data.lines[0].directCostAmount,
        },
      ],
    } });
    expect(twoRows.statusCode, twoRows.body).toBe(200);
    expect(twoRows.json().data.lines.map((line: any) => [line.baseQuantityPerPack, line.baseQuantityReceived])).toEqual([["2000", "6000"], ["1000", "3000"]]);

    const remaining = twoRows.json().data.lines[1]!;
    const deletedFirst = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/purchases/" + draft.json().data.id, cookies: manager, payload: {
      expectedVersion: twoRows.json().data.version,
      lines: [{
        id: remaining.id,
        stockItemId: remaining.stockItemId,
        conversionId: remaining.conversionId,
        purchaseUnitLabel: remaining.purchaseUnitLabel,
        purchaseQuantity: remaining.purchaseQuantity,
        directCostAmount: remaining.directCostAmount,
      }],
    } });
    expect(deletedFirst.statusCode, deletedFirst.body).toBe(200);
    expect(deletedFirst.json().data.lines[0]).toMatchObject({ baseQuantityPerPack: "1000", baseQuantityReceived: "3000", directCostAmount: 300_000 });
  });
  it("allows legacy duplicate-line edits when every matching snapshot has the same factor", async () => {
    const manager = await session(UserRole.DEVELOPER, "legacy-equivalent-lines.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: {
      name: "Equivalent snapshot cocoa",
      category: "Ingredients",
      baseUnit: "GRAM",
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0" },
      conversions: [{ label: "pack", baseQuantityPerPack: "1000", isActive: true }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const item = created.json().data;
    const conversionId = item.conversions[0].id as string;
    const draft = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: {
      receivedAt: new Date().toISOString(),
      lines: [
        { stockItemId: item.id, conversionId, purchaseUnitLabel: "pack", purchaseQuantity: "2", directCostAmount: 200_000 },
        { stockItemId: item.id, conversionId, purchaseUnitLabel: "pack", purchaseQuantity: "2", directCostAmount: 220_000 },
      ],
    } });
    expect(draft.statusCode, draft.body).toBe(201);
    const legacyResave = await app.inject({ method: "PATCH", url: "/api/v1/admin/inventory/purchases/" + draft.json().data.id, cookies: manager, payload: {
      expectedVersion: draft.json().data.version,
      lines: draft.json().data.lines.map(({ id: _id, ...line }: any) => line),
    } });
    expect(legacyResave.statusCode, legacyResave.body).toBe(200);
    expect(legacyResave.json().data.lines.map((line: any) => [line.baseQuantityPerPack, line.baseQuantityReceived, line.directCostAmount])).toEqual([
      ["1000", "2000", 200_000],
      ["1000", "2000", 220_000],
    ]);
  });
  it("rejects receipt value overflow and rolls back earlier lines in the same receipt", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-overflow.manager");
    const stockItemId = await stockFixture(manager, "Overflow beans", "100", 2_147_483_646);
    const line = { stockItemId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: "1", directCostAmount: 1 };
    const draft = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { receivedAt: "2026-10-14T08:00:00.000Z", lines: [line, line] } });
    expect(draft.statusCode, draft.body).toBe(201);
    const posted = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/purchases/${draft.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "inventory-overflow-receipt-01" }, payload: { expectedVersion: 1 } });
    expect(posted.statusCode, posted.body).toBe(422);
    expect(posted.json().error.code).toBe("BUSINESS_RULE_VIOLATION");
    const balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("100");
    expect(balance.carryingValueAmount).toBe(2_147_483_646);
    expect(await app.prisma.inventoryMovement.count({ where: { kind: "PURCHASE_RECEIPT" } })).toBe(0);
    expect((await app.prisma.purchase.findUniqueOrThrow({ where: { id: draft.json().data.id } })).status).toBe("DRAFT");
    expect(await app.prisma.idempotencyRecord.count({ where: { operation: "POST_INVENTORY_PURCHASE" } })).toBe(0);
  });
  it("returns field errors for blank suppliers, oversized quantities, and inexact pack conversions without saving a draft", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-errors.manager");
    const stock = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Precision beans", category: "Ingredients", baseUnit: "GRAM", conversions: [{ label: "pack", baseQuantityPerPack: "0.123456" }] } });
    expect(stock.statusCode, stock.body).toBe(201);
    const body = { receivedAt: "2026-10-14T08:00:00.000Z", supplier: null, lines: [{ stockItemId: stock.json().data.id, conversionId: stock.json().data.conversions[0].id, purchaseUnitLabel: "pack", purchaseQuantity: "0.123456", directCostAmount: 100 }] };
    const blank = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { ...body, supplier: "   " } });
    expect(blank.statusCode, blank.body).toBe(400);
    expect(blank.json().error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "supplier" })]));
    const large = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { ...body, lines: [{ ...body.lines[0], purchaseQuantity: "100000000000000" }] } });
    expect(large.statusCode, large.body).toBe(400);
    expect(large.json().error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "lines.0.purchaseQuantity" })]));
    const precision = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: body });
    expect(precision.statusCode, precision.body).toBe(422);
    expect(precision.json().error.details).toEqual([expect.objectContaining({ path: "lines.0.purchaseQuantity", code: "quantity_precision" })]);
    expect(await app.prisma.purchase.count()).toBe(0);
    const valid = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { ...body, lines: [{ ...body.lines[0], purchaseQuantity: "2" }] } });
    expect(valid.statusCode, valid.body).toBe(201);
    expect(valid.json().data.lines[0].baseQuantityReceived).toBe("0.246912");
    const stale = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/purchases/${valid.json().data.id}`, cookies: manager, payload: { expectedVersion: 2, supplier: "Another supplier" } });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.details).toEqual([{ path: "expectedVersion", code: "current_version", message: "Current version is 1." }]);
  });
  it("keeps saved recipes stable, retries whole pending orders at receipt-time moving average, and restores deleted stock once", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-flow.manager");
    const staff = await session(UserRole.STAFF, "inventory-flow.staff");
    const product = await productFixture("Inventory Latte");
    const stockItemId = await stockFixture(manager, "Inventory Beans", "100", 10_000);
    const recipe = await recipeFixture(manager, product.id, stockItemId);
    const order = await orderFixture(staff, product.id, 2, "inventory-flow-order-create-01");

    const partial = await settleAmount(staff, order, 400, "inventory-flow-payment-partial-01");
    expect(partial.statusCode, partial.body).toBe(201);
    expect(await app.prisma.orderConsumption.count({ where: { orderId: order.id } })).toBe(0);

    const changedRecipe = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/recipes/${recipe.id}`, cookies: manager, payload: { expectedVersion: 1, name: recipe.name, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "beans",  sourceKind: "STOCK_ITEM", stockItemId, quantity: "50", displayOrder: 0 }] } });
    expect(changedRecipe.statusCode, changedRecipe.body).toBe(200);

    const finalOrder = partial.json().data;
    const final = await settleAmount(staff, finalOrder, 1_600, "inventory-flow-payment-final-01");
    expect(final.statusCode, final.body).toBe(201);
    expect(final.json().data.paymentStatus).toBe("PAID");
    const consumption = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { orderId_paymentSettlementId: { orderId: order.id, paymentSettlementId: final.json().data.settlements.at(-1).id } }, include: { items: true } });
    expect(consumption.status).toBe("PENDING");
    expect(consumption.theoreticalCogsAmount).toBe(16_000n);
    expect(consumption.items[0]?.costSnapshot).toMatchObject({ components: [{ quantity: "160", knownCostAmount: 16_000 }] });

    const purchase = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { receivedAt: "2026-10-12T08:00:00.000Z", supplier: "Bean supplier", lines: [{ stockItemId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: "100", directCostAmount: 20_000 }] } });
    expect(purchase.statusCode, purchase.body).toBe(201);
    const purchaseId = purchase.json().data.id as string;
    const postUrl = `/api/v1/admin/inventory/purchases/${purchaseId}/post`;
    const payload = { expectedVersion: 1 };
    const posted = await app.inject({ method: "POST", url: postUrl, cookies: manager, headers: { "idempotency-key": "inventory-flow-post-purchase-01" }, payload });
    expect(posted.statusCode, posted.body).toBe(200);
    expect((await app.inject({ method: "POST", url: postUrl, cookies: manager, headers: { "idempotency-key": "inventory-flow-post-purchase-01" }, payload })).statusCode).toBe(200);
    await expect(app.prisma.inventoryMovement.count({ where: { kind: "PURCHASE_RECEIPT", purchaseLineId: purchase.json().data.lines[0].id } })).resolves.toBe(1);

    const retried = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } });
    expect(retried.status).toBe("POSTED");
    const consumed = await app.prisma.inventoryMovement.findFirstOrThrow({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } });
    expect(consumed.quantityDelta.toString()).toBe("-160");
    expect(consumed.valueDeltaAmount).toBe(-24_000);
    const balanceAfterSale = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balanceAfterSale.quantityOnHand.toString()).toBe("40");
    expect(balanceAfterSale.carryingValueAmount).toBe(6_000);

    const receipt = await app.inject({ method: "GET", url: `/api/v1/orders/${order.id}/receipt`, cookies: staff });
    expect(receipt.statusCode).toBe(200);
    expect(JSON.stringify(receipt.json().data)).not.toMatch(/knownCogs|grossProfit|movingAverage/i);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/inventory/stock-items", cookies: staff })).statusCode).toBe(403);

    const deleted = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/delete`, cookies: staff, payload: { expectedVersion: 3, reason: "Duplicate ticket" } });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const restored = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(restored.quantityOnHand.toString()).toBe("200");
    expect(restored.carryingValueAmount).toBe(30_000);
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_RESTORATION" } })).toBe(1);
  }, 15_000);

  it("reconciles a pending whole order to a physical count without deducting it again", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-count.manager");
    const staff = await session(UserRole.STAFF, "inventory-count.staff");
    const product = await productFixture("Counted Mocha");
    const stockItemId = await stockFixture(manager, "Counted Beans", "100", 10_000);
    await recipeFixture(manager, product.id, stockItemId);
    const order = await orderFixture(staff, product.id, 2, "inventory-count-order-create-01");
    const settled = await settleAmount(staff, order, 2_000, "inventory-count-settlement-01");
    expect(settled.statusCode, settled.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { orderId_paymentSettlementId: { orderId: order.id, paymentSettlementId: settled.json().data.settlements[0].id } } });

    const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", reason: "شمارش دوره‌ای", lines: [{ stockItemId, observedQuantity: "20", observedValueAmount: 2_000 }] } });
    expect(count.statusCode, count.body).toBe(201);
    const posted = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${count.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "inventory-count-post-physical-01" }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [consumption.id] } });
    expect(posted.statusCode, posted.body).toBe(200);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } })).quantityOnHand.toString()).toBe("20");
    expect((await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } })).status).toBe("RECONCILED");
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } })).toBe(0);

    const deleted = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/delete`, cookies: staff, payload: { expectedVersion: 2, reason: "Cancelled order" } });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const restored = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(restored.quantityOnHand.toString()).toBe("180");
    expect(restored.carryingValueAmount).toBe(18_000);
  });

  it("restores a posted order consumption when its final settlement is reversed", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-reversal.manager");
    const staff = await session(UserRole.STAFF, "inventory-reversal.staff");
    const product = await productFixture("Reversal Cappuccino");
    const stockItemId = await stockFixture(manager, "Reversal Beans", "200", 20_000);
    await recipeFixture(manager, product.id, stockItemId);
    const order = await orderFixture(staff, product.id, 1, "inventory-reversal-order-create-01");
    const settled = await settleAmount(staff, order, 1_000, "inventory-reversal-settlement-01");
    expect(settled.statusCode, settled.body).toBe(201);
    const settlementId = settled.json().data.settlements[0].id as string;
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } })).quantityOnHand.toString()).toBe("120");

    const reversed = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/reverse`, cookies: manager, payload: { expectedVersion: 2, reason: "Incorrectly posted final payment" } });
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(reversed.json().data).toMatchObject({ paymentStatus: "UNPAID", state: "OPEN" });
    const restored = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(restored.quantityOnHand.toString()).toBe("200");
    expect(restored.carryingValueAmount).toBe(20_000);
    expect(await app.prisma.inventoryMovement.count({ where: { kind: "ORDER_RESTORATION" } })).toBe(1);
  });

  it("previews option overrides and weighted purchased items and rejects recipe cycles", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-preview.manager");
    const stockItemId = await stockFixture(manager, "Preview Beans", "200", 20_000);
    const category = await app.prisma.category.create({ data: { name: "Preview drinks", displayOrder: 1 } });
    const group = await app.prisma.optionGroup.create({ data: { name: "Preview options" } });
    const double = await app.prisma.option.create({ data: { optionGroupId: group.id, name: "Double shot", priceAmount: 0, displayOrder: 1 } });
    const oat = await app.prisma.option.create({ data: { optionGroupId: group.id, name: "Oat milk", priceAmount: 0, displayOrder: 2 } });
    const product = await app.prisma.product.create({ data: { categoryId: category.id, name: "Preview drink", priceAmount: 1_000, preparationDeadlineMinutes: 5, displayOrder: 1, productOptionGroups: { create: { optionGroupId: group.id, displayOrder: 1, minSelections: 0, maxSelections: 2, allowedOptions: { create: [{ optionId: double.id, displayOrder: 1 }, { optionId: oat.id, displayOrder: 2 }] } } } } });
    const recipe = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/recipes", cookies: manager, payload: { name: "Preview base recipe", outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "beans",  sourceKind: "STOCK_ITEM", stockItemId, quantity: "18", displayOrder: 0 }] } });
    expect(recipe.statusCode, recipe.body).toBe(201);
    const recipeId = recipe.json().data.id as string;
    const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId, recipeQuantity: "1", optionRules: [{ optionId: double.id, rules: [{ action: "CHANGE_QUANTITY", componentKey: "beans", quantity: "36" }] }], combinations: [{ name: "Double with oat", optionIds: [double.id, oat.id], rules: [{ action: "CHANGE_QUANTITY", componentKey: "beans", quantity: "40" }] }] } });
    expect(configured.statusCode, configured.body).toBe(200);
    const basePreview = await app.inject({ method: "POST", url: `/api/v1/admin/products/${product.id}/costing/preview`, cookies: manager, payload: { optionIds: [], quantity: 1 } });
    expect(basePreview.statusCode, basePreview.body).toBe(200);
    expect(basePreview.json().data).toMatchObject({ isComplete: true, knownCostAmount: 1_800, components: [{ quantity: "18" }] });
    const doublePreview = await app.inject({ method: "POST", url: `/api/v1/admin/products/${product.id}/costing/preview`, cookies: manager, payload: { optionIds: [double.id], quantity: 1 } });
    expect(doublePreview.json().data).toMatchObject({ knownCostAmount: 3_600, components: [{ quantity: "36" }] });
    const comboPreview = await app.inject({ method: "POST", url: `/api/v1/admin/products/${product.id}/costing/preview`, cookies: manager, payload: { optionIds: [double.id, oat.id], quantity: 1 } });
    expect(comboPreview.json().data).toMatchObject({ knownCostAmount: 4_000, components: [{ quantity: "40" }] });

    const reusable = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/recipes", cookies: manager, payload: { name: "Reusable preview recipe", outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "base",  sourceKind: "RECIPE", nestedRecipeId: recipeId, quantity: "1", displayOrder: 0 }] } });
    expect(reusable.statusCode, reusable.body).toBe(201);
    const cyclicEdit = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/recipes/${recipeId}`, cookies: manager, payload: { expectedVersion: 1, name: "Preview base recipe", outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "base",  sourceKind: "RECIPE", nestedRecipeId: reusable.json().data.id, quantity: "1", displayOrder: 0 }] } });
    expect(cyclicEdit.statusCode).toBe(422);

    const weightedCategory = await app.prisma.category.create({ data: { name: "Weighted preview", displayOrder: 2 } });
    const weightedProduct = await app.prisma.product.create({ data: { categoryId: weightedCategory.id, name: "Weighted dessert", priceAmount: 100_000, pricingMode: "WEIGHTED_PER_KG", preparationDeadlineMinutes: 5, displayOrder: 1 } });
    const weightedConfig = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${weightedProduct.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "PURCHASED_ITEM", purchasedStockItemId: stockItemId, optionRules: [], combinations: [] } });
    expect(weightedConfig.statusCode, weightedConfig.body).toBe(200);
    const weightedPreview = await app.inject({ method: "POST", url: `/api/v1/admin/products/${weightedProduct.id}/costing/preview`, cookies: manager, payload: { optionIds: [], quantity: 1, weightGrams: 250 } });
    expect(weightedPreview.statusCode, weightedPreview.body).toBe(200);
    expect(weightedPreview.json().data).toMatchObject({ isComplete: true, knownCostAmount: 25_000, components: [{ quantity: "250" }] });
  });

  it("reports full-payment revenue and theoretical costs by Tehran date to Developers only", async () => {
    const manager = await session(UserRole.DEVELOPER, "gross-profit.manager");
    const staff = await session(UserRole.STAFF, "gross-profit.staff");
    const product = await productFixture("Gross Profit Espresso");
    const stockItemId = await stockFixture(manager, "Gross Profit Beans", "100", 10_000);
    const beforeReportPeriod = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    await app.prisma.inventoryBalance.update({ where: { stockItemId }, data: { trackingStartedAt: beforeReportPeriod } });
    const untracked = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Untracked gross profit item", category: "Ingredients", baseUnit: "GRAM", conversions: [] } });
    expect(untracked.statusCode, untracked.body).toBe(201);
    await recipeFixture(manager, product.id, stockItemId);
    const order = await orderFixture(staff, product.id, 1, "gross-profit-order-create-01");
    const settled = await settleAmount(staff, order, order.totalAmount, "gross-profit-settlement-01");
    expect(settled.statusCode, settled.body).toBe(201);

    const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const url = `/api/v1/admin/reports/gross-profit?fromDate=${reportDate}&toDate=${reportDate}`;
    expect((await app.inject({ method: "GET", url, cookies: staff })).statusCode).toBe(403);
    const report = await app.inject({ method: "GET", url, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data).toMatchObject({
      totals: { netSalesAmount: order.totalAmount, theoreticalCogsAmount: 8_000, knownCogsAmount: 8_000, grossProfitAmount: order.totalAmount - 8_000, grossMarginPercent: ((order.totalAmount - 8_000) / order.totalAmount * 100).toFixed(2) },
      products: [{ productId: product.id, netSalesAmount: order.totalAmount, theoreticalCogsAmount: 8_000, completeOrderItemCount: 1, incompleteOrderItemCount: 0 }],
      costCoverage: { completeOrderItemCount: 1, incompleteOrderItemCount: 0 },
      pendingConsumptionCount: 0,
      inventoryConsumption: { amount: 8_000, isEstimate: true, varianceAmount: 0, missingValuationCount: 0 },
    });
    expect(new Date(report.json().meta.range.from).getTime()).toBeLessThan(Date.now());
    expect(new Date(report.json().meta.range.to).getTime()).toBeGreaterThan(Date.now());

    const tooLong = await app.inject({ method: "GET", url: "/api/v1/admin/reports/gross-profit?fromDate=2024-01-01&toDate=2025-01-02", cookies: manager });
    expect(tooLong.statusCode).toBe(400);
    const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    const future = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${futureDate}&toDate=${futureDate}`, cookies: manager });
    expect(future.statusCode).toBe(422);
  });

  it("reports persisted catalog, item, and order discounts and removes a reversed sale from its original period", async () => {
    const manager = await session(UserRole.DEVELOPER, "gross-profit-discount.manager");
    const staff = await session(UserRole.STAFF, "gross-profit-discount.staff");
    const catalogDiscountProduct = await productFixture("Catalog-discount gross-profit coffee");
    const itemDiscountProduct = await productFixture("Item-discount gross-profit coffee");
    for (const product of [catalogDiscountProduct, itemDiscountProduct]) await app.prisma.product.update({ where: { id: product.id }, data: { priceAmount: 100_000 } });
    const stockItemId = await stockFixture(manager, "Discounted gross-profit beans", "100", 10_000);
    const recipe = await recipeFixture(manager, catalogDiscountProduct.id, stockItemId);
    const secondCosting = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${itemDiscountProduct.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: recipe.id, recipeQuantity: "1", optionRules: [], combinations: [] } });
    expect(secondCosting.statusCode, secondCosting.body).toBe(200);
    const catalogDiscount = await app.inject({ method: "PATCH", url: `/api/v1/admin/products/${catalogDiscountProduct.id}/sale-discount`, cookies: manager, payload: { saleDiscount: { kind: "PERCENTAGE", value: 10 } } });
    expect(catalogDiscount.statusCode, catalogDiscount.body).toBe(200);

    const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "gross-profit-discount-order-create-01" }, payload: { channel: "TAKEAWAY", items: [{ productId: catalogDiscountProduct.id, quantity: 1, options: [] }, { productId: itemDiscountProduct.id, quantity: 1, options: [] }] } });
    expect(created.statusCode, created.body).toBe(201);
    const order = created.json().data;
    const itemDiscount = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload: { expectedVersion: order.version, itemUpdates: [{ orderItemId: order.items[1].id, discount: { kind: "FIXED", value: 10_000 } }] } });
    expect(itemDiscount.statusCode, itemDiscount.body).toBe(200);
    const orderDiscount = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload: { expectedVersion: itemDiscount.json().data.version, orderDiscount: { kind: "PERCENTAGE", value: 10 } } });
    expect(orderDiscount.statusCode, orderDiscount.body).toBe(200);
    expect(orderDiscount.json().data.totalAmount).toBe(162_000);

    const settled = await settleAmount(staff, orderDiscount.json().data, 162_000, "gross-profit-discount-settle-01");
    expect(settled.statusCode, settled.body).toBe(201);
    const settlement = settled.json().data.settlements.at(-1);
    expect(settlement?.allocations.map((allocation: { amount: number }) => allocation.amount)).toEqual([81_000, 81_000]);
    const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const url = `/api/v1/admin/reports/gross-profit?fromDate=${reportDate}&toDate=${reportDate}`;
    const report = await app.inject({ method: "GET", url, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data).toMatchObject({ totals: { netSalesAmount: 162_000, theoreticalCogsAmount: 16_000, grossProfitAmount: 146_000, grossMarginPercent: "90.12" }, costCoverage: { completeOrderItemCount: 2, incompleteOrderItemCount: 0 }, pendingConsumptionCount: 1 });
    expect(report.json().data.inventoryConsumption.varianceAmount).toBeNull();
    expect(report.json().data.products).toEqual(expect.arrayContaining([
      { channel: "TAKEAWAY", productId: catalogDiscountProduct.id, productName: catalogDiscountProduct.name, soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 81_000, completeCostRevenueAmount: 81_000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCostRevenueOfTotalSalesPercent: "0.00", incompleteCostRevenueSharePercent: null, theoreticalCogsAmount: 8_000, knownCogsAmount: 8_000, grossProfitAmount: 73_000, grossMarginPercent: "90.12", completeOrderItemCount: 1, incompleteOrderItemCount: 0 },
      { channel: "TAKEAWAY", productId: itemDiscountProduct.id, productName: itemDiscountProduct.name, soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 81_000, completeCostRevenueAmount: 81_000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCostRevenueOfTotalSalesPercent: "0.00", incompleteCostRevenueSharePercent: null, theoreticalCogsAmount: 8_000, knownCogsAmount: 8_000, grossProfitAmount: 73_000, grossMarginPercent: "90.12", completeOrderItemCount: 1, incompleteOrderItemCount: 0 },
    ]));

    const reversed = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlement!.id}/reverse`, cookies: manager, payload: { expectedVersion: settled.json().data.version, reason: "Incorrect full payment" } });
    expect(reversed.statusCode, reversed.body).toBe(200);
    const restated = await app.inject({ method: "GET", url, cookies: manager });
    expect(restated.statusCode, restated.body).toBe(200);
    expect(restated.json().data.totals).toMatchObject({ netSalesAmount: 0, theoreticalCogsAmount: 0, grossProfitAmount: 0, grossMarginPercent: null });
    expect(restated.json().data.products).toEqual([]);
    expect(restated.json().data.inventoryConsumption.varianceAmount).toBe(0);
  });

  it("keeps a multi-ingredient order wholly pending until every ingredient is available", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-multi-shortage.manager");
    const staff = await session(UserRole.STAFF, "inventory-multi-shortage.staff");
    const product = await productFixture("Multi-ingredient shortage drink");
    const beans = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Multi-shortage beans", category: "Ingredients", baseUnit: "GRAM", openingQuantity: "100", openingValueAmount: 10_000, conversions: [] } });
    const milk = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Multi-shortage milk", category: "Ingredients", baseUnit: "GRAM", openingQuantity: "40", openingValueAmount: 8_000, conversions: [] } });
    expect(beans.statusCode, beans.body).toBe(201);
    expect(milk.statusCode, milk.body).toBe(201);
    const beansId = beans.json().data.id as string;
    const milkId = milk.json().data.id as string;
    const recipe = await app.inject({
      method: "POST", url: "/api/v1/admin/inventory/recipes", cookies: manager,
      payload: { name: "Multi-shortage recipe", outputUnit: "PIECE", yieldQuantity: "1", components: [
        { componentKey: "beans",  sourceKind: "STOCK_ITEM", stockItemId: beansId, quantity: "80", displayOrder: 0 },
        { componentKey: "milk",  sourceKind: "STOCK_ITEM", stockItemId: milkId, quantity: "60", displayOrder: 1 },
      ] },
    });
    expect(recipe.statusCode, recipe.body).toBe(201);
    const costing = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: recipe.json().data.id, recipeQuantity: "1", optionRules: [], combinations: [] } });
    expect(costing.statusCode, costing.body).toBe(200);
    const order = await orderFixture(staff, product.id, 1, "inventory-multi-shortage-order-create-01");
    const paid = await settleAmount(staff, order, 1_000, "inventory-multi-shortage-payment-01");
    expect(paid.statusCode, paid.body).toBe(201);

    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(consumption.status).toBe("PENDING");
    expect(consumption.items).toHaveLength(1);
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } })).toBe(0);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: beansId } })).quantityOnHand.toString()).toBe("100");
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: milkId } })).quantityOnHand.toString()).toBe("40");

    const receive = async (stockItemId: string, amount: string, cost: number, key: string) => {
      const purchase = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { receivedAt: new Date().toISOString(), lines: [{ stockItemId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: amount, directCostAmount: cost }] } });
      expect(purchase.statusCode, purchase.body).toBe(201);
      return app.inject({ method: "POST", url: `/api/v1/admin/inventory/purchases/${purchase.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": key }, payload: { expectedVersion: 1 } });
    };
    const partialReceipt = await receive(milkId, "10", 2_000, "inventory-multi-shortage-receipt-partial-01");
    expect(partialReceipt.statusCode, partialReceipt.body).toBe(200);
    expect((await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } })).status).toBe("PENDING");
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } })).toBe(0);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: beansId } })).quantityOnHand.toString()).toBe("100");

    const sufficientReceipt = await receive(milkId, "20", 4_000, "inventory-multi-shortage-receipt-final-01");
    expect(sufficientReceipt.statusCode, sufficientReceipt.body).toBe(200);
    expect((await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } })).status).toBe("POSTED");
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } })).toBe(2);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: beansId } })).quantityOnHand.toString()).toBe("20");
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: milkId } })).quantityOnHand.toString()).toBe("10");
  }, 15_000);

  it("resolves a missing paid-item recipe and retries the whole order without partial deduction", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-backfill.manager");
    const staff = await session(UserRole.STAFF, "inventory-backfill.staff");
    const knownProduct = await productFixture("Backfill known recipe product");
    const missingProduct = await productFixture("Backfill missing recipe product");
    const knownStockId = await stockFixture(manager, "Backfill known beans", "100", 10_000);
    const missingStockId = await stockFixture(manager, "Backfill delayed beans", "100", 10_000);
    await recipeFixture(manager, knownProduct.id, knownStockId, "10");

    const created = await app.inject({
      method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "inventory-backfill-order-create-01" },
      payload: { channel: "TAKEAWAY", items: [{ productId: knownProduct.id, quantity: 1, options: [] }, { productId: missingProduct.id, quantity: 1, options: [] }] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const order = created.json().data;
    const paid = await settleAmount(staff, order, order.totalAmount, "inventory-backfill-order-payment-01");
    expect(paid.statusCode, paid.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(consumption.status).toBe("PENDING");
    expect(consumption.items.some((item) => !item.isCostComplete && (item.costSnapshot as any).missingReasons.includes(`missing-costing:${missingProduct.name}`))).toBe(true);
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } })).toBe(0);

    // A receipt retries this pending order before its second recipe exists.
    // The known line must not be deducted on its own.
    const purchase = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { receivedAt: new Date().toISOString(), lines: [{ stockItemId: knownStockId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: "1", directCostAmount: 100 }] } });
    expect(purchase.statusCode, purchase.body).toBe(201);
    const postedPurchase = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/purchases/${purchase.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "inventory-backfill-known-receipt-01" }, payload: { expectedVersion: 1 } });
    expect(postedPurchase.statusCode, postedPurchase.body).toBe(200);
    expect((await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } })).status).toBe("PENDING");
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } })).toBe(0);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: knownStockId } })).quantityOnHand.toString()).toBe("101");

    const delayedRecipe = await recipeFixture(manager, missingProduct.id, missingStockId, "20");
    const resolved = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id }, include: { items: { include: { orderItem: { select: { productId: true } } } } } });
    expect(resolved).toMatchObject({ status: "POSTED", isCostComplete: true, theoreticalCogsAmount: 3_000n });
    const backfilledItem = resolved.items.find((item) => item.orderItem.productId === missingProduct.id)!;
    expect(backfilledItem).toMatchObject({ isCostComplete: true, theoreticalCogsAmount: 2_000n });
    expect(backfilledItem.costSnapshot).toMatchObject({ missingReasons: [], components: [expect.objectContaining({ stockItemId: missingStockId, quantity: "20", knownCostAmount: 2_000 })] });
    const savedCosting = await app.prisma.orderItemCostingSnapshot.findFirstOrThrow({ where: { orderItem: { orderId: order.id, productId: missingProduct.id } } });
    expect(savedCosting).toMatchObject({ isComplete: true, configurationVersion: 1, snapshot: { missingReasons: [], components: [expect.objectContaining({ stockItemId: missingStockId, quantity: "20" })] } });
    const movements = await app.prisma.inventoryMovement.findMany({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } });
    expect(movements).toHaveLength(2);
    expect(movements.map((movement) => [movement.stockItemId, movement.quantityDelta.toString()])).toEqual(expect.arrayContaining([[knownStockId, "-10"], [missingStockId, "-20"]]));
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: knownStockId } })).quantityOnHand.toString()).toBe("91");
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: missingStockId } })).quantityOnHand.toString()).toBe("80");

    const repeatedConfig = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${missingProduct.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: delayedRecipe.id, recipeQuantity: "1", optionRules: [], combinations: [] } });
    expect(repeatedConfig.statusCode, repeatedConfig.body).toBe(200);
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } })).toBe(2);
  }, 15_000);

  it("keeps a partially backfilled multi-product order pending until all recipes and stock are ready", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-backfill-multiple.manager");
    const staff = await session(UserRole.STAFF, "inventory-backfill-multiple.staff");
    const firstProduct = await productFixture("First delayed recipe product");
    const secondProduct = await productFixture("Second delayed recipe product");
    const firstStockId = await stockFixture(manager, "First delayed beans", "100", 10_000);
    const secondStockId = await stockFixture(manager, "Second delayed beans", "5", 500);
    const created = await app.inject({
      method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "inventory-backfill-multiple-order-01" },
      payload: { channel: "TAKEAWAY", items: [{ productId: firstProduct.id, quantity: 1, options: [] }, { productId: secondProduct.id, quantity: 1, options: [] }] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const order = created.json().data;
    const paid = await settleAmount(staff, order, order.totalAmount, "inventory-backfill-multiple-payment-01");
    expect(paid.statusCode, paid.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });

    await recipeFixture(manager, firstProduct.id, firstStockId, "10");
    expect((await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } })).status).toBe("PENDING");
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } })).toBe(0);
    expect(await app.prisma.orderItemCostingSnapshot.count({ where: { orderItem: { orderId: order.id }, isComplete: true } })).toBe(1);
    expect(await app.prisma.orderItemCostingSnapshot.count({ where: { orderItem: { orderId: order.id }, isComplete: false } })).toBe(1);

    const firstLineSnapshot = await app.prisma.orderItemCostingSnapshot.findFirstOrThrow({ where: { orderItem: { orderId: order.id, productId: firstProduct.id } } });
    const firstLineConsumption = await app.prisma.orderConsumptionItem.findFirstOrThrow({ where: { orderConsumptionId: consumption.id, orderItem: { productId: firstProduct.id } } });
    const changedRecipe = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/recipes", cookies: manager, payload: { name: "Changed first delayed recipe", outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "beans", sourceKind: "STOCK_ITEM", stockItemId: firstStockId, quantity: "50", displayOrder: 0 }] } });
    expect(changedRecipe.statusCode, changedRecipe.body).toBe(201);
    const changedConfig = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${firstProduct.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: changedRecipe.json().data.id, recipeQuantity: "1", optionRules: [], combinations: [] } });
    expect(changedConfig.statusCode, changedConfig.body).toBe(200);
    expect(await app.prisma.orderItemCostingSnapshot.findFirstOrThrow({ where: { orderItem: { orderId: order.id, productId: firstProduct.id } } })).toEqual(firstLineSnapshot);
    expect(await app.prisma.orderConsumptionItem.findFirstOrThrow({ where: { orderConsumptionId: consumption.id, orderItem: { productId: firstProduct.id } } })).toEqual(firstLineConsumption);

    await recipeFixture(manager, secondProduct.id, secondStockId, "30");
    const configuredButShort = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id }, include: { items: true } });
    expect(configuredButShort).toMatchObject({ status: "PENDING", isCostComplete: true, theoreticalCogsAmount: 4_000n });
    expect(configuredButShort.items.every((item) => (item.costSnapshot as any).missingReasons.length === 0)).toBe(true);
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } })).toBe(0);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: firstStockId } })).quantityOnHand.toString()).toBe("100");
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: secondStockId } })).quantityOnHand.toString()).toBe("5");

    const purchase = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { receivedAt: new Date().toISOString(), lines: [{ stockItemId: secondStockId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: "25", directCostAmount: 2_500 }] } });
    expect(purchase.statusCode, purchase.body).toBe(201);
    const postedPurchase = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/purchases/${purchase.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "inventory-backfill-multiple-receipt-01" }, payload: { expectedVersion: 1 } });
    expect(postedPurchase.statusCode, postedPurchase.body).toBe(200);
    expect((await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } })).status).toBe("POSTED");
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } })).toBe(2);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: firstStockId } })).quantityOnHand.toString()).toBe("90");
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: secondStockId } })).quantityOnHand.toString()).toBe("0");
  }, 15_000);

  it("returns posted purchase stock with carrying value, idempotent replay, and an over-return guard", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-return.manager");
    const stockItemId = await stockFixture(manager, "Returnable beans", "100", 10_000);
    const purchase = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { receivedAt: new Date().toISOString(), supplier: "Return test supplier", lines: [{ stockItemId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: "100", directCostAmount: 20_000 }] } });
    expect(purchase.statusCode, purchase.body).toBe(201);
    const purchaseId = purchase.json().data.id as string;
    const purchaseLineId = purchase.json().data.lines[0].id as string;
    const posted = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/purchases/${purchaseId}/post`, cookies: manager, headers: { "idempotency-key": "inventory-return-post-purchase-01" }, payload: { expectedVersion: 1 } });
    expect(posted.statusCode, posted.body).toBe(200);

    const payload = { purchaseLineId, baseQuantity: "25", occurredAt: new Date().toISOString(), reason: "Damaged package" };
    const url = `/api/v1/admin/inventory/purchases/${purchaseId}/returns`;
    const first = await app.inject({ method: "POST", url, cookies: manager, headers: { "idempotency-key": "inventory-return-partial-01" }, payload });
    expect(first.statusCode, first.body).toBe(201);
    const replay = await app.inject({ method: "POST", url, cookies: manager, headers: { "idempotency-key": "inventory-return-partial-01" }, payload });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data).toEqual(first.json().data);
    const conflictingReplay = await app.inject({ method: "POST", url, cookies: manager, headers: { "idempotency-key": "inventory-return-partial-01" }, payload: { ...payload, reason: "Different return request" } });
    expect(conflictingReplay.statusCode).toBe(409);
    let balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("175");
    expect(balance.carryingValueAmount).toBe(26_250);
    expect(await app.prisma.inventoryMovement.count({ where: { purchaseLineId, kind: "PURCHASE_RETURN" } })).toBe(1);

    for (const [baseQuantity, key] of [["50", "inventory-return-partial-02"], ["25", "inventory-return-final-01"]] as const) {
      const returned = await app.inject({ method: "POST", url, cookies: manager, headers: { "idempotency-key": key }, payload: { ...payload, baseQuantity } });
      expect(returned.statusCode, returned.body).toBe(201);
    }
    balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("100");
    expect(balance.carryingValueAmount).toBe(15_000);
    expect(await app.prisma.inventoryMovement.count({ where: { purchaseLineId, kind: "PURCHASE_RETURN" } })).toBe(3);

    const overReturn = await app.inject({ method: "POST", url, cookies: manager, headers: { "idempotency-key": "inventory-return-over-limit-01" }, payload: { ...payload, baseQuantity: "1" } });
    expect(overReturn.statusCode).toBe(422);
    balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("100");
    expect(balance.carryingValueAmount).toBe(15_000);
    expect(await app.prisma.inventoryMovement.count({ where: { purchaseLineId, kind: "PURCHASE_RETURN" } })).toBe(3);
    expect(await app.prisma.auditLog.count({ where: { operation: "RETURN_INVENTORY_PURCHASE", entityId: purchaseId } })).toBe(3);
  });

  it("calculates cafe gross margin from aggregate sales and costs rather than averaging product margins", async () => {
    const manager = await session(UserRole.DEVELOPER, "gross-profit-weighted-margin.manager");
    const staff = await session(UserRole.STAFF, "gross-profit-weighted-margin.staff");
    const lowerSales = await productFixture("Weighted margin lower-sales product");
    const higherSales = await productFixture("Weighted margin higher-sales product");
    await app.prisma.product.update({ where: { id: lowerSales.id }, data: { priceAmount: 100_000 } });
    await app.prisma.product.update({ where: { id: higherSales.id }, data: { priceAmount: 300_000 } });
    const stockItemId = await stockFixture(manager, "Weighted margin ingredient", "100", 80_000);
    await recipeFixture(manager, lowerSales.id, stockItemId, "62.5");
    await recipeFixture(manager, higherSales.id, stockItemId, "37.5");

    for (const [product, amount, key] of [[lowerSales, 100_000, "weighted-margin-low"], [higherSales, 300_000, "weighted-margin-high"]] as const) {
      const order = await orderFixture(staff, product.id, 1, `${key}-order-create-01`);
      const settlement = await settleAmount(staff, order, amount, `${key}-settlement-01`);
      expect(settlement.statusCode, settlement.body).toBe(201);
    }

    const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const report = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${reportDate}&toDate=${reportDate}`, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data.totals).toMatchObject({ netSalesAmount: 400_000, theoreticalCogsAmount: 80_000, grossProfitAmount: 320_000, grossMarginPercent: "80.00" });
    expect(report.json().data.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: lowerSales.id, netSalesAmount: 100_000, theoreticalCogsAmount: 50_000, grossMarginPercent: "50.00" }),
      expect.objectContaining({ productId: higherSales.id, netSalesAmount: 300_000, theoreticalCogsAmount: 30_000, grossMarginPercent: "90.00" }),
    ]));
  });

  it("reports a sold ingredient with no opening valuation as incomplete instead of zero cost", async () => {
    const manager = await session(UserRole.DEVELOPER, "gross-profit-incomplete.manager");
    const staff = await session(UserRole.STAFF, "gross-profit-incomplete.staff");
    const product = await productFixture("Unvalued ingredient product");
    const managerId = (await app.prisma.user.findFirstOrThrow({ where: { username: "gross-profit-incomplete.manager" } })).id;
    const stock = await app.prisma.stockItem.create({ data: { name: "Unvalued recipe ingredient", category: "Ingredients", baseUnit: "GRAM", createdById: managerId } });
    await recipeFixture(manager, product.id, stock.id, "20");
    const order = await orderFixture(staff, product.id, 1, "gross-profit-incomplete-order-create-01");
    const settlement = await settleAmount(staff, order, 1_000, "gross-profit-incomplete-settlement-01");
    expect(settlement.statusCode, settlement.body).toBe(201);

    const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const report = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${reportDate}&toDate=${reportDate}`, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data).toMatchObject({
      totals: { netSalesAmount: 1_000, theoreticalCogsAmount: null, knownCogsAmount: 0, grossProfitAmount: null, grossMarginPercent: null },
      costCoverage: { totalEligibleNetSalesAmount: 1_000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 1_000, coveragePercent: "0.00", incompleteCoveragePercent: "100.00", completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
      pendingConsumptionCount: 1,
      inventoryConsumption: { varianceAmount: null, missingValuationCount: 1 },
    });
    expect(report.json().data.daily).toMatchObject([{ date: reportDate, theoreticalCogsAmount: null, grossProfitAmount: null, grossMarginPercent: null, incompleteOrderItemCount: 1 }]);
    expect(report.json().data.products).toMatchObject([{ productId: product.id, knownCogsAmount: 0, theoreticalCogsAmount: null, grossProfitAmount: null, grossMarginPercent: null, incompleteOrderItemCount: 1 }]);
  });

  it("uses exact fractional moving averages and rounds only posted Toman values half up", async () => {
    const manager = await session(UserRole.DEVELOPER, "fractional-valuation.manager");
    const staff = await session(UserRole.STAFF, "fractional-valuation.staff");
    const product = await productFixture("Fractional valuation product");
    const stockItemId = await stockFixture(manager, "Fractional valuation stock", "3", 10);
    await recipeFixture(manager, product.id, stockItemId, "1");

    const costs: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const order = await orderFixture(staff, product.id, 1, `fractional-valuation-order-${index}-01`);
      const settlement = await settleAmount(staff, order, order.totalAmount, `fractional-valuation-settle-${index}-01`);
      expect(settlement.statusCode, settlement.body).toBe(201);
      const consumption = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { orderId_cycleNumber: { orderId: order.id, cycleNumber: 1 } } });
      costs.push(Number(consumption.theoreticalCogsAmount!));
    }

    expect(costs).toEqual([3, 4, 3]);
    const balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("0");
    expect(balance.carryingValueAmount).toBe(0);
    const movements = await app.prisma.inventoryMovement.findMany({ where: { stockItemId, kind: "ORDER_CONSUMPTION" }, orderBy: { occurredAt: "asc" } });
    expect(movements.reduce((sum, movement) => sum + Math.abs(movement.valueDeltaAmount), 0)).toBe(10);
  });

  it("rejects ineligible count reconciliation and records explicit physical adjustments", async () => {
    const manager = await session(UserRole.DEVELOPER, "count-eligibility.manager");
    const staff = await session(UserRole.STAFF, "count-eligibility.staff");
    const product = await productFixture("Count eligibility product");
    const stockIds: string[] = [];
    for (const [name, value] of [["Count eligibility beans", 10_000], ["Count eligibility milk", 20_000]] as const) {
      const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name, category: "Ingredients", baseUnit: "GRAM", openingQuantity: "100", openingValueAmount: value, conversions: [] } });
      expect(created.statusCode, created.body).toBe(201);
      stockIds.push(created.json().data.id as string);
    }
    const [beansId, milkId] = stockIds as [string, string];
    await recipeFixture(manager, product.id, beansId, "180");
    const recipe = await app.prisma.recipe.findFirstOrThrow({ where: { name: `Recipe ${product.id}` } });
    await app.prisma.recipeComponent.create({ data: { recipeId: recipe.id, componentKey: "milk", label: "Milk", sourceKind: "STOCK_ITEM", stockItemId: milkId, quantity: "20", displayOrder: 1 } });
    const order = await orderFixture(staff, product.id, 1, "count-eligibility-order-01");
    const settlement = await settleAmount(staff, order, order.totalAmount, "count-eligibility-settlement-01");
    expect(settlement.statusCode, settlement.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });

    const incompleteCount = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", reason: "بازبینی موجودی", lines: [{ stockItemId: beansId, observedQuantity: "15", observedValueAmount: 1_500 }] } });
    const rejected = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${incompleteCount.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "count-eligibility-reject-01" }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [consumption.id] } });
    expect(rejected.statusCode).toBe(422);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: beansId } })).quantityOnHand.toString()).toBe("100");
    expect((await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } })).status).toBe("PENDING");

    const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", reason: "اصلاح شمارش", lines: [{ stockItemId: beansId, observedQuantity: "15", observedValueAmount: 1_500 }, { stockItemId: milkId, observedQuantity: "70", observedValueAmount: 14_000 }] } });
    const posted = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${count.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "count-eligibility-post-01" }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [consumption.id] } });
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().data.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ stockItemId: beansId, expectedQuantity: "100", differenceQuantity: "-85", expectedValueAmount: 10_000, differenceValueAmount: -8_500 }),
      expect.objectContaining({ stockItemId: milkId, expectedQuantity: "100", differenceQuantity: "-30", expectedValueAmount: 20_000, differenceValueAmount: -6_000 }),
    ]));
    expect(await app.prisma.inventoryMovement.count({ where: { kind: "PHYSICAL_COUNT_ADJUSTMENT", inventoryCountLine: { countId: count.json().data.id } } })).toBe(2);
  });

  it("restores reconciled stock on settlement correction exactly once and keeps tender-only corrections inventory-neutral", async () => {
    const manager = await session(UserRole.DEVELOPER, "reconciled-correction.manager");
    const staff = await session(UserRole.STAFF, "reconciled-correction.staff");
    const product = await productFixture("Reconciled correction product");
    const stockItemId = await stockFixture(manager, "Reconciled correction stock", "100", 10_000);
    await recipeFixture(manager, product.id, stockItemId, "180");
    const order = await orderFixture(staff, product.id, 1, "reconciled-correction-order-01");
    const settlement = await settleAmount(staff, order, order.totalAmount, "reconciled-correction-settlement-01");
    const settlementId = settlement.json().data.settlements[0].id as string;
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });

    const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", reason: "شمارش دوره‌ای", lines: [{ stockItemId, observedQuantity: "20", observedValueAmount: 2_000 }] } });
    const posted = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${count.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "reconciled-correction-count-01" }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [consumption.id] } });
    expect(posted.statusCode).toBe(200);
    const tenderCorrection = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/edit`, cookies: manager, headers: { "idempotency-key": "reconciled-correction-tender-01" }, payload: { expectedVersion: 2, reason: "Correct tender method", payments: [{ method: "CARD_TERMINAL", amount: order.totalAmount }] } });
    expect(tenderCorrection.statusCode, tenderCorrection.body).toBe(200);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } })).quantityOnHand.toString()).toBe("20");

    const replacementSettlement = await app.prisma.paymentSettlement.findFirstOrThrow({ where: { orderId: order.id, reversal: null }, orderBy: { recordedAt: "desc" } });
    const reversal = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${replacementSettlement.id}/reverse`, cookies: manager, payload: { expectedVersion: tenderCorrection.json().data.version, reason: "Corrected paid order" } });
    expect(reversal.statusCode, reversal.body).toBe(200);
    const restored = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(restored.quantityOnHand.toString()).toBe("200");
    expect(restored.carryingValueAmount).toBe(20_000);
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_RESTORATION" } })).toBe(1);
    expect((await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } })).status).toBe("CANCELLED");
  });

  it("recognizes zero estimated cost as complete and includes it in gross-margin coverage", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-zero.manager");
    const staff = await session(UserRole.STAFF, "estimated-zero.staff");
    const product = await productFixture("Zero estimated-cost product", null, 12_000);
    await estimatedCostFixture(manager, product.id, 0);

    const preview = await app.inject({ method: "POST", url: `/api/v1/admin/products/${product.id}/costing/preview`, cookies: manager, payload: { optionIds: [], quantity: 1 } });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().data).toMatchObject({ isComplete: true, knownCostAmount: 0, components: [], missingReasons: [] });
    const order = await orderFixture(staff, product.id, 2, "estimated-zero-order");
    const settlement = await settleAmount(staff, order, order.totalAmount, "estimated-zero-settlement");
    expect(settlement.statusCode, settlement.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(consumption).toMatchObject({ status: "POSTED", isCostComplete: true, knownCogsAmount: 0n, theoreticalCogsAmount: 0n });
    expect(consumption.items[0]).toMatchObject({ isCostComplete: true, knownCogsAmount: 0n, theoreticalCogsAmount: 0n, costSnapshot: expect.objectContaining({ estimatedCostAmount: 0, estimatedCosts: [{ name: product.name, amount: 0 }] }) });
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id } })).toBe(0);

    const report = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${tehranToday()}&toDate=${tehranToday()}`, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data).toMatchObject({
      totals: { netSalesAmount: order.totalAmount, theoreticalCogsAmount: 0, grossProfitAmount: order.totalAmount, grossMarginPercent: "100.00" },
      costCoverage: { completeCostRevenueAmount: order.totalAmount, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", completeOrderItemCount: 1, incompleteOrderItemCount: 0 },
      pendingConsumptionCount: 0,
    });
    const analytics = await app.inject({ method: "GET", url: `/api/v1/admin/reports/sales-analytics?fromDate=${tehranToday()}&toDate=${tehranToday()}`, cookies: manager });
    expect(analytics.statusCode, analytics.body).toBe(200);
    expect(SalesAnalyticsResponseSchema.parse(analytics.json()).data.overview.financialRecognition).toMatchObject({
      knownCogsAmount: 0, completeCostRevenueAmount: order.totalAmount, incompleteCostRevenueAmount: 0,
      totalContributionAmount: order.totalAmount, isCostComplete: true,
    });
  });

  it("reports gross-profit aggregates above one Int32 order amount", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-report-range.manager");
    const staff = await session(UserRole.STAFF, "estimated-report-range.staff");
    const product = await productFixture("Large estimate report product", null, 1_100_000_000);
    await estimatedCostFixture(manager, product.id, 1_100_000_000);
    for (const [orderKey, settlementKey] of [
      ["estimated-report-range-order-one", "estimated-report-range-pay-one"],
      ["estimated-report-range-order-two", "estimated-report-range-pay-two"],
    ] as const) {
      const order = await orderFixture(staff, product.id, 1, orderKey);
      const settlement = await settleAmount(staff, order, order.totalAmount, settlementKey);
      expect(settlement.statusCode, settlement.body).toBe(201);
    }

    const report = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${tehranToday()}&toDate=${tehranToday()}`, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(GrossProfitReportResponseSchema.parse(report.json()).data).toMatchObject({
      totals: { netSalesAmount: 2_200_000_000, theoreticalCogsAmount: 2_200_000_000, knownCogsAmount: 2_200_000_000, grossProfitAmount: 0 },
      products: [expect.objectContaining({ netSalesAmount: 2_200_000_000, theoreticalCogsAmount: 2_200_000_000, knownCogsAmount: 2_200_000_000 })],
      costCoverage: { totalEligibleNetSalesAmount: 2_200_000_000, completeCostRevenueAmount: 2_200_000_000 },
    });
    const analytics = await app.inject({ method: "GET", url: `/api/v1/admin/reports/sales-analytics?fromDate=${tehranToday()}&toDate=${tehranToday()}`, cookies: manager });
    expect(analytics.statusCode, analytics.body).toBe(200);
    expect(SalesAnalyticsResponseSchema.parse(analytics.json()).data.overview.financialRecognition).toMatchObject({
      netSalesAmount: 2_200_000_000, knownCogsAmount: 2_200_000_000, totalContributionAmount: 0, isCostComplete: true,
    });
  });

  it("preserves a saved estimate when another product is added to a partially settled order", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-edit-history.manager");
    const staff = await session(UserRole.STAFF, "estimated-edit-history.staff");
    const originalProduct = await productFixture("Original estimated order item", null, 10_000);
    const addedProduct = await productFixture("Added estimated order item", null, 10_000);
    await estimatedCostFixture(manager, originalProduct.id, 1_000);
    await estimatedCostFixture(manager, addedProduct.id, 500);
    const order = await orderFixture(staff, originalProduct.id, 2, "estimated-edit-history-order");
    const originalSnapshot = await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: order.items[0].id } });
    expect((originalSnapshot.snapshot as { estimatedCostAmount: number }).estimatedCostAmount).toBe(2_000);

    const partial = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staff, headers: { "idempotency-key": "estimated-edit-history-partial" }, payload: { expectedVersion: order.version, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 10_000 }] } });
    expect(partial.statusCode, partial.body).toBe(201);
    const updateCost = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${originalProduct.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 2_000, optionRules: [], combinations: [] } });
    expect(updateCost.statusCode, updateCost.body).toBe(200);

    const edited = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload: { expectedVersion: partial.json().data.version, addItems: [{ productId: addedProduct.id, quantity: 1, options: [] }] } });
    expect(edited.statusCode, edited.body).toBe(200);
    const addedItem = edited.json().data.items.find((item: { productId: string }) => item.productId === addedProduct.id);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: order.items[0].id } }).then((row) => row.snapshot as { estimatedCostAmount: number })).estimatedCostAmount).toBe(2_000);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: addedItem.id } }).then((row) => row.snapshot as { estimatedCostAmount: number })).estimatedCostAmount).toBe(500);

    const finalPayment = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staff, headers: { "idempotency-key": "estimated-edit-history-final" }, payload: { expectedVersion: edited.json().data.version, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }, { orderItemId: addedItem.id, quantity: 1 }], payments: [{ method: "CASH", amount: 20_000 }] } });
    expect(finalPayment.statusCode, finalPayment.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(consumption.knownCogsAmount).toBe(2_500n);
    expect(Object.fromEntries(consumption.items.map((item) => [item.orderItemId, (item.costSnapshot as { estimatedCostAmount: number }).estimatedCostAmount]))).toEqual({ [order.items[0].id]: 2_000, [addedItem.id]: 500 });
  });

  it("preserves unchanged costing snapshots when the POS replaces an unpaid order", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-unpaid-replace.manager");
    const staff = await session(UserRole.STAFF, "estimated-unpaid-replace.staff");
    const originalProduct = await productFixture("Original unpaid estimated item", null, 10_000);
    const addedProduct = await productFixture("Added unpaid estimated item", null, 10_000);
    await estimatedCostFixture(manager, originalProduct.id, 1_000);
    await estimatedCostFixture(manager, addedProduct.id, 500);
    const order = await orderFixture(staff, originalProduct.id, 1, "estimated-unpaid-replace-order");
    const originalItemId = order.items[0].id as string;

    const updatedCost = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${originalProduct.id}/costing`, cookies: manager, payload: {
      expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 2_000, optionRules: [], combinations: [],
    } });
    expect(updatedCost.statusCode, updatedCost.body).toBe(200);
    const edited = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload: {
      expectedVersion: order.version,
      items: [
        { productId: originalProduct.id, quantity: 1, options: [] },
        { productId: addedProduct.id, quantity: 1, options: [] },
      ],
    } });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().data.items[0].id).toBe(originalItemId);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: originalItemId } }).then((row) => row.snapshot as { estimatedCostAmount: number })).estimatedCostAmount).toBe(1_000);
    const addedItem = edited.json().data.items.find((item: { productId: string }) => item.productId === addedProduct.id);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: addedItem.id } }).then((row) => row.snapshot as { estimatedCostAmount: number })).estimatedCostAmount).toBe(500);

    const paid = await settleAmount(staff, edited.json().data, edited.json().data.totalAmount, "estimated-unpaid-replace-payment");
    expect(paid.statusCode, paid.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(consumption.theoreticalCogsAmount).toBe(1_500n);
    expect(Object.fromEntries(consumption.items.map((item) => [item.orderItemId, (item.costSnapshot as { estimatedCostAmount: number }).estimatedCostAmount]))).toEqual({ [originalItemId]: 1_000, [addedItem.id]: 500 });
  });

  it("uses POS client references to retain the right snapshot among duplicate unpaid lines", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-duplicate-replace.manager");
    const staff = await session(UserRole.STAFF, "estimated-duplicate-replace.staff");
    const product = await productFixture("Duplicate unpaid estimated item", null, 10_000);
    await estimatedCostFixture(manager, product.id, 100);
    const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "estimated-duplicate-replace-order" }, payload: {
      channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }, { productId: product.id, quantity: 1, options: [] }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const firstId = created.json().data.items[0].id as string;
    const secondId = created.json().data.items[1].id as string;

    const changedCost = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: {
      expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 200, optionRules: [], combinations: [],
    } });
    expect(changedCost.statusCode, changedCost.body).toBe(200);
    const added = await app.inject({ method: "PATCH", url: `/api/v1/orders/${created.json().data.id}`, cookies: staff, payload: {
      expectedVersion: created.json().data.version, addItems: [{ productId: product.id, quantity: 1, options: [] }],
    } });
    expect(added.statusCode, added.body).toBe(200);
    const thirdId = added.json().data.items.find((item: { id: string }) => item.id !== firstId && item.id !== secondId).id as string;
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: secondId } }).then((row) => row.snapshot as { estimatedCostAmount: number })).estimatedCostAmount).toBe(100);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: thirdId } }).then((row) => row.snapshot as { estimatedCostAmount: number })).estimatedCostAmount).toBe(200);

    const replaced = await app.inject({ method: "PATCH", url: `/api/v1/orders/${created.json().data.id}`, cookies: staff, payload: {
      expectedVersion: added.json().data.version,
      items: [
        { clientRef: secondId, productId: product.id, quantity: 1, options: [] },
        { clientRef: thirdId, productId: product.id, quantity: 1, options: [] },
      ],
    } });
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect(replaced.json().data.items.map((item: { id: string }) => item.id)).toEqual([secondId, thirdId]);
    expect(await Promise.all([secondId, thirdId].map((id) => app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: id } }).then((row) => (row.snapshot as { estimatedCostAmount: number }).estimatedCostAmount)))).toEqual([100, 200]);

    const paid = await settleAmount(staff, replaced.json().data, replaced.json().data.totalAmount, "estimated-duplicate-replace-payment");
    expect(paid.statusCode, paid.body).toBe(201);
    expect((await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: created.json().data.id } })).theoreticalCogsAmount).toBe(300n);
  });

  it("uses current costing for a new identical line in an unpaid replacement", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-new-duplicate.manager");
    const staff = await session(UserRole.STAFF, "estimated-new-duplicate.staff");
    const product = await productFixture("New duplicate unpaid item", null, 10_000);
    await estimatedCostFixture(manager, product.id, 100);
    const order = await orderFixture(staff, product.id, 1, "estimated-new-duplicate-order");
    const oldItemId = order.items[0].id as string;

    const changedCost = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: {
      expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 200, optionRules: [], combinations: [],
    } });
    expect(changedCost.statusCode, changedCost.body).toBe(200);
    const newClientRef = randomUUID();
    const replaced = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload: {
      expectedVersion: order.version,
      items: [{ clientRef: newClientRef, productId: product.id, quantity: 1, options: [] }],
    } });
    expect(replaced.statusCode, replaced.body).toBe(200);
    const newItemId = replaced.json().data.items[0].id as string;
    expect(newItemId).not.toBe(oldItemId);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: newItemId } }).then((row) => row.snapshot as { estimatedCostAmount: number })).estimatedCostAmount).toBe(200);

    const paid = await settleAmount(staff, replaced.json().data, replaced.json().data.totalAmount, "estimated-new-duplicate-payment");
    expect(paid.statusCode, paid.body).toBe(201);
    expect((await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } })).theoreticalCogsAmount).toBe(200n);
  });

  it("reallocates per-order packaging when an unpaid same-total replacement changes line order", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-replace-packaging.manager");
    const staff = await session(UserRole.STAFF, "estimated-replace-packaging.staff");
    const product = await productFixture("Same-total package replacement product", null, 1_000);
    const packageStockId = await stockFixture(manager, "Same-total replacement package", "10", 1_000, true);
    const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: {
      expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 0,
      takeawayPackaging: [{ stockItemId: packageStockId, quantity: "1", mode: "PER_ORDER" }], optionRules: [], combinations: [],
    } });
    expect(configured.statusCode, configured.body).toBe(200);
    const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "same-total-package-replace-order" }, payload: {
      channel: "TAKEAWAY", items: [
        { productId: product.id, quantity: 1, note: "A", options: [] },
        { productId: product.id, quantity: 1, note: "B", options: [] },
      ],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const [removedFirst, retainedSecond] = created.json().data.items;
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: removedFirst.id } }).then((row) => row.snapshot as { components: unknown[] })).components).toHaveLength(1);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: retainedSecond.id } }).then((row) => row.snapshot as { components: unknown[] })).components).toHaveLength(0);

    const replaced = await app.inject({ method: "PATCH", url: `/api/v1/orders/${created.json().data.id}`, cookies: staff, payload: {
      expectedVersion: created.json().data.version,
      items: [
        { clientRef: retainedSecond.id, productId: product.id, quantity: 1, note: "B", options: [] },
        { productId: product.id, quantity: 1, note: "C", options: [] },
      ],
    } });
    expect(replaced.statusCode, replaced.body).toBe(200);
    const retained = replaced.json().data.items.find((item: { id: string }) => item.id === retainedSecond.id);
    const added = replaced.json().data.items.find((item: { id: string }) => item.id !== retainedSecond.id);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: retained.id } }).then((row) => row.snapshot as { components: Array<{ stockItemId: string }> })).components).toEqual([expect.objectContaining({ stockItemId: packageStockId })]);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: added.id } }).then((row) => row.snapshot as { components: unknown[] })).components).toHaveLength(0);

    const paid = await settleAmount(staff, replaced.json().data, replaced.json().data.totalAmount, "same-total-package-replace-payment");
    expect(paid.statusCode, paid.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: created.json().data.id } });
    expect(consumption.theoreticalCogsAmount).toBe(100n);
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION", stockItemId: packageStockId } })).toBe(1);
  });

  it("preserves an earlier weighted line when a new weight variant of the same product is added", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-weight-edit.manager");
    const staff = await session(UserRole.STAFF, "estimated-weight-edit.staff");
    const product = await productFixture("Weighted estimate history", null, 100_000);
    await app.prisma.product.update({ where: { id: product.id }, data: { pricingMode: "WEIGHTED_PER_KG" } });
    await estimatedCostFixture(manager, product.id, 12_000);
    const opened = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "estimated-weight-edit-order" }, payload: {
      channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 2, weightGrams: 250, options: [] }],
    } });
    expect(opened.statusCode, opened.body).toBe(201);
    const order = opened.json().data;
    const originalItem = order.items[0];
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: originalItem.id } }).then((row) => row.snapshot as { estimatedCostAmount: number })).estimatedCostAmount).toBe(6_000);

    const partial = await settleAmount(staff, order, 10_000, "estimated-weight-edit-partial");
    expect(partial.statusCode, partial.body).toBe(201);
    const updatedCost = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 24_000, optionRules: [], combinations: [] } });
    expect(updatedCost.statusCode, updatedCost.body).toBe(200);

    const edited = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload: { expectedVersion: partial.json().data.version, addItems: [{ productId: product.id, quantity: 1, weightGrams: 500, options: [] }] } });
    expect(edited.statusCode, edited.body).toBe(200);
    const addedItem = edited.json().data.items.find((item: { id: string }) => item.id !== originalItem.id);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: originalItem.id } }).then((row) => row.snapshot as { estimatedCostAmount: number })).estimatedCostAmount).toBe(6_000);
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: addedItem.id } }).then((row) => row.snapshot as { estimatedCostAmount: number })).estimatedCostAmount).toBe(12_000);

    const finalPayment = await settleAmount(staff, edited.json().data, edited.json().data.balanceAmount, "estimated-weight-edit-final");
    expect(finalPayment.statusCode, finalPayment.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(consumption.theoreticalCogsAmount).toBe(18_000n);
    expect(Object.fromEntries(consumption.items.map((item) => [item.orderItemId, (item.costSnapshot as { estimatedCostAmount: number }).estimatedCostAmount]))).toEqual({ [originalItem.id]: 6_000, [addedItem.id]: 12_000 });
  });

  it("reallocates per-order packaging when a same-product line crosses its quantity threshold", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-package-threshold.manager");
    const staff = await session(UserRole.STAFF, "estimated-package-threshold.staff");
    const product = await productFixture("Estimated package threshold product", null, 1_000);
    const packagingStockId = await stockFixture(manager, "Threshold package", "10", 1_000, true);
    const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: {
      expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 0,
      takeawayPackaging: [{ stockItemId: packagingStockId, quantity: "1", mode: "PER_ORDER", minQuantity: 2 }],
      optionRules: [], combinations: [],
    } });
    expect(configured.statusCode, configured.body).toBe(200);

    const order = await orderFixture(staff, product.id, 1, "estimated-package-threshold-order");
    expect((await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: order.items[0].id } }).then((row) => row.snapshot as { components: unknown[] })).components).toHaveLength(0);
    const edited = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload: {
      expectedVersion: order.version, addItems: [{ productId: product.id, quantity: 1, options: [] }],
    } });
    expect(edited.statusCode, edited.body).toBe(200);
    const items = edited.json().data.items;
    const firstSnapshot = await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: items[0].id } });
    const secondSnapshot = await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: items[1].id } });
    expect((firstSnapshot.snapshot as { components: Array<{ stockItemId: string; quantity: string; packagingQuantity: string }> }).components).toEqual([
      expect.objectContaining({ stockItemId: packagingStockId, quantity: "1", packagingQuantity: "1" }),
    ]);
    expect((secondSnapshot.snapshot as { components: unknown[] }).components).toHaveLength(0);

    const paid = await settleAmount(staff, edited.json().data, edited.json().data.totalAmount, "estimated-package-threshold-payment");
    expect(paid.statusCode, paid.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(consumption.theoreticalCogsAmount).toBe(100n);
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION", stockItemId: packagingStockId } })).toBe(1);
  });

  it("keeps an archived package missing when a same-product edit reaches its minimum quantity", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-package-missing.manager");
    const staff = await session(UserRole.STAFF, "estimated-package-missing.staff");
    const product = await productFixture("Missing package threshold product", null, 1_000);
    const packagingStockId = await stockFixture(manager, "Archived threshold package", "0", 0, true);
    const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: {
      expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 0,
      takeawayPackaging: [{ stockItemId: packagingStockId, quantity: "1", mode: "PER_ORDER", minQuantity: 2 }],
      optionRules: [], combinations: [],
    } });
    expect(configured.statusCode, configured.body).toBe(200);
    const order = await orderFixture(staff, product.id, 1, "estimated-package-missing-order");
    const stock = await app.prisma.stockItem.findUniqueOrThrow({ where: { id: packagingStockId } });
    const archived = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/stock-items/${packagingStockId}/archive`, cookies: manager, payload: { expectedVersion: stock.version } });
    expect(archived.statusCode, archived.body).toBe(200);

    const edited = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload: {
      expectedVersion: order.version, addItems: [{ productId: product.id, quantity: 1, options: [] }],
    } });
    expect(edited.statusCode, edited.body).toBe(200);
    const firstItem = edited.json().data.items[0];
    const firstSnapshot = await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: firstItem.id } });
    expect(firstSnapshot).toMatchObject({ isComplete: false, missingReasons: [`missing-takeaway-packaging:${packagingStockId}`] });

    const paid = await settleAmount(staff, edited.json().data, edited.json().data.totalAmount, "estimated-package-missing-payment");
    expect(paid.statusCode, paid.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });
    expect(consumption.status).toBe("PENDING");
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id } })).toBe(0);
    const pending = await app.inject({ method: "GET", url: "/api/v1/admin/inventory/pending-consumption", cookies: manager });
    expect(pending.statusCode, pending.body).toBe(200);
    expect(PendingConsumptionsResponseSchema.parse(pending.json()).data.consumptions[0]?.missingStockItemIds).toContain(packagingStockId);
  });

  it("re-resolves legacy snapshot formats during same-product takeaway packaging edits", async () => {
    const manager = await session(UserRole.DEVELOPER, "legacy-package-refresh.manager");
    const staff = await session(UserRole.STAFF, "legacy-package-refresh.staff");
    const product = await productFixture("Legacy package refresh product", null, 1_000);
    const packageStockId = await stockFixture(manager, "Legacy package stock", "10", 1_000, true);
    const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: {
      expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 0,
      takeawayPackaging: [{ stockItemId: packageStockId, quantity: "1", mode: "PER_ORDER" }], optionRules: [], combinations: [],
    } });
    expect(configured.statusCode, configured.body).toBe(200);
    const order = await orderFixture(staff, product.id, 1, "legacy-package-refresh-order");
    const itemId = order.items[0].id as string;
    const saved = await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: itemId } });
    const oldShape = saved.snapshot as Record<string, any>;
    delete oldShape.snapshotFormatVersion;
    oldShape.components = oldShape.components.map((component: Record<string, unknown>) => {
      const legacy = { ...component };
      delete legacy.takeawayPackagingQuantity;
      return legacy;
    });
    await app.prisma.orderItemCostingSnapshot.update({ where: { orderItemId: itemId }, data: { snapshot: oldShape, isComplete: true, missingReasons: [] } });

    const edited = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staff, payload: {
      expectedVersion: order.version, addItems: [{ productId: product.id, quantity: 1, options: [] }],
    } });
    expect(edited.statusCode, edited.body).toBe(200);
    const paid = await settleAmount(staff, edited.json().data, edited.json().data.totalAmount, "legacy-package-refresh-payment");
    expect(paid.statusCode, paid.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });
    expect(consumption.theoreticalCogsAmount).toBe(100n);
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION", stockItemId: packageStockId } })).toBe(1);

    const missingProduct = await productFixture("Legacy removed package product", null, 1_000);
    const missingStockId = await stockFixture(manager, "Legacy removed package stock", "0", 0, true);
    const missingConfigured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${missingProduct.id}/costing`, cookies: manager, payload: {
      expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 0,
      takeawayPackaging: [{ stockItemId: missingStockId, quantity: "1", mode: "PER_ORDER" }], optionRules: [], combinations: [],
    } });
    expect(missingConfigured.statusCode, missingConfigured.body).toBe(200);
    const missingOrder = await orderFixture(staff, missingProduct.id, 1, "legacy-removed-package-order");
    const missingItemId = missingOrder.items[0].id as string;
    const missingSaved = await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: missingItemId } });
    const missingOldShape = missingSaved.snapshot as Record<string, any>;
    delete missingOldShape.snapshotFormatVersion;
    missingOldShape.missingReasons = [`missing-stock:${missingStockId}`];
    await app.prisma.orderItemCostingSnapshot.update({ where: { orderItemId: missingItemId }, data: { snapshot: missingOldShape, isComplete: false, missingReasons: missingOldShape.missingReasons } });
    const missingStock = await app.prisma.stockItem.findUniqueOrThrow({ where: { id: missingStockId } });
    const archived = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/stock-items/${missingStockId}/archive`, cookies: manager, payload: { expectedVersion: missingStock.version } });
    expect(archived.statusCode, archived.body).toBe(200);
    const removedMapping = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${missingProduct.id}/costing`, cookies: manager, payload: {
      expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 0, takeawayPackaging: [], optionRules: [], combinations: [],
    } });
    expect(removedMapping.statusCode, removedMapping.body).toBe(200);
    const missingEdited = await app.inject({ method: "PATCH", url: `/api/v1/orders/${missingOrder.id}`, cookies: staff, payload: {
      expectedVersion: missingOrder.version, addItems: [{ productId: missingProduct.id, quantity: 1, options: [] }],
    } });
    expect(missingEdited.statusCode, missingEdited.body).toBe(200);
    const repairedSnapshot = await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: missingItemId } });
    expect(repairedSnapshot).toMatchObject({ isComplete: true, missingReasons: [] });
  });

  it("keeps explicit zero distinct from null and rejects incomplete preserved recipe fields", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-validation.manager");
    const product = await productFixture("Estimated validation product");
    const url = `/api/v1/admin/products/${product.id}/costing`;
    const request = (estimatedCostAmount: unknown, extra: Record<string, unknown> = {}) => app.inject({
      method: "PUT", url, cookies: manager,
      payload: { expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount, optionRules: [], combinations: [], ...extra },
    });
    expect((await request(null)).statusCode).toBe(400);
    expect((await request("0")).statusCode).toBe(400);
    expect((await request(0, { recipeQuantity: "1" })).statusCode).toBe(400);
    const configured = await request(0);
    expect(configured.statusCode, configured.body).toBe(200);
    expect(configured.json().data).toMatchObject({ useEstimatedCost: true, estimatedCostAmount: 0, recipeId: null, recipeQuantity: null });
  });

  it("adds independent estimated side-add-ons to COGS while deducting only recipe-based add-ons", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-addons.manager");
    const staff = await session(UserRole.STAFF, "estimated-addons.staff");
    const product = await productFixture("Estimated add-on product", null, 10_000);
    const stockItemId = await stockFixture(manager, "Recipe side item", "100", 20_000);
    await estimatedCostFixture(manager, product.id, 2_000, [
      { sourceKind: "ESTIMATED_COST", name: "کوکی", estimatedCostAmount: 500 },
      { sourceKind: "STOCK_ITEM", stockItemId, quantity: "2" },
    ]);

    const order = await orderFixture(staff, product.id, 2, "estimated-addons-order");
    const settlement = await settleAmount(staff, order, order.totalAmount, "estimated-addons-settlement");
    expect(settlement.statusCode, settlement.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(consumption).toMatchObject({ status: "POSTED", isCostComplete: true, knownCogsAmount: 5_800n, theoreticalCogsAmount: 5_800n });
    expect(consumption.items[0]?.costSnapshot).toMatchObject({ estimatedCostAmount: 5_000, estimatedCosts: expect.arrayContaining([{ name: product.name, amount: 4_000 }, { name: "کوکی", amount: 1_000 }]) });
    expect(consumption.items[0]?.costSnapshot).toMatchObject({ components: [expect.objectContaining({ stockItemId, quantity: "4", knownCostAmount: 800 })] });
    const movements = await app.prisma.inventoryMovement.findMany({ where: { orderConsumptionId: consumption.id, kind: "ORDER_CONSUMPTION" } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.stockItemId).toBe(stockItemId);
    expect(movements[0]?.quantityDelta.toString()).toBe("-4");
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id, stockItemId: { not: stockItemId } } })).toBe(0);

    const report = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${tehranToday()}&toDate=${tehranToday()}`, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data).toMatchObject({
      totals: { theoreticalCogsAmount: 5_800, grossProfitAmount: 14_200, grossMarginPercent: "71.00" },
      inventoryConsumption: { varianceAmount: 0 },
    });
  });

  it("stores multiplied and aggregate estimated COGS above Int32 without blocking payment", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-overflow.manager");
    const staff = await session(UserRole.STAFF, "estimated-overflow.staff");
    const combined = await productFixture("Combined estimate overflow", null, 1_000);
    const oversizedConfiguration = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${combined.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 1_500_000_000, servedAlongside: [{ sourceKind: "ESTIMATED_COST", name: "Large side", estimatedCostAmount: 1_000_000_000 }], optionRules: [], combinations: [] } });
    expect(oversizedConfiguration.statusCode, oversizedConfiguration.body).toBe(200);

    const retainedSide = await productFixture("Retained side estimate range", null, 1_000);
    await estimatedCostFixture(manager, retainedSide.id, 0, [{ sourceKind: "ESTIMATED_COST", name: "Retained side", estimatedCostAmount: 500_000_000 }]);
    const updateWithOmittedSide = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${retainedSide.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 1_700_000_000, optionRules: [], combinations: [] } });
    expect(updateWithOmittedSide.statusCode, updateWithOmittedSide.body).toBe(200);

    const largeQuantity = await productFixture("Large quantity estimate", null, 1_000);
    await estimatedCostFixture(manager, largeQuantity.id, 1_500_000_000);
    const oversizedLine = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "estimated-overflow-line" }, payload: { channel: "TAKEAWAY", items: [{ productId: largeQuantity.id, quantity: 2, options: [] }] } });
    expect(oversizedLine.statusCode, oversizedLine.body).toBe(201);
    const largeOrder = oversizedLine.json().data;
    const largePayment = await settleAmount(staff, largeOrder, largeOrder.totalAmount, "estimated-overflow-line-payment");
    expect(largePayment.statusCode, largePayment.body).toBe(201);
    expect((await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: largeOrder.id } })).theoreticalCogsAmount).toBe(3_000_000_000n);

    const mixedOverflow = await productFixture("Estimate plus tracked recipe overflow", null, 3_000);
    const expensiveSide = await stockFixture(manager, "High value mixed overflow side", "1000", 200_000_000);
    await estimatedCostFixture(manager, mixedOverflow.id, 2_000_000_000, [{ sourceKind: "STOCK_ITEM", stockItemId: expensiveSide, quantity: "1000" }]);
    const mixedOverflowOrder = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "estimated-mixed-overflow" }, payload: { channel: "TAKEAWAY", items: [{ productId: mixedOverflow.id, quantity: 1, options: [] }] } });
    expect(mixedOverflowOrder.statusCode, mixedOverflowOrder.body).toBe(201);
    const mixedOrder = mixedOverflowOrder.json().data;
    const mixedPayment = await settleAmount(staff, mixedOrder, mixedOrder.totalAmount, "estimated-mixed-overflow-payment");
    expect(mixedPayment.statusCode, mixedPayment.body).toBe(201);
    expect((await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: mixedOrder.id } })).theoreticalCogsAmount).toBe(2_200_000_000n);

    const first = await productFixture("Aggregate estimate overflow one", null, 1_000);
    const second = await productFixture("Aggregate estimate overflow two", null, 1_000);
    await estimatedCostFixture(manager, first.id, 1_100_000_000);
    await estimatedCostFixture(manager, second.id, 1_100_000_000);
    const orderResponse = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "estimated-overflow-order" }, payload: { channel: "TAKEAWAY", items: [{ productId: first.id, quantity: 1, options: [] }, { productId: second.id, quantity: 1, options: [] }] } });
    expect(orderResponse.statusCode, orderResponse.body).toBe(201);
    const aggregateOrder = orderResponse.json().data;
    const aggregatePayment = await settleAmount(staff, aggregateOrder, aggregateOrder.totalAmount, "estimated-overflow-order-payment");
    expect(aggregatePayment.statusCode, aggregatePayment.body).toBe(201);
    expect((await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: aggregateOrder.id } })).theoreticalCogsAmount).toBe(2_200_000_000n);
  });

  it("values mixed estimated and tracked costs at the payment-time moving average", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-reprice.manager");
    const staff = await session(UserRole.STAFF, "estimated-reprice.staff");
    const product = await productFixture("Estimated repriced product", null, 3_000);
    const stockItemId = await stockFixture(manager, "Estimated repriced side", "0", 0);
    await estimatedCostFixture(manager, product.id, 2_000_000_000, [{ sourceKind: "STOCK_ITEM", stockItemId, quantity: "1" }]);
    const order = await orderFixture(staff, product.id, 1, "estimated-reprice-order");
    const savedSnapshot = await app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: order.items[0].id } });
    expect(savedSnapshot.snapshot).toMatchObject({ estimatedCostAmount: 2_000_000_000, components: [{ quantity: "1" }] });

    const receiveSide = await purchaseToPost(manager, stockItemId, "1", 200_000_000, "estimated-reprice-stock");
    const received = await receiveSide();
    expect(received.statusCode, received.body).toBe(200);
    const paid = await settleAmount(staff, order, order.totalAmount, "estimated-reprice-payment");
    expect(paid.statusCode, paid.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(consumption).toMatchObject({ status: "POSTED", isCostComplete: true, knownCogsAmount: 2_200_000_000n, theoreticalCogsAmount: 2_200_000_000n });
    expect(consumption.items[0]?.costSnapshot).toMatchObject({ components: [{ stockItemId, knownCostAmount: 200_000_000 }] });
  });

  it("preserves recipe configuration and historical snapshots across estimate toggles", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-toggle.manager");
    const staff = await session(UserRole.STAFF, "estimated-toggle.staff");
    const product = await productFixture("Estimate toggle recipe product", null, 30_000);
    const stockItemId = await stockFixture(manager, "Toggle recipe stock", "1000", 200_000);
    const recipe = await recipeFixture(manager, product.id, stockItemId);
    const historicalOrder = await orderFixture(staff, product.id, 1, "estimated-toggle-old-order");
    const historicalPaid = await settleAmount(staff, historicalOrder, historicalOrder.totalAmount, "estimated-toggle-old-paid");
    expect(historicalPaid.statusCode, historicalPaid.body).toBe(201);
    const oldConsumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: historicalOrder.id }, include: { items: true } });
    expect(oldConsumption.theoreticalCogsAmount).toBe(16_000n);

    const enable = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 2_500, optionRules: [], combinations: [] } });
    expect(enable.statusCode, enable.body).toBe(200);
    expect(enable.json().data).toMatchObject({ mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 2_500, recipeId: recipe.id, recipeQuantity: "1" });
    expect((await app.prisma.productCostingConfiguration.findUniqueOrThrow({ where: { productId: product.id } })).recipeId).toBe(recipe.id);
    expect((await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: oldConsumption.id } })).theoreticalCogsAmount).toBe(16_000n);

    const disable = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: { expectedVersion: 2, mode: "RECIPE", recipeId: recipe.id, recipeQuantity: "1", useEstimatedCost: false, estimatedCostAmount: 2_500, optionRules: [], combinations: [] } });
    expect(disable.statusCode, disable.body).toBe(200);
    expect(disable.json().data).toMatchObject({ useEstimatedCost: false, estimatedCostAmount: 2_500, recipeId: recipe.id });
    const nextOrder = await orderFixture(staff, product.id, 1, "estimated-toggle-new-order");
    const nextPaid = await settleAmount(staff, nextOrder, nextOrder.totalAmount, "estimated-toggle-new-paid");
    expect(nextPaid.statusCode, nextPaid.body).toBe(201);
    const nextConsumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: nextOrder.id } });
    expect(nextConsumption.theoreticalCogsAmount).toBe(16_000n);
    expect(await app.prisma.inventoryMovement.count({ where: { stockItemId, kind: "ORDER_CONSUMPTION" } })).toBe(2);
  });

  it("resolves a pending missing-recipe sale into estimated COGS without inventory movements", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-backfill.manager");
    const staff = await session(UserRole.STAFF, "estimated-backfill.staff");
    const product = await productFixture("Late estimated-cost product", null, 10_000);
    const order = await orderFixture(staff, product.id, 1, "estimated-backfill-order");
    const paid = await settleAmount(staff, order, order.totalAmount, "estimated-backfill-paid");
    expect(paid.statusCode, paid.body).toBe(201);
    const waiting = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });
    expect(waiting.status).toBe("PENDING");

    await estimatedCostFixture(manager, product.id, 2_500);
    const resolved = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: waiting.id }, include: { items: true } });
    expect(resolved).toMatchObject({ status: "POSTED", isCostComplete: true, theoreticalCogsAmount: 2_500n, knownCogsAmount: 2_500n });
    expect(resolved.items[0]).toMatchObject({ isCostComplete: true, theoreticalCogsAmount: 2_500n, costSnapshot: expect.objectContaining({ estimatedCostAmount: 2_500, missingReasons: [] }) });
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: waiting.id } })).toBe(0);
  });

  it("backfills a new estimate without revaluing unchanged pending product costs", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-backfill-preserve.manager");
    const staff = await session(UserRole.STAFF, "estimated-backfill-preserve.staff");
    const established = await productFixture("Preserved pending costing", null, 10_000);
    const newlyConfigured = await productFixture("New pending estimate", null, 10_000);
    const stockItemId = await stockFixture(manager, "Preserved pending stock", "1", 1_500_000_000);
    await recipeFixture(manager, established.id, stockItemId, "1");
    const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "estimated-backfill-preserve-order" }, payload: {
      channel: "TAKEAWAY", items: [{ productId: established.id, quantity: 1, options: [] }, { productId: newlyConfigured.id, quantity: 1, options: [] }],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const order = created.json().data;
    const paid = await settleAmount(staff, order, order.totalAmount, "estimated-backfill-preserve-payment");
    expect(paid.statusCode, paid.body).toBe(201);
    const pending = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(pending).toMatchObject({ status: "PENDING", knownCogsAmount: 1_500_000_000n, theoreticalCogsAmount: null });

    await app.prisma.inventoryBalance.update({ where: { stockItemId }, data: { carryingValueAmount: 2_000_000_000 } });
    const configured = await estimatedCostFixture(manager, newlyConfigured.id, 200_000_000);
    expect(configured.useEstimatedCost).toBe(true);
    const resolved = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: pending.id }, include: { items: true } });
    expect(resolved).toMatchObject({ status: "POSTED", knownCogsAmount: 1_700_000_000n, theoreticalCogsAmount: 1_700_000_000n, isCostComplete: true });
    const establishedItemId = order.items.find((item: { productId: string }) => item.productId === established.id).id;
    const estimatedItemId = order.items.find((item: { productId: string }) => item.productId === newlyConfigured.id).id;
    expect(Object.fromEntries(resolved.items.map((item) => [item.orderItemId, item.knownCogsAmount]))).toEqual({ [establishedItemId]: 1_500_000_000n, [estimatedItemId]: 200_000_000n });
  });

  it("scales estimated costs by the sold weight in weighted product units", async () => {
    const manager = await session(UserRole.DEVELOPER, "estimated-weight.manager");
    const staff = await session(UserRole.STAFF, "estimated-weight.staff");
    const product = await productFixture("Weighted estimated product", null, 100_000);
    await app.prisma.product.update({ where: { id: product.id }, data: { pricingMode: "WEIGHTED_PER_KG" } });
    await estimatedCostFixture(manager, product.id, 12_000);
    const missingWeightPreview = await app.inject({ method: "POST", url: `/api/v1/admin/products/${product.id}/costing/preview`, cookies: manager, payload: { optionIds: [], quantity: 1 } });
    expect(missingWeightPreview.statusCode, missingWeightPreview.body).toBe(422);
    const preview = await app.inject({ method: "POST", url: `/api/v1/admin/products/${product.id}/costing/preview`, cookies: manager, payload: { optionIds: [], quantity: 2, weightGrams: 250 } });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().data).toMatchObject({ isComplete: true, knownCostAmount: 6_000, components: [] });
    const orderResponse = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": "estimated-weight-order" }, payload: { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 2, weightGrams: 250, options: [] }] } });
    expect(orderResponse.statusCode, orderResponse.body).toBe(201);
    const order = orderResponse.json().data;
    expect(order.totalAmount).toBe(50_000);
    const paid = await settleAmount(staff, order, order.totalAmount, "estimated-weight-paid");
    expect(paid.statusCode, paid.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });
    expect(consumption).toMatchObject({ status: "POSTED", knownCogsAmount: 6_000n, theoreticalCogsAmount: 6_000n });
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: consumption.id } })).toBe(0);
  });

  it("keeps sales with missing product costing configuration visibly incomplete", async () => {
    const manager = await session(UserRole.DEVELOPER, "missing-config.manager");
    const staff = await session(UserRole.STAFF, "missing-config.staff");
    const product = await productFixture("No costing configuration product");
    const order = await orderFixture(staff, product.id, 1, "missing-config-order-create-01");
    const settlement = await settleAmount(staff, order, order.totalAmount, "missing-config-settlement-01");
    expect(settlement.statusCode, settlement.body).toBe(201);
    const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const report = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${reportDate}&toDate=${reportDate}`, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data).toMatchObject({
      totals: { netSalesAmount: order.totalAmount, theoreticalCogsAmount: null, grossProfitAmount: null, grossMarginPercent: null },
      costCoverage: { totalEligibleNetSalesAmount: order.totalAmount, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: order.totalAmount, coveragePercent: "0.00", incompleteCoveragePercent: "100.00", completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
      pendingConsumptionCount: 1,
    });
  });

  it("enforces shared Manager and Developer inventory operations and stable history boundaries", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-management.manager");
    const staff = await session(UserRole.STAFF, "inventory-management.staff");
    const item = await stockFixture(manager, "Managed stock item", "100", 10_000);
    const forbidden = [
      ["GET", "/api/v1/admin/inventory/stock-items"],
      ["GET", "/api/v1/admin/inventory/purchases"],
      ["GET", "/api/v1/admin/inventory/recipes"],
      ["GET", "/api/v1/admin/inventory/counts"],
      ["GET", "/api/v1/admin/inventory/movements"], ["GET", "/api/v1/admin/inventory/pending-consumption"],
      ["GET", "/api/v1/admin/reports/gross-profit?fromDate=2026-10-13&toDate=2026-10-13"],
    ] as const;
    for (const [method, url] of forbidden) {
      const response = await app.inject({ method, url, cookies: staff });
      expect(response.statusCode, `${method} ${url}: ${response.body}`).toBe(403);
    }
    const forbiddenWrite = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: staff, payload: { name: "Staff must not create stock", category: "Ingredients", baseUnit: "GRAM", conversions: [] } });
    expect(forbiddenWrite.statusCode, forbiddenWrite.body).toBe(403);

    const update = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/stock-items/${item}/archive`, cookies: manager, payload: { expectedVersion: 99 } });
    expect(update.statusCode).toBe(409);
    const history = await app.inject({ method: "GET", url: "/api/v1/admin/inventory/movements?limit=1", cookies: manager });
    expect(history.statusCode).toBe(200);
    expect(Object.keys(history.json().data.movements[0] ?? {})).toEqual(expect.arrayContaining(["stockItemId", "kind", "quantityDelta", "valueDeltaAmount", "occurredAt"]));
    expect(JSON.stringify(history.json().data)).not.toMatch(/password|token|secret/i);
  });

  it("gives Developer Manager access while reserving analysis reports to Developer", async () => {
    const manager = await session(UserRole.MANAGER, "developer-parity.manager");
    const developer = await session(UserRole.DEVELOPER, "developer-parity.developer");
    const product = await productFixture("Developer parity simulation product");
    const managerInventory = await app.inject({ method: "GET", url: "/api/v1/admin/inventory/stock-items", cookies: manager });
    expect(managerInventory.statusCode, managerInventory.body).toBe(200);
    const developerSettings = await app.inject({ method: "GET", url: "/api/v1/admin/settings", cookies: developer });
    expect(developerSettings.statusCode, developerSettings.body).toBe(200);
    const developerUsers = await app.inject({ method: "GET", url: "/api/v1/admin/users", cookies: developer });
    expect(developerUsers.statusCode, developerUsers.body).toBe(200);

    const exclusiveViews = [
      ["GET", "/api/v1/admin/reports/gross-profit?fromDate=2026-11-10&toDate=2026-11-10"],
      ["GET", "/api/v1/admin/reports/sales-channels?fromDate=2026-11-10&toDate=2026-11-10"],
      ["GET", "/api/v1/admin/reports/sales-analytics?fromDate=2026-11-10&toDate=2026-11-10"],
      ["GET", "/api/v1/admin/pricing-experiments"],
      ["POST", "/api/v1/admin/reports/pricing-experiments/simulate"],
    ] as const;
    for (const [method, url] of exclusiveViews) {
      const payload = method === "POST" ? { fromDate: "2026-11-10", toDate: "2026-11-10", rules: [{ targetKind: "PRODUCT", productId: product.id, adjustmentAmount: 0 }] } : undefined;
      const denied = await app.inject({ method, url, cookies: manager, ...(payload ? { payload } : {}) });
      expect(denied.statusCode, `${method} ${url}: ${denied.body}`).toBe(403);
      const allowed = await app.inject({ method, url, cookies: developer, ...(payload ? { payload } : {}) });
      expect(allowed.statusCode, `${method} ${url}: ${allowed.body}`).not.toBe(403);
    }
  });

  it("validates inventory response DTOs and keeps every protected read outside Staff access", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-dto.manager");
    const staff = await session(UserRole.STAFF, "inventory-dto.staff");
    const itemId = await stockFixture(manager, "DTO boundary stock", "5", 1_000);
    const product = await productFixture("DTO boundary product");
    const itemRead = await app.inject({ method: "GET", url: "/api/v1/admin/inventory/stock-items", cookies: manager });
    expect(StockItemsResponseSchema.safeParse(itemRead.json()).success).toBe(true);
    const purchase = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { receivedAt: new Date().toISOString(), lines: [{ stockItemId: itemId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: "1", directCostAmount: 100 }] } });
    expect(PurchaseResponseSchema.safeParse(purchase.json()).success).toBe(true);
    const postedPurchase = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/purchases/${purchase.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "inventory-dto-post-purchase-01" }, payload: { expectedVersion: 1 } });
    expect(PurchaseResponseSchema.safeParse(postedPurchase.json()).success).toBe(true);
    const returned = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/purchases/${purchase.json().data.id}/returns`, cookies: manager, headers: { "idempotency-key": "inventory-dto-return-purchase-01" }, payload: { purchaseLineId: purchase.json().data.lines[0].id, baseQuantity: "1", occurredAt: new Date().toISOString(), reason: "DTO validation" } });
    expect(InventoryMovementSchema.safeParse(returned.json().data).success).toBe(true);
    const recipe = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/recipes", cookies: manager, payload: { name: "DTO boundary recipe", outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "ingredient",  sourceKind: "STOCK_ITEM", stockItemId: itemId, quantity: "1", displayOrder: 0 }] } });
    expect(RecipeResponseSchema.safeParse(recipe.json()).success).toBe(true);
    const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", reason: "اصلاح مقدار", lines: [{ stockItemId: itemId, observedQuantity: "5", observedValueAmount: 1_000 }] } });
    expect(InventoryCountResponseSchema.safeParse(count.json()).success).toBe(true);
    const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: recipe.json().data.id, recipeQuantity: "1", optionRules: [], combinations: [] } });
    expect(ProductCostingConfigurationResponseSchema.safeParse(configured.json()).success).toBe(true);
    const costingRead = await app.inject({ method: "GET", url: `/api/v1/admin/products/${product.id}/costing`, cookies: manager });
    expect(ProductCostingConfigurationResponseSchema.safeParse(costingRead.json()).success).toBe(true);
    expect((await app.inject({ method: "POST", url: `/api/v1/admin/products/${product.id}/costing/preview`, cookies: staff, payload: { optionIds: [], quantity: 1 } })).statusCode).toBe(403);
    const managerPreview = await app.inject({ method: "POST", url: `/api/v1/admin/products/${product.id}/costing/preview`, cookies: manager, payload: { optionIds: [], quantity: 1 } });
    expect(ProductCostingPreviewResponseSchema.safeParse(managerPreview.json()).success).toBe(true);
    const draftPurchase = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { receivedAt: new Date().toISOString(), lines: [{ stockItemId: itemId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: "1", directCostAmount: 100 }] } });
    const deniedPurchaseId = draftPurchase.json().data.id as string;
    const deniedPurchaseLineId = draftPurchase.json().data.lines[0].id as string;
    const staffMutationCases = [
      { method: "POST", url: "/api/v1/admin/inventory/stock-items", payload: { name: "Staff inventory item", category: "Ingredients", baseUnit: "GRAM", conversions: [] } },
      { method: "PATCH", url: `/api/v1/admin/inventory/stock-items/${itemId}`, payload: { expectedVersion: 1, name: "Staff stock edit" } },
      { method: "POST", url: `/api/v1/admin/inventory/stock-items/${itemId}/archive`, payload: { expectedVersion: 1 } },
      { method: "POST", url: "/api/v1/admin/inventory/purchases", payload: { receivedAt: new Date().toISOString(), lines: [{ stockItemId: itemId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: "1", directCostAmount: 100 }] } },
      { method: "PATCH", url: `/api/v1/admin/inventory/purchases/${deniedPurchaseId}`, payload: { expectedVersion: 1, supplier: "Staff edit" } },
      { method: "POST", url: `/api/v1/admin/inventory/purchases/${deniedPurchaseId}/post`, headers: { "idempotency-key": "staff-inventory-denied-post-001" }, payload: { expectedVersion: 1 } },
      { method: "POST", url: `/api/v1/admin/inventory/purchases/${deniedPurchaseId}/returns`, headers: { "idempotency-key": "staff-inventory-denied-return-001" }, payload: { purchaseLineId: deniedPurchaseLineId, baseQuantity: "1", occurredAt: new Date().toISOString(), reason: "Staff denied" } },
      { method: "POST", url: "/api/v1/admin/inventory/recipes", payload: { name: "Staff recipe", outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "ingredient",  sourceKind: "STOCK_ITEM", stockItemId: itemId, quantity: "1", displayOrder: 0 }] } },
      { method: "PATCH", url: `/api/v1/admin/inventory/recipes/${recipe.json().data.id}`, payload: { expectedVersion: 1, name: recipe.json().data.name, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "ingredient",  sourceKind: "STOCK_ITEM", stockItemId: itemId, quantity: "1", displayOrder: 0 }] } },
      { method: "POST", url: `/api/v1/admin/inventory/recipes/${recipe.json().data.id}/archive`, payload: { expectedVersion: 1 } },
      { method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, payload: { expectedVersion: 2, mode: "RECIPE", recipeId: recipe.json().data.id, recipeQuantity: "1", optionRules: [], combinations: [] } },
      { method: "POST", url: `/api/v1/admin/products/${product.id}/costing/preview`, payload: { optionIds: [], quantity: 1 } },
      { method: "POST", url: "/api/v1/admin/inventory/counts", payload: { kind: "PHYSICAL", lines: [{ stockItemId: itemId, observedQuantity: "5", observedValueAmount: 1_000 }] } },
      { method: "PATCH", url: `/api/v1/admin/inventory/counts/${count.json().data.id}`, payload: { expectedVersion: 1, lines: [{ stockItemId: itemId, observedQuantity: "5", observedValueAmount: 1_000 }] } },
      { method: "POST", url: `/api/v1/admin/inventory/counts/${count.json().data.id}/post`, headers: { "idempotency-key": "staff-inventory-denied-count-001" }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [] } },
    ] as const;
    for (const mutation of staffMutationCases) {
      const response = await app.inject({ ...mutation, cookies: staff });
      expect(response.statusCode, `${mutation.method} ${mutation.url}: ${response.body}`).toBe(403);
    }
    const movementsRead = await app.inject({ method: "GET", url: "/api/v1/admin/inventory/movements", cookies: manager });
    expect(InventoryMovementsResponseSchema.safeParse(movementsRead.json()).success).toBe(true);
    const movement = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${count.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "inventory-dto-post-count-01" }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [] } });
    expect(movement.statusCode).toBe(200);
    expect(InventoryCountResponseSchema.safeParse(movement.json()).success).toBe(true);
    const movementRead = await app.inject({ method: "GET", url: `/api/v1/admin/inventory/movements?stockItemId=${itemId}`, cookies: manager });
    const movementDto = movementRead.json().data.movements[0];
    expect(movementDto).toBeDefined();
    expect(InventoryMovementSchema.safeParse(movementDto).success).toBe(true);
    expect(JSON.stringify(movementDto)).not.toMatch(/password|token|secret|margin|knownCost/i);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const paths = [
      ["/api/v1/admin/inventory/stock-items", StockItemsResponseSchema],
      ["/api/v1/admin/inventory/purchases", PurchasesResponseSchema],
      ["/api/v1/admin/inventory/recipes", RecipesResponseSchema],
      ["/api/v1/admin/inventory/counts", InventoryCountsResponseSchema],
      ["/api/v1/admin/inventory/movements", InventoryMovementsResponseSchema],
      ["/api/v1/admin/inventory/pending-consumption", PendingConsumptionsResponseSchema],
      [`/api/v1/admin/reports/gross-profit?fromDate=${date}&toDate=${date}`, GrossProfitReportResponseSchema],
    ] as const;
    for (const [url, responseSchema] of paths) {
      const response = await app.inject({ method: "GET", url, cookies: manager });
      expect(response.statusCode, response.body).toBe(200);
      expect(responseSchema.safeParse(response.json()).success, url).toBe(true);
      expect((await app.inject({ method: "GET", url, cookies: staff })).statusCode, url).toBe(403);
    }

    const costingUrl = `/api/v1/admin/products/${product.id}/costing`;
    expect((await app.inject({ method: "GET", url: costingUrl, cookies: staff })).statusCode).toBe(403);
    const previewUrl = `/api/v1/admin/products/${product.id}/costing/preview`;
    expect((await app.inject({ method: "POST", url: previewUrl, cookies: staff, payload: { optionIds: [], quantity: 1 } })).statusCode).toBe(403);
    const preview = await app.inject({ method: "POST", url: previewUrl, cookies: manager, payload: { optionIds: [], quantity: 1 } });
    expect(ProductCostingPreviewResponseSchema.safeParse(preview.json()).success).toBe(true);
    expect(JSON.stringify(preview.json())).not.toMatch(/password|token|secret/i);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: itemId } })).trackingStartedAt).not.toBeNull();
  });

  it("covers P2 inventory editing, stale versions, draft history, and malformed management input", async () => {
    const manager = await session(UserRole.DEVELOPER, "inventory-p2.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Editable stock", category: "Ingredients", baseUnit: "GRAM", conversions: [{ label: "kg", baseQuantityPerPack: "1000", isActive: true }] } });
    expect(created.statusCode, created.body).toBe(201);
    const stockItemId = created.json().data.id as string;
    const duplicateConversion = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/stock-items/${stockItemId}`, cookies: manager, payload: { expectedVersion: 1, conversions: [{ label: "kg", baseQuantityPerPack: "1000", isActive: true }, { label: "KG", baseQuantityPerPack: "1000", isActive: true }] } });
    expect(duplicateConversion.statusCode).toBe(422);

    const updated = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/stock-items/${stockItemId}`, cookies: manager, payload: { expectedVersion: 1, name: "Renamed stock" } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().data).toMatchObject({ name: "Renamed stock", version: 2, balance: { quantityOnHand: "0", carryingValueAmount: 0 } });
    const stale = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/stock-items/${stockItemId}`, cookies: manager, payload: { expectedVersion: 1, name: "Stale write" } });
    expect(stale.statusCode).toBe(409);

    const purchase = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { receivedAt: "2026-10-13T08:00:00.000Z", supplier: "Draft supplier", lines: [{ stockItemId, conversionId: created.json().data.conversions[0].id, purchaseUnitLabel: "kg", purchaseQuantity: "0.5", directCostAmount: 12_500 }] } });
    expect(purchase.statusCode, purchase.body).toBe(201);
    const purchaseId = purchase.json().data.id as string;
    const editedPurchase = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/purchases/${purchaseId}`, cookies: manager, payload: { expectedVersion: 1, supplier: "Corrected supplier" } });
    expect(editedPurchase.statusCode, editedPurchase.body).toBe(200);
    expect(editedPurchase.json().data).toMatchObject({ status: "DRAFT", version: 2, supplier: "Corrected supplier", lines: [{ baseQuantityReceived: "500", directCostAmount: 12_500 }] });
    const stalePurchase = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/purchases/${purchaseId}`, cookies: manager, payload: { expectedVersion: 1, supplier: "Stale supplier" } });
    expect(stalePurchase.statusCode).toBe(409);

    const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", reason: "اصلاح شمارش", lines: [{ stockItemId, observedQuantity: "10", observedValueAmount: 1_000 }] } });
    const editCount = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/counts/${count.json().data.id}`, cookies: manager, payload: { expectedVersion: 1, reason: "اصلاح مقدار ثبت‌شده", lines: [{ stockItemId, observedQuantity: "10.5", observedValueAmount: 1_050 }] } });
    expect(editCount.statusCode, editCount.body).toBe(200);
    expect(editCount.json().data.lines).toMatchObject([{ observedQuantity: "10.5", observedValueAmount: 1_050 }]);
    const malformedQuery = await app.inject({ method: "GET", url: "/api/v1/admin/inventory/movements?limit=0", cookies: manager });
    expect(malformedQuery.statusCode).toBe(400);
  });
});
