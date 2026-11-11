import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
async function login(role: "MANAGER" | "STAFF") {
  const username = `activation.${role.toLowerCase()}`;
  await app.prisma.user.create({ data: { username, role, passwordHash: await hashPassword("CafePassword2026") } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  expect(response.statusCode).toBe(200);
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}
async function product() {
  const category = await app.prisma.category.create({ data: { name: "Activation category", displayOrder: 1 } });
  return app.prisma.product.create({ data: { categoryId: category.id, name: "Activation coffee", priceAmount: 10000, preparationDeadlineMinutes: 1, displayOrder: 1 } });
}
async function order(cookies: Record<string, string>, productId: string, key: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/orders", cookies, headers: { "idempotency-key": key }, payload: { channel: "TAKEAWAY", items: [{ productId, quantity: 1, options: [] }] } });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data;
}
async function activate(cookies: Record<string, string>) {
  const response = await app.inject({ method: "POST", url: "/api/v1/admin/settings/inventory/activate", cookies, payload: {} });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data;
}
async function settle(cookies: Record<string, string>, current: any, key: string) {
  const response = await app.inject({ method: "POST", url: `/api/v1/orders/${current.id}/record-settlement`, cookies, headers: { "idempotency-key": key }, payload: { expectedVersion: current.version, allocationMode: "AMOUNT", amount: current.totalAmount, payments: [{ method: "CASH", amount: current.totalAmount }] } });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data;
}
async function setupCosting(manager: Record<string, string>) {
  const item = await product();
  const stock = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Costing beans", category: "Ingredients", baseUnit: "GRAM", openingQuantity: "100", openingValueAmount: 1000, conversions: [] } });
  expect(stock.statusCode, stock.body).toBe(201);
  const stockItemId = stock.json().data.id;
  const recipe = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/recipes", cookies: manager, payload: { name: "Coffee recipe", outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "beans", sourceKind: "STOCK_ITEM", stockItemId, quantity: "10", displayOrder: 0 }] } });
  expect(recipe.statusCode, recipe.body).toBe(201);
  const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${item.id}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: recipe.json().data.id, recipeQuantity: "1", optionRules: [], combinations: [] } });
  expect(configured.statusCode, configured.body).toBe(200);
  return { item, stockItemId };
}
async function receipt(manager: Record<string, string>, stockItemId: string, key: string) {
  const draft = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: manager, payload: { receivedAt: new Date().toISOString(), supplier: "Supplier", lines: [{ stockItemId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: "100", directCostAmount: 3000 }] } });
  expect(draft.statusCode, draft.body).toBe(201);
  const request = { method: "POST" as const, url: `/api/v1/admin/inventory/purchases/${draft.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": key }, payload: { expectedVersion: 1 } };
  for (let i = 0; i < 2; i++) {
    const result = await app.inject(request);
    expect(result.statusCode, result.body).toBe(200);
  }
}
async function report(manager: Record<string, string>) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const response = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${date}&toDate=${date}`, cookies: manager });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data;
}
async function expectNoOrderMovements(orderId: string) {
  expect(await app.prisma.inventoryMovement.count({ where: { orderConsumption: { orderId } } })).toBe(0);
  expect(await app.prisma.orderConsumption.count({ where: { orderId, status: "PENDING" } })).toBe(0);
}

