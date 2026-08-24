import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DiscountKind } from "../../generated/prisma/client.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("public QR menu", () => {
  it("returns only public current menu fields without requiring a session", async () => {
    const category = await app.prisma.category.create({ data: { name: "قهوه", displayOrder: 1 } });
    const optionGroup = await app.prisma.optionGroup.create({ data: { name: "دانه قهوه" } });
    const product = await app.prisma.product.create({
      data: {
        categoryId: category.id, name: "لاته", priceAmount: 250_000,
        saleDiscountKind: DiscountKind.PERCENTAGE, saleDiscountValue: 20,
        preparationDeadlineMinutes: 8, displayOrder: 1, isAvailable: false,
        image: { create: { storageKey: "products/latte.webp", altText: "لاته" } },
        productOptionGroups: { create: { optionGroupId: optionGroup.id, displayOrder: 1 } },
      },
    });
    await app.prisma.option.createMany({
      data: [
        { optionGroupId: optionGroup.id, name: "۱۰۰ عربیکا", priceAmount: 0, displayOrder: 1 },
        { optionGroupId: optionGroup.id, name: "ناموجود", priceAmount: 10_000, displayOrder: 2, isAvailable: false },
      ],
    });
    const hiddenCategory = await app.prisma.category.create({ data: { name: "پنهان", displayOrder: 2, isActive: false } });
    await app.prisma.product.create({ data: { categoryId: hiddenCategory.id, name: "نباید نمایش داده شود", priceAmount: 1, preparationDeadlineMinutes: 1, displayOrder: 1 } });

    const response = await app.inject({ method: "GET", url: "/api/v1/public/menu" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.categories).toEqual([{
      id: category.id, name: "قهوه", products: [{
        id: product.id, name: "لاته", priceAmount: 200_000,
        isAvailable: false, image: { storageKey: "products/latte.webp", altText: "لاته" },
        optionGroups: [{ id: optionGroup.id, name: "دانه قهوه", options: [
          { id: expect.any(String), name: "۱۰۰ عربیکا", priceAmount: 0, isAvailable: true },
          { id: expect.any(String), name: "ناموجود", priceAmount: 10_000, isAvailable: false },
        ] }],
      }],
    }]);
    expect(response.body).not.toContain("saleDiscount");
    expect(response.body).not.toContain("preparationDeadlineMinutes");
    expect(response.body).not.toContain("displayOrder");
    expect(response.body).not.toContain("archivedAt");
  });

  it("validates search and category filters and returns a safe product detail", async () => {
    const coffee = await app.prisma.category.create({ data: { name: "Coffee", displayOrder: 1 } });
    const tea = await app.prisma.category.create({ data: { name: "Tea", displayOrder: 2 } });
    const latte = await app.prisma.product.create({ data: { categoryId: coffee.id, name: "Latte", priceAmount: 150_000, preparationDeadlineMinutes: 5, displayOrder: 1 } });
    await app.prisma.product.create({ data: { categoryId: tea.id, name: "Tea", priceAmount: 80_000, preparationDeadlineMinutes: 4, displayOrder: 1 } });

    const search = await app.inject({ method: "GET", url: "/api/v1/public/menu?q=latte" });
    expect(search.statusCode).toBe(200);
    expect(search.json().data.categories).toHaveLength(1);
    expect(search.json().data.categories[0].products[0].id).toBe(latte.id);
    const filter = await app.inject({ method: "GET", url: `/api/v1/public/menu?categoryId=${tea.id}` });
    expect(filter.json().data.categories).toHaveLength(1);
    expect(filter.json().data.categories[0].id).toBe(tea.id);
    expect((await app.inject({ method: "GET", url: "/api/v1/public/menu?q=" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/v1/public/products/${latte.id}` })).json().data).toMatchObject({ id: latte.id, name: "Latte", priceAmount: 150_000 });
  });
});
