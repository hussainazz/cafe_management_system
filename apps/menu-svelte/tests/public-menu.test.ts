import { describe, expect, it, vi } from "vitest";
import { getPublicMenu } from "../src/lib/server/public-menu.js";

const validPayload = {
  data: {
    categories: [
      {
        id: "6b16bb29-d6ef-4fd6-80f8-b5dbbd4d4862",
        name: "Hot drinks",
        products: [
          {
            id: "c46e186d-4854-49e4-8f5c-3b7a989f2508",
            name: "Espresso",
            menuNote: null,
            basePriceAmount: 85_000,
            priceAmount: 85_000,
            saleDiscount: null,
            isAvailable: true,
            image: null,
            optionGroups: [],
          },
        ],
      },
    ],
  },
  meta: { requestId: "request-test" },
};

describe("getPublicMenu", () => {
  it("loads and validates the shared public-menu response", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(validPayload));

    const result = await getPublicMenu("https://api.example.test/", fetcher);

    expect(result).toEqual({
      ok: true,
      categories: validPayload.data.categories,
      requestId: "request-test",
    });
    if (result.ok) {
      expect(result.categories[0]?.products[0]).toMatchObject({
        name: "Espresso",
        priceAmount: 85_000,
      });
    }
    expect(JSON.stringify(result)).not.toContain("api.example.test");
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://api.example.test/api/v1/public/menu"),
      expect.objectContaining({
        cache: "no-store",
        headers: { accept: "application/json" },
      }),
    );
  });

  it("returns a controlled result when API_BASE_URL is missing or invalid", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();

    expect(await getPublicMenu(undefined, fetcher)).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(await getPublicMenu("file:///etc", fetcher)).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("handles HTTP and network failures without exposing internal details", async () => {
    const failedStatus = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const failedNetwork = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error("private host detail"));

    expect(await getPublicMenu("http://127.0.0.1:3001", failedStatus)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await getPublicMenu("http://127.0.0.1:3001", failedNetwork)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("reports request timeouts", async () => {
    const timeout = Object.assign(new Error("deadline"), { name: "TimeoutError" });
    const fetcher = vi.fn<typeof globalThis.fetch>().mockRejectedValue(timeout);

    expect(await getPublicMenu("http://127.0.0.1:3001", fetcher)).toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  it("rejects invalid API response shapes", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ data: { categories: [] } }));
    const malformedJson = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("{", { headers: { "content-type": "application/json" } }));

    expect(await getPublicMenu("http://127.0.0.1:3001", fetcher)).toEqual({
      ok: false,
      reason: "invalid_response",
    });
    expect(await getPublicMenu("http://127.0.0.1:3001", malformedJson)).toEqual({
      ok: false,
      reason: "invalid_response",
    });
  });
});
