// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { printerResolutionIssue, resolvePrinter, saveConfiguredPrinter } from "./printer-resolver";

afterEach(() => { saveConfiguredPrinter("BAR", null); saveConfiguredPrinter("RECEIPT", null); });
describe("printer resolution", () => {
  it("honors an explicitly selected local Windows queue", () => { saveConfiguredPrinter("RECEIPT", "Cashier POS88C"); expect(resolvePrinter("RECEIPT", ["Cashier POS88C", "Microsoft Print to PDF"])).toBe("Cashier POS88C"); });
  it("selects exactly one likely POS88C queue", () => { expect(resolvePrinter("BAR", ["Microsoft Print to PDF", "OSCAR POS88C"])).toBe("OSCAR POS88C"); });
  it("does not select an unrelated queue", () => { expect(resolvePrinter("RECEIPT", ["Microsoft Print to PDF"])).toBeNull(); expect(printerResolutionIssue("RECEIPT", ["Microsoft Print to PDF"])).toBe("missing"); });
  it("refuses an ambiguous likely-printer match", () => { expect(resolvePrinter("BAR", ["OSCAR POS88C", "POS88 Kitchen"])).toBeNull(); expect(printerResolutionIssue("BAR", ["OSCAR POS88C", "POS88 Kitchen"])).toBe("ambiguous"); });
});
