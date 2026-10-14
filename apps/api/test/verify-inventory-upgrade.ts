import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(apiRoot, ".env.test") });

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) {
  throw new Error("Inventory migration rehearsal requires matching DATABASE_URL and TEST_DATABASE_URL values.");
}
const target = new URL(databaseUrl);
if (target.hostname !== "127.0.0.1" || target.port !== "5433" || target.pathname !== "/cafe_management_test") {
  throw new Error("Inventory migration rehearsal is restricted to cafe_management_test on 127.0.0.1:5433.");
}

const migrationRoot = join(apiRoot, "prisma", "migrations");
const entries = (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
if (entries.length < 2 || !entries.at(-1)?.includes("inventory_costing")) throw new Error("The checked-in inventory migration must be the newest migration for this rehearsal.");

const temporaryDirectory = await mkdtemp(join(apiRoot, ".inventory-upgrade-rehearsal-"));
const temporaryMigrations = join(temporaryDirectory, "migrations");
const temporaryConfig = join(temporaryDirectory, "prisma.config.ts");
const prismaCliPath = resolve(apiRoot, "../../node_modules/prisma/build/index.js");
const environment = { ...process.env, DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl };

function run(args: string[]) {
  const result = spawnSync(process.execPath, [prismaCliPath, ...args], { cwd: apiRoot, env: environment, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Prisma ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

let passed = false;
try {
  await mkdir(temporaryMigrations);
  await writeFile(join(temporaryMigrations, "migration_lock.toml"), 'provider = "postgresql"\n');
  for (const name of entries.slice(0, -1)) await cp(join(migrationRoot, name), join(temporaryMigrations, name), { recursive: true });
  await writeFile(temporaryConfig, `import { defineConfig, env } from "prisma/config";\nexport default defineConfig({ schema: ${JSON.stringify(join(apiRoot, "prisma", "schema.prisma"))}, migrations: { path: ${JSON.stringify(temporaryMigrations)} }, engine: "classic", datasource: { url: env("DATABASE_URL") } });\n`);

  run(["migrate", "reset", "--force", "--skip-generate", "--skip-seed", "--config", temporaryConfig]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  let categoryId = "";
  try {
    const category = await prisma.category.create({ data: { name: `Inventory migration upgrade ${Date.now()}`, displayOrder: 999 } });
    categoryId = category.id;
  } finally {
    await prisma.$disconnect();
  }

  const deployOutput = run(["migrate", "deploy", "--config", "prisma.config.ts"]);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT
         (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migration_count,
         (SELECT count(*)::int FROM "categories" WHERE id = $1) AS prior_data,
         to_regclass('public.stock_items') AS stock_items,
         to_regclass('public.inventory_movements') AS inventory_movements,
         to_regclass('public.order_consumptions') AS order_consumptions`,
      [categoryId],
    );
    const row = result.rows[0];
    if (row?.migration_count !== entries.length || row.prior_data !== 1 || row.stock_items !== "stock_items" || row.inventory_movements !== "inventory_movements" || row.order_consumptions !== "order_consumptions") {
      throw new Error(`Upgrade verification failed: ${JSON.stringify(row)}`);
    }
    if (!deployOutput.includes(entries.at(-1)!)) throw new Error("Prisma did not report applying the inventory-costing migration during upgrade.");
    await client.query(`DELETE FROM "categories" WHERE id = $1`, [categoryId]);
  } finally {
    await client.end();
  }

  passed = true;
  console.info(`Inventory migration upgrade passed on cafe_management_test: ${entries.length - 1} earlier migrations applied, existing category row preserved, and ${entries.at(-1)} applied.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
  if (!passed) {
    const reset = spawnSync("pnpm", ["--filter", "@cafe/api", "test:db:reset"], { cwd: resolve(apiRoot, "../.."), env: environment, encoding: "utf8" });
    if (reset.status !== 0) throw new Error(`The authorized isolated test database cleanup failed:\n${reset.stdout}\n${reset.stderr}`);
  }
}
