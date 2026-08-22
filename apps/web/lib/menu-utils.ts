import type { MenuCategory, MenuProduct, PublicMenu } from "./menu-types";

export type Language = "fa" | "en";

export function normalizeSearch(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("fa")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ");
}

export function filterMenu(
  menu: PublicMenu,
  query: string,
  categoryId: string | null,
  availableOnly: boolean,
): MenuCategory[] {
  const normalizedQuery = normalizeSearch(query);

  return menu.categories
    .filter((category) => categoryId === null || category.id === categoryId)
    .map((category) => ({
      ...category,
      products: category.products.filter((product) => {
        if (availableOnly && !product.isAvailable) return false;
        if (!normalizedQuery) return true;
        return normalizeSearch(`${product.name} ${product.nameEn ?? ""}`).includes(normalizedQuery);
      }),
    }))
    .filter((category) => category.products.length > 0);
}

export function menuProductCount(menu: PublicMenu) {
  return menu.categories.reduce((total, category) => total + category.products.length, 0);
}

export function localizedName(
  item: Pick<MenuProduct | MenuCategory, "name" | "nameEn">,
  language: Language,
) {
  return language === "en" && item.nameEn ? item.nameEn : item.name;
}

export function secondaryName(
  item: Pick<MenuProduct | MenuCategory, "name" | "nameEn">,
  language: Language,
) {
  if (!item.nameEn) return null;
  return language === "en" ? item.name : item.nameEn;
}

export function formatToman(amount: number, language: Language) {
  return new Intl.NumberFormat(language === "fa" ? "fa-IR" : "en-US").format(amount);
}

export function productImageUrl(storageKey: string) {
  const configuredBase = process.env.NEXT_PUBLIC_PRODUCT_IMAGE_BASE_URL?.replace(/\/$/, "");
  const safePath = storageKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${configuredBase ?? "/product-images"}/${safePath}`;
}

export function categoryTone(category: MenuCategory) {
  const key = `${category.nameEn ?? ""} ${category.name}`.toLowerCase();
  if (/coffee|brew|قهوه|دم/.test(key)) return "coffee";
  if (/tea|herbal|چای|دمنوش/.test(key)) return "tea";
  if (/juice|mocktail|smooth|frappe|shake|آبمیوه|ماکتل|اسموتی|فراپه|شیک/.test(key)) {
    return "cold";
  }
  if (/cake|brunch|کیک|صبحانه/.test(key)) return "sweet";
  return "food";
}
