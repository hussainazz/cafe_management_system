import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const key = "00000000-0000-4000-8000-000000000001.webp";
const params = Promise.resolve({ storageKey: key });
const request = new Request(`http://localhost/media/products/uploads/${key}`);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("canonical uploaded product image proxy", () => {
  it("streams a validated public image with the 30-day immutable policy", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, {
      headers: {
        "content-type": "image/webp",
        "content-length": String(bytes.length),
        etag: '"uuid-version"',
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request, { params });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=2592000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain(`/api/v1/media/products/uploads/${key}`);
    expect(options?.cache).toBe("no-store");
    expect(options?.redirect).toBe("manual");
  });

  it("does not cache invalid keys, errors, redirects, or unexpected content", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/pos" } }))
      .mockResolvedValueOnce(new Response("private response", { status: 200, headers: { "content-type": "text/plain" } }));
    vi.stubGlobal("fetch", fetchMock);

    const invalid = await GET(request, { params: Promise.resolve({ storageKey: "../secret.png" }) });
    const missing = await GET(request, { params });
    const redirect = await GET(request, { params });
    const invalidType = await GET(request, { params });

    for (const response of [invalid, missing, redirect, invalidType]) {
      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    }
    expect(invalid.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(redirect.status).toBe(502);
    expect(invalidType.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
