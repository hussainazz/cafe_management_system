// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogPanel } from "./catalog-panel";

const api = vi.hoisted(() => ({ savePromotionalCategoryProducts: vi.fn(), saveProduct: vi.fn() }));
vi.mock("../lib/api-client", () => ({
  archiveCategory: vi.fn(), archiveProduct: vi.fn(), archiveProductImage: vi.fn(),
  reorderCategories: vi.fn(), reorderProducts: vi.fn(), saveCategory: vi.fn(),
  savePromotionalCategoryProducts: api.savePromotionalCategoryProducts,
  saveOption: vi.fn(), saveOptionGroup: vi.fn(), saveProduct: api.saveProduct,
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
  it("selects a category's products and saves the memberships", async () => {
    renderCatalog([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "انتخاب همه محصولات قهوه" }));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.savePromotionalCategoryProducts).toHaveBeenCalledWith("promo", ["product-1"]));
  });

  it("closes the previous category editor and discards its draft when selection changes", () => {
    render(<CatalogPanel catalog={catalog} mutate={vi.fn()} reload={vi.fn()} requestConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "تغییر نام دسته" }));
    const editor = document.querySelector(".catalog-category-rename input") as HTMLInputElement;
    fireEvent.change(editor, { target: { value: "Unsaved rename" } });
    fireEvent.click(screen.getByRole("button", { name: catalog.categories[1].name }));
    expect(document.querySelector(".catalog-category-rename")).toBeNull();
    expect(screen.getByRole("button", { name: catalog.categories[0].name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: catalog.categories[0].name }));
    fireEvent.click(screen.getByRole("button", { name: "تغییر نام دسته" }));
    expect((document.querySelector(".catalog-category-rename input") as HTMLInputElement).value).toBe(catalog.categories[0].name);
  });

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


describe("Product editor tabs", () => {
  it("sends the public-menu visibility toggle when saving a product", async () => {
    api.saveProduct.mockResolvedValueOnce({ ok: true });
    const reload = vi.fn(async () => undefined);
    const mutate = vi.fn(async (action: () => Promise<unknown>, refresh: () => Promise<unknown>) => {
      await action();
      await refresh();
    });
    render(<CatalogPanel catalog={catalog} mutate={mutate} reload={reload} requestConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "قهوه" }));
    fireEvent.click(screen.getByRole("button", { name: /لاته.*50,000/ }));
    const visibility = screen.getByRole("checkbox", { name: /نمایش در منوی عمومی/ });
    expect((visibility as HTMLInputElement).checked).toBe(true);
    fireEvent.click(visibility);
    fireEvent.click(screen.getByRole("button", { name: "ذخیره مشخصات محصول" }));

    await waitFor(() => expect(api.saveProduct).toHaveBeenCalledWith("product-1", expect.objectContaining({ isPublic: false })));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps unsaved product fields when moving between tabs and supports arrow navigation", () => {
    render(<CatalogPanel catalog={catalog} mutate={vi.fn()} reload={vi.fn()} requestConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "قهوه" }));
    fireEvent.click(screen.getByRole("button", { name: /لاته.*50,000/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "نام" }), { target: { value: "لاته تازه" } });
    const options = screen.getByRole("tab", { name: "گزینه‌ها" });
    fireEvent.click(options);
    expect(screen.queryByRole("textbox", { name: "نام" })).toBeNull();
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("product-tab-options");
    fireEvent.keyDown(options, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "مشخصات" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByRole("textbox", { name: "نام" }) as HTMLInputElement).value).toBe("لاته تازه");
    const form = document.getElementById("catalog-product-form") as HTMLFormElement;
    expect(new FormData(form).get("name")).toBe("لاته تازه");
  });
});
