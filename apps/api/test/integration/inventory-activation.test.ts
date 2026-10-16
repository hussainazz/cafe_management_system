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
async function expectNoInventoryWrites(orderId: string) {
  expect(await app.prisma.orderItemCostingSnapshot.count({ where: { orderItem: { orderId } } })).toBe(0);
  expect(await app.prisma.orderConsumption.count({ where: { orderId } })).toBe(0);
  expect(await app.prisma.inventoryMovement.count()).toBe(0);
}

describe("permanent inventory activation", () => {
  it("defaults off, blocks inventory reads and writes, and keeps ordering and payment free of inventory records", async () => {
    const manager = await login("MANAGER");
    const item = await product();
    const settings = await app.inject({ method: "GET", url: "/api/v1/admin/settings", cookies: manager });
    expect(settings.json().data.inventoryActivatedAt).toBeNull();
    for (const url of ["/admin/inventory/stock-items", "/admin/inventory/purchases", "/admin/inventory/recipes", "/admin/inventory/counts", "/admin/inventory/movements", "/admin/inventory/pending-consumption", `/admin/products/${item.id}/costing`, "/admin/reports/gross-profit?fromDate=2026-10-14&toDate=2026-10-14"]) {
      const response = await app.inject({ method: "GET", url: `/api/v1${url}`, cookies: manager });
      expect(response.statusCode, response.body).toBe(409);
    }
    const blocked = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Disabled beans", category: "Ingredients", baseUnit: "GRAM", openingQuantity: "0", openingValueAmount: 0, conversions: [] } });
    expect(blocked.statusCode, blocked.body).toBe(409);
    const created = await order(manager, item.id, "disabled-inventory-order-01");
    await expectNoInventoryWrites(created.id);
    await settle(manager, created, "disabled-inventory-payment-01");
    await expectNoInventoryWrites(created.id);
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

  it("excludes existing open orders when edited and paid after activation and tracks new orders", async () => {
    const manager = await login("MANAGER");
    const item = await product();
    const older = await order(manager, item.id, "preactivation-open-order-01");
    await app.prisma.order.update({ where: { id: older.id }, data: { createdAt: new Date(Date.now() - 60000) } });
    await activate(manager);
    const edit = await app.inject({ method: "PATCH", url: `/api/v1/orders/${older.id}`, cookies: manager, payload: { expectedVersion: older.version, items: [{ productId: item.id, quantity: 2, options: [] }] } });
    expect(edit.statusCode, edit.body).toBe(200);
    await settle(manager, edit.json().data, "preactivation-paid-after-01");
    await expectNoInventoryWrites(older.id);
    const newer = await order(manager, item.id, "postactivation-new-order-01");
    expect(await app.prisma.orderItemCostingSnapshot.count({ where: { orderItem: { orderId: newer.id } } })).toBe(1);
    await settle(manager, newer, "postactivation-new-payment-01");
    expect(await app.prisma.orderConsumption.count({ where: { orderId: newer.id } })).toBe(1);
    expect(await app.prisma.orderConsumption.count({ where: { orderId: older.id } })).toBe(0);
  });
});
