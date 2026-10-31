import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("bundled product image cache policy", () => {
  it("keeps immutable uploaded image URLs separate and caches bundled pictures for a day", async () => {
    const rules = await nextConfig.headers?.();
    const rule = rules?.find((entry) => entry.source === "/items_pictures/:path*");

    expect(rule?.headers).toContainEqual({
      key: "Cache-Control",
      value: "public, max-age=86400, stale-while-revalidate=604800",
    });
  });
});
