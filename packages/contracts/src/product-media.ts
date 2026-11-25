import { BUNDLED_PRODUCT_IMAGE_URLS } from "./product-media-assets.generated.js";

const uploadKeyPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|png|webp)$/i;

export function uploadedProductImageUrl(storageKey: string): string | null {
  if (!uploadKeyPattern.test(storageKey)) return null;
  return `/media/products/uploads/${encodeURIComponent(storageKey)}`;
}

export function bundledProductImageUrl(sourcePath: string): string | null {
  const normalized = sourcePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return BUNDLED_PRODUCT_IMAGE_URLS[normalized] ?? null;
}
