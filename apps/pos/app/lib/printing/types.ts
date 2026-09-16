export type PrinterRole = "BAR" | "RECEIPT";
export type PrintKind = "bar-ticket" | "receipt" | "settlement";
export type PrinterDiagnostics = { connected: boolean; configuredPrinter: string | null; resolvedPrinter: string | null; printers: string[]; lastFailure: string | null };
export class PrintServiceError extends Error {
  constructor(readonly code: "QZ_UNAVAILABLE" | "PRINTER_NOT_FOUND" | "PRINTER_AMBIGUOUS" | "SIGNING" | "PRINT_REJECTED", message: string) { super(message); this.name = "PrintServiceError"; }
}
