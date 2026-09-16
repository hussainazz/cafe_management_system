type CatalogProduct = { name: string; image?: { storageKey: string } | null };

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase("fa").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[\u064B-\u065F\u0670]/g, "").replace(/\s+/g, " ");
}

const pictures: Record<string, string> = {
  "آمریکانو سینگل": "americano-single.webp", "آمریکانو دبل": "americano_double.webp",
  "آیس آمریکانو سینگل": "ice americano.webp", "آیس آمریکانو دبل": "ice americano.webp",
  "آیس اسپرسو سینگل": "ice-espresso.webp", "آیس اسپرسو دبل": "ice-espresso.webp",
  "لاته": "لته_.webp", "آیس لاته": "ice latte.webp", "آیس کارامل ماکیاتو": "ice-caramel.webp",
  "آیس موکا": "ice-mocha.webp", "آیس چاکلت فندق": "ice-chocolate.webp", "آیس اورنج": "ice-orange.webp",
  "تونیک اسپرسو": "tonic-espresso.webp", "کارامل ماکیاتو": "white-espresso.webp",
  "اسپرسو سینگل": "espresso-single.webp", "اسپرسو دبل": "espresso.webp", "ترک": "turkish.webp",
  "کورتادو": "cortado.webp", "چای هل و زغفران": "چای.webp", "آب پرتقال": "آب_پرتقال.webp",
  "هندونه": "watermellon.webp", "هندوانه": "watermellon.webp", "طالبی": "honeydew melon.webp",
  "رد مون": "ردمون.webp", "منگوبری": "mangoberry.webp", "دمنوش بابونه": "دمنوش_بابونه.webp",
  "کاپوچینو": "catpuccino.webp", "وایت اسپرسو": "white-espresso.webp", "وایت چاکلت": "white-choclote.webp",
  "هات چاکلت": "hot-chocolate.webp", "پینک چاکلت": "pink-chocolate.webp", "چای ماسالا": "masala.webp",
  "ایس تی هلو": "ice-tea-peach.webp", "گل گاو زبان": "gol-gav-zaban.webp", "aeropress": "aeropress.webp",
  "v 60": "v60.webp", "siphone": "siphone.webp", "چری بری": "cherry-berry.webp", "موز شکلات": "chocolate-shakes.webp",
  "بادام زمینی": "peanut-shakes.webp", "بادوم زمینی": "peanut-shakes.webp", "بادوم زمینی موز": "peanut-shakes.webp",
  "موز وانیل": "banana-vanilla-shake.webp", "پروتئین": "protein-shake.webp", "سیمیت پنیر گردو": "simmit.webp",
  "تست ژامبون": "ham-toast.webp", "کره بادوم زمینی": "peanutbutter-toast.webp", "تیرامیسو": "tiramisu.webp",
  "چیز کیک لوتوس": "luttos cheescake.webp", "چیزکیک انبه": "mango-cheesecake.webp", "کروسان شکلاتی": "crossant.webp",
  "چیز چیپس": "cheese-chips.webp", "هات چیپس": "hot-chips.webp",
};

export function catalogProductImageUrl(product: CatalogProduct, categoryName?: string | null): string | null {
  if (product.image?.storageKey) {
    return `/pos/api/v1/product-images/${encodeURIComponent(product.image.storageKey)}`;
  }
  const name = normalizeSearch(product.name);
  const category = normalizeSearch(categoryName ?? "");
  if (name === "نسکافه") return category === "بار گرم قهوه" ? "/items_pictures/nescafe.webp" : null;
  if (name === "شکلات") return category === "شیک" ? "/items_pictures/chocolate-shakes.webp" : null;
  const file = pictures[name];
  return file ? `/items_pictures/${encodeURIComponent(file)}` : null;
}
