import { Client } from "pg";
import { beforeEach } from "vitest";

const tableNames = [
  "audit_logs",
  "idempotency_records",
  "settlement_reversals",
  "payments",
  "settlement_allocations",
  "payment_settlements",
  "order_item_options",
  "order_items",
  "orders",
  "product_option_groups",
  "product_images",
  "options",
  "option_groups",
  "products",
  "categories",
  "cafe_tables",
  "cafe_settings",
  "auth_events",
  "refresh_sessions",
  "users",
];

const databaseUrl = process.env.DATABASE_URL;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (
  !databaseUrl ||
  databaseUrl !== testDatabaseUrl ||
  !new URL(databaseUrl).pathname.endsWith("_test")
) {
  throw new Error(
    "Tests require DATABASE_URL and TEST_DATABASE_URL to target the same _test database",
  );
}

const truncateStatement = `TRUNCATE TABLE ${tableNames.map((name) => `"${name}"`).join(", ")} RESTART IDENTITY CASCADE`;

beforeEach(async () => {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query(truncateStatement);
  } finally {
    await client.end();
  }
});
