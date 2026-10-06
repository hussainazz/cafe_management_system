// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogPanel } from "./catalog-panel";

const api = vi.hoisted(() => ({ savePromotionalCategoryProducts: vi.fn() }));
vi.mock("../lib/api-client", () => ({
  archiveCategory: vi.fn(), archiveProduct: vi.fn(), archiveProductImage: vi.fn(),
  reorderCategories: vi.fn(), reorderProducts: vi.fn(), saveCategory: vi.fn(),
  savePromotionalCategoryProducts: api.savePromotionalCategoryProducts,
  saveOption: vi.fn(), saveOptionGroup: vi.fn(), saveProduct: vi.fn(),
  saveProductSaleDiscount: vi.fn(), uploadProductImage: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const catalog = {
  categories: [
    { id: "promo", name: "ویژه", kind: "PROMOTIONAL", productIds: [], displayOrder: 1, isActive: true, isPosVisible: false, archivedAt: null },
    { id: "source", name: "قهوه", kind: "SOURCE", productIds: [], displayOrder: 2, isActive: true, isPosVisible: true, archivedAt: null },
  ],
  products: [
    { id: "product-1", categoryId: "source", name: "لاته", priceAmount: 50_000, pricingMode: "FIXED", saleDiscountKind: null, saleDiscountValue: null, isPublic: true, systemKey: null, isAvailable: true, isActive: true, image: null, optionGroups: [] },
  ],
  optionGroups: [],
  tables: [],
} as any;

function renderCatalog(productIds: string[]) {
  const reload = vi.fn(async () => undefined);
  const mutate = vi.fn(async (action: () => Promise<unknown>, refresh: () => Promise<unknown>) => {
    await action();
    await refresh();
  });
  render(<CatalogPanel catalog={{ ...catalog, categories: catalog.categories.map((category: any) => category.id === "promo" ? { ...category, productIds } : category) }} mutate={mutate} reload={reload} requestConfirm={vi.fn()} />);
  fireEvent.click(screen.getAllByRole("button", { name: "افزودن محصول از دسته‌ها" })[0]!);
  return { reload, mutate };
}

describe("Manager promotional product picker", () => {
  it("saves a selected source product as a promotional membership", async () => {
    const { reload, mutate } = renderCatalog([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "لاته" }));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => expect(api.savePromotionalCategoryProducts).toHaveBeenCalledWith("promo", ["product-1"]));
    expect(mutate).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes an existing membership while keeping the picker selection synchronized", async () => {
    const { reload } = renderCatalog(["product-1"]);
    expect((screen.getByRole("checkbox", { name: "لاته" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "لاته" }));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => expect(api.savePromotionalCategoryProducts).toHaveBeenCalledWith("promo", []));
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
