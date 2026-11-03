import { afterEach, describe, expect, it, vi } from "vitest";
import { terminalPrepare, terminalReconcile, posApiFailureEvent, acknowledgeBarTicket, createInventoryPurchase, readStaffCatalog, readWaiterCalls } from "./api-client";

const authenticationError = {
  error: {
    code: "AUTHENTICATION_REQUIRED",
    message: "Authentication is required.",
    requestId: "request-expired-1",
    timestamp: "2026-09-15T10:00:00.000Z",
  },
};

const authenticatedUser = {
  data: {
    id: "11111111-1111-4111-8111-111111111111",
    username: "staff",
    role: "STAFF",
  },
  meta: { requestId: "request-refresh-1" },
};

const waiterCalls = {
  data: { calls: [] },
  meta: { requestId: "request-waiters-1" },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inventory error transport", () => {
  it("preserves field details and the support reference without repeating a failed write", async () => {
    const details = [{ path: "lines.0.purchaseQuantity", code: "quantity_precision", message: "Use an exact converted quantity." }];
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "BUSINESS_RULE_VIOLATION", message: "Invalid converted quantity", details, requestId: "purchase-validation-123", timestamp: "2026-10-14T08:00:00.000Z" } }, 422));
    vi.stubGlobal("fetch", fetch);
    expect(await createInventoryPurchase({ lines: [] })).toMatchObject({ ok: false, error: { kind: "response", status: 422, details, requestId: "purchase-validation-123" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Staff catalog transport", () => {
  it.each([false, true])("requests only Staff catalog endpoints and propagates a failed read=%s", async (failure) => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/products") && failure) return jsonResponse({ error: { code: "AUTHORIZATION_DENIED", message: "Forbidden", requestId: "staff-catalog", timestamp: "2026-10-22T00:00:00.000Z" } }, 403);
      const field = url.endsWith("/categories") ? "categories" : url.endsWith("/products") ? "products" : "optionGroups";
      return jsonResponse({ data: { [field]: [] }, meta: { requestId: "staff-catalog" } });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await readStaffCatalog();
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([
      "/pos/api/v1/admin/categories", "/pos/api/v1/admin/option-groups", "/pos/api/v1/admin/products",
    ]);
    expect(result).toMatchObject(failure ? { ok: false, error: { status: 403 } } : { ok: true, data: { categories: [], products: [], optionGroups: [], tables: [] } });
  });
});

describe("POS API session recovery", () => {
  it("refreshes an expired access session and retries the protected request", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(authenticationError, 401))
      .mockResolvedValueOnce(jsonResponse(authenticatedUser))
      .mockResolvedValueOnce(jsonResponse(waiterCalls));
    vi.stubGlobal("fetch", fetch);

    await expect(readWaiterCalls()).resolves.toMatchObject({ ok: true, data: [] });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/pos/api/v1/waiter-calls",
      "/pos/api/v1/auth/refresh",
      "/pos/api/v1/waiter-calls",
    ]);
  });

  it("shares one refresh across simultaneous polling failures", async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/refresh")) {
        await refreshGate;
        return jsonResponse(authenticatedUser);
      }
      const waiterRequestCount = fetch.mock.calls.filter(([calledUrl]) =>
        String(calledUrl).endsWith("/waiter-calls"),
      ).length;
      return waiterRequestCount <= 2
        ? jsonResponse(authenticationError, 401)
        : jsonResponse(waiterCalls);
    });
    vi.stubGlobal("fetch", fetch);

    const first = readWaiterCalls();
    const second = readWaiterCalls();
    await vi.waitFor(() => {
      expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(1);
    });
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { ok: true, data: [] },
      { ok: true, data: [] },
    ]);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(1);
  });
});


describe("bar ticket acknowledgment transport", () => {
  it("sends exact preparation ID as JSON to the authenticated POS route", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ data: { acknowledged: true }, meta: { requestId: "ack" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await acknowledgeBarTicket("order", "11111111-1111-4111-8111-111111111111")).toMatchObject({ ok: true });
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe("/pos/api/v1/orders/order/bar-ticket/acknowledge");
    expect(options.method).toBe("POST");
    expect(options.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ preparationId: "11111111-1111-4111-8111-111111111111" });
  });
});


describe("terminal errors stay in the payment dialog", () => {
  it("does not broadcast preparation or reconciliation conflicts to automatic page recovery", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ error: {
      code: "INVALID_STATE", message: "This terminal or order already has an unresolved attempt.",
      requestId: "terminal-conflict", timestamp: "2026-11-02T12:24:30.000Z",
    } }, 409));
    vi.stubGlobal("fetch", fetch);
    expect(await terminalPrepare("order", {} as Parameters<typeof terminalPrepare>[1], "checkout-key")).toMatchObject({ ok: false, error: { status: 409, code: "INVALID_STATE" } });
    expect(await terminalReconcile("attempt", {} as Parameters<typeof terminalReconcile>[1])).toMatchObject({ ok: false, error: { status: 409 } });
    expect(dispatchEvent.mock.calls.filter(([event]) => event.type === posApiFailureEvent)).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("ends a stalled terminal request without broadcasting recovery or retrying the payment", async () => {
    vi.useFakeTimers();
    try {
      const dispatchEvent = vi.fn(); vi.stubGlobal("window", { dispatchEvent });
      const fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }));
      vi.stubGlobal("fetch", fetch);
      const pending = terminalPrepare("order", {} as Parameters<typeof terminalPrepare>[1], "checkout-key");
      await vi.advanceTimersByTimeAsync(15000);
      expect(await pending).toMatchObject({ ok: false, error: { kind: "network" } });
      expect(fetch).toHaveBeenCalledTimes(1); expect(dispatchEvent).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
