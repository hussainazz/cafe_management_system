import { afterEach, describe, expect, it, vi } from "vitest";
import { readWaiterCalls } from "./api-client";

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
