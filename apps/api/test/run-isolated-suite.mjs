import { spawnSync } from "node:child_process";

const files = [
  "test/integration/admin.test.ts",
  "test/integration/auth.test.ts",
  "test/integration/database-constraints.test.ts",
  "test/integration/database-isolation.test.ts",
  "test/integration/error-envelope.test.ts",
  "test/integration/health.test.ts",
  "test/integration/manager-query-plans.test.ts",
  "test/integration/orders.test.ts",
  "test/integration/openapi.test.ts",
  "test/integration/pos-reads.test.ts",
  "test/integration/product-images.test.ts",
  "test/integration/public-menu.test.ts",
  "test/integration/table-qr-provisioning.test.ts",
  "test/integration/waiter-calls.test.ts",
  "test/unit/password.test.ts",
];

const selectedFiles = process.argv.slice(2);
const filesToRun = selectedFiles.length > 0 ? selectedFiles : files;

for (const file of filesToRun) {
  const result = spawnSync(
    process.execPath,
    ["../../node_modules/vitest/vitest.mjs", "run", file],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
