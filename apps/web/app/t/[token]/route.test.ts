import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());

describe("table QR web entrypoint", () => {
  it("forwards the context cookie and redirects a valid token to the shared menu", async () => {
    const token = "a".repeat(43);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { tableName: "1" } }), {
          status: 200,
          headers: { "set-cookie": "cafe_table_context=signed; HttpOnly; Path=/; SameSite=Lax" },
        }),
      ),
    );

    const response = await GET(new Request(`https://runncafe.ir/t/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/menu");
    expect(response.headers.get("set-cookie")).toContain("cafe_table_context=signed");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/public/table-context/exchange"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ token }) }),
    );
  });

  it("redirects an invalid token to the usable menu with a warning marker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "TABLE_CONTEXT_INVALID" } }), {
          status: 401,
          headers: { "set-cookie": "cafe_table_context=; HttpOnly; Path=/; Max-Age=0" },
        }),
      ),
    );
    const token = "b".repeat(43);
    const response = await GET(new Request(`https://runncafe.ir/t/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/menu?table-context=invalid");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("clears an older context when a malformed token is rejected before the API handler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR" } }), {
          status: 400,
        }),
      ),
    );
    const response = await GET(new Request("https://runncafe.ir/t/bad"), {
      params: Promise.resolve({ token: "bad" }),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/menu?table-context=invalid");
    expect(response.headers.get("set-cookie")).toContain("cafe_table_context=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
