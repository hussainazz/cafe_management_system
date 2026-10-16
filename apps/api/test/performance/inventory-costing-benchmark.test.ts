import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const [{ buildApp }, { hashPassword }, { UserRole }] = await Promise.all([
  import("../../src/app.js"),
  import("../../src/auth/password.js"),
  import("../../generated/prisma/client.js"),
]);

const app = buildApp();
beforeEach(async () => { await app.prisma.cafeSettings.create({ data: { inventoryActivatedAt: new Date("2020-01-01T00:00:00.000Z") } }); });
const password = "InventoryBenchmarkPassword2026";
const sampleCount = 8;

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function cookies(response: { cookies: Array<{ name: string; value: string }> }) {
  return Object.fromEntries(response.cookies.map(({ name, value }) => [name, value]));
}

async function measure(name: string, prepare: () => Promise<() => Promise<{ statusCode: number }>>) {
  const warmup = await prepare();
  const warmupResponse = await warmup();
  if (warmupResponse.statusCode < 200 || warmupResponse.statusCode >= 300) throw new Error(`${name} warmup returned ${warmupResponse.statusCode}`);

  const durations: number[] = [];
  for (let index = 0; index < sampleCount; index++) {
    const request = await prepare();
    const start = performance.now();
    const response = await request();
    durations.push(performance.now() - start);
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`${name} sample ${index + 1} returned ${response.statusCode}`);
  }

  return {
    name,
    samples: durations.length,
    p50Ms: Number(percentile(durations, 50).toFixed(2)),
    p95Ms: Number(percentile(durations, 95).toFixed(2)),
    minMs: Number(Math.min(...durations).toFixed(2)),
    maxMs: Number(Math.max(...durations).toFixed(2)),
  };
}

