// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { printDocument, printRoute } from "./print-routes";

afterEach(() => document.querySelectorAll('iframe[title="سند چاپی کافه"]').forEach((iframe) => iframe.remove()));

describe("printRoute", () => {
  it("builds dedicated bar-ticket, whole-order, and settlement print routes", () => {
    expect(printRoute("order/id", "bar-ticket")).toBe("/pos/print/order%2Fid/bar-ticket");
    expect(printRoute("order", "receipt")).toBe("/pos/print/order/receipt");
    expect(printRoute("order", "settlement", "settlement/id")).toBe("/pos/print/order/settlements/settlement%2Fid/receipt");
  });

  it("rejects a settlement route without a settlement ID", () => {
    expect(() => printRoute("order", "settlement")).toThrow("settlement ID");
  });

  it("keeps a prepared print frame alive until printing finishes", async () => {
    const prepared = printDocument("/pos/print/order/receipt");
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="سند چاپی کافه"]')!;
    const frameDocument = document.implementation.createHTMLDocument("print");
    frameDocument.body.innerHTML = '<main class="thermal-print">receipt</main>';
    Object.defineProperty(iframe, "contentDocument", { configurable: true, value: frameDocument });
    iframe.dispatchEvent(new Event("load"));
    await expect(prepared).resolves.toBeUndefined();
    expect(iframe.isConnected).toBe(true);
    iframe.contentWindow!.dispatchEvent(new Event("afterprint"));
    expect(iframe.isConnected).toBe(false);
  });

  it("surfaces a print-document loading error and removes the frame", async () => {
    const prepared = printDocument("/pos/print/order/receipt");
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="سند چاپی کافه"]')!;
    const frameDocument = document.implementation.createHTMLDocument("print");
    frameDocument.body.innerHTML = '<main class="thermal-error">رسید پیدا نشد.</main>';
    Object.defineProperty(iframe, "contentDocument", { configurable: true, value: frameDocument });
    iframe.dispatchEvent(new Event("load"));
    await expect(prepared).rejects.toThrow("رسید پیدا نشد");
    expect(iframe.isConnected).toBe(false);
  });
});
