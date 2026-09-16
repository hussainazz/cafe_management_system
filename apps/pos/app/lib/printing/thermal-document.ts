import { prepareThermalDocument } from "../print-routes";
import type { PrintKind } from "./types";
export function thermalRoute(orderId: string, kind: PrintKind, settlementId?: string): string { const base = `/pos/print/${encodeURIComponent(orderId)}`; if (kind === "bar-ticket") return `${base}/bar-ticket`; if (kind === "receipt") return `${base}/receipt`; if (!settlementId) throw new Error("A settlement receipt requires a settlement ID."); return `${base}/settlements/${encodeURIComponent(settlementId)}/receipt`; }
export const thermalDocument = (orderId: string, kind: PrintKind, settlementId?: string) => prepareThermalDocument(thermalRoute(orderId, kind, settlementId));
