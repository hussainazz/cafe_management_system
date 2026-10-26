import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeHealthUrl, probeBridge } from "./sep-bridge-diagnostic";

afterEach(() => vi.unstubAllGlobals());

describe("health-only SEP browser diagnostic", () => {
  it("sends explicit credential-free GET probes with a header forcing preflight", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ service: "run-cafe-sep-bridge", version: "0.1.0", mode: "health-only", paymentEnabled: false, terminalAccess: false })));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await probeBridge(18711, "simple", signal)).toEqual({ kind: "simple", ok: true, status: 200 });
    expect(await probeBridge(18711, "preflight", signal)).toEqual({ kind: "preflight", ok: true, status: 200 });
    expect(fetch.mock.calls[0]).toEqual(["http://127.0.0.1:18711/health", {
      method: "GET", mode: "cors", credentials: "omit", cache: "no-store", redirect: "error", signal,
    }]);
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: "GET", headers: { "x-run-cafe-diagnostic": "1" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports an indistinguishable network/policy failure without claiming terminal failure or retrying", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Fetch failed"));
    vi.stubGlobal("fetch", fetch);
    expect(await probeBridge(18711, "simple", new AbortController().signal)).toEqual({ kind: "simple", ok: false, error: "network-or-policy" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, { paymentEnabled: true }, { service: "run-cafe-sep-bridge", version: "0.1.0", mode: "health-only", paymentEnabled: false, terminalAccess: true }])("rejects unexpected or payment-capable health data", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    expect(await probeBridge(18711, "simple", new AbortController().signal)).toMatchObject({ ok: false, error: "unexpected-response" });
  });

  it.each([0, 80, 1023, 65536, NaN, 18711.5])("rejects invalid ports before any request", port => {
    expect(() => bridgeHealthUrl(port)).toThrow("Invalid bridge port");
  });
});

it("accepts the payment host health metadata without calling any financial endpoint", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ service: "run-cafe-sep-bridge", version: "0.2.0", mode: "payments", paymentEnabled: true, manualVerificationRequired: true })));
  vi.stubGlobal("fetch", fetch);
  expect(await probeBridge(18711, "simple", new AbortController().signal)).toMatchObject({ ok: true });
  expect(fetch.mock.calls[0]![0]).toBe("http://127.0.0.1:18711/health");
});
