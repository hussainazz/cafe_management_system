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
  // Keep this list explicit: a product without a matching photograph should retain its artwork.
  // In particular, the tea photograph belongs only to black tea—not every tea variation.
  const pictures: Record<string, string> = {
    "آمریکانو سینگل": "/items_pictures/americano.webp",
    "آمریکانو دبل": "/items_pictures/americano.webp",
    "آیس آمریکانو سینگل": "/items_pictures/ice americano.webp",
    "آیس آمریکانو دبل": "/items_pictures/ice americano.webp",
    "لاته": "/items_pictures/لته_.webp",
    "آیس لاته": "/items_pictures/ice latte.webp",
    "آیس کارامل ماکیاتو": "/items_pictures/ice carammel.webp",
    "اسپرسو سینگل": "/items_pictures/espresso.webp",
    "اسپرسو دبل": "/items_pictures/espresso.webp",
    "ترک": "/items_pictures/turkish.webp",
    "چای": "/items_pictures/چای.webp",
    "چای سیاه": "/items_pictures/چای.webp",
    "آب پرتقال": "/items_pictures/آب_پرتقال.webp",
    "هندونه": "/items_pictures/watermellon.webp",
    "طالبی": "/items_pictures/honeydew melon.webp",
    "رد مون": "/items_pictures/ردمون.webp",
    "دمنوش بابونه": "/items_pictures/دمنوش_بابونه.webp",
    "کره بادوم زمینی": "/items_pictures/تست_کره_بادم.webp",
    "تیرامیسو": "/items_pictures/tiramisu.webp",
    "چیز کیک لوتوس": "/items_pictures/luttos cheescake.webp",
    "کروسان شکلاتی": "/items_pictures/crossant.webp",
    "کروسان نوتلا توت فرنگی": "/items_pictures/crossant.webp",
    "کروسان ویژه": "/items_pictures/crossant.webp",
  };

  return pictures[name] ?? null;
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
