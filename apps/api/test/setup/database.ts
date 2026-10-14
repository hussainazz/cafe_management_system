import { Client } from "pg";
import { beforeEach } from "vitest";

const tableNames = [
  "inventory_movements",
  "order_consumption_items",
  "order_consumptions",
  "order_item_costing_snapshots",
  "inventory_count_pending_orders",
  "inventory_count_lines",
  "inventory_counts",
  "product_combination_costing_rules",
  "costing_combination_options",
  "product_costing_combinations",
  "product_option_costing_rules",
  "product_costing_configurations",
  "recipe_components",
  "recipes",
  "purchase_lines",
  "purchases",
  "inventory_balances",
  "stock_unit_conversions",
  "stock_items",
  "audit_logs",
  "idempotency_records",
  "waiter_calls",
  "customer_table_visits",
  "customer_auth_sessions",
  "customer_otp_challenges",
  "customers",
  "table_qr_credentials",
  "settlement_reversals",
  "payments",
  "settlement_allocations",
  "payment_settlements",
  "order_item_options",
  "order_items",
  "orders",
  "product_option_group_options",
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
