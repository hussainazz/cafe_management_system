import { describe, expect, it } from "vitest";
import type { PublicMenu } from "./menu-types";
import {
  categoryTone,
  filterMenu,
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

  it("uses consistent icon groups for menu categories", () => {
    const category = (name: string) => ({ ...menu.categories[0]!, name, nameEn: null });

    expect(categoryTone(category("ویژه و جدید"))).toBe("special");
    expect(categoryTone(category("ماچا بار"))).toBe("drink");
    expect(categoryTone(category("بار گرم قهوه"))).toBe("drink");
    expect(categoryTone(category("دسر"))).toBe("dessert");
    expect(categoryTone(category("پنینی"))).toBe("food");
  });

  it("maps supplied local pictures to matching and reusable product variants", () => {
    expect(localProductPictureUrl({ name: "آمریکانو سینگل" })).toBe(
      "/items/آمریکانو.webp",
    );
    expect(localProductPictureUrl({ name: "آیس آمریکانو دبل" })).toBe(
      "/items/آمریکانو.webp",
    );
    expect(localProductPictureUrl({ name: "لاته" })).toBe("/items/لته_.webp");
    expect(localProductPictureUrl({ name: "آیس لاته" })).toBe("/items/لته_.webp");
    expect(localProductPictureUrl({ name: "ماچا لته" })).toBeNull();
    expect(localProductPictureUrl({ name: "دمنوش بابونه" })).toBe(
      "/items/دمنوش_بابونه.webp",
    );
  });
});
