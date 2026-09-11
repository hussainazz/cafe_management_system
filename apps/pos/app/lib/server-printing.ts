import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export type ServerPrintKind = "receipt" | "bar-ticket" | "settlement";
export type PrintCommand = (printer: string, file: string) => Promise<void>;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const apiBase = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

async function submitWithLp(printer: string, file: string) {
  try {
    await execFileAsync("lp", ["-d", printer, file], { timeout: 15_000 });
  } catch (error) {
    const detail = error as { message?: string; stderr?: string };
    throw new Error(detail.stderr?.trim() || detail.message || "lp failed");
  }
}

async function renderPdf(htmlFile: string, pdfFile: string, profile: string) {
  try {
    const renderer = process.env.POS_PRINT_BROWSER ?? "wkhtmltopdf";
    if (renderer.endsWith("wkhtmltopdf")) {
      await execFileAsync(renderer, ["--encoding", "utf-8", "--page-width", "80mm", "--margin-top", "0", "--margin-right", "0", "--margin-bottom", "0", "--margin-left", "0", htmlFile, pdfFile], { timeout: 30_000 });
    } else {
      await execFileAsync(renderer, ["--headless", "--no-sandbox", "--disable-gpu", `--user-data-dir=${profile}`, `--print-to-pdf=${pdfFile}`, `file://${htmlFile}`], { timeout: 30_000 });
    }
  } catch (error) {
    const detail = error as { message?: string; stderr?: string };
    throw Object.assign(new Error(detail.stderr?.trim() || detail.message || "PDF rendering failed"), { code: "PRINT_RENDER_FAILED" });
  }
}

async function renderEscPos(htmlFile: string, outputFile: string) {
  const pngFile = `${outputFile}.png`;
  try {
    // OSCAR POS88C is an 80 mm, 576-dot printer. Its bitmap command is the
    // ESC/POS ESC * 8-dot bit-image command; ESC K is only paper feeding.
    await execFileAsync("wkhtmltoimage", ["--encoding", "utf-8", "--width", "576", "--quality", "100", htmlFile, pngFile], { timeout: 30_000 });
    const { stdout } = await execFileAsync("convert", [pngFile, "-background", "white", "-alpha", "remove", "-colorspace", "Gray", "-threshold", "60%", "-trim", "+repage", "-depth", "1", "txt:-"], { timeout: 30_000, maxBuffer: 20 * 1024 * 1024 });
    const dimensions = /^# ImageMagick pixel enumeration: (\d+),(\d+)/m.exec(stdout);
    if (!dimensions) throw new Error("Rendered print image has no dimensions");
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    const rowBytes = Math.ceil(width / 8);
    const pixels = Buffer.alloc(rowBytes * height, 0x00);
    for (const line of stdout.split("\n")) {
      const pixel = /^(\d+),(\d+):.*?#000000(?:00)?\b/.exec(line);
      if (!pixel) continue;
      const x = Number(pixel[1]); const y = Number(pixel[2]);
      const offset = y * rowBytes + Math.floor(x / 8);
      pixels[offset] = (pixels[offset] ?? 0x00) | (0x80 >> (x % 8));
    }
    const bands: Buffer[] = [Buffer.from([0x1b, 0x40])];
    // ESC * mode 0, one 8-dot vertical slice per output row.
    for (let y = 0; y < height; y += 8) {
      const command = Buffer.alloc(5 + width + 1);
      command.set([0x1b, 0x2a, 0x00, width & 0xff, (width >> 8) & 0xff]);
      for (let x = 0; x < width; x++) {
        for (let bit = 0; bit < 8; bit++) {
          const source = pixels[(y + bit) * rowBytes + Math.floor(x / 8)] ?? 0;
          if (source & (0x80 >> (x % 8))) command[5 + x] = (command[5 + x] ?? 0) | (0x80 >> bit);
        }
      }
      command[5 + width] = 0x0a;
      bands.push(command);
    }
    bands.push(Buffer.from([0x1d, 0x56, 0x00]));
    await fs.writeFile(outputFile, Buffer.concat(bands));
  } catch (error) {
    const detail = error as { message?: string; stderr?: string };
    throw Object.assign(new Error(detail.stderr?.trim() || detail.message || "ESC/POS rendering failed"), { code: "PRINT_RENDER_FAILED" });
  } finally { await fs.rm(pngFile, { force: true }); }
}

