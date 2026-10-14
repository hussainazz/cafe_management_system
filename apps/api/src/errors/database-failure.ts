import { ApplicationError, ErrorCodes } from "./application-error.js";
import { databaseDiagnostic } from "./database-diagnostics.js";

export function databaseFailure(error: unknown): ApplicationError | undefined {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof source.code === "string" ? source.code : typeof source.errorCode === "string" ? source.errorCode : undefined;
  const diagnostic = databaseDiagnostic(error);
  const state = diagnostic?.sqlState;
  if (code === "P2025") return new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested resource was not found.");
  if (code === "P2002" || state === "23505") return new ApplicationError(409, ErrorCodes.CONFLICT, "A resource with the same unique value already exists.");
  if (["P2003", "P2014"].includes(code ?? "") || state === "23503") return new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The request references a missing or protected resource.");
  if (code === "P2034" || state === "40001" || state === "40P01") return new ApplicationError(409, ErrorCodes.CONFLICT, "The inventory changed during this request. Refresh the data before trying again.");
  if (["P1000", "P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2037"].includes(code ?? "") ||
      state?.startsWith("08") || ["53300", "57P01", "57P02", "57P03"].includes(state ?? "") ||
      ["SocketTimeout", "ConnectionClosed", "ConnectionError", "TlsConnectionError", "DatabaseNotReachable", "TooManyConnections", "AuthenticationFailed", "DatabaseAccessDenied"].includes(diagnostic?.kind ?? "")) {
    return new ApplicationError(503, ErrorCodes.SERVICE_UNAVAILABLE, "The database is temporarily unavailable. Check the saved state before trying again.");
  }
  if (["P2021", "P2022"].includes(code ?? "") || ["42P01", "42703"].includes(state ?? "")) return new ApplicationError(503, ErrorCodes.SERVICE_UNAVAILABLE, "The inventory service needs a database update. Contact the system administrator.");
  if (["P2000", "P2020"].includes(code ?? "") || ["22001", "22003"].includes(state ?? "")) return new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A quantity or amount exceeds the supported range.");
  if (state === "23514") {
    const constraints: Record<string, { path: string; message: string }> = {
      purchases_supplier_nonempty: { path: "supplier", message: "Enter a supplier name or leave it unspecified." },
      purchase_lines_base_quantity_matches_conversion: { path: "lines", message: "The converted quantity must be exact to six decimal places." },
      inventory_balances_quantity_nonnegative: { path: "quantity", message: "There is not enough inventory for this operation." },
      inventory_balances_value_nonnegative: { path: "value", message: "The operation would make the inventory value negative." },
    };
    const field = constraints[diagnostic?.constraint ?? ""];
    if (field) return new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, field.message, [{ ...field, code: "inventory_constraint" }]);
  }
  return undefined;
}
