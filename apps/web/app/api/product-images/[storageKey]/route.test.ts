import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const key = "00000000-0000-4000-8000-000000000001.png";
const params = Promise.resolve({ storageKey: key });

function request(storageKey = key) {
  return new Request(`http://localhost/api/product-images/${storageKey}`);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public product image proxy", () => {
  it("streams exact image bytes and preserves safe metadata with immutable caching", async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const upstream = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    }), {
      headers: {
        "content-type": "image/png",
        "content-length": String(bytes.length),
        etag: '"image-v1"',
        "last-modified": "Fri, 30 Oct 2026 12:00:00 GMT",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(), { params });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("etag")).toBe('"image-v1"');
    expect(response.headers.get("last-modified")).toBe("Fri, 30 Oct 2026 12:00:00 GMT");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    const urlText = url instanceof Request ? url.url : url instanceof URL ? url.href : url;
    expect(urlText).toContain(`/api/v1/product-images/${key}`);
    expect(options?.cache).toBe("no-store");
    expect(options?.headers).toEqual({ accept: "image/*", "accept-encoding": "identity" });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not cache invalid keys or upstream not-found responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const invalid = await GET(request("not-a-uuid.png"), { params: Promise.resolve({ storageKey: "not-a-uuid.png" }) });
    expect(invalid.status).toBe(404);
    expect(invalid.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();

    const missing = await GET(request(), { params });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(await missing.text()).toBe("");
  });

  it("maps unexpected upstream statuses and invalid representations to uncached gateway errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("upstream details", { status: 500 }))
      .mockResolvedValueOnce(new Response("not an image", { status: 200, headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const failed = await GET(request(), { params });
    expect(failed.status).toBe(502);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(await failed.text()).toBe("");

    const invalid = await GET(request(), { params });
    expect(invalid.status).toBe(502);
    expect(invalid.headers.get("cache-control")).toBe("no-store");

    const empty = await GET(request(), { params });
    expect(empty.status).toBe(502);
    expect(empty.headers.get("cache-control")).toBe("no-store");
  });

  it("returns an uncached service-unavailable response when fetch fails", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("connection refused"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET(request(), { params });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns an uncached gateway timeout when upstream headers do not arrive", async () => {
    vi.useFakeTimers();
    const fetchMock: typeof fetch = (_url, options) => new Promise<Response>((_resolve, reject) => {
      const signal = options?.signal;
      signal?.addEventListener("abort", () => {
        reject(new Error("fetch aborted"));
      }, { once: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = GET(request(), { params });
    await vi.advanceTimersByTimeAsync(8_000);
    const response = await pending;

    expect(response.status).toBe(504);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("times out a stalled body before returning a successful response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    }), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const pending = GET(request(), { params });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8_000);
    const response = await pending;

    expect(response.status).toBe(504);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("interrupts a body that stalls after streaming has started", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
      },
      pull() {
        return new Promise<void>(() => undefined);
      },
    }), {
      headers: { "content-type": "image/png", "content-length": "6" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET(request(), { params });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected a streamed image body");
    await expect(reader.read()).resolves.toMatchObject({ done: false, value: Uint8Array.from([1, 2, 3]) });
    const stalledRead = reader.read();
    const stalledError = expect(stalledRead).rejects.toThrow("Upstream image request timed out");
    await vi.advanceTimersByTimeAsync(8_000);
    await stalledError;
    await reader.cancel().catch(() => undefined);
  });

  it("propagates interrupted body streams instead of reporting a complete image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
      },
      pull() {
        throw new Error("connection reset");
      },
    }), {
      headers: { "content-type": "image/png", "content-length": "6" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET(request(), { params });
    await expect(response.arrayBuffer()).rejects.toThrow("connection reset");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("6");
  });

  it("detects an upstream body shorter than its declared content length", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
        controller.close();
      },
    }), {
      headers: { "content-type": "image/png", "content-length": "6" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET(request(), { params });
    await expect(response.arrayBuffer()).rejects.toThrow("Upstream image length mismatch");
  });
});
