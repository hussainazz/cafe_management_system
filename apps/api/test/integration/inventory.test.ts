import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

function cookieJar(response: { cookies: Array<{ name: string; value: string }> }) {
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}
async function session(role: UserRole, username: string) {
  await app.prisma.user.create({ data: { username, passwordHash: await hashPassword("CafePassword2026"), role } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  expect(response.statusCode).toBe(200);
  return cookieJar(response);
}
async function productFixture(name: string) {
  const category = await app.prisma.category.create({ data: { name: `${name} category`, displayOrder: 1 } });
  return app.prisma.product.create({ data: { categoryId: category.id, name, priceAmount: 1_000, preparationDeadlineMinutes: 5, displayOrder: 1 } });
}
async function stockFixture(manager: Record<string, string>, name: string, quantity: string, value: number) {
  const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name, category: "Ingredients", baseUnit: "GRAM", conversions: [{ label: "kg", baseQuantityPerPack: "1000", isActive: true }] } });
  expect(created.statusCode, created.body).toBe(201);
  const stockItemId = created.json().data.id as string;
  const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "OPENING", lines: [{ stockItemId, observedQuantity: quantity, observedValueAmount: value }] } });
  expect(count.statusCode, count.body).toBe(201);
  const countId = count.json().data.id as string;
  const safeKey = name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");
  const posted = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${countId}/post`, cookies: manager, headers: { "idempotency-key": `open-count-${safeKey}-0001` }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [] } });
  expect(posted.statusCode, posted.body).toBe(200);
  return stockItemId;
}
async function recipeFixture(manager: Record<string, string>, productId: string, stockItemId: string, quantity = "80") {
  const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/recipes", cookies: manager, payload: { name: `Recipe ${productId}`, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "beans",  sourceKind: "STOCK_ITEM", stockItemId, quantity, displayOrder: 0 }] } });
  expect(created.statusCode, created.body).toBe(201);
  const recipe = created.json().data;
  const configured = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${productId}/costing`, cookies: manager, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: recipe.id, recipeQuantity: "1", optionRules: [], combinations: [] } });
  expect(configured.statusCode, configured.body).toBe(200);
  return recipe;
}
async function orderFixture(staff: Record<string, string>, productId: string, quantity: number, key: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staff, headers: { "idempotency-key": key }, payload: { channel: "TAKEAWAY", items: [{ productId, quantity, options: [] }] } });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data;
}
async function settleAmount(staff: Record<string, string>, order: any, amount: number, key: string) {
  return app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staff, headers: { "idempotency-key": key }, payload: { expectedVersion: order.version, allocationMode: "AMOUNT", amount, payments: [{ method: "CASH", amount }] } });
}

