import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MenuExperience } from "./menu-experience";
import type { PublicMenu } from "../lib/menu-types";

const menu: PublicMenu = {
  categories: [{
    id: "drinks",
    name: "نوشیدنی",
    nameEn: null,
    products: [
      {
        id: "manager-product",
        name: "قهوه مدیر",
        nameEn: null,
        menuNote: null,
        basePriceAmount: 100_000,
        finalPriceAmount: 100_000,
        saleDiscount: null,
        isAvailable: true,
        image: {
          storageKey: "123e4567-e89b-12d3-a456-426614174000.webp",
          altText: "قهوه مدیر",
        },
        optionGroups: [],
      },
      {
        id: "bundled-product",
        name: "آمریکانو سینگل",
        nameEn: null,
        menuNote: null,
        basePriceAmount: 80_000,
        finalPriceAmount: 80_000,
        saleDiscount: null,
        isAvailable: true,
        image: null,
        optionGroups: [],
      },
    ],
  }],
};

describe("menu image opening behavior", () => {
  it("renders the menu without starting image downloads outside the queue", () => {
    const markup = renderToStaticMarkup(createElement(MenuExperience, {
      initialMenu: menu,
      initialRequestFailed: false,
      invalidTableContext: false,
      initialTableContext: null,
    }));

    expect(markup).not.toContain("product-visual-image-main");
    expect(markup).not.toContain("menu-image-loading-screen");
    expect(markup).not.toContain("aria-busy=\"true\"");
    expect(markup).not.toContain("inert");
    expect(markup).toContain("قهوه مدیر");
    expect(markup).toContain("آمریکانو سینگل");
  });
});
