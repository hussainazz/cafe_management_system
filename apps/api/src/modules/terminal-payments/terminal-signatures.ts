import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { TerminalClaim, TerminalIntent, TerminalResult } from "@cafe/contracts";

// Restricted scalar fields use a fixed order and LF, never locale formatting or JSON property order.
function message(purpose: string, values: Array<string | number | null>): string {
  return [purpose, ...values.map(value => value === null ? "" : String(value))].join("\n");
}
export function intentMessage(value: Omit<TerminalIntent, "signature">): string {
  return message("sep-intent-v1", [value.attemptId, value.bridgeId, value.terminalId, value.orderId,
    value.orderVersion, value.cardAmount, value.unit, value.checkoutHash, value.nonce, value.issuedAtUnix, value.expiresAtUnix]);
}
export function claimMessage(value: TerminalClaim): string {
  return message("sep-claim-v1", [value.attemptId, value.bridgeId, value.nonce, value.sentAtUnix]);
}
export function resultMessage(value: TerminalResult): string {
  return message("sep-result-v1", [value.attemptId, value.bridgeId, value.terminalId,
    value.sentAtUnix, value.finishedAtUnix, value.responseCode, value.rrn, value.trace]);
}
export function signTerminalMessage(value: string, key: string): string {
  return createHmac("sha256", Buffer.from(key, "hex")).update(value, "utf8").digest("hex");
}
export function verifyTerminalMessage(value: string, signature: unknown, key: string): boolean {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(signTerminalMessage(value, key), "hex"));
}
export function terminalFingerprint(value: unknown): string {
  function stable(input: unknown): string {
    if (input === null || typeof input !== "object") return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(stable).join(",")}]`;
    return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${stable((input as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return createHash("sha256").update(stable(value)).digest("hex");
}
