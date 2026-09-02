import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";
import { spawnSync } from "node:child_process";

dotenv.config({ path: new URL("../.env.test", import.meta.url) });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const parsedUrl = new URL(testDatabaseUrl);
const sourceDatabaseName = parsedUrl.pathname.slice(1);
if (!/^[a-z][a-z0-9_]{0,62}_test$/.test(sourceDatabaseName)) {
  throw new Error("TEST_DATABASE_URL must name a PostgreSQL database ending in _test");
}

const stem = sourceDatabaseName.slice(0, -5).slice(0, 36);
const databaseNames = {
  fresh: `${stem}_migration_fresh_test`,
  upgrade: `${stem}_migration_upgrade_test`,
  failure: `${stem}_migration_failure_test`,
  restore: `${stem}_migration_restore_test`,
};
const adminUrl = new URL(parsedUrl);
adminUrl.pathname = "/postgres";
adminUrl.search = "";
const migrationsDirectory = new URL("./migrations/", import.meta.url);
const prismaCliPath = fileURLToPath(
  new URL("../../../node_modules/prisma/build/index.js", import.meta.url),
);

function databaseUrl(name) {
  const url = new URL(parsedUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function adminQuery(sql, values = []) {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    return await client.query(sql, values);
  } finally {
    await client.end();
  }
}

async function recreateDatabase(name) {
  await adminQuery("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [
    name,
  ]);
  await adminQuery(`DROP DATABASE IF EXISTS "${name}"`);
  await adminQuery(`CREATE DATABASE "${name}"`);
}

async function dropDatabase(name) {
  await adminQuery("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [
    name,
  ]);
  await adminQuery(`DROP DATABASE IF EXISTS "${name}"`);
}

function prismaDeploy(url) {
  const result = spawnSync(
    process.execPath,
    [prismaCliPath, "migrate", "deploy", "--config", "prisma.config.ts"],
    {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`Prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

function postgresCommand(command, arguments_, databaseName) {
  const result = spawnSync(command, arguments_, {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(parsedUrl.password) },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed for ${databaseName}:\n${result.stdout}\n${result.stderr}`);
  }
}

async function migrationFiles() {
  const entries = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    entries.map(async (name) => ({
      name,
      sql: await readFile(new URL(`${name}/migration.sql`, migrationsDirectory), "utf8"),
    })),
  );
}

async function withClient(url, action) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

