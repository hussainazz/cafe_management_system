import { describe, expect, it } from "vitest";
import { catalogProductImageUrl } from "./catalog-image";

describe("catalogProductImageUrl", () => {
  it("prefers the API image when the catalog has one", () => {
    expect(catalogProductImageUrl({ name: "ترک", image: { storageKey: "products/turk.webp" } }, "قهوه"))
      .toBe("/pos/api/v1/product-images/products%2Fturk.webp");
  });

  it("uses the public-menu local mapping when the API image is absent", () => {
    expect(catalogProductImageUrl({ name: "ترک", image: null }, "قهوه")).toBe("/items_pictures/turkish.webp");
  });

  it("keeps category-specific mappings scoped", () => {
    expect(catalogProductImageUrl({ name: "نسکافه", image: null }, "بار گرم قهوه")).toBe("/items_pictures/nescafe.webp");
    expect(catalogProductImageUrl({ name: "نسکافه", image: null }, "شیک")).toBeNull();
  });
});
