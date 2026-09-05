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

export function formatCompactToman(amount: number, language: Language) {
  return new Intl.NumberFormat(language === "fa" ? "fa-IR" : "en-US", {
    useGrouping: false,
    maximumFractionDigits: 2,
  }).format(amount / 1_000);
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

export function localProductPictureUrl(
  product: Pick<MenuProduct, "name">,
  category?: Pick<MenuCategory, "name">,
) {
  const name = normalizeSearch(product.name);
  const categoryName = normalizeSearch(category?.name ?? "");
  // Keep this list explicit: a product without a matching photograph should retain its artwork.
  // In particular, the tea photograph belongs only to black tea—not every tea variation.
  const pictures: Record<string, string> = {
    "آمریکانو سینگل": "/items_pictures/americano-single.webp",
    "آمریکانو دبل": "/items_pictures/americano_double.webp",
    "آیس آمریکانو سینگل": "/items_pictures/ice americano.webp",
    "آیس آمریکانو دبل": "/items_pictures/ice americano.webp",
    "آیس اسپرسو سینگل": "/items_pictures/ice-espresso.webp",
    "آیس اسپرسو دبل": "/items_pictures/ice-espresso.webp",
    "لاته": "/items_pictures/لته_.webp",
    "آیس لاته": "/items_pictures/ice latte.webp",
    "آیس کارامل ماکیاتو": "/items_pictures/ice-caramel.webp",
    "آیس موکا": "/items_pictures/ice-mocha.webp",
    "آیس چاکلت فندق": "/items_pictures/ice-chocolate.webp",
    "کارامل ماکیاتو": "/items_pictures/white-espresso.webp",
    "اسپرسو سینگل": "/items_pictures/espresso-single.webp",
    "اسپرسو دبل": "/items_pictures/espresso.webp",
    "ترک": "/items_pictures/turkish.webp",
    "کورتادو": "/items_pictures/cortado.webp",
    "چای هل و زغفران": "/items_pictures/چای.webp",
    "آب پرتقال": "/items_pictures/آب_پرتقال.webp",
    "هندونه": "/items_pictures/watermellon.webp",
    "هندوانه": "/items_pictures/watermellon.webp",
    "طالبی": "/items_pictures/honeydew melon.webp",
    "رد مون": "/items_pictures/ردمون.webp",
    "منگوبری": "/items_pictures/mangoberry.webp",
    "دمنوش بابونه": "/items_pictures/دمنوش_بابونه.webp",
    "کاپوچینو": "/items_pictures/catpuccino.webp",
    "وایت اسپرسو": "/items_pictures/white-espresso.webp",
    "وایت چاکلت": "/items_pictures/white-choclote.webp",
    "هات چاکلت": "/items_pictures/hot-chocolate.webp",
    "پینک چاکلت": "/items_pictures/pink-chocolate.webp",
    "چای ماسالا": "/items_pictures/masala.webp",
    "aeropress": "/items_pictures/aeropress.webp",
    "v 60": "/items_pictures/v60.webp",
    "siphone": "/items_pictures/siphone.webp",
    "چری بری": "/items_pictures/cherry-berry.webp",
    "موز شکلات": "/items_pictures/chocolate-shakes.webp",
    "بادام زمینی": "/items_pictures/peanut-shakes.webp",
    "بادوم زمینی": "/items_pictures/peanut-shakes.webp",
    "بادوم زمینی موز": "/items_pictures/peanut-shakes.webp",
    "سیمیت پنیر گردو": "/items_pictures/simmit.webp",
    "تست ژامبون": "/items_pictures/ham-toast.webp",
    "کره بادوم زمینی": "/items_pictures/peanutbutter-toast.webp",
    "تیرامیسو": "/items_pictures/tiramisu.webp",
    "چیز کیک لوتوس": "/items_pictures/luttos cheescake.webp",
    "چیزکیک انبه": "/items_pictures/mango-cheesecake.webp",
    "کروسان شکلاتی": "/items_pictures/crossant.webp",
    "چیز چیپس": "/items_pictures/cheese-chips.webp",
    "هات چیپس": "/items_pictures/hot-chips.webp",
  };

  // Nescafe exists in both the hot-coffee bar and shake bar; this photo is the hot drink.
  if (name === "نسکافه") {
    return categoryName === "بار گرم قهوه" ? "/items_pictures/nescafe.webp" : null;
  }

  // The chocolate photograph belongs to the shake, not the same-named toast.
  if (name === "شکلات") {
    return categoryName === "شیک" ? "/items_pictures/chocolate-shakes.webp" : null;
  }

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
