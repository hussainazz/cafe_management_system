import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "dist/**"],
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
    setupFiles: ["./test/setup/database.ts"],
  },
});
