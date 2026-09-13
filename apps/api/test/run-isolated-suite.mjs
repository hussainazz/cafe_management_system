import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { relative } from "node:path";

const files = (await readdir(new URL("./", import.meta.url), {
  recursive: true,
  withFileTypes: true,
}))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => relative(process.cwd(), `${entry.parentPath}/${entry.name}`))
  .sort();

if (files.length === 0) throw new Error("No API test files were discovered");

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
