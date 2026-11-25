import { describe, expect, it } from "vitest";
import { bundledProductImageUrl, uploadedProductImageUrl } from "@cafe/contracts";
import { catalogProductImageUrl } from "./catalog-image";

describe("catalogProductImageUrl", () => {
  it("prefers the API image when the catalog has one", () => {
    const storageKey = "00000000-0000-4000-8000-000000000001.webp";
    expect(catalogProductImageUrl({ name: "ترک", image: { storageKey } }, "قهوه"))
      .toBe(uploadedProductImageUrl(storageKey));
  });

  it("uses the public-menu local mapping when the API image is absent", () => {
    expect(catalogProductImageUrl({ name: "ترک", image: null }, "قهوه")).toBe(bundledProductImageUrl("items_pictures/turkish.webp"));
  });

  it("keeps category-specific mappings scoped", () => {
    expect(catalogProductImageUrl({ name: "نسکافه", image: null }, "بار گرم قهوه")).toBe(bundledProductImageUrl("items_pictures/nescafe.webp"));
    expect(catalogProductImageUrl({ name: "نسکافه", image: null }, "شیک")).toBeNull();
  });
});
