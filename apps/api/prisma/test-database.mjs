import dotenv from "dotenv";
import { Client } from "pg";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

dotenv.config({ path: new URL("../.env.test", import.meta.url) });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const parsedUrl = new URL(testDatabaseUrl);
const testDatabaseName = parsedUrl.pathname.slice(1);

if (!/^[a-z][a-z0-9_]{0,62}_test$/.test(testDatabaseName)) {
  throw new Error("TEST_DATABASE_URL must name a PostgreSQL database ending in _test");
}

const adminUrl = new URL(parsedUrl);
adminUrl.pathname = "/postgres";
adminUrl.search = "";
const prismaCliPath = fileURLToPath(
  new URL("../../../node_modules/prisma/build/index.js", import.meta.url),
);

async function withAdminClient(action) {
  const client = new Client({ connectionString: adminUrl.toString() });

  await client.connect();

  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

async function createDatabase() {
  await withAdminClient(async (client) => {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      testDatabaseName,
    ]);

    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE "${testDatabaseName}"`);
      console.info(`Created test database ${testDatabaseName}.`);
    }
  });
}

async function disposeDatabase() {
  await withAdminClient(async (client) => {
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
      [testDatabaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${testDatabaseName}"`);
  });

  console.info(`Disposed test database ${testDatabaseName}.`);
}

function runPrisma(...arguments_) {
  const result = spawnSync(process.execPath, [prismaCliPath, ...arguments_], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

const command = process.argv[2];

switch (command) {
  case "create":
    await createDatabase();
    break;
  case "reset":
    await createDatabase();
    runPrisma(
      "migrate",
      "reset",
      "--force",
      "--skip-generate",
      "--skip-seed",
      "--config",
      "prisma.config.ts",
    );
    break;
  case "dispose":
    await disposeDatabase();
    break;
  default:
    throw new Error("Expected one of: create, reset, dispose");
}
