import "dotenv/config";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import QRCode from "qrcode";
import { PrismaClient } from "../generated/prisma/client.js";
import { createTableQrToken, hashTableQrToken } from "../src/table-context/table-context.js";

type Arguments = {
  table: string | undefined;
  allEligible: boolean;
  rotate: boolean;
  baseUrl: string;
  outputDirectory: string;
};

function parseArguments(values: string[]): Arguments {
  const valueFor = (flag: string) => {
    const index = values.indexOf(flag);
    return index >= 0 ? values[index + 1] : undefined;
  };
  const table = valueFor("--table");
  const allEligible = values.includes("--all-eligible");
  const rotate = values.includes("--rotate");
  const baseUrlValue = valueFor("--base-url") ?? process.env.TABLE_QR_BASE_URL;
  const outputDirectory = valueFor("--output-dir");

  if (Boolean(table) === allEligible) {
    throw new Error("Specify exactly one of --table <label> or --all-eligible");
  }
  if (!baseUrlValue) throw new Error("--base-url or TABLE_QR_BASE_URL is required");
  if (!outputDirectory) throw new Error("--output-dir is required");
  const baseUrl = new URL(baseUrlValue);
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.search || baseUrl.hash) {
    throw new Error("The QR base URL must be an HTTP(S) origin without a query or fragment");
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/$/, "");
  return {
    table,
    allEligible,
    rotate,
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    outputDirectory: resolve(outputDirectory),
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

async function provision() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const args = parseArguments(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const temporaryDirectory = join(dirname(args.outputDirectory), `.table-qrs-${randomUUID()}`);
  let credentialsCommitted = false;

  try {
    await mkdir(dirname(args.outputDirectory), { recursive: true, mode: 0o700 });
    try {
      await lstat(args.outputDirectory);
      throw new Error(`Output path already exists: ${args.outputDirectory}`);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const tables = await prisma.cafeTable.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        waiterCallEnabled: true,
        ...(args.table ? { name: args.table } : {}),
      },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: { qrCredentials: { where: { isActive: true }, take: 1 } },
    });
    if (args.table && tables.length !== 1) {
      throw new Error(`Eligible active table not found: ${args.table}`);
    }
    if (args.allEligible && tables.length === 0) throw new Error("No eligible active tables found");
    const withExisting = tables.filter((table) => table.qrCredentials.length > 0);
    if (withExisting.length > 0 && !args.rotate) {
      throw new Error(
        `Active QR credential already exists for: ${withExisting.map((table) => table.name).join(", ")}. Use --rotate explicitly.`,
      );
    }

    const issued = tables.map((table) => {
      const token = createTableQrToken();
      return {
        table,
        token,
        tokenHash: hashTableQrToken(token),
        url: `${args.baseUrl}/t/${token}`,
        fileName: `table-${String(table.displayOrder).padStart(2, "0")}.svg`,
      };
    });
    await mkdir(temporaryDirectory, { recursive: false, mode: 0o700 });
    for (const item of issued) {
      const svg = await QRCode.toString(item.url, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 4,
        width: 512,
      });
      await writeFile(join(temporaryDirectory, item.fileName), svg, { mode: 0o600 });
    }
    const generatedAt = new Date();
    await writeFile(
      join(temporaryDirectory, "table-qr-urls.json"),
      JSON.stringify(
        {
          generatedAt: generatedAt.toISOString(),
          baseUrl: args.baseUrl,
          credentials: issued.map((item) => ({
            tableId: item.table.id,
            tableName: item.table.name,
            displayOrder: item.table.displayOrder,
            url: item.url,
            svg: item.fileName,
          })),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await writeFile(
      join(temporaryDirectory, "print-sheet.html"),
      `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>Run Cafe table QR codes</title><style>@page{size:A4;margin:12mm}body{font-family:system-ui,sans-serif}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12mm}.card{break-inside:avoid;text-align:center;border:1px solid #bbb;padding:8mm}.card img{width:58mm;height:58mm}.card h1{font-size:20pt;margin:4mm 0 0}</style></head><body><main class="grid">${issued.map((item) => `<section class="card"><img src="${escapeHtml(item.fileName)}" alt="QR میز ${escapeHtml(item.table.name)}"><h1>میز ${escapeHtml(item.table.name)}</h1></section>`).join("")}</main></body></html>`,
      { mode: 0o600 },
    );

    await prisma.$transaction(async (transaction) => {
      const rotatedAt = new Date();
      for (const item of issued) {
        if (args.rotate) {
          await transaction.tableQrCredential.updateMany({
            where: { tableId: item.table.id, isActive: true },
            data: { isActive: false, rotatedAt },
          });
          await transaction.cafeTable.update({
            where: { id: item.table.id },
            data: { tableContextInvalidBefore: rotatedAt },
          });
        }
        await transaction.tableQrCredential.create({
          data: { tableId: item.table.id, tokenHash: item.tokenHash, createdAt: generatedAt },
        });
      }
    });
    credentialsCommitted = true;
    try {
      await rename(temporaryDirectory, args.outputDirectory);
    } catch {
      throw new Error(
        `Credentials were activated; recover the printable artifacts from ${temporaryDirectory}`,
      );
    }
    console.info(`Created ${issued.length} table QR credential(s) in ${args.outputDirectory}.`);
  } catch (error) {
    if (!credentialsCommitted) await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await provision();
} catch (error) {
  console.error(
    `Table QR provisioning failed: ${error instanceof Error ? error.message : "Unknown error"}`,
  );
  process.exitCode = 1;
}
