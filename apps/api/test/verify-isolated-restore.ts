import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "../generated/prisma/client.js";
import { Client } from "pg";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(apiRoot, "../..");
dotenv.config({ path: join(apiRoot, ".env.test") });

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) {
  throw new Error("Restore rehearsal requires matching DATABASE_URL and TEST_DATABASE_URL values.");
}
const target = new URL(databaseUrl);
if (target.hostname !== "127.0.0.1" || target.port !== "5433" || target.pathname !== "/cafe_management_test") {
  throw new Error("Restore rehearsal is restricted to cafe_management_test on 127.0.0.1:5433.");
}

const pgArgs = ["--host", target.hostname, "--port", target.port, "--username", decodeURIComponent(target.username), "--no-password"];
const pgEnv = { ...process.env, PGPASSWORD: decodeURIComponent(target.password) };
const archiveDirectory = await mkdtemp(join(tmpdir(), "cafe-test-restore-"));
const archiveFile = join(archiveDirectory, "cafe_management_test.dump");

function run(command: string, args: string[], cwd = apiRoot, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

async function seedProductionLikeFixture(): Promise<{ orderId: string; settlementId: string; userId: string }> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const user = await prisma.user.create({
      data: { username: "restore-gate-manager", passwordHash: "restore-drill-placeholder", role: UserRole.MANAGER },
    });
    const category = await prisma.category.create({ data: { name: "Restore drill", displayOrder: 999 } });
    const product = await prisma.product.create({
      data: { categoryId: category.id, name: "Restore drill coffee", priceAmount: 125_000, preparationDeadlineMinutes: 5, displayOrder: 1 },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: "RESTORE-DRILL-20261007",
        dailyOrderNumber: 999,
        createdById: user.id,
        channel: "TAKEAWAY",
        state: "CLOSED",
        paymentStatus: "PAID",
        subtotalAmount: 125_000,
        totalAmount: 125_000,
        paidAmount: 125_000,
        balanceAmount: 0,
        items: {
          create: [{
            productId: product.id,
            productNameSnapshot: product.name,
            basePriceSnapshot: product.priceAmount,
            pricingModeSnapshot: "FIXED",
            quantity: 1,
            lineTotalAmount: product.priceAmount,
            displayOrder: 1,
          }],
        },
      },
      include: { items: true },
    });
    const orderItem = order.items[0];
    if (!orderItem) throw new Error("Restore fixture order item was not created.");
    const settlement = await prisma.paymentSettlement.create({
      data: {
        orderId: order.id,
        recordedById: user.id,
        idempotencyKey: "restore-drill-settlement-1",
        totalAmount: order.totalAmount,
        allocations: { create: [{ orderItemId: orderItem.id, quantity: 1, amount: order.totalAmount }] },
        payments: { create: [{ method: "CARD_TERMINAL", amount: order.totalAmount }] },
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        requestId: "restore-drill-request-1",
        operation: "RECORD_SETTLEMENT",
        entityType: "PAYMENT_SETTLEMENT",
        entityId: settlement.id,
        afterSnapshot: { orderId: order.id, totalAmount: order.totalAmount, paymentStatus: "PAID" },
      },
    });
    return { orderId: order.id, settlementId: settlement.id, userId: user.id };
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyRestoredFixture(expected: { orderId: string; settlementId: string; userId: string }): Promise<number> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT
         (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations,
         (SELECT count(*)::int FROM "cafe_tables" WHERE "isActive" = true) AS active_tables,
         (SELECT count(*)::int FROM "orders" WHERE id = $1 AND state = 'CLOSED' AND "paymentStatus" = 'PAID') AS paid_orders,
         (SELECT count(*)::int FROM "payment_settlements" WHERE id = $2 AND "totalAmount" = 125000) AS settlements,
         (SELECT count(*)::int FROM "payments" p JOIN "payment_settlements" s ON s.id = p."settlementId" WHERE s.id = $2 AND p.method = 'CARD_TERMINAL' AND p.amount = 125000) AS tenders,
         (SELECT count(*)::int FROM "audit_logs" WHERE "entityId" = $2 AND operation = 'RECORD_SETTLEMENT') AS audit_entries,
         (SELECT count(*)::int FROM "users" WHERE id = $3) AS users`,
      [expected.orderId, expected.settlementId, expected.userId],
    );
    const row = result.rows[0];
    if (row.active_tables !== 15 || row.paid_orders !== 1 || row.settlements !== 1 || row.tenders !== 1 || row.audit_entries !== 1 || row.users !== 1) {
      throw new Error(`Restored production-like fixture counts did not match: ${JSON.stringify(row)}`);
    }
    return row.migrations;
  } finally {
    await client.end();
  }
}

let restored = false;
try {
  run("pnpm", ["--filter", "@cafe/api", "test:db:reset"], workspaceRoot, {
    ...process.env,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
  });
  const fixture = await seedProductionLikeFixture();
  run("pg_dump", [...pgArgs, "--format=custom", "--no-owner", "--no-acl", "--file", archiveFile, "cafe_management_test"], apiRoot, pgEnv);
  const archiveListing = run("pg_restore", [...pgArgs, "--list", archiveFile], apiRoot, pgEnv);
  if (!archiveListing.includes("TABLE DATA public orders") || !archiveListing.includes("TABLE DATA public payments")) {
    throw new Error("The custom-format backup is missing order or payment data.");
  }

  run("pnpm", ["--filter", "@cafe/api", "test:db:reset"], workspaceRoot, {
    ...process.env,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
  });
  run("pg_restore", [...pgArgs, "--clean", "--if-exists", "--no-owner", "--no-acl", "--exit-on-error", "--dbname", "cafe_management_test", archiveFile], apiRoot, pgEnv);
  const migrationOutput = run(process.execPath, ["../../node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.config.ts"], apiRoot, {
    ...process.env,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    PGPASSWORD: decodeURIComponent(target.password),
  });
  if (!migrationOutput.includes("No pending migrations to apply")) {
    throw new Error("Prisma migrate deploy did not confirm that the restored schema is current.");
  }
  const migrationCount = await verifyRestoredFixture(fixture);
  if (migrationCount !== 30) throw new Error(`Expected 30 applied migrations after restore, found ${migrationCount}.`);
  restored = true;
  console.info("Isolated restore rehearsal passed: custom backup validated, test database restored, 30 migrations current, and paid order/tender/audit fixture preserved.");
} finally {
  if (!restored) {
    run("pnpm", ["--filter", "@cafe/api", "test:db:reset"], workspaceRoot, {
      ...process.env,
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
    });
  }
  await rm(archiveDirectory, { recursive: true, force: true });
}
