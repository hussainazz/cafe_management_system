import { describe, expect, it } from "vitest";
import { bundledProductImageUrl, uploadedProductImageUrl } from "./product-media.js";

describe("canonical product media URLs", () => {
  it("uses one safe same-origin versioned URL for an uploaded image key", () => {
    expect(uploadedProductImageUrl("00000000-0000-4000-8000-000000000001.webp"))
      .toBe("/media/products/uploads/00000000-0000-4000-8000-000000000001.webp");
    expect(uploadedProductImageUrl("../private.png")).toBeNull();
    expect(uploadedProductImageUrl("not-a-uuid.webp")).toBeNull();
  });

  it("maps legacy bundled paths to content-hashed URLs and rejects unknown paths", () => {
    const url = bundledProductImageUrl("items_pictures/turkish.webp");
    expect(url).toMatch(/^\/media\/products\/bundled\/[a-f0-9]{64}\.webp$/);
    expect(bundledProductImageUrl("items_pictures/../secret.webp")).toBeNull();
    expect(bundledProductImageUrl("private/secret.webp")).toBeNull();
  });
});