describe("inventory costing and settlement integration", () => {
  it("initializes a new stock item after other items are tracked while preventing a tracked item from being reopened", async () => {
    const manager = await session(UserRole.MANAGER, "opening-per-item.manager");
    const first = await stockFixture(manager, "Existing opening beans", "100", 1000);
    const second = await stockFixture(manager, "Later opening beans", "200", 2000);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: first } })).quantityOnHand.toString()).toBe("100");
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: second } })).quantityOnHand.toString()).toBe("200");
    const reset = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "OPENING", lines: [{ stockItemId: first, observedQuantity: "0", observedValueAmount: 0 }] } });
    expect(reset.statusCode, reset.body).toBe(409);
    expect(reset.json().error.code).toBe("INVALID_STATE");
    const zero = await stockFixture(manager, "Empty opening beans", "0", 0);
    expect(await app.prisma.inventoryMovement.count({ where: { stockItemId: zero, kind: "OPENING_COUNT" } })).toBe(0);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: zero } })).trackingStartedAt).not.toBeNull();
    const resetZero = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "OPENING", lines: [{ stockItemId: zero, observedQuantity: "10", observedValueAmount: 100 }] } });
    expect(resetZero.statusCode, resetZero.body).toBe(409);
  });
  it("rejects receipt value overflow and rolls back earlier lines in the same receipt", async () => {
    const manager = await session(UserRole.MANAGER, "inventory-overflow.manager");
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
    const manager = await session(UserRole.MANAGER, "inventory-errors.manager");
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
    const manager = await session(UserRole.MANAGER, "inventory-flow.manager");
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
    expect(consumption.theoreticalCogsAmount).toBe(16_000);
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
    const manager = await session(UserRole.MANAGER, "inventory-count.manager");
    const staff = await session(UserRole.STAFF, "inventory-count.staff");
    const product = await productFixture("Counted Mocha");
    const stockItemId = await stockFixture(manager, "Counted Beans", "100", 10_000);
    await recipeFixture(manager, product.id, stockItemId);
    const order = await orderFixture(staff, product.id, 2, "inventory-count-order-create-01");
    const settled = await settleAmount(staff, order, 2_000, "inventory-count-settlement-01");
    expect(settled.statusCode, settled.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findUniqueOrThrow({ where: { orderId_paymentSettlementId: { orderId: order.id, paymentSettlementId: settled.json().data.settlements[0].id } } });

    const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", lines: [{ stockItemId, observedQuantity: "20", observedValueAmount: 2_000 }] } });
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
    const manager = await session(UserRole.MANAGER, "inventory-reversal.manager");
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
    const manager = await session(UserRole.MANAGER, "inventory-preview.manager");
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

  it("reports full-payment revenue and theoretical costs by Tehran date to Managers only", async () => {
    const manager = await session(UserRole.MANAGER, "gross-profit.manager");
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
      inventoryConsumption: { amount: 8_000, isEstimate: true, varianceAmount: null, missingValuationCount: 1 },
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
    const manager = await session(UserRole.MANAGER, "gross-profit-discount.manager");
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
      { productId: catalogDiscountProduct.id, productName: catalogDiscountProduct.name, netSalesAmount: 81_000, theoreticalCogsAmount: 8_000, knownCogsAmount: 8_000, grossProfitAmount: 73_000, grossMarginPercent: "90.12", completeOrderItemCount: 1, incompleteOrderItemCount: 0 },
      { productId: itemDiscountProduct.id, productName: itemDiscountProduct.name, netSalesAmount: 81_000, theoreticalCogsAmount: 8_000, knownCogsAmount: 8_000, grossProfitAmount: 73_000, grossMarginPercent: "90.12", completeOrderItemCount: 1, incompleteOrderItemCount: 0 },
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
    const manager = await session(UserRole.MANAGER, "inventory-multi-shortage.manager");
    const staff = await session(UserRole.STAFF, "inventory-multi-shortage.staff");
    const product = await productFixture("Multi-ingredient shortage drink");
    const beans = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Multi-shortage beans", category: "Ingredients", baseUnit: "GRAM", conversions: [] } });
    const milk = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Multi-shortage milk", category: "Ingredients", baseUnit: "GRAM", conversions: [] } });
    expect(beans.statusCode, beans.body).toBe(201);
    expect(milk.statusCode, milk.body).toBe(201);
    const beansId = beans.json().data.id as string;
    const milkId = milk.json().data.id as string;
    const opening = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "OPENING", lines: [
      { stockItemId: beansId, observedQuantity: "100", observedValueAmount: 10_000 },
      { stockItemId: milkId, observedQuantity: "40", observedValueAmount: 8_000 },
    ] } });
    expect(opening.statusCode, opening.body).toBe(201);
    const openingPost = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${opening.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "inventory-multi-shortage-opening-01" }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [] } });
    expect(openingPost.statusCode, openingPost.body).toBe(200);
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

  it("returns posted purchase stock with carrying value, idempotent replay, and an over-return guard", async () => {
    const manager = await session(UserRole.MANAGER, "inventory-return.manager");
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
    const manager = await session(UserRole.MANAGER, "gross-profit-weighted-margin.manager");
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
    const manager = await session(UserRole.MANAGER, "gross-profit-incomplete.manager");
    const staff = await session(UserRole.STAFF, "gross-profit-incomplete.staff");
    const product = await productFixture("Unvalued ingredient product");
    const stock = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Unvalued recipe ingredient", category: "Ingredients", baseUnit: "GRAM", conversions: [] } });
    expect(stock.statusCode, stock.body).toBe(201);
    await recipeFixture(manager, product.id, stock.json().data.id as string, "20");
    const order = await orderFixture(staff, product.id, 1, "gross-profit-incomplete-order-create-01");
    const settlement = await settleAmount(staff, order, 1_000, "gross-profit-incomplete-settlement-01");
    expect(settlement.statusCode, settlement.body).toBe(201);

    const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const report = await app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${reportDate}&toDate=${reportDate}`, cookies: manager });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().data).toMatchObject({
      totals: { netSalesAmount: 1_000, theoreticalCogsAmount: null, knownCogsAmount: 0, grossProfitAmount: null, grossMarginPercent: null },
      costCoverage: { completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
      pendingConsumptionCount: 1,
      inventoryConsumption: { varianceAmount: null, missingValuationCount: 1 },
    });
    expect(report.json().data.products).toMatchObject([{ productId: product.id, knownCogsAmount: 0, theoreticalCogsAmount: null, grossProfitAmount: null, grossMarginPercent: null, incompleteOrderItemCount: 1 }]);
  });

  it("uses exact fractional moving averages and rounds only posted Toman values half up", async () => {
    const manager = await session(UserRole.MANAGER, "fractional-valuation.manager");
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
      costs.push(consumption.theoreticalCogsAmount!);
    }

    expect(costs).toEqual([3, 4, 3]);
    const balance = await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId } });
    expect(balance.quantityOnHand.toString()).toBe("0");
    expect(balance.carryingValueAmount).toBe(0);
    const movements = await app.prisma.inventoryMovement.findMany({ where: { stockItemId, kind: "ORDER_CONSUMPTION" }, orderBy: { occurredAt: "asc" } });
    expect(movements.reduce((sum, movement) => sum + Math.abs(movement.valueDeltaAmount), 0)).toBe(10);
  });

  it("rejects ineligible count reconciliation and records explicit physical adjustments", async () => {
    const manager = await session(UserRole.MANAGER, "count-eligibility.manager");
    const staff = await session(UserRole.STAFF, "count-eligibility.staff");
    const product = await productFixture("Count eligibility product");
    const stockIds: string[] = [];
    for (const [name, value] of [["Count eligibility beans", 10_000], ["Count eligibility milk", 20_000]] as const) {
      const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name, category: "Ingredients", baseUnit: "GRAM", conversions: [] } });
      expect(created.statusCode, created.body).toBe(201);
      stockIds.push(created.json().data.id as string);
    }
    const [beansId, milkId] = stockIds as [string, string];
    const opening = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "OPENING", lines: [{ stockItemId: beansId, observedQuantity: "100", observedValueAmount: 10_000 }, { stockItemId: milkId, observedQuantity: "100", observedValueAmount: 20_000 }] } });
    const openingPost = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${opening.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "count-eligibility-opening-01" }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [] } });
    expect(openingPost.statusCode, openingPost.body).toBe(200);
    await recipeFixture(manager, product.id, beansId, "180");
    const recipe = await app.prisma.recipe.findFirstOrThrow({ where: { name: `Recipe ${product.id}` } });
    await app.prisma.recipeComponent.create({ data: { recipeId: recipe.id, componentKey: "milk", label: "Milk", sourceKind: "STOCK_ITEM", stockItemId: milkId, quantity: "20", displayOrder: 1 } });
    const order = await orderFixture(staff, product.id, 1, "count-eligibility-order-01");
    const settlement = await settleAmount(staff, order, order.totalAmount, "count-eligibility-settlement-01");
    expect(settlement.statusCode, settlement.body).toBe(201);
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });

    const incompleteCount = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", lines: [{ stockItemId: beansId, observedQuantity: "15", observedValueAmount: 1_500 }] } });
    const rejected = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${incompleteCount.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "count-eligibility-reject-01" }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [consumption.id] } });
    expect(rejected.statusCode).toBe(422);
    expect((await app.prisma.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: beansId } })).quantityOnHand.toString()).toBe("100");
    expect((await app.prisma.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } })).status).toBe("PENDING");

    const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", lines: [{ stockItemId: beansId, observedQuantity: "15", observedValueAmount: 1_500 }, { stockItemId: milkId, observedQuantity: "70", observedValueAmount: 14_000 }] } });
    const posted = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${count.json().data.id}/post`, cookies: manager, headers: { "idempotency-key": "count-eligibility-post-01" }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [consumption.id] } });
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().data.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ stockItemId: beansId, expectedQuantity: "100", differenceQuantity: "-85", expectedValueAmount: 10_000, differenceValueAmount: -8_500 }),
      expect.objectContaining({ stockItemId: milkId, expectedQuantity: "100", differenceQuantity: "-30", expectedValueAmount: 20_000, differenceValueAmount: -6_000 }),
    ]));
    expect(await app.prisma.inventoryMovement.count({ where: { kind: "PHYSICAL_COUNT_ADJUSTMENT", inventoryCountLine: { countId: count.json().data.id } } })).toBe(2);
  });

  it("restores reconciled stock on settlement correction exactly once and keeps tender-only corrections inventory-neutral", async () => {
    const manager = await session(UserRole.MANAGER, "reconciled-correction.manager");
    const staff = await session(UserRole.STAFF, "reconciled-correction.staff");
    const product = await productFixture("Reconciled correction product");
    const stockItemId = await stockFixture(manager, "Reconciled correction stock", "100", 10_000);
    await recipeFixture(manager, product.id, stockItemId, "180");
    const order = await orderFixture(staff, product.id, 1, "reconciled-correction-order-01");
    const settlement = await settleAmount(staff, order, order.totalAmount, "reconciled-correction-settlement-01");
    const settlementId = settlement.json().data.settlements[0].id as string;
    const consumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: order.id } });

    const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", lines: [{ stockItemId, observedQuantity: "20", observedValueAmount: 2_000 }] } });
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

  it("keeps sales with missing product costing configuration visibly incomplete", async () => {
    const manager = await session(UserRole.MANAGER, "missing-config.manager");
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
      costCoverage: { completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
      pendingConsumptionCount: 1,
    });
  });

  it("enforces Manager-only inventory operations and stable management/history boundaries", async () => {
    const manager = await session(UserRole.MANAGER, "inventory-management.manager");
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

  it("validates inventory response DTOs and keeps every protected read Manager-only", async () => {
    const manager = await session(UserRole.MANAGER, "inventory-dto.manager");
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
    const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "PHYSICAL", lines: [{ stockItemId: itemId, observedQuantity: "5", observedValueAmount: 1_000 }] } });
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
    const manager = await session(UserRole.MANAGER, "inventory-p2.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: manager, payload: { name: "Editable stock", category: "Ingredients", baseUnit: "GRAM", conversions: [{ label: "kg", baseQuantityPerPack: "1000", isActive: true }] } });
    expect(created.statusCode, created.body).toBe(201);
    const stockItemId = created.json().data.id as string;
    const duplicateConversion = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/stock-items/${stockItemId}`, cookies: manager, payload: { expectedVersion: 1, conversions: [{ label: "kg", baseQuantityPerPack: "1000", isActive: true }, { label: "KG", baseQuantityPerPack: "1000", isActive: true }] } });
    expect(duplicateConversion.statusCode).toBe(422);

    const updated = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/stock-items/${stockItemId}`, cookies: manager, payload: { expectedVersion: 1, name: "Renamed stock" } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().data).toMatchObject({ name: "Renamed stock", version: 2, balance: { quantityOnHand: null, carryingValueAmount: null } });
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

    const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: manager, payload: { kind: "OPENING", lines: [{ stockItemId, observedQuantity: "10", observedValueAmount: 1_000 }] } });
    const editCount = await app.inject({ method: "PATCH", url: `/api/v1/admin/inventory/counts/${count.json().data.id}`, cookies: manager, payload: { expectedVersion: 1, lines: [{ stockItemId, observedQuantity: "10.5", observedValueAmount: 1_050 }] } });
    expect(editCount.statusCode, editCount.body).toBe(200);
    expect(editCount.json().data.lines).toMatchObject([{ observedQuantity: "10.5", observedValueAmount: 1_050 }]);
    const malformedQuery = await app.inject({ method: "GET", url: "/api/v1/admin/inventory/movements?limit=0", cookies: manager });
    expect(malformedQuery.statusCode).toBe(400);
  });
});