describe("Inventory response-time measurement", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl || databaseUrl !== testDatabaseUrl) throw new Error("Benchmark requires matching DATABASE_URL and TEST_DATABASE_URL.");
    const parsed = new URL(databaseUrl);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "5433" || parsed.pathname !== "/cafe_management_test") {
      throw new Error("Benchmark is restricted to 127.0.0.1:5433/cafe_management_test.");
    }
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it("measures purchase posting, pending-order retry, count posting, and bounded profit reports", async () => {
    const passwordHash = await hashPassword(password);
    const staff = await app.prisma.user.create({ data: { username: "inventory-benchmark-staff", passwordHash, role: UserRole.STAFF } });
    await app.prisma.user.create({ data: { username: "inventory-benchmark-manager", passwordHash, role: UserRole.MANAGER } });
    const login = async (username: string) => app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
    const staffCookies = cookies(await login("inventory-benchmark-staff"));
    const managerCookies = cookies(await login("inventory-benchmark-manager"));

    const category = await app.prisma.category.create({ data: { name: "Inventory benchmark", displayOrder: 1 } });
    const product = await app.prisma.product.create({ data: { categoryId: category.id, name: "Inventory benchmark drink", priceAmount: 10_000, preparationDeadlineMinutes: 5, displayOrder: 1 } });
    const stockItem = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/stock-items", cookies: managerCookies, payload: { name: "Inventory benchmark grams", category: "Benchmark", baseUnit: "GRAM", openingQuantity: "0", openingValueAmount: 0, conversions: [] } });
    if (stockItem.statusCode !== 201) throw new Error(`Stock fixture returned ${stockItem.statusCode}: ${stockItem.body}`);
    const stockItemId = stockItem.json().data.id as string;
    const recipe = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/recipes", cookies: managerCookies, payload: { name: "Inventory benchmark recipe", outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "base",  sourceKind: "STOCK_ITEM", stockItemId, quantity: "1", displayOrder: 0 }] } });
    if (recipe.statusCode !== 201) throw new Error(`Recipe fixture returned ${recipe.statusCode}: ${recipe.body}`);
    const costing = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/costing`, cookies: managerCookies, payload: { expectedVersion: 1, mode: "RECIPE", recipeId: recipe.json().data.id, recipeQuantity: "1", optionRules: [], combinations: [] } });
    if (costing.statusCode !== 200) throw new Error(`Costing fixture returned ${costing.statusCode}: ${costing.body}`);

    const createPurchase = async () => {
      const purchase = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/purchases", cookies: managerCookies, payload: { receivedAt: new Date().toISOString(), supplier: "Benchmark", lines: [{ stockItemId, conversionId: null, purchaseUnitLabel: "GRAM", purchaseQuantity: "1", directCostAmount: 10 }] } });
      if (purchase.statusCode !== 201) throw new Error(`Purchase fixture returned ${purchase.statusCode}: ${purchase.body}`);
      return purchase.json().data.id as string;
    };
    const createPostedZeroCount = async () => {
      const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: managerCookies, payload: { kind: "PHYSICAL", reason: "Benchmark reset", lines: [{ stockItemId, observedQuantity: "0", observedValueAmount: 0 }] } });
      if (count.statusCode !== 201) throw new Error(`Physical count fixture returned ${count.statusCode}: ${count.body}`);
      const result = await app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${count.json().data.id}/post`, cookies: managerCookies, headers: { "idempotency-key": `inventory-benchmark-count-reset-${randomUUID()}` }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [] } });
      if (result.statusCode !== 200) throw new Error(`Physical count reset returned ${result.statusCode}: ${result.body}`);
    };
    const createPendingPurchase = async () => {
      await createPostedZeroCount();
      const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: staffCookies, headers: { "idempotency-key": `inventory-benchmark-order-${randomUUID()}` }, payload: { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] } });
      if (created.statusCode !== 201) throw new Error(`Order fixture returned ${created.statusCode}: ${created.body}`);
      const order = created.json().data;
      const settled = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staffCookies, headers: { "idempotency-key": `inventory-benchmark-settlement-${randomUUID()}` }, payload: { expectedVersion: order.version, allocationMode: "AMOUNT", amount: 10_000, payments: [{ method: "CASH", amount: 10_000 }] } });
      if (settled.statusCode !== 201) throw new Error(`Settlement fixture returned ${settled.statusCode}: ${settled.body}`);
      return createPurchase();
    };

    const results = [];
    results.push(await measure("purchase posting", async () => {
      const purchaseId = await createPurchase();
      return () => app.inject({ method: "POST", url: `/api/v1/admin/inventory/purchases/${purchaseId}/post`, cookies: managerCookies, headers: { "idempotency-key": `inventory-benchmark-post-${randomUUID()}` }, payload: { expectedVersion: 1 } });
    }));
    results.push(await measure("receipt posting with one pending-order retry", async () => {
      const purchaseId = await createPendingPurchase();
      return () => app.inject({ method: "POST", url: `/api/v1/admin/inventory/purchases/${purchaseId}/post`, cookies: managerCookies, headers: { "idempotency-key": `inventory-benchmark-retry-${randomUUID()}` }, payload: { expectedVersion: 1 } });
    }));
    results.push(await measure("physical-count posting (one stock item)", async () => {
      const count = await app.inject({ method: "POST", url: "/api/v1/admin/inventory/counts", cookies: managerCookies, payload: { kind: "PHYSICAL", reason: "Benchmark physical count", lines: [{ stockItemId, observedQuantity: "0", observedValueAmount: 0 }] } });
      if (count.statusCode !== 201) throw new Error(`Physical count fixture returned ${count.statusCode}: ${count.body}`);
      return () => app.inject({ method: "POST", url: `/api/v1/admin/inventory/counts/${count.json().data.id}/post`, cookies: managerCookies, headers: { "idempotency-key": `inventory-benchmark-count-${randomUUID()}` }, payload: { expectedVersion: 1, absorbedOrderConsumptionIds: [] } });
    }));
    const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    results.push(await measure("bounded gross-profit report (one day)", async () => () => app.inject({ method: "GET", url: `/api/v1/admin/reports/gross-profit?fromDate=${reportDate}&toDate=${reportDate}`, cookies: managerCookies })));

    process.stdout.write("INVENTORY_BENCHMARK_RESULTS=" + JSON.stringify({
      method: `Fastify inject; one warmup then ${sampleCount} timed successful requests per operation; includes route handling, serialization, and local test PostgreSQL work; excludes TCP/TLS/browser/network time.`,
      fixture: { stockItems: 1, recipeComponents: 1, product: 1, paidOrdersForRetry: 1, linesPerCount: 1 },
      results,
    }) + "\n");
  }, 120_000);
});
