import type { PublicMenu } from "./menu-types";

const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

type MenuResult = { ok: true; menu: PublicMenu; requestId: string } | { ok: false; reason: string };

type BackendOption = { id: string; name: string; priceAmount: number; isAvailable: boolean };
type BackendProduct = {
  id: string;
  name: string;
  priceAmount: number;
  isAvailable: boolean;
  image: { storageKey: string; altText: string } | null;
  optionGroups: Array<{ id: string; name: string; options: BackendOption[] }>;
};
type BackendResponse = {
  data: { categories: Array<{ id: string; name: string; products: BackendProduct[] }> };
  meta: { requestId: string };
};

function isBackendResponse(value: unknown): value is BackendResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<BackendResponse>;
  return Boolean(
    response.data &&
    Array.isArray(response.data.categories) &&
    response.meta &&
    typeof response.meta.requestId === "string",
  );
}

function adaptMenu(response: BackendResponse): PublicMenu {
  return {
    categories: response.data.categories.map((category) => ({
      id: category.id,
      name: category.name,
      nameEn: null,
      products: category.products.map((product) => ({
        id: product.id,
        name: product.name,
        nameEn: null,
        basePriceAmount: product.priceAmount,
        finalPriceAmount: product.priceAmount,
        saleDiscount: null,
        isAvailable: product.isAvailable,
        image: product.image,
        optionGroups: product.optionGroups
          .map((group) => ({
            id: group.id,
            name: group.name,
            options: group.options
              .filter((option) => option.isAvailable)
              .map(({ id, name, priceAmount }) => ({ id, name, priceAmount })),
          }))
          .filter((group) => group.options.length > 0),
      })),
    })),
  };
}

export async function getPublicMenu(): Promise<MenuResult> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/public/menu`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) return { ok: false, reason: `API responded with ${response.status}` };

    const body: unknown = await response.json();
    if (!isBackendResponse(body)) {
      return { ok: false, reason: "API returned an invalid menu response" };
    }

    return { ok: true, menu: adaptMenu(body), requestId: body.meta.requestId };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Unknown menu error" };
  }
}
