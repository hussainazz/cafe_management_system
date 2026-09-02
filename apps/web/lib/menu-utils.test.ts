import { describe, expect, it } from "vitest";
import type { PublicMenu } from "./menu-types";
import {
  categoryTone,
  filterMenu,
  formatCompactToman,
  formatToman,
  localProductPictureUrl,
  normalizeSearch,
} from "./menu-utils";

const menu: PublicMenu = {
  categories: [
    {
      id: "coffee",
      name: "قهوه",
      nameEn: "Coffee",
      products: [
        {
          id: "latte",
          name: "لاته",
          nameEn: "Latte",
          basePriceAmount: 135_000,
          finalPriceAmount: 135_000,
          saleDiscount: null,
          isAvailable: true,
          image: null,
          optionGroups: [],
        },
        {
          id: "mocha",
          name: "موکا",
          nameEn: "Mocha",
          basePriceAmount: 150_000,
          finalPriceAmount: 150_000,
          saleDiscount: null,
          isAvailable: false,
          image: null,
          optionGroups: [],
        },
      ],
    },
  ],
};

describe("menu utilities", () => {
  it("normalizes Arabic Persian variants for search", () => {
    expect(normalizeSearch("  كيك ي  ")).toBe("کیک ی");
  });

  it("searches both languages and filters by category", () => {
    expect(filterMenu(menu, "latte", null)[0]?.products.map(({ id }) => id)).toEqual([
      "latte",
    ]);
    expect(filterMenu(menu, "موكا", null)[0]?.products.map(({ id }) => id)).toEqual([
      "mocha",
    ]);
    expect(filterMenu(menu, "", "coffee")[0]?.products.map(({ id }) => id)).toEqual([
      "latte",
      "mocha",
    ]);
  });

  it("formats the API's integer Toman values without conversion", () => {
    expect(formatToman(135_000, "en")).toBe("135,000");
  });

  it("formats menu prices in thousands without grouping separators", () => {
    expect(formatCompactToman(165_000, "en")).toBe("165");
    expect(formatCompactToman(165_000, "fa")).toBe("۱۶۵");
  });

  it("uses consistent icon groups for menu categories", () => {
    const category = (name: string) => ({ ...menu.categories[0]!, name, nameEn: null });

    expect(categoryTone(category("ویژه و جدید"))).toBe("special");
    expect(categoryTone(category("ماچا بار"))).toBe("drink");
    expect(categoryTone(category("بار گرم قهوه"))).toBe("drink");
    expect(categoryTone(category("دسر"))).toBe("dessert");
    expect(categoryTone(category("پنینی"))).toBe("food");
  });

  it("maps supplied local pictures only to their matching menu products", () => {
    expect(localProductPictureUrl({ name: "آمریکانو سینگل" })).toBe(
      "/items_pictures/americano-single.webp",
    );
    expect(localProductPictureUrl({ name: "آیس آمریکانو دبل" })).toBe(
      "/items_pictures/ice americano.webp",
    );
    expect(localProductPictureUrl({ name: "لاته" })).toBe("/items_pictures/لته_.webp");
    expect(localProductPictureUrl({ name: "آیس لاته" })).toBe(
      "/items_pictures/ice latte.webp",
    );
    expect(localProductPictureUrl({ name: "آیس کارامل ماکیاتو" })).toBe(
      "/items_pictures/ice-caramel.webp",
    );
    expect(localProductPictureUrl({ name: "کارامل ماکیاتو" })).toBe(
      "/items_pictures/white-espresso.webp",
    );
    expect(localProductPictureUrl({ name: "آیس اورنج" })).toBeNull();
    expect(localProductPictureUrl({ name: "چای هل و زغفران" })).toBe(
      "/items_pictures/چای.webp",
    );
    expect(localProductPictureUrl({ name: "چای ماسالا" })).toBe(
      "/items_pictures/masala.webp",
    );
    expect(localProductPictureUrl({ name: "ماچا لته" })).toBeNull();
    expect(localProductPictureUrl({ name: "کروسان ویژه" })).toBeNull();
    expect(localProductPictureUrl({ name: "دمنوش بابونه" })).toBe(
      "/items_pictures/دمنوش_بابونه.webp",
    );
    expect(localProductPictureUrl({ name: "Aeropress" })).toBe(
      "/items_pictures/aeropress.webp",
    );
    expect(localProductPictureUrl({ name: "تست ژامبون" })).toBe(
      "/items_pictures/ham-toast.webp",
    );
    expect(localProductPictureUrl({ name: "نسکافه" }, { name: "بار گرم قهوه" })).toBe(
      "/items_pictures/nescafe.webp",
    );
    expect(localProductPictureUrl({ name: "نسکافه" }, { name: "شیک" })).toBeNull();
  });
});
