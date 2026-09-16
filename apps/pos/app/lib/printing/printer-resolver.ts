import type { PrinterRole } from "./types";
const preferenceKey = (role: PrinterRole) => `run-cafe:printer:${role}`;
const likelyPrinter = /(pos\s*88c?|oscar)/i;
export function configuredPrinter(role: PrinterRole): string | null { return typeof window === "undefined" ? null : window.localStorage.getItem(preferenceKey(role))?.trim() || null; }
export function saveConfiguredPrinter(role: PrinterRole, name: string | null): void { if (typeof window === "undefined") return; if (name) window.localStorage.setItem(preferenceKey(role), name); else window.localStorage.removeItem(preferenceKey(role)); }
export function resolvePrinter(role: PrinterRole, printers: string[]): string | null { const configured = configuredPrinter(role); if (configured) return printers.includes(configured) ? configured : null; const candidates = printers.filter((printer) => likelyPrinter.test(printer)); return candidates.length === 1 ? candidates[0]! : null; }
export function printerResolutionIssue(role: PrinterRole, printers: string[]): "missing" | "ambiguous" | null { const configured = configuredPrinter(role); if (configured) return printers.includes(configured) ? null : "missing"; const candidates = printers.filter((printer) => likelyPrinter.test(printer)); return candidates.length === 0 ? "missing" : candidates.length === 1 ? null : "ambiguous"; }
