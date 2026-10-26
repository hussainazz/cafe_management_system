import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalIntent } from "@cafe/contracts";
import { sendTerminalPurchase } from "./sep-payment";
const intent: TerminalIntent = { attemptId: "50000000-0000-4000-8000-000000000003", bridgeId: "50000000-0000-4000-8000-000000000004", terminalId: "31187710", orderId: "50000000-0000-4000-8000-000000000001", orderVersion: 2, cardAmount: 1000, unit: "TOMAN", checkoutHash: "a".repeat(64), nonce: "50000000-0000-4000-8000-000000000005", issuedAtUnix: 1792920000, expiresAtUnix: 1792920120, signature: "a".repeat(64) };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Explicit loopback purchase transport", () => {
  it("uses one credential-free JSON fetch with no redirect or automatic retry", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ attemptId: intent.attemptId, status: "PENDING" }))); vi.stubGlobal("fetch", fetch);
    expect(await sendTerminalPurchase(intent)).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toMatchObject(["http://127.0.0.1:18711/payments", { method: "POST", mode: "cors", credentials: "omit", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify(intent) }]);
  });
  it("returns uncertainty after an offline bridge without retry", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("offline")); vi.stubGlobal("fetch", fetch);
    expect(await sendTerminalPurchase(intent)).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched attempt acknowledgments and malformed authorizations", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ attemptId: "different" }))); vi.stubGlobal("fetch", fetch);
    expect(await sendTerminalPurchase(intent)).toBe(false); expect(await sendTerminalPurchase({ ...intent, cardAmount: -1 })).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds a hung HTTP response without treating it as a declined payment", async () => {
    vi.useFakeTimers(); const fetch = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))); vi.stubGlobal("fetch", fetch);
    const pending = sendTerminalPurchase(intent); await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
