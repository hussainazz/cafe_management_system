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
): MenuCategory[] {
  const normalizedQuery = normalizeSearch(query);

  return menu.categories
    .filter((category) => categoryId === null || category.id === categoryId)
    .map((category) => ({
      ...category,
      products: category.products.filter((product) => {
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

export function localProductPictureUrl(product: Pick<MenuProduct, "name">) {
  const name = normalizeSearch(product.name);

  if (name.includes("آمریکانو")) return "/items/آمریکانو.webp";
  if (name === "لاته" || name === "آیس لاته") return "/items/لته_.webp";
  if (name === "کارامل ماکیاتو" || name === "آیس کارامل ماکیاتو") {
    return "/items/آیس_کارامل.webp";
  }
  if (name === "آب پرتقال") return "/items/آب_پرتقال.webp";
  if (name === "رد مون") return "/items/ردمون.webp";
  if (name === "دمنوش بابونه") return "/items/دمنوش_بابونه.webp";
  if (name === "کره بادوم زمینی") return "/items/تست_کره_بادم.webp";
  if (name.startsWith("چای ")) return "/items/چای.webp";

  return null;
}

export function categoryTone(category: MenuCategory) {
  const key = `${category.nameEn ?? ""} ${category.name}`.toLowerCase();
  if (/special|new|ویژه|جدید/.test(key)) return "special";
  if (/dessert|sweet|cake|دسر|شیرینی|کیک/.test(key)) return "dessert";
  if (/toast|panini|chips|sandwich|تست|پنینی|چیپس|ساندویچ/.test(key)) return "food";
  if (
    /coffee|brew|tea|herbal|drink|juice|mocktail|smooth|frappe|shake|matcha|add-on|قهوه|دمی|چای|دمنوش|نوشیدنی|آبمیوه|ماکتل|اسموتی|فراپه|شیک|ماچا|افزودنی/.test(
      key,
    )
  ) {
    return "drink";
  }
  return "food";
}
