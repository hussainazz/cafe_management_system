export type PrintKind = "bar-ticket" | "receipt" | "settlement";

export function printRoute(orderId: string, kind: PrintKind, settlementId?: string): string {
  const base = `/print/${encodeURIComponent(orderId)}`;
  if (kind === "bar-ticket") return `${base}/bar-ticket`;
  if (kind === "receipt") return `${base}/receipt`;
  if (!settlementId) throw new Error("A settlement receipt requires a settlement ID.");
  return `${base}/settlements/${encodeURIComponent(settlementId)}/receipt`;
}