async function verifyFreshDeploy(files) {
  const name = databaseNames.fresh;
  const url = databaseUrl(name);
  await recreateDatabase(name);
  prismaDeploy(url);

  await withClient(url, async (client) => {
    const applied = await client.query(
      `SELECT migration_name FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    );
    if (
      applied.rows.map((row) => row.migration_name).join("\n") !==
      files.map((file) => file.name).join("\n")
    ) {
      throw new Error("Fresh deploy did not apply exactly the checked-in migration set");
    }

    const tables = await client.query(
      `SELECT "name", "displayOrder", "waiterCallEnabled"
       FROM "cafe_tables" ORDER BY "displayOrder"`,
    );
    const expectedNames = [
      "1",
      "2",
      "3",
      "4",
      "کانتر وسط",
      "5",
      "6",
      "جگوار",
      "7",
      "8",
      "سوشال",
      "سوشال سوشال",
      "9",
      "10",
      "11",
      "12",
    ];
    const enabledNames = new Set(["1", "2", "3", "4", "5", "6", "جگوار", "7", "8", "9", "10"]);
    if (
      tables.rows.length !== expectedNames.length ||
      tables.rows.some(
        (row, index) =>
          row.name !== expectedNames[index] ||
          row.displayOrder !== index + 1 ||
          row.waiterCallEnabled !== enabledNames.has(row.name),
      )
    ) {
      throw new Error("Fresh deploy did not seed the exact physical table layout");
    }

    await client.query(
      `INSERT INTO "categories" ("id", "name", "displayOrder")
       VALUES ('70000000-0000-4000-8000-000000000001', 'Backup restore probe', 999)`,
    );
  });

  const secondDeploy = prismaDeploy(url);
  if (!secondDeploy.includes("No pending migrations to apply")) {
    throw new Error("A repeated migrate deploy was not idempotent");
  }
}

async function verifyBackupRestore(files) {
  const sourceName = databaseNames.fresh;
  const restoreName = databaseNames.restore;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "cafe-db-restore-"));
  const archivePath = join(temporaryDirectory, "database.dump");
  const connectionArguments = [
    "--host",
    parsedUrl.hostname,
    "--port",
    parsedUrl.port || "5432",
    "--username",
    decodeURIComponent(parsedUrl.username),
    "--no-password",
  ];

  try {
    postgresCommand(
      "pg_dump",
      [...connectionArguments, "--format=custom", "--file", archivePath, sourceName],
      sourceName,
    );
    await recreateDatabase(restoreName);
    postgresCommand(
      "pg_restore",
      [...connectionArguments, "--dbname", restoreName, "--exit-on-error", archivePath],
      restoreName,
    );

    await withClient(databaseUrl(restoreName), async (client) => {
      const evidence = await client.query(`
        SELECT
          (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations,
          (SELECT count(*)::int FROM "cafe_tables") AS tables,
          (SELECT count(*)::int FROM "categories" WHERE "name" = 'Backup restore probe') AS probes,
          to_regclass('public.waiter_calls') AS waiter_table
      `);
      const row = evidence.rows[0];
      if (
        row?.migrations !== files.length ||
        row?.tables !== 16 ||
        row?.probes !== 1 ||
        row?.waiter_table !== "waiter_calls"
      ) {
        throw new Error(
          "Clean restore did not preserve migration history, seed data, probe data, and schema",
        );
      }
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function applySqlFiles(url, files) {
  await withClient(url, async (client) => {
    for (const file of files) await client.query(file.sql);
  });
}

async function verifyExistingDataUpgrade(files) {
  const name = databaseNames.upgrade;
  const url = databaseUrl(name);
  const previous = files.slice(0, -1);
  const latest = files.at(-1);
  if (!latest) throw new Error("No migrations found");

  await recreateDatabase(name);
  await applySqlFiles(url, previous);
  await withClient(url, async (client) => {
    await client.query(`
      INSERT INTO "users" ("id", "username", "passwordHash", "role", "updatedAt")
      VALUES ('10000000-0000-4000-8000-000000000001', 'migration.staff', 'hash', 'STAFF', CURRENT_TIMESTAMP);
      INSERT INTO "categories" ("id", "name", "displayOrder")
      VALUES ('20000000-0000-4000-8000-000000000001', 'Existing category', 1);
      INSERT INTO "products" ("id", "categoryId", "name", "priceAmount", "preparationDeadlineMinutes", "displayOrder")
      VALUES ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Existing product', 100000, 5, 1);
      INSERT INTO "orders" (
        "id", "orderNumber", "createdById", "channel", "state", "paymentStatus", "version",
        "discountAmount", "subtotalAmount", "totalAmount", "paidAmount", "balanceAmount",
        "estimatedPreparationMinutes", "createdAt", "updatedAt"
      ) VALUES (
        '50000000-0000-4000-8000-000000000001', 'MIGRATION-ORDER-1',
        '10000000-0000-4000-8000-000000000001', 'TAKEAWAY', 'OPEN', 'UNPAID', 1,
        0, 100000, 100000, 0, 100000, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO "order_items" (
        "id", "orderId", "productId", "productNameSnapshot", "basePriceSnapshot",
        "preparationDeadlineSnapshotMinutes", "quantity", "discountAmount", "lineTotalAmount", "displayOrder"
      ) VALUES (
        '60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001', 'Existing product', 100000, 5, 1, 0, 100000, 1
      );
    `);
    await client.query(latest.sql);
    const retained = await client.query(
      `SELECT "totalAmount" FROM "orders" WHERE "orderNumber" = 'MIGRATION-ORDER-1'`,
    );
    if (retained.rows[0]?.totalAmount !== 100000)
      throw new Error("Existing valid financial data was not retained");
    const waiterTable = await client.query(`SELECT to_regclass('public.waiter_calls') AS name`);
    if (waiterTable.rows[0]?.name !== "waiter_calls")
      throw new Error("Existing-data upgrade did not add waiter-call persistence");
  });
}

async function verifyFailedUpgradeIsAtomic(files) {
  const name = databaseNames.failure;
  const url = databaseUrl(name);
  const previous = files.slice(0, -1);
  const latest = files.at(-1);
  if (!latest) throw new Error("No migrations found");

  await recreateDatabase(name);
  await applySqlFiles(url, previous);
  await withClient(url, async (client) => {
    await client.query(
      `INSERT INTO "categories" ("id", "name", "displayOrder") VALUES ($1, '   ', 0)`,
      [randomId()],
    );
    let failed = false;
    try {
      await client.query(latest.sql);
    } catch (error) {
      failed = error?.code === "23514" && error?.constraint === "categories_name_non_empty_check";
    }
    if (!failed)
      throw new Error("The migration did not reject invalid historical data as expected");

    const state = await client.query(`
      SELECT
        to_regclass('public.waiter_calls') AS waiter_table,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'cafe_settings' AND column_name = 'singletonKey'
        ) AS singleton_column
    `);
    if (state.rows[0]?.waiter_table !== null || state.rows[0]?.singleton_column !== false) {
      throw new Error("A failed migration left partial schema changes behind");
    }
  });
}

function randomId() {
  return `90000000-0000-4000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`;
}

const files = await migrationFiles();
if (files.length === 0) throw new Error("No migration files found");

try {
  await verifyFreshDeploy(files);
  await verifyBackupRestore(files);
  await verifyExistingDataUpgrade(files);
  await verifyFailedUpgradeIsAtomic(files);
  console.info(
    `Verified ${files.length} migrations: fresh/repeat deploy, existing-data upgrade, exact seed, atomic failure, and clean backup restore.`,
  );
} finally {
  await Promise.all(Object.values(databaseNames).map(dropDatabase));
}
