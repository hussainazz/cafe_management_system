import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

const app = buildApp();
const temporaryDirectories: string[] = [];

beforeAll(async () => app.ready());
afterAll(async () => {
  await app.close();
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function outputPath(name: string) {
  const parent = await mkdtemp(join(tmpdir(), `cafe-qr-${name}-`));
  temporaryDirectories.push(parent);
  return join(parent, "output");
}

function runProvision(arguments_: string[]) {
  return spawnSync(process.execPath, ["../../node_modules/tsx/dist/cli.mjs", "prisma/provision-table-qrs.ts", ...arguments_], {
    cwd: new URL("../../", import.meta.url),
    env: process.env,
    encoding: "utf8",
  });
}

describe("table QR provisioning command", () => {
  it("creates printable hash-only artifacts and requires explicit rotation", async () => {
    const table = await app.prisma.cafeTable.create({ data: { name: "1", displayOrder: 1, waiterCallEnabled: true } });
    const firstOutput = await outputPath("first");
    const first = runProvision(["--table", "1", "--base-url", "https://runncafe.ir", "--output-dir", firstOutput]);
    expect(first.status, first.stderr).toBe(0);
    const firstManifest = JSON.parse(await readFile(join(firstOutput, "table-qr-urls.json"), "utf8"));
    expect(firstManifest.credentials).toEqual([expect.objectContaining({ tableId: table.id, tableName: "1", url: expect.stringMatching(/^https:\/\/runncafe\.ir\/t\/[A-Za-z0-9_-]{43}$/) })]);
    await expect(readFile(join(firstOutput, "table-01.svg"), "utf8")).resolves.toContain("<svg");
    await expect(readFile(join(firstOutput, "print-sheet.html"), "utf8")).resolves.toContain("میز 1");
    const stored = await app.prisma.tableQrCredential.findFirstOrThrow();
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(firstManifest.credentials[0].url);

    const duplicate = runProvision(["--table", "1", "--base-url", "https://runncafe.ir", "--output-dir", await outputPath("duplicate")]);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("Use --rotate explicitly");

    const rotatedOutput = await outputPath("rotated");
    const rotated = runProvision(["--table", "1", "--rotate", "--base-url", "https://runncafe.ir", "--output-dir", rotatedOutput]);
    expect(rotated.status, rotated.stderr).toBe(0);
    const rotatedManifest = JSON.parse(await readFile(join(rotatedOutput, "table-qr-urls.json"), "utf8"));
    expect(rotatedManifest.credentials[0].url).not.toBe(firstManifest.credentials[0].url);
    expect(await app.prisma.tableQrCredential.count({ where: { tableId: table.id, isActive: true } })).toBe(1);
    expect(await app.prisma.tableQrCredential.count({ where: { tableId: table.id, isActive: false } })).toBe(1);
  });

  it("supports all eligible tables and rejects noneligible labels", async () => {
    await app.prisma.cafeTable.createMany({ data: [
      { name: "1", displayOrder: 1, waiterCallEnabled: true },
      { name: "جگوار", displayOrder: 2, waiterCallEnabled: true },
      { name: "کانتر وسط", displayOrder: 3, waiterCallEnabled: false },
    ] });
    const output = await outputPath("all");
    const all = runProvision(["--all-eligible", "--base-url", "https://runncafe.ir", "--output-dir", output]);
    expect(all.status, all.stderr).toBe(0);
    const manifest = JSON.parse(await readFile(join(output, "table-qr-urls.json"), "utf8"));
    expect(manifest.credentials.map((item: { tableName: string }) => item.tableName)).toEqual(["1", "جگوار"]);

    const disabled = runProvision(["--table", "کانتر وسط", "--base-url", "https://runncafe.ir", "--output-dir", await outputPath("disabled")]);
    expect(disabled.status).not.toBe(0);
    expect(disabled.stderr).toContain("Eligible active table not found");
  });
});
