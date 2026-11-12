import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GrossProfitReportResponseSchema, ProductCostingConfigurationResponseSchema, ProductCostingPreviewResponseSchema } from "@cafe/contracts";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
type Cookies = Record<string, string>;
async function request(cookies: Cookies, method: "GET" | "POST" | "PUT" | "PATCH", path: string, payload?: unknown, status = 200, key?: string) {
  const response = await app.inject({ method, url: `/api/v1${path}`, cookies, ...(payload === undefined ? {} : { payload: payload as any }), ...(key ? { headers: { "idempotency-key": key } } : {}) });
  expect(response.statusCode, response.body).toBe(status);
  return response.json().data;
}
async function login(role: "MANAGER" | "STAFF") {
  const username = `${role.toLowerCase()}.${randomUUID()}`;
  await app.prisma.user.create({ data: { username, role, passwordHash: await hashPassword("CafePassword2026") } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  expect(response.statusCode).toBe(200);
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}
async function fixture(active = false, mode: "RECIPE" | "PURCHASED_ITEM" = "RECIPE", weighted = false) {
  const manager = await login("MANAGER");
  if (active) await request(manager, "POST", "/admin/settings/inventory/activate", {});
  const category = await app.prisma.category.create({ data: { name: "Packaging drinks", displayOrder: 1 } });
  const product = await app.prisma.product.create({ data: { name: "Packaging coffee", categoryId: category.id, priceAmount: 10000, preparationDeadlineMinutes: 1, displayOrder: 1, pricingMode: weighted ? "WEIGHTED_PER_KG" : "FIXED" } });
  const stock = async (name: string, baseUnit: "GRAM" | "PIECE", quantity: string, value: number) => request(manager, "POST", "/admin/inventory/stock-items", { name, category: "Stock", baseUnit, openingQuantity: quantity, openingValueAmount: value, conversions: [] }, 201);
  const beans = await stock("Coffee", "GRAM", "1000", 10000);
  const cup = await stock("Cup", "PIECE", "10", 1000);
  const holder = await stock("Holder", "PIECE", "10", 2000);
  const recipe = await request(manager, "POST", "/admin/inventory/recipes", { name: "Coffee recipe", outputUnit: weighted ? "GRAM" : "PIECE", yieldQuantity: weighted ? "1000" : "1", components: [{ componentKey: "coffee", sourceKind: "STOCK_ITEM", stockItemId: beans.id, quantity: "10", displayOrder: 0 }] }, 201);
  const base = mode === "RECIPE" ? { mode, recipeId: recipe.id, recipeQuantity: weighted ? "1000" : "1" } : { mode, purchasedStockItemId: beans.id, purchasedQuantity: "10" };
  const input = { ...base, optionRules: [], combinations: [], takeawayPackaging: [{ stockItemId: cup.id, quantity: "1" }, { stockItemId: holder.id, quantity: "0.5" }] };
  const configuration = await request(manager, "PUT", `/admin/products/${product.id}/costing`, { ...input, expectedVersion: 1 });
  ProductCostingConfigurationResponseSchema.parse({ data: configuration, meta: { requestId: "test" } });
  return { manager, product, beans, cup, holder, recipe, input, configuration };
}
type Fixture = Pick<Awaited<ReturnType<typeof fixture>>, "manager" | "product">;
async function preview(f: Fixture, channel: "TABLE" | "TAKEAWAY", quantity = 1, weightGrams?: number, optionIds: string[] = []) {
  const data = await request(f.manager, "POST", `/admin/products/${f.product.id}/costing/preview`, { channel, quantity, optionIds, ...(weightGrams ? { weightGrams } : {}) });
  ProductCostingPreviewResponseSchema.parse({ data, meta: { requestId: "test" } });
  return data;
}
async function order(f: Fixture, channel: "TABLE" | "TAKEAWAY", quantity = 1) {
  const table = channel === "TABLE" ? await app.prisma.cafeTable.create({ data: { name: `Table ${randomUUID()}`, displayOrder: 1 } }) : null;
  return request(f.manager, "POST", "/orders", { channel, ...(table ? { tableId: table.id } : {}), items: [{ productId: f.product.id, quantity, options: [] }] }, 201, randomUUID());
}
async function pay(f: Fixture, current: any, amount = current.balanceAmount, key = randomUUID()) {
  return request(f.manager, "POST", `/orders/${current.id}/record-settlement`, { expectedVersion: current.version, allocationMode: "AMOUNT", amount, payments: [{ method: "CASH", amount }] }, 201, key);
}
async function report(f: Fixture) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const response = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${date}&toDate=${date}`, cookies: f.manager });
  expect(response.statusCode, response.body).toBe(200);
  return GrossProfitReportResponseSchema.parse(response.json()).data;
}
async function balance(id: string) { return (await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: id } })).quantityOnHand.toString(); }

describe("takeaway packaging", () => {
  it.each(["RECIPE", "PURCHASED_ITEM"] as const)("adds multiple exact packaging quantities only to takeaway %s previews", async (mode) => {
    const f = await fixture(false, mode);
    expect(await preview(f, "TABLE", 2)).toMatchObject({ isComplete: true, knownCostAmount: 200 });
    const takeaway = await preview(f, "TAKEAWAY", 2);
    expect(takeaway).toMatchObject({ isComplete: true, knownCostAmount: 600 });
    expect(takeaway.components).toEqual(expect.arrayContaining([expect.objectContaining({ stockItemId: f.cup.id, quantity: "2" }), expect.objectContaining({ stockItemId: f.holder.id, quantity: "1" })]));
  });

  it("scales weighted ingredients by weight and packaging by sold count", async () => {
    const f = await fixture(false, "RECIPE", true);
    expect(await preview(f, "TABLE", 2, 250)).toMatchObject({ knownCostAmount: 50 });
    expect(await preview(f, "TAKEAWAY", 2, 250)).toMatchObject({ knownCostAmount: 450 });
  });

  it("adds packaging after a complete option recipe, without replacing ingredients", async () => {
    const f = await fixture();
    const group = await app.prisma.optionGroup.create({ data: { name: "Size" } });
    const option = await app.prisma.option.create({ data: { optionGroupId: group.id, name: "Large", displayOrder: 1, priceAmount: 0 } });
    await app.prisma.productOptionGroup.create({ data: { productId: f.product.id, optionGroupId: group.id, minSelections: 0, maxSelections: 1, displayOrder: 1, allowedOptions: { create: { optionId: option.id, displayOrder: 1 } } } });
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, optionRecipes: [{ optionId: option.id, recipeId: f.recipe.id, recipeQuantity: "2" }], expectedVersion: 1 });
    expect(await preview(f, "TAKEAWAY", 1, undefined, [option.id])).toMatchObject({ isComplete: true, knownCostAmount: 400 });
  });

  it("validates quantities, duplicates, active references, authorization and stale edits; omission preserves mappings and empty clears", async () => {
    const f = await fixture();
    const staff = await login("STAFF");
    await request(staff, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, expectedVersion: 1 }, 403);
    await request(staff, "POST", `/admin/products/${f.product.id}/costing/preview`, { channel: "TAKEAWAY", optionIds: [], quantity: 1 }, 403);
    for (const quantity of ["0", "-1", "1.0000001", "abc"]) await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, expectedVersion: 1, takeawayPackaging: [{ stockItemId: f.cup.id, quantity }] }, 400);
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, expectedVersion: 1, takeawayPackaging: [f.input.takeawayPackaging[0], f.input.takeawayPackaging[0]] }, 400);
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, expectedVersion: 1, takeawayPackaging: [{ stockItemId: randomUUID(), quantity: "1" }] }, 422);
    await app.prisma.stockItem.update({ where: { id: f.cup.id }, data: { isActive: false } });
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, expectedVersion: 1 }, 422);
    expect(await preview(f, "TAKEAWAY")).toMatchObject({ isComplete: false, missingReasons: [`missing-stock:${f.cup.id}`] });
    expect(await preview(f, "TABLE")).toMatchObject({ isComplete: true });
    await app.prisma.stockItem.update({ where: { id: f.cup.id }, data: { isActive: true } });
    const { takeawayPackaging, ...legacyInput } = f.input;
    const saved = await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...legacyInput, expectedVersion: 1 });
    expect(saved.takeawayPackaging).toEqual(takeawayPackaging);
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, expectedVersion: 1 }, 409);
    const cleared = await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...legacyInput, takeawayPackaging: [], expectedVersion: 2 });
    expect(cleared.takeawayPackaging).toEqual([]);
    expect(await preview(f, "TAKEAWAY")).toMatchObject({ knownCostAmount: 100 });
    expect(await app.prisma.auditLog.count({ where: { operation: "UPDATE_PRODUCT_COSTING" } })).toBe(2);
  });

  it("recognizes only full payments without deductions before activation, snapshots mappings and splits margins without double counting", async () => {
    const f = await fixture();
    const takeaway = await order(f, "TAKEAWAY", 2);
    const partial = await pay(f, takeaway, 5000);
    expect((await report(f)).totals.netSalesAmount).toBe(0);
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, takeawayPackaging: [], expectedVersion: 1 });
    const key = randomUUID();
    await pay(f, partial, 15000, key);
    await pay(f, partial, 15000, key);
    await pay(f, await order(f, "TABLE"));
    const data = await report(f);
    expect(data.products).toHaveLength(2);
    expect(data.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "TABLE", netSalesAmount: 10000, theoreticalCogsAmount: 100, grossMarginPercent: "99.00" }),
      expect.objectContaining({ channel: "TAKEAWAY", netSalesAmount: 20000, theoreticalCogsAmount: 600, grossMarginPercent: "97.00" }),
    ]));
    expect(data.totals).toMatchObject({ netSalesAmount: 30000, theoreticalCogsAmount: 700, grossProfitAmount: 29300, grossMarginPercent: "97.67" });
    expect(await balance(f.cup.id)).toBe("10");
    expect(await app.prisma.orderConsumption.count({ where: { status: "UNTRACKED" } })).toBe(2);
    expect(await app.prisma.inventoryMovement.count({ where: { orderConsumptionId: { not: null } } })).toBe(0);
  });

  it("consumes packaging once on full payment and restores recorded quantities/value on reversal, repayment and deletion", async () => {
    const f = await fixture(true);
    const created = await order(f, "TAKEAWAY", 2);
    const paid = await pay(f, created);
    expect(await balance(f.cup.id)).toBe("8");
    expect(await balance(f.holder.id)).toBe("9");
    const settlement = await app.prisma.paymentSettlement.findFirstOrThrow({ where: { orderId: created.id } });
    const reopened = await request(f.manager, "POST", `/admin/settlements/${settlement.id}/reverse`, { expectedVersion: paid.version, reason: "Correction" });
    expect(await balance(f.cup.id)).toBe("10");
    expect((await report(f)).totals.netSalesAmount).toBe(0);
    const repaid = await pay(f, reopened);
    expect(await balance(f.cup.id)).toBe("8");
    await request(f.manager, "POST", `/orders/${created.id}/delete`, { expectedVersion: repaid.version });
    expect(await balance(f.cup.id)).toBe("10");
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: f.cup.id } })).carryingValueAmount).toBe(1000);
    expect((await report(f)).products).toEqual([]);
  });

  it("keeps the whole order pending on packaging shortage and retries it once after a receipt", async () => {
    const f = await fixture(true);
    const created = await order(f, "TAKEAWAY", 11);
    await pay(f, created);
    expect(await balance(f.beans.id)).toBe("1000");
    expect(await balance(f.cup.id)).toBe("10");
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: created.id } })).toMatchObject({ status: "PENDING" });
    const purchase = await request(f.manager, "POST", "/admin/inventory/purchases", { receivedAt: new Date().toISOString(), lines: [{ stockItemId: f.cup.id, conversionId: null, purchaseUnitLabel: "PIECE", purchaseQuantity: "10", directCostAmount: 1000 }] }, 201);
    const key = randomUUID();
    await request(f.manager, "POST", `/admin/inventory/purchases/${purchase.id}/post`, { expectedVersion: 1 }, 200, key);
    await request(f.manager, "POST", `/admin/inventory/purchases/${purchase.id}/post`, { expectedVersion: 1 }, 200, key);
    expect(await balance(f.beans.id)).toBe("890");
    expect(await balance(f.cup.id)).toBe("9");
    expect(await balance(f.holder.id)).toBe("4.5");
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: created.id } })).toMatchObject({ status: "POSTED", theoreticalCogsAmount: 3300 });
  });

  it("keeps packaging shortages untracked before turnover and does not backfill after activation", async () => {
    const f = await fixture();
    await pay(f, await order(f, "TAKEAWAY", 11));
    expect(await app.prisma.orderConsumption.findFirst()).toMatchObject({ status: "UNTRACKED", theoreticalCogsAmount: 3300 });
    expect(await balance(f.beans.id)).toBe("1000");
    expect(await balance(f.cup.id)).toBe("10");
    await request(f.manager, "POST", "/admin/settings/inventory/activate", {});
    await pay(f, await order(f, "TABLE"));
    expect(await balance(f.beans.id)).toBe("990");
    expect(await balance(f.cup.id)).toBe("10");
    expect(await app.prisma.orderConsumption.count({ where: { status: "PENDING" } })).toBe(0);
  });

  it("marks missing packaging valuation incomplete without hiding known ingredient costs", async () => {
    const f = await fixture();
    await app.prisma.inventoryBalance.update({ where: { stockItemId: f.cup.id }, data: { trackingStartedAt: null, quantityOnHand: 0, carryingValueAmount: 0 } });
    expect(await preview(f, "TAKEAWAY")).toMatchObject({ isComplete: false, knownCostAmount: 200, missingReasons: [`missing-valuation:${f.cup.id}`] });
    await pay(f, await order(f, "TAKEAWAY"));
    const data = await report(f);
    expect(data.products).toEqual([expect.objectContaining({ channel: "TAKEAWAY", theoreticalCogsAmount: null, knownCogsAmount: 200, grossMarginPercent: null, incompleteOrderItemCount: 1 })]);
    expect(data.totals.grossProfitAmount).toBeNull();
    expect(await app.prisma.orderConsumption.findFirst()).toMatchObject({ status: "UNTRACKED" });
  });

  it("preserves dine-in costing when an unpaid table order is set aside", async () => {
    const f = await fixture();
    const current = await order(f, "TABLE");
    const deferred = await request(f.manager, "POST", `/orders/${current.id}/defer`, { expectedVersion: current.version });
    const edited = await request(f.manager, "PATCH", `/orders/${current.id}`, { expectedVersion: deferred.version, addItems: [{ productId: f.product.id, quantity: 1, options: [] }] });
    await pay(f, edited);
    const rows = (await report(f)).products;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "TABLE", theoreticalCogsAmount: 200, netSalesAmount: 20000 });
  });
});

async function latteFixture(active = false) {
  const f = await fixture(active);
  const stock = (name: string, value: number) => request(f.manager, "POST", "/admin/inventory/stock-items", { name, category: "Stock", baseUnit: "PIECE", openingQuantity: "100", openingValueAmount: value, conversions: [] }, 201);
  const cookie = await stock("Cookie", 5000);
  const wrapper = await stock("Cookie wrapper", 1000);
  const cap = await stock("Cup cap", 2000);
  const recipe = (name: string, components: any[]) => request(f.manager, "POST", "/admin/inventory/recipes", { name, outputUnit: "PIECE", yieldQuantity: "1", components: components.map((row, displayOrder) => ({ ...row, componentKey: `${name}-${displayOrder}`, displayOrder })) }, 201);
  const normalCookie = await recipe("Cookie dine-in", [{ sourceKind: "STOCK_ITEM", stockItemId: cookie.id, quantity: "1" }]);
  const takeawayCookie = await recipe("Cookie takeaway", [{ sourceKind: "RECIPE", nestedRecipeId: normalCookie.id, quantity: "1" }, { sourceKind: "STOCK_ITEM", stockItemId: wrapper.id, quantity: "1" }]);
  const normalLatte = await recipe("Latte dine-in", [{ sourceKind: "STOCK_ITEM", stockItemId: f.beans.id, quantity: "10" }, { sourceKind: "RECIPE", nestedRecipeId: normalCookie.id, quantity: "1" }]);
  const takeawayLatte = await recipe("Latte takeaway", [{ sourceKind: "STOCK_ITEM", stockItemId: f.beans.id, quantity: "10" }, { sourceKind: "RECIPE", nestedRecipeId: takeawayCookie.id, quantity: "1" }]);
  const input = { ...f.input, recipeId: normalLatte.id, takeawayRecipeId: takeawayLatte.id, takeawayPackaging: [{ stockItemId: f.cup.id, quantity: "1" }, { stockItemId: cap.id, quantity: "1" }, { stockItemId: f.holder.id, quantity: "1", mode: "PER_GROUP", groupSize: 2 }] };
  await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...input, expectedVersion: 1 });
  return { ...f, input, cookie, wrapper, cap, normalCookie, takeawayCookie, normalLatte, takeawayLatte };
}
function componentQuantity(data: any, id: string) { return data.components.find((row: any) => row.stockItemId === id)?.quantity ?? "0"; }

describe("conditional packaging and nested takeaway preparations", () => {
  it("resolves the exact latte example, complete pairs and nested wrapped cookies without adding packaging to dine-in", async () => {
    const f = await latteFixture();
    for (const quantity of [1, 2, 3, 4, 5]) {
      const data = await preview(f, "TAKEAWAY", quantity);
      expect(data.isComplete).toBe(true);
      for (const id of [f.cup.id, f.cap.id, f.cookie.id, f.wrapper.id]) expect(componentQuantity(data, id)).toBe(String(quantity));
      expect(componentQuantity(data, f.holder.id)).toBe(String(Math.floor(quantity / 2)));
      expect(data.knownCostAmount).toBe(quantity * 280 + Math.floor(quantity / 2) * 200);
    }
    const normal = await preview(f, "TABLE", 2);
    expect(normal.knownCostAmount).toBe(300);
    expect(componentQuantity(normal, f.cookie.id)).toBe("2");
    for (const id of [f.wrapper.id, f.cap.id, f.cup.id, f.holder.id]) expect(componentQuantity(normal, id)).toBe("0");
  });

  it("counts split product rows together, deducts one whole holder and restores nested packaging once", async () => {
    const f = await latteFixture(true);
    const created = await request(f.manager, "POST", "/orders", { channel: "TAKEAWAY", items: [{ productId: f.product.id, quantity: 1, note: "first", options: [] }, { productId: f.product.id, quantity: 1, note: "second", options: [] }] }, 201, randomUUID());
    const paid = await pay(f, created);
    expect(await balance(f.holder.id)).toBe("9");
    expect(await balance(f.cup.id)).toBe("8");
    expect(await balance(f.cap.id)).toBe("98");
    expect(await balance(f.wrapper.id)).toBe("98");
    expect(await balance(f.cookie.id)).toBe("98");
    expect((await report(f)).totals.theoreticalCogsAmount).toBe(760);
    const movements = await app.prisma.inventoryMovement.findMany({ where: { stockItemId: f.holder.id, kind: "ORDER_CONSUMPTION" } });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.quantityDelta.toString()).toBe("-1");
    await request(f.manager, "POST", `/orders/${created.id}/delete`, { expectedVersion: paid.version });
    expect(await balance(f.holder.id)).toBe("10");
    expect(await balance(f.wrapper.id)).toBe("100");
    expect((await report(f)).products).toEqual([]);
  });

  it("reevaluates order quantity edits while retaining resolved requirements after later configuration changes", async () => {
    const f = await latteFixture();
    const created = await order(f, "TAKEAWAY");
    const snapshots = () => app.prisma.orderItemCostingSnapshot.findUniqueOrThrow({ where: { orderItemId: created.items[0].id } });
    expect(componentQuantity((await snapshots()).snapshot, f.holder.id)).toBe("0");
    let edited = await request(f.manager, "PATCH", `/orders/${created.id}`, { expectedVersion: created.version, itemUpdates: [{ orderItemId: created.items[0].id, quantity: 2 }] });
    expect(componentQuantity((await snapshots()).snapshot, f.holder.id)).toBe("1");
    edited = await request(f.manager, "PATCH", `/orders/${created.id}`, { expectedVersion: edited.version, itemUpdates: [{ orderItemId: created.items[0].id, quantity: 1 }] });
    expect(componentQuantity((await snapshots()).snapshot, f.holder.id)).toBe("0");
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, takeawayRecipeId: null, takeawayPackaging: [], expectedVersion: 2 });
    await pay(f, edited);
    expect((await report(f)).totals.theoreticalCogsAmount).toBe(280);
    expect(await balance(f.wrapper.id)).toBe("100");
  });

  it("supports quantity bands and once-per-product rules across split rows", async () => {
    const f = await latteFixture();
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, takeawayPackaging: [{ stockItemId: f.holder.id, quantity: "1", mode: "PER_ORDER", minQuantity: 2, maxQuantity: 3 }], expectedVersion: 2 });
    for (const [quantity, expected] of [[1, "0"], [2, "1"], [3, "1"], [4, "0"]] as const) expect(componentQuantity(await preview(f, "TAKEAWAY", quantity), f.holder.id)).toBe(expected);
    const created = await request(f.manager, "POST", "/orders", { channel: "TAKEAWAY", items: [{ productId: f.product.id, quantity: 1, options: [] }, { productId: f.product.id, quantity: 1, options: [] }] }, 201, randomUUID());
    await pay(f, created);
    expect((await report(f)).totals.theoreticalCogsAmount).toBe(520);
  });

  it("uses takeaway option overrides and inherits normal option recipes when an override is absent", async () => {
    const f = await latteFixture();
    const group = await app.prisma.optionGroup.create({ data: { name: "Drink size" } });
    const option = await app.prisma.option.create({ data: { name: "Large latte", optionGroupId: group.id, priceAmount: 0, displayOrder: 1 } });
    await app.prisma.productOptionGroup.create({ data: { productId: f.product.id, optionGroupId: group.id, minSelections: 0, maxSelections: 1, displayOrder: 1, allowedOptions: { create: { optionId: option.id, displayOrder: 1 } } } });
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, optionRecipes: [{ optionId: option.id, recipeId: f.normalLatte.id, recipeQuantity: "1" }], takeawayOptionRecipes: [{ optionId: option.id, recipeId: f.takeawayLatte.id, recipeQuantity: "1" }], expectedVersion: 2 });
    expect(componentQuantity(await preview(f, "TABLE", 1, undefined, [option.id]), f.wrapper.id)).toBe("0");
    expect(componentQuantity(await preview(f, "TAKEAWAY", 1, undefined, [option.id]), f.wrapper.id)).toBe("1");
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, optionRecipes: [{ optionId: option.id, recipeId: f.normalLatte.id, recipeQuantity: "1" }], takeawayOptionRecipes: [], expectedVersion: 3 });
    expect(componentQuantity(await preview(f, "TAKEAWAY", 1, undefined, [option.id]), f.wrapper.id)).toBe("0");
  });

  it("keeps grouped holders and nested wrappers pending together and restores their recorded amounts after retry", async () => {
    const f = await latteFixture(true);
    const created = await order(f, "TAKEAWAY", 22);
    const paid = await pay(f, created);
    expect(await app.prisma.orderConsumption.findFirst({ where: { orderId: created.id } })).toMatchObject({ status: "PENDING", theoreticalCogsAmount: 8360 });
    expect(await balance(f.cookie.id)).toBe("100");
    expect(await balance(f.wrapper.id)).toBe("100");
    const purchase = await request(f.manager, "POST", "/admin/inventory/purchases", { receivedAt: new Date().toISOString(), lines: [
      { stockItemId: f.cup.id, conversionId: null, purchaseUnitLabel: "PIECE", purchaseQuantity: "20", directCostAmount: 2000 },
      { stockItemId: f.holder.id, conversionId: null, purchaseUnitLabel: "PIECE", purchaseQuantity: "1", directCostAmount: 200 },
    ] }, 201);
    await request(f.manager, "POST", `/admin/inventory/purchases/${purchase.id}/post`, { expectedVersion: 1 }, 200, randomUUID());
    expect(await balance(f.cup.id)).toBe("8");
    expect(await balance(f.holder.id)).toBe("0");
    expect(await balance(f.wrapper.id)).toBe("78");
    const settlement = await app.prisma.paymentSettlement.findFirstOrThrow({ where: { orderId: created.id } });
    await request(f.manager, "POST", `/admin/settlements/${settlement.id}/reverse`, { expectedVersion: paid.version, reason: "Correction" });
    expect(await balance(f.cup.id)).toBe("30");
    expect(await balance(f.holder.id)).toBe("11");
    expect(await balance(f.wrapper.id)).toBe("100");
  });

  it("does not combine different products into a holder group and marks inactive nested wrappers incomplete", async () => {
    const f = await latteFixture();
    const other = await app.prisma.product.create({ data: { categoryId: f.product.categoryId, name: "Other drink", priceAmount: 10000, preparationDeadlineMinutes: 1, displayOrder: 2 } });
    await request(f.manager, "PUT", `/admin/products/${other.id}/costing`, { ...f.input, expectedVersion: 1 });
    const created = await request(f.manager, "POST", "/orders", { channel: "TAKEAWAY", items: [{ productId: f.product.id, quantity: 1, options: [] }, { productId: other.id, quantity: 1, options: [] }] }, 201, randomUUID());
    await pay(f, created);
    expect((await report(f)).totals.theoreticalCogsAmount).toBe(560);
    await app.prisma.stockItem.update({ where: { id: f.wrapper.id }, data: { isActive: false } });
    expect(await preview(f, "TAKEAWAY")).toMatchObject({ isComplete: false, missingReasons: [`missing-stock:${f.wrapper.id}`] });
    expect(await preview(f, "TABLE")).toMatchObject({ isComplete: true });
  });

  it("rejects malformed rules, invalid overrides, foreign options and circular reusable recipes", async () => {
    const f = await latteFixture();
    for (const rule of [ { mode: "PER_GROUP" }, { mode: "PER_GROUP", groupSize: 1 }, { mode: "PER_UNIT", groupSize: 2 }, { minQuantity: 3, maxQuantity: 2 }, { minQuantity: 0 } ]) {
      await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, takeawayPackaging: [{ stockItemId: f.holder.id, quantity: "1", ...rule }], expectedVersion: 2 }, 400);
    }
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, takeawayRecipeId: randomUUID(), expectedVersion: 2 }, 422);
    await request(f.manager, "PUT", `/admin/products/${f.product.id}/costing`, { ...f.input, takeawayOptionRecipes: [{ optionId: randomUUID(), recipeId: f.takeawayLatte.id, recipeQuantity: "1" }], expectedVersion: 2 }, 422);
    await request(f.manager, "PATCH", `/admin/inventory/recipes/${f.normalCookie.id}`, { name: "Cookie dine-in", outputUnit: "PIECE", yieldQuantity: "1", expectedVersion: 1, components: [{ componentKey: "cycle", sourceKind: "RECIPE", nestedRecipeId: f.takeawayCookie.id, quantity: "1", displayOrder: 0 }] }, 422);
    const staff = await login("STAFF");
    await request(staff, "POST", "/admin/inventory/recipes", { name: "Unauthorized cookie", outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "cookie", sourceKind: "STOCK_ITEM", stockItemId: f.cookie.id, quantity: "1", displayOrder: 0 }] }, 403);
  });
});