export function renderPrintHtml(kind: ServerPrintKind, data: any) {
  const items = data.items.map((item: any) => `<article><b>${escapeHtml(item.productName)}</b><span> ×${item.quantity}</span>${item.options?.length ? `<small>${item.options.map((option: any) => `${escapeHtml(option.name)} ×${option.quantity}`).join("، ")}</small>` : ""}${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}${kind !== "bar-ticket" ? `<strong>${item.lineTotalAmount}</strong>` : ""}</article>`).join("");
  const total = kind === "bar-ticket" ? "" : `<section class="total">${data.totalAmount}</section><footer>${escapeHtml(data.displayTime)}</footer>`;
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}body{width:72mm;margin:4mm;font-family:"Noto Sans Arabic",Arial,sans-serif;font-size:5.5pt;direction:rtl}article{border-bottom:1px dashed #888;padding:2mm 0}article b{display:inline-block}article span{float:left}small,p{display:block;margin:1mm 0;font-size:4.5pt}.total{font-weight:bold;border-top:2px solid #111;margin-top:3mm;padding-top:3mm}footer{text-align:center;margin-top:5mm;font-size:4.5pt}</style></head><body>${data.context ? `<header>${escapeHtml(data.context)}</header>` : ""}${items}${total}</body></html>`;
}

export async function printFromApi(input: { kind: ServerPrintKind; orderId: string; settlementId?: string; cookie: string }, submit: PrintCommand = submitWithLp) {
  const printer = process.env.POS_PRINTER_NAME?.trim();
  if (!printer) throw Object.assign(new Error("POS_PRINTER_NAME is not configured"), { code: "PRINTER_NOT_CONFIGURED" });
  const suffix = input.kind === "bar-ticket" ? "bar-ticket" : input.kind === "receipt" ? "receipt" : `settlements/${encodeURIComponent(input.settlementId ?? "")}/receipt`;
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/v1/orders/${encodeURIComponent(input.orderId)}/${suffix}`, { headers: { cookie: input.cookie, accept: "application/json" }, cache: "no-store" });
  } catch (error) {
    throw Object.assign(new Error(`Print API unavailable: ${error instanceof Error ? error.message : "request failed"}`), { code: "PRINT_API_UNAVAILABLE" });
  }
  const rawPayload = await response.text();
  let payload: { data?: unknown; error?: { code?: string; message?: string } } = {};
  try { payload = JSON.parse(rawPayload) as typeof payload; } catch { /* retain a useful status below */ }
  if (!response.ok) throw Object.assign(new Error(`Print data request failed (${response.status})${payload.error?.code ? ` ${payload.error.code}` : ""}${payload.error?.message ? `: ${payload.error.message}` : ""}`), { code: "PRINT_DATA_UNAVAILABLE", status: response.status });
  if (!payload.data) throw Object.assign(new Error("Print data unavailable"), { code: "PRINT_DATA_UNAVAILABLE" });
  const stem = path.join(os.tmpdir(), `run-cafe-print-${process.pid}-${Date.now()}`);
  const htmlFile = `${stem}.html`, outputFile = `${stem}.escpos`;
  try { await fs.writeFile(htmlFile, renderPrintHtml(input.kind, payload.data), "utf8"); await renderEscPos(htmlFile, outputFile); await submit(printer, outputFile); }
  finally { await Promise.all([htmlFile, outputFile, `${outputFile}.png`].map((file) => fs.rm(file, { force: true, recursive: true }))); }
}
