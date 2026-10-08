import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";

const imageDirectory = join(tmpdir(), "run-cafe-stage10-benchmark-images");
process.env.PRODUCT_IMAGE_STORAGE_DIR = imageDirectory;

const [{ buildApp }, { hashPassword }, { UserRole }] = await Promise.all([
  import("../../src/app.js"),
  import("../../src/auth/password.js"),
  import("../../generated/prisma/client.js"),
]);

const app = buildApp();
const password = "Stage10BenchmarkPassword2026";
const sampleCount = 20;

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function measure(name: string, prepare: () => Promise<() => Promise<{ statusCode: number }>>) {
  for (let i = 0; i < 3; i++) {
    const request = await prepare();
    const warmup = await request();
    if (warmup.statusCode < 200 || warmup.statusCode >= 300) throw new Error(`${name} warmup returned ${warmup.statusCode}`);
  }

  const durations: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const request = await prepare();
    const start = performance.now();
    const response = await request();
    durations.push(performance.now() - start);
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`${name} sample ${i + 1} returned ${response.statusCode}`);
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

function cookies(response: { cookies: Array<{ name: string; value: string }> }) {
  return Object.fromEntries(response.cookies.map(({ name, value }) => [name, value]));
}

describe("Stage 10 response-time measurement", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl || databaseUrl !== testDatabaseUrl) throw new Error("Benchmark requires matching DATABASE_URL and TEST_DATABASE_URL.");
    const parsed = new URL(databaseUrl);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "5433" || parsed.pathname !== "/cafe_management_test") {
      throw new Error("Benchmark is restricted to 127.0.0.1:5433/cafe_management_test.");
    }
    await mkdir(imageDirectory, { recursive: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(imageDirectory, { recursive: true, force: true });
  });

  it("records route timings against a fixed isolated fixture", async () => {
    const staffName = "stage10-benchmark-staff";
    const managerName = "stage10-benchmark-manager";
    const passwordHash = await hashPassword(password);
    const staff = await app.prisma.user.create({ data: { username: staffName, passwordHash, role: UserRole.STAFF } });
    await app.prisma.user.create({ data: { username: managerName, passwordHash, role: UserRole.MANAGER } });

    const login = async (username: string) => app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username, password },
    });
    const staffLogin = await login(staffName);
    const staffCookies = cookies(staffLogin);
    const managerCookies = cookies(await login(managerName));

    let sequence = 0;
    const category = await app.prisma.category.create({ data: { name: "Stage 10 benchmark", displayOrder: 1 } });
    const product = await app.prisma.product.create({ data: {
      categoryId: category.id,
      name: "Benchmark item",
      priceAmount: 50_000,
      preparationDeadlineMinutes: 5,
      displayOrder: 1,
    } });

    const createOrder = async (key: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/orders",
        cookies: staffCookies,
        headers: { "idempotency-key": key },
        payload: { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] },
      });
      if (response.statusCode !== 201) throw new Error(`Order setup returned ${response.statusCode}: ${response.body}`);
      return response.json().data as { id: string; version: number; items: Array<{ id: string }> };
    };

    const results = [];
    results.push(await measure("login", async () => () => login(staffName)));
    results.push(await measure("order create", async () => async () => {
      const key = `stage10-bench-create-${++sequence}`;
      return app.inject({
        method: "POST", url: "/api/v1/orders", cookies: staffCookies,
        headers: { "idempotency-key": key },
        payload: { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] },
      });
    }));
    results.push(await measure("order edit", async () => {
      const order = await createOrder(`stage10-bench-edit-setup-${++sequence}`);
      return () => app.inject({
        method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: staffCookies,
        payload: { expectedVersion: order.version, itemUpdates: [{ orderItemId: order.items[0]!.id, note: "benchmark edit" }] },
      });
    }));
    results.push(await measure("order delete", async () => {
      const order = await createOrder(`stage10-bench-delete-setup-${++sequence}`);
      return () => app.inject({
        method: "POST", url: `/api/v1/orders/${order.id}/delete`, cookies: staffCookies,
        payload: { expectedVersion: order.version },
      });
    }));
    results.push(await measure("payment settlement", async () => {
      const order = await createOrder(`stage10-bench-payment-setup-${++sequence}`);
      return () => app.inject({
        method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staffCookies,
        headers: { "idempotency-key": `stage10-bench-payment-${sequence}` },
        payload: {
          expectedVersion: order.version,
          allocations: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
          payments: [{ method: "CARD_TERMINAL", amount: 50_000 }],
        },
      });
    }));

    const menuCategories = await Promise.all(Array.from({ length: 8 }, (_, index) => app.prisma.category.create({
      data: { name: `Stage 10 menu category ${index + 1}`, displayOrder: index + 1 },
    })));
    await app.prisma.product.createMany({
      data: Array.from({ length: 200 }, (_, index) => ({
        categoryId: menuCategories[index % menuCategories.length]!.id,
        name: `Stage 10 menu item ${index + 1}`,
        priceAmount: 30_000 + index * 100,
        preparationDeadlineMinutes: 5,
        displayOrder: Math.floor(index / menuCategories.length) + 1,
      })),
    });
    results.push(await measure("public menu API (8 categories / 200 products)", async () => () => app.inject({ method: "GET", url: "/api/v1/public/menu" })));

    const imageKey = `${randomUUID()}.png`;
    await writeFile(join(imageDirectory, imageKey), Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(256 * 1024 - 8, 0x61),
    ]));
    await app.prisma.productImage.create({ data: { productId: product.id, storageKey: imageKey, altText: product.name } });
    results.push(await measure("product image API (256 KiB synthetic PNG payload)", async () => () => app.inject({ method: "GET", url: `/api/v1/product-images/${imageKey}` })));

    const now = new Date();
    const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const reportPrefix = "stage10-report-benchmark-";
    await app.prisma.order.createMany({ data: Array.from({ length: 500 }, (_, index) => ({
      orderNumber: `${reportPrefix}${index + 1}`,
      dailyOrderNumber: index + 1,
      createdById: staff.id,
      channel: "TAKEAWAY" as const,
      state: index < 250 ? "CLOSED" as const : "OPEN" as const,
      paymentStatus: index < 250 ? "PAID" as const : "UNPAID" as const,
      subtotalAmount: 50_000,
      totalAmount: 50_000,
      paidAmount: index < 250 ? 50_000 : 0,
      balanceAmount: index < 250 ? 0 : 50_000,
      createdAt: now,
    })) });
    const reportOrders = await app.prisma.order.findMany({
      where: { orderNumber: { startsWith: reportPrefix } },
      select: { id: true, orderNumber: true },
      orderBy: { orderNumber: "asc" },
    });
    await app.prisma.orderItem.createMany({ data: reportOrders.map((order, index) => ({
      orderId: order.id,
      productId: product.id,
      productNameSnapshot: product.name,
      basePriceSnapshot: 50_000,
      quantity: 1,
      lineTotalAmount: 50_000,
      displayOrder: 0,
      note: String(index),
    })) });
    const reportItems = await app.prisma.orderItem.findMany({ where: { orderId: { in: reportOrders.map(({ id }) => id) } }, select: { id: true, orderId: true } });
    const itemByOrder = new Map(reportItems.map(({ id, orderId }) => [orderId, id]));
    const paidOrders = reportOrders.slice(0, 250);
    for (let offset = 0; offset < paidOrders.length; offset += 25) {
      await Promise.all(paidOrders.slice(offset, offset + 25).map((order) => app.prisma.paymentSettlement.create({
        data: {
          orderId: order.id,
          recordedById: staff.id,
          idempotencyKey: `bench-${order.orderNumber}`,
          totalAmount: 50_000,
          recordedAt: now,
          allocations: { create: { orderItemId: itemByOrder.get(order.id)!, quantity: 1, amount: 50_000 } },
          payments: { create: { method: "CARD_TERMINAL", amount: 50_000, recordedAt: now } },
        },
      })));
    }
    const reportUrl = `/api/v1/admin/reports/daily?fromDate=${businessDate}&toDate=${businessDate}`;
    results.push(await measure("daily report API (500 orders / 500 items / 250 settlements)", async () => () => app.inject({ method: "GET", url: reportUrl, cookies: managerCookies })));

    process.stdout.write("STAGE10_BENCHMARK_RESULTS=" + JSON.stringify({
      method: "Fastify inject; sequential warmup 3 then 20 timed successful requests per operation; milliseconds include route handling, serialization, and local test PostgreSQL work, but exclude TCP/TLS/browser/network time.",
      reportFixture: { orders: 500, orderItems: 500, settlements: 250, payments: 250 },
      menuFixture: { categories: 8, products: 200 },
      results,
    }) + "\n");
  }, 120_000);
});
