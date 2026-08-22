import { describe, expect, it } from "vitest";
import type { PublicMenu } from "./menu-types";
import { filterMenu, formatToman, normalizeSearch } from "./menu-utils";

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
          preparationDeadlineMinutes: 8,
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
          preparationDeadlineMinutes: 8,
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

  it("searches both languages and applies availability", () => {
    expect(filterMenu(menu, "latte", null, false)[0]?.products.map(({ id }) => id)).toEqual([
      "latte",
    ]);
    expect(filterMenu(menu, "موكا", null, false)[0]?.products.map(({ id }) => id)).toEqual([
      "mocha",
    ]);
    expect(filterMenu(menu, "", null, true)[0]?.products.map(({ id }) => id)).toEqual(["latte"]);
  });

  it("formats the API's integer Toman values without conversion", () => {
    expect(formatToman(135_000, "en")).toBe("135,000");
  });
});