describe("permanent stock turnover activation", () => {
  it("keeps Manager costing routes available before activation while denying Staff", async () => {
    const manager = await login("MANAGER");
    const staff = await login("STAFF");
    const { item } = await setupCosting(manager);
    const settings = await app.inject({ method: "GET", url: "/api/v1/admin/settings", cookies: manager });
    expect(settings.json().data.inventoryActivatedAt).toBeNull();
    for (const url of ["/admin/inventory/stock-items", "/admin/inventory/purchases", "/admin/inventory/recipes", "/admin/inventory/counts", "/admin/inventory/movements", "/admin/inventory/pending-consumption", `/admin/products/${item.id}/costing`]) {
      expect((await app.inject({ method: "GET", url: `/api/v1${url}`, cookies: manager })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/api/v1${url}`, cookies: staff })).statusCode).toBe(403);
    }
    expect((await report(manager)).totals.netSalesAmount).toBe(0);
  });

  it("posts purchases and previews BOM cost while recognizing only full payments without deductions or later retries", async () => {
    const manager = await login("MANAGER");
    const { item, stockItemId } = await setupCosting(manager);
    await receipt(manager, stockItemId, "costing-receipt-before-01");
    const preview = await app.inject({ method: "POST", url: `/api/v1/admin/products/${item.id}/costing/preview`, cookies: manager, payload: { optionIds: [], quantity: 1 } });
    expect(preview.statusCode, preview.body).toBe(200);
    const created = await order(manager, item.id, "costing-only-order-01");
    const partial = await app.inject({ method: "POST", url: `/api/v1/orders/${created.id}/record-settlement`, cookies: manager, headers: { "idempotency-key": "costing-partial-payment-01" }, payload: { expectedVersion: created.version, allocationMode: "AMOUNT", amount: 4000, payments: [{ method: "CASH", amount: 4000 }] } });
    expect(partial.statusCode, partial.body).toBe(201);
    expect(await app.prisma.orderConsumption.count()).toBe(0);
    expect((await report(manager)).totals.netSalesAmount).toBe(0);
    const final = await app.inject({ method: "POST", url: `/api/v1/orders/${created.id}/record-settlement`, cookies: manager, headers: { "idempotency-key": "costing-final-payment-01" }, payload: { expectedVersion: partial.json().data.version, allocationMode: "AMOUNT", amount: 6000, payments: [{ method: "CASH", amount: 6000 }] } });
    expect(final.statusCode, final.body).toBe(201);
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: created.id } })).toMatchObject({ status: "UNTRACKED", theoreticalCogsAmount: 200, isCostComplete: true });
    expect((await report(manager)).totals).toMatchObject({ netSalesAmount: 10000, theoreticalCogsAmount: 200, grossProfitAmount: 9800 });
    expect((await report(manager)).inventoryConsumption.amount).toBeNull();
    await activate(manager);
    await receipt(manager, stockItemId, "costing-receipt-after-01");
    const balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("300");
    expect(balance.carryingValueAmount).toBe(7000);
    expect(await app.prisma.inventoryMovement.count({ where: { kind: "PURCHASE_RECEIPT" } })).toBe(2);
    await expectNoOrderMovements(created.id);
    expect((await report(manager)).totals.theoreticalCogsAmount).toBe(200);
  });

  it("requires a Manager and preserves the first activation and audit on concurrent retries", async () => {
    const staff = await login("STAFF");
    const denied = await app.inject({ method: "POST", url: "/api/v1/admin/settings/inventory/activate", cookies: staff, payload: {} });
    expect(denied.statusCode).toBe(403);
    const manager = await login("MANAGER");
    const rows = await Promise.all([activate(manager), activate(manager)]);
    expect(rows[0].inventoryActivatedAt).toBeTruthy();
    expect(rows[1].inventoryActivatedAt).toBe(rows[0].inventoryActivatedAt);
    expect(await app.prisma.auditLog.count({ where: { operation: "ACTIVATE_INVENTORY" } })).toBe(1);
    const patch = await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", cookies: manager, payload: { tableSeatingLimitMinutes: 45 } });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(patch.json().data.inventoryActivatedAt).toBe(rows[0].inventoryActivatedAt);
    const disable = await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", cookies: manager, payload: { tableSeatingLimitMinutes: 45, inventoryActivatedAt: null } });
    expect(disable.statusCode).toBe(200);
    expect(disable.json().data.inventoryActivatedAt).toBe(rows[0].inventoryActivatedAt);
    await expect(app.prisma.cafeSettings.update({ where: { singletonKey: true }, data: { inventoryActivatedAt: null } })).rejects.toThrow();
    await expect(app.prisma.cafeSettings.update({ where: { singletonKey: true }, data: { inventoryActivatedAt: new Date("2020-01-01T00:00:00Z") } })).rejects.toThrow();
    await expect(app.prisma.cafeSettings.delete({ where: { singletonKey: true } })).rejects.toThrow();
  });

  it("costs existing open orders after activation without consuming them and deducts new orders", async () => {
    const manager = await login("MANAGER");
    const { item, stockItemId } = await setupCosting(manager);
    const older = await order(manager, item.id, "preactivation-open-order-01");
    await app.prisma.order.update({ where: { id: older.id }, data: { createdAt: new Date(Date.now() - 60000) } });
    await activate(manager);
    const edit = await app.inject({ method: "PATCH", url: `/api/v1/orders/${older.id}`, cookies: manager, payload: { expectedVersion: older.version, items: [{ productId: item.id, quantity: 2, options: [] }] } });
    expect(edit.statusCode, edit.body).toBe(200);
    await settle(manager, edit.json().data, "preactivation-paid-after-01");
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: older.id } })).toMatchObject({ status: "UNTRACKED", theoreticalCogsAmount: 200 });
    await expectNoOrderMovements(older.id);
    const newer = await order(manager, item.id, "postactivation-new-order-01");
    await settle(manager, newer, "postactivation-new-payment-01");
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: newer.id } })).toMatchObject({ status: "POSTED", theoreticalCogsAmount: 100 });
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } })).quantityOnHand.toString()).toBe("90");
    expect((await report(manager)).totals).toMatchObject({ netSalesAmount: 30000, theoreticalCogsAmount: 300, grossProfitAmount: 29700 });
    expect((await report(manager)).inventoryConsumption.amount).toBeNull();
  });

  it("cancels untracked COGS on reversal, recognizes repayment once, and deletes without restoring stock", async () => {
    const manager = await login("MANAGER");
    const { item, stockItemId } = await setupCosting(manager);
    const created = await order(manager, item.id, "untracked-reversal-order-01");
    const paid = await settle(manager, created, "untracked-first-payment-01");
    const reversed = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${paid.settlements[0].id}/reverse`, cookies: manager, payload: { expectedVersion: paid.version, reason: "Correction" } });
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect((await report(manager)).totals.netSalesAmount).toBe(0);
    const repaid = await settle(manager, reversed.json().data, "untracked-repayment-01");
    expect((await report(manager)).totals).toMatchObject({ netSalesAmount: 10000, theoreticalCogsAmount: 100 });
    expect(await app.prisma.orderConsumption.count({ where: { orderId: created.id, status: "CANCELLED" } })).toBe(1);
    await activate(manager);
    const deleted = await app.inject({ method: "POST", url: `/api/v1/orders/${created.id}/delete`, cookies: manager, payload: { expectedVersion: repaid.version } });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect((await report(manager)).totals.netSalesAmount).toBe(0);
    await expectNoOrderMovements(created.id);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } })).quantityOnHand.toString()).toBe("100");
  });

  it("flags missing costing as incomplete without queuing untracked sales", async () => {
    const manager = await login("MANAGER");
    const item = await product();
    const created = await order(manager, item.id, "untracked-missing-cost-order");
    await settle(manager, created, "untracked-missing-cost-paid");
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: created.id } })).toMatchObject({ status: "UNTRACKED", theoreticalCogsAmount: null, isCostComplete: false });
    expect((await report(manager)).totals).toMatchObject({ netSalesAmount: 10000, theoreticalCogsAmount: null, grossProfitAmount: null });
    await expectNoOrderMovements(created.id);
  });

  it("records staff consumption without stock deduction or sales profit before activation", async () => {
    const manager = await login("MANAGER");
    const { item, stockItemId } = await setupCosting(manager);
    const created = await app.inject({ method: "POST", url: "/api/v1/staff-consumption", cookies: manager, headers: { "idempotency-key": "untracked-staff-consumption" }, payload: { channel: "TAKEAWAY", items: [{ productId: item.id, quantity: 1, options: [] }] } });
    expect(created.statusCode, created.body).toBe(201);
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: created.json().data.id } })).toMatchObject({ status: "UNTRACKED", theoreticalCogsAmount: 100 });
    expect((await report(manager)).totals.netSalesAmount).toBe(0);
    await expectNoOrderMovements(created.json().data.id);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } })).quantityOnHand.toString()).toBe("100");
  });
  it("does not queue or deduct an untracked sale even when its recipe exceeds available stock", async () => {
    const manager = await login("MANAGER");
    const { item, stockItemId } = await setupCosting(manager);
    const response = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: manager, headers: { "idempotency-key": "untracked-shortage-order-01" }, payload: { channel: "TAKEAWAY", items: [{ productId: item.id, quantity: 20, options: [] }] } });
    expect(response.statusCode, response.body).toBe(201);
    await settle(manager, response.json().data, "untracked-shortage-payment-01");
    expect(await app.prisma.orderConsumption.findFirst()).toMatchObject({ status: "UNTRACKED", theoreticalCogsAmount: 2000, isCostComplete: true });
    await expectNoOrderMovements(response.json().data.id);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } })).quantityOnHand.toString()).toBe("100");
  });

  it("preserves saved recipes at payment while filling absent legacy snapshots", async () => {
    const manager = await login("MANAGER");
    const { item } = await setupCosting(manager);
    const saved = await order(manager, item.id, "saved-costing-recipe-order");
    const component = await app.prisma.recipeComponent.findFirstOrThrow();
    await app.prisma.recipeComponent.update({ where: { id: component.id }, data: { quantity: "20" } });
    await settle(manager, saved, "saved-costing-recipe-payment");
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: saved.id } })).toMatchObject({ theoreticalCogsAmount: 100 });
    const legacy = await order(manager, item.id, "legacy-costing-recipe-order");
    await app.prisma.orderItemCostingSnapshot.deleteMany({ where: { orderItem: { orderId: legacy.id } } });
    await settle(manager, legacy, "legacy-costing-recipe-payment");
    expect(await app.prisma.orderItemCostingSnapshot.count({ where: { orderItem: { orderId: legacy.id } } })).toBe(1);
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: legacy.id } })).toMatchObject({ theoreticalCogsAmount: 200 });
  });

});
