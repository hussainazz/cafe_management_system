// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryWorkspace } from "./inventory-workspace";
import * as api from "../lib/api-client";

vi.mock("../lib/api-client", () => ({
  archiveInventoryRecipe: vi.fn(), archiveInventoryStockItem: vi.fn(), createInventoryCount: vi.fn(),
  createInventoryPurchase: vi.fn(), previewProductCosting: vi.fn(), postInventoryCount: vi.fn(),
  postInventoryPurchase: vi.fn(), readGrossProfitReport: vi.fn(), readInventoryCounts: vi.fn(),
  readInventoryMovements: vi.fn(), readInventoryPurchases: vi.fn(), readInventoryRecipes: vi.fn(),
  readInventoryStockItems: vi.fn(), readPendingInventoryConsumption: vi.fn(), readProductCosting: vi.fn(), readSalesChannelReport: vi.fn(), readSalesAnalyticsReport: vi.fn(),
  returnInventoryPurchase: vi.fn(), saveInventoryRecipe: vi.fn(), saveInventoryStockItem: vi.fn(),
  saveProductCosting: vi.fn(), updateInventoryCount: vi.fn(), updateInventoryPurchase: vi.fn(),
}));

const stock = {
  id: "stock-1", name: "قهوه", category: "مواد اولیه", baseUnit: "GRAM", isPackagingMaterial: false, isActive: true,
  archivedAt: null, version: 1, conversions: [],
  balance: { quantityOnHand: "100", carryingValueAmount: 20_000, movingAverageCostPerBaseUnit: "200", trackingStartedAt: "2026-10-13T08:00:00.000Z" },
  createdAt: "2026-10-13T08:00:00.000Z", updatedAt: "2026-10-13T08:00:00.000Z",
};
const ok = (data: unknown) => ({ ok: true, data });
const catalog = { categories: [], products: [], optionGroups: [], options: [] } as never;

function list(data: unknown, key: string) { const page = { limit: 20, nextCursor: null, hasMore: false }; return ok({ data: { [key]: data, page }, meta: { requestId: "test", page } }); }

function chooseInventoryOption(label: string, name: string) {
  const picker = screen.getByRole("combobox", { name: label });
  fireEvent.change(picker, { target: { value: name } });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([], "stockItems") as never);
  vi.mocked(api.readInventoryPurchases).mockResolvedValue(list([], "purchases") as never);
  vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([], "recipes") as never);
  vi.mocked(api.readInventoryCounts).mockResolvedValue(list([], "counts") as never);
  vi.mocked(api.readInventoryMovements).mockResolvedValue(list([], "movements") as never);
  vi.mocked(api.readPendingInventoryConsumption).mockResolvedValue(list([], "consumptions") as never);
  vi.mocked(api.readGrossProfitReport).mockResolvedValue({ ok: false, error: { kind: "response", message: "گزارشی برای نمایش نیست" } } as never);
  vi.mocked(api.readSalesChannelReport).mockResolvedValue(ok({ data: {
    orderDistribution: { totalCount: 0, takeawayCount: 0, dineInCount: 0, takeawayPercent: null, dineInPercent: null },
    averageOrderValue: { takeawayAmount: null, dineInAmount: null, absoluteDifferenceAmount: null, differencePercent: null },
    revenue: { totalAmount: 0, takeawayAmount: 0, dineInAmount: 0, takeawayPercent: null, dineInPercent: null },
    takeawayOrigin: { directTakeawayCount: 0, tableOriginatedTakeawayCount: 0, directTakeawayRevenueAmount: 0, tableOriginatedTakeawayRevenueAmount: 0 },
    unclassifiedHistoricalOrigin: { count: 0, revenueAmount: 0 },
  }, meta: { requestId: "test", range: { from: "2026-11-10T20:30:00.000Z", to: "2026-11-11T20:30:00.000Z" } } }) as never);
  vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: null }) as never);
  vi.mocked(api.saveInventoryStockItem).mockResolvedValue(ok(stock) as never);
  vi.mocked(api.createInventoryCount).mockResolvedValue(ok({ id: "count-1" }) as never);
});

afterEach(() => cleanup());

it("searches purchase items with Persian keyboard variants and submits ungrouped prices and decimal weights", async () => {
  const anotherStock = { ...stock, id: "stock-2", name: "کیک شکلاتی" };
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock, anotherStock], "stockItems") as never);
  vi.mocked(api.createInventoryPurchase).mockResolvedValue(ok({ data: {} }) as never);
  const user = userEvent.setup();
  render(<InventoryWorkspace catalog={catalog} />);
  const picker = await screen.findByRole("combobox", { name: "کالا" });
  expect((picker as HTMLInputElement).value).toBe("");
  fireEvent.change(picker, { target: { value: "كيك" } });
  expect(screen.getByRole("option", { name: anotherStock.name })).toBeTruthy();
  fireEvent.keyDown(picker, { key: "ArrowDown" });
  fireEvent.keyDown(picker, { key: "Enter" });
  expect((picker as HTMLInputElement).value).toBe(anotherStock.name);
  const amount = screen.getByLabelText("هزینه‌ی مستقیم (تومان)") as HTMLInputElement;
  fireEvent.change(amount, { target: { value: "1,5" } });
  expect(amount.value).toBe("1,5");
  expect(amount.validity.patternMismatch).toBe(true);
  await user.clear(amount);
  await user.type(amount, "1234567");
  expect(amount.value).toBe("1,234,567");
  await user.keyboard("{Home}{ArrowRight}{Delete}");
  expect(amount.selectionStart).toBe(2);
  await user.keyboard("9");
  expect(amount.value).toBe("19,234,567");
  const quantity = screen.getByLabelText("مقدار خرید (گرم)") as HTMLInputElement;
  fireEvent.change(quantity, { target: { value: "۱۲٬۳۴۵٫۶۷۸۹۰۱" } });
  expect(quantity.value).toBe("12,345.678901");
  await user.click(screen.getByRole("button", { name: "ایجاد پیش‌نویس خرید" }));
  await waitFor(() => expect(api.createInventoryPurchase).toHaveBeenCalledWith(expect.objectContaining({
    lines: [expect.objectContaining({ stockItemId: anotherStock.id, directCostAmount: 19234567, purchaseQuantity: "12345.678901" })],
  })));
});

it("uses the reference package size and price as defaults for a new purchase", async () => {
  const configuredStock = {
    ...stock,
    referencePurchase: { conversionId: "kg-conversion", conversionLabel: "کیلوگرم", packageQuantity: "2", baseQuantityPerPack: "1000", priceAmount: 400_000 },
    conversions: [{ id: "kg-conversion", label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }],
  };
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([configuredStock], "stockItems") as never);
  vi.mocked(api.createInventoryPurchase).mockResolvedValue(ok({ data: {} }) as never);
  render(<InventoryWorkspace catalog={catalog} />);
  const quantity = await screen.findByLabelText("مقدار خرید (کیلوگرم)") as HTMLInputElement;
  const cost = screen.getByLabelText("هزینه‌ی مستقیم (تومان)") as HTMLInputElement;
  expect(quantity.value).toBe("2");
  expect(cost.value).toBe("400,000");
  fireEvent.click(screen.getByRole("button", { name: "ایجاد پیش‌نویس خرید" }));
  await waitFor(() => expect(api.createInventoryPurchase).toHaveBeenCalledWith(expect.objectContaining({
    lines: [expect.objectContaining({ stockItemId: stock.id, conversionId: "kg-conversion", purchaseUnitLabel: "کیلوگرم", purchaseQuantity: "2", directCostAmount: 400_000 })],
  })));
});

it("keeps a draft receipt's saved unit snapshot selected after its stock conversion changes", async () => {
  const updatedStock = {
    ...stock,
    referencePurchase: { conversionId: "kg-conversion", conversionLabel: "sack", packageQuantity: "1", baseQuantityPerPack: "2000", priceAmount: 500_000 },
    conversions: [{ id: "kg-conversion", label: "sack", baseQuantityPerPack: "2000", isActive: true }],
  };
  const draft = {
    id: "purchase-draft-1", status: "DRAFT", receivedAt: "2026-11-24T08:00:00.000Z", supplier: "Old supplier", version: 1, postedAt: null,
    lines: [{ id: "purchase-line-1", stockItemId: stock.id, conversionId: "kg-conversion", purchaseUnitLabel: "kg", purchaseQuantity: "2", directCostAmount: 400_000, baseQuantityPerPack: "1000", baseQuantityReceived: "2000" }],
  };
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([updatedStock], "stockItems") as never);
  vi.mocked(api.readInventoryPurchases).mockResolvedValue(list([draft], "purchases") as never);
  vi.mocked(api.updateInventoryPurchase).mockResolvedValue(ok({ data: draft }) as never);
  render(<InventoryWorkspace catalog={catalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "ویرایش پیش‌نویس" }));
  const unit = await screen.findByLabelText("واحد خرید") as HTMLSelectElement;
  expect(unit.value).toBe("snapshot:kg-conversion");
  expect(unit.selectedOptions[0]?.textContent).toContain("ثبت‌شده");
  fireEvent.change(screen.getByLabelText("تأمین‌کننده (اختیاری)"), { target: { value: "Updated supplier" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره پیش‌نویس" }));
  await waitFor(() => expect(api.updateInventoryPurchase).toHaveBeenCalledWith(draft.id, expect.objectContaining({
    supplier: "Updated supplier",
    lines: [{ id: "purchase-line-1", stockItemId: stock.id, conversionId: "kg-conversion", purchaseUnitLabel: "kg", purchaseQuantity: "2", directCostAmount: 400_000 }],
  })));
});

it("marks an explicit switch from a saved draft unit to the current conversion", async () => {
  const updatedStock = {
    ...stock,
    referencePurchase: { conversionId: "kg-conversion", conversionLabel: "kg", packageQuantity: "1", baseQuantityPerPack: "2000", priceAmount: 500_000 },
    conversions: [{ id: "kg-conversion", label: "kg", baseQuantityPerPack: "2000", isActive: true }],
  };
  const draft = {
    id: "purchase-draft-2", status: "DRAFT", receivedAt: "2026-11-24T08:00:00.000Z", supplier: "Old supplier", version: 1, postedAt: null,
    lines: [{ id: "purchase-line-2", stockItemId: stock.id, conversionId: "kg-conversion", purchaseUnitLabel: "kg", purchaseQuantity: "2", directCostAmount: 400_000, baseQuantityPerPack: "1000", baseQuantityReceived: "2000" }],
  };
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([updatedStock], "stockItems") as never);
  vi.mocked(api.readInventoryPurchases).mockResolvedValue(list([draft], "purchases") as never);
  vi.mocked(api.updateInventoryPurchase).mockResolvedValue(ok({ data: draft }) as never);
  render(<InventoryWorkspace catalog={catalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "ویرایش پیش‌نویس" }));
  const unit = await screen.findByLabelText("واحد خرید") as HTMLSelectElement;
  expect(unit.value).toBe("snapshot:kg-conversion");
  fireEvent.change(unit, { target: { value: "" } });
  fireEvent.change(unit, { target: { value: "kg-conversion" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره پیش‌نویس" }));
  await waitFor(() => expect(api.updateInventoryPurchase).toHaveBeenCalledWith(draft.id, expect.objectContaining({
    lines: [expect.objectContaining({ id: "purchase-line-2", conversionId: "kg-conversion", purchaseUnitLabel: "kg", useCurrentConversion: true })],
  })));
});

it("keeps a replacement purchase row on the current conversion after unit changes", async () => {
  const updatedStock = {
    ...stock,
    referencePurchase: { conversionId: "kg-conversion", conversionLabel: "kg", packageQuantity: "1", baseQuantityPerPack: "2000", priceAmount: 500_000 },
    conversions: [{ id: "kg-conversion", label: "kg", baseQuantityPerPack: "2000", isActive: true }],
  };
  const draft = {
    id: "purchase-draft-3", status: "DRAFT", receivedAt: "2026-11-24T08:00:00.000Z", supplier: "Old supplier", version: 1, postedAt: null,
    lines: [{ id: "purchase-line-3", stockItemId: stock.id, conversionId: "kg-conversion", purchaseUnitLabel: "kg", purchaseQuantity: "1", directCostAmount: 400_000, baseQuantityPerPack: "1000", baseQuantityReceived: "1000" }],
  };
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([updatedStock], "stockItems") as never);
  vi.mocked(api.readInventoryPurchases).mockResolvedValue(list([draft], "purchases") as never);
  vi.mocked(api.updateInventoryPurchase).mockResolvedValue(ok({ data: draft }) as never);
  render(<InventoryWorkspace catalog={catalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "ویرایش پیش‌نویس" }));
  fireEvent.click(screen.getByRole("button", { name: "افزودن ردیف کالا" }));
  const units = screen.getAllByLabelText("واحد خرید") as HTMLSelectElement[];
  fireEvent.change(units[1]!, { target: { value: "" } });
  fireEvent.change(units[1]!, { target: { value: "kg-conversion" } });
  fireEvent.click(screen.getAllByRole("button", { name: "حذف ردیف" })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "ذخیره پیش‌نویس" }));
  await waitFor(() => expect(api.updateInventoryPurchase).toHaveBeenCalledWith(draft.id, expect.objectContaining({
    lines: [{ stockItemId: stock.id, conversionId: "kg-conversion", purchaseUnitLabel: "kg", purchaseQuantity: "1", directCostAmount: 500_000, useCurrentConversion: true }],
  })));
});

it("moves matching count rows up without changing selected quantities or marking the draft dirty", async () => {
  const anotherStock = { ...stock, id: "milk", name: "شیر" };
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock, anotherStock], "stockItems") as never);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "شمارش انبار" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "جست‌وجوی قلم برای شمارش" }), { target: { value: "شير" } });
    expect(screen.getByRole("checkbox", { name: "شمارش شیر" })).toHaveProperty("checked", true);
    expect(screen.queryByRole("checkbox", { name: "شمارش قهوه" })).toBeNull();
    expect(screen.getAllByRole("group", { name: /قهوه|شیر/ })[0]).toBe(screen.getByRole("group", { name: "شیر" }));
    expect(screen.getByRole("group", { name: "قهوه" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "گردش موجودی" }));
    expect(confirm).not.toHaveBeenCalled();
  } finally { confirm.mockRestore(); }
});

it("applies Persian order numbers and clears the query when the movement filter changes", async () => {
  render(<InventoryWorkspace catalog={catalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "گردش موجودی" }));
  const method = screen.getByLabelText("جست‌وجو بر اساس");
  fireEvent.change(method, { target: { value: "ORDER_NUMBER" } });
  fireEvent.change(screen.getByRole("searchbox", { name: "شماره‌ی سفارش" }), { target: { value: "#۱۲۳۴" } });
  fireEvent.click(screen.getByRole("button", { name: "اعمال فیلترها" }));
  await waitFor(() => expect(api.readInventoryMovements).toHaveBeenLastCalledWith({ limit: "20", searchBy: "ORDER_NUMBER", search: "1234" }));
  fireEvent.change(method, { target: { value: "KIND" } });
  fireEvent.click(screen.getByRole("button", { name: "اعمال فیلترها" }));
  await waitFor(() => expect(api.readInventoryMovements).toHaveBeenLastCalledWith({ limit: "20" }));
});

it("takes a new operator from a missing purchase prerequisite to the stock form without writing data", async () => {
  render(<InventoryWorkspace catalog={catalog} />);
  await screen.findByText("ابتدا کالای خرید را تعریف کنید");
  fireEvent.click(screen.getByRole("button", { name: "تعریف کالای خرید" }));
  await screen.findByText("هنوز کالای فعالی ثبت نشده است.");
  fireEvent.click(screen.getByRole("button", { name: "تعریف اولین کالای انبار" }));
  expect(document.activeElement).toBe(screen.getByLabelText("نام کالا"));
  expect(api.createInventoryPurchase).not.toHaveBeenCalled();
  expect(api.saveInventoryStockItem).not.toHaveBeenCalled();
});

it("keeps optional help navigation behind the existing unsaved draft guard", async () => {
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.change(await screen.findByLabelText("تأمین‌کننده (اختیاری)"), { target: { value: "خرید جاری" } });
    fireEvent.click(screen.getByText("راهنمای ثبت خرید"));
    fireEvent.click(screen.getByRole("button", { name: "رفتن به اقلام موجودی" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("تأمین‌کننده (اختیاری)") as HTMLInputElement).value).toBe("خرید جاری");
    expect(api.createInventoryPurchase).not.toHaveBeenCalled();
  } finally { confirm.mockRestore(); }
});

it("distinguishes a first purchase from an empty filtered search and clears the applied search", async () => {
  render(<InventoryWorkspace catalog={catalog} />);
  await screen.findByText("هنوز خریدی ثبت نشده است");
  fireEvent.change(screen.getByLabelText("جست‌وجو در تأمین‌کننده یا کالا"), { target: { value: "نام ناموجود" } });
  fireEvent.click(screen.getByRole("button", { name: "اعمال فیلترها" }));
  await screen.findByText("خریدی با این فیلترها پیدا نشد.");
  fireEvent.click(screen.getByRole("button", { name: "نمایش همه‌ی خریدها" }));
  await screen.findByText("هنوز خریدی ثبت نشده است");
  expect((screen.getByLabelText("جست‌وجو در تأمین‌کننده یا کالا") as HTMLInputElement).value).toBe("");
  expect(api.readInventoryPurchases).toHaveBeenLastCalledWith({ limit: 20 });
});

it("shows and retries a failed stock prerequisite on purchases instead of suggesting an empty inventory", async () => {
  vi.mocked(api.readInventoryStockItems).mockResolvedValueOnce({ ok: false, error: { kind: "response", code: "SERVICE_UNAVAILABLE", message: "Database unavailable" } } as never);
  render(<InventoryWorkspace catalog={catalog} />);
  await screen.findByRole("alert");
  expect(screen.queryByText("برای ثبت خرید، ابتدا یک قلم فعال به موجودی اضافه کنید.")).toBeNull();
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
  fireEvent.click(screen.getByRole("button", { name: "بارگذاری دوباره" }));
  await screen.findByLabelText("مقدار خرید (گرم)");
  expect(api.createInventoryPurchase).not.toHaveBeenCalled();
});

it("keeps an unsaved purchase when section navigation is cancelled", async () => {
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    render(<InventoryWorkspace catalog={catalog} />);
    const supplier = await screen.findByLabelText("تأمین‌کننده (اختیاری)");
    fireEvent.change(supplier, { target: { value: "خرید ذخیره‌نشده" } });
    fireEvent.click(screen.getByRole("button", { name: "اقلام موجودی" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("تأمین‌کننده (اختیاری)") as HTMLInputElement).value).toBe("خرید ذخیره‌نشده");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "اقلام موجودی" }));
    await screen.findByRole("region", { name: "جدول اقلام موجودی" });
    expect(api.createInventoryPurchase).not.toHaveBeenCalled();
  } finally { confirm.mockRestore(); }
});

it("filters zero stock separately from uninitialized stock and makes movement history keyboard focusable", async () => {
  const zero = { ...stock, balance: { ...stock.balance, quantityOnHand: "0.000000", carryingValueAmount: 0 } };
  const unknown = { ...stock, id: "unknown", name: "شیر", balance: { ...stock.balance, quantityOnHand: null, carryingValueAmount: null, trackingStartedAt: null } };
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([zero, unknown], "stockItems") as never);
  render(<InventoryWorkspace catalog={catalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
  fireEvent.change(screen.getByLabelText("وضعیت موجودی"), { target: { value: "empty" } });
  const table = screen.getByRole("table");
  expect(within(table).queryByRole("rowheader", { name: /شیر/ })).toBeNull();
  expect(within(table).getByRole("rowheader", { name: /قهوه/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("وضعیت موجودی"), { target: { value: "untracked" } });
  expect(within(table).getByRole("rowheader", { name: /شیر/ })).toBeTruthy();
  fireEvent.click(within(table).getByRole("button", { name: "ویرایش شیر" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("نام کالا")));
  fireEvent.click(screen.getByRole("button", { name: "گردش موجودی" }));
  const region = await screen.findByRole("region", { name: "جدول گردش موجودی" });
  expect(region.tabIndex).toBe(0);
});

it("prevents duplicate recipe previews and ignores a result for a previously selected product", async () => {
  const recipeCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [] }, { id: "product-2", name: "لاته", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [] }], optionGroups: [], categories: [], options: [] } as never;
  vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: { mode: "RECIPE", recipeId: "r", version: 1, optionRecipes: [], optionRules: [], combinations: [] } }) as never);
  let finish!: (value: any) => void;
  vi.mocked(api.previewProductCosting).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<InventoryWorkspace catalog={recipeCatalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  const preview = await screen.findByRole("button", { name: "محاسبه‌ی هزینه‌ی مواد اصلی محصول" });
  fireEvent.click(preview);
  fireEvent.click(preview);
  expect(api.previewProductCosting).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "در حال محاسبه‌ی هزینه…" }).hasAttribute("disabled")).toBe(true);
  chooseInventoryOption("محصول منو", "لاته");
  await waitFor(() => expect(api.readProductCosting).toHaveBeenLastCalledWith("product-2"));
  await act(async () => { finish(ok({ data: { isComplete: true, knownCostAmount: 987654, components: [], missingReasons: [] } })); });
  expect(screen.queryByText(/987,654/)).toBeNull();
});

it("does not offer a destructive configuration reload for recipe validation errors", async () => {
  const recipeCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [] }], optionGroups: [], categories: [], options: [] } as never;
  render(<InventoryWorkspace catalog={recipeCatalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  const save = await screen.findByRole("button", { name: "ذخیره‌ی دستورهای تهیه" });
  fireEvent.submit(save.closest("form")!);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "بارگذاری تنظیم هزینه" })).toBeNull();
  expect(api.saveInventoryRecipe).not.toHaveBeenCalled();
});

describe("InventoryWorkspace", () => {
  it("counts only the selected item without changing an unrelated item", async () => {
    const other = { ...stock, id: "stock-2", name: "شیر" };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock, other], "stockItems") as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "شمارش انبار" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "شمارش شیر" }));
    fireEvent.change(screen.getByLabelText("مقدار گرم"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("دلیل اختلاف موجودی (برای کل شمارش)"), { target: { value: "کسری در شمارش فیزیکی" } });
    fireEvent.click(screen.getByRole("button", { name: "ایجاد پیش‌نویس شمارش" }));
    await waitFor(() => expect(api.createInventoryCount).toHaveBeenCalledWith({ lines: [{ stockItemId: stock.id, observedQuantity: "80", observedValueAmount: 20000 }], reason: "کسری در شمارش فیزیکی", kind: "PHYSICAL" }));
  });
  it("blocks costing edits after a configuration read fails and allows a read retry", async () => {
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [{ optionGroupId: "group-1", options: [{ optionId: "option-1" }] }] }], optionGroups: [{ id: "group-1", name: "اندازه", options: [{ id: "option-1", name: "دبل", isActive: true, archivedAt: null }] }], categories: [], options: [] } as never;
    vi.mocked(api.readProductCosting).mockResolvedValue({ ok: false, error: { kind: "response", code: "SERVICE_UNAVAILABLE", message: "Database unavailable", requestId: "costing-read-123" } } as never);
    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    expect((await screen.findByRole("alert")).textContent).toContain("costing-read-123");
    expect(screen.queryByLabelText("روش محاسبه")).toBeNull();
    vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: null }) as never);
    fireEvent.click(screen.getByRole("button", { name: "بارگذاری تنظیم هزینه" }));
    await screen.findByLabelText("مقدار");
    expect(api.saveProductCosting).not.toHaveBeenCalled();
  });
  it("allows only one inventory write while a request is pending and releases the form after failure", async () => {
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    let finish!: (value: any) => void;
    vi.mocked(api.createInventoryPurchase).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "خریدها" }));
    const submit = screen.getByRole("button", { name: "ایجاد پیش‌نویس خرید" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.createInventoryPurchase).toHaveBeenCalledTimes(1);
    finish({ ok: false, error: { kind: "response", code: "SERVICE_UNAVAILABLE", message: "Database unavailable" } });
    await screen.findByRole("alert");
    fireEvent.click(submit);
    expect(api.createInventoryPurchase).toHaveBeenCalledTimes(2);
    finish({ ok: false, error: { kind: "response", message: "تعذر ثبت" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("تعذر ثبت"));
  });
  it("shows field details and the request ID while retaining an unsuccessful purchase draft", async () => {
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.createInventoryPurchase).mockResolvedValue({ ok: false, error: { kind: "response", status: 422, code: "BUSINESS_RULE_VIOLATION", message: "The converted purchase quantity must fit the supported range and be exact to six decimal places.", requestId: "purchase-error-123", details: [{ path: "lines.0.purchaseQuantity", code: "quantity_precision", message: "Use an exact quantity." }] } } as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "خریدها" }));
    fireEvent.change(screen.getByLabelText("مقدار خرید (گرم)"), { target: { value: "0.123456" } });
    fireEvent.click(screen.getByRole("button", { name: "ایجاد پیش‌نویس خرید" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("مقدار خرید (ردیف 1)");
    expect(alert.textContent).toContain("purchase-error-123");
    expect(alert.textContent).not.toContain("converted purchase");
    expect((screen.getByLabelText("مقدار خرید (گرم)") as HTMLInputElement).value).toBe("0.123456");
  });

  it("keeps a history read failure in the history panel and retries reads without repeating writes", async () => {
    vi.mocked(api.readInventoryMovements).mockResolvedValue({ ok: false, error: { kind: "response", code: "SERVICE_UNAVAILABLE", message: "Database unavailable", requestId: "history-error-123" } } as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    await screen.findByRole("button", { name: "ثبت کالا" });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "گردش موجودی" }));
    expect((await screen.findByRole("alert")).textContent).toContain("history-error-123");
    vi.mocked(api.readInventoryMovements).mockResolvedValue(list([], "movements") as never);
    fireEvent.click(screen.getByRole("button", { name: "بارگذاری دوباره" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(api.createInventoryPurchase).not.toHaveBeenCalled();
  });
  it("blocks invalid unit conversions before sending a stock item", async () => {
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.change(screen.getByLabelText("نام کالا"), { target: { value: "قهوه تازه" } });
    fireEvent.change(screen.getByLabelText("مقدار هر بسته"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("قیمت هر بسته (تومان)"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("نام واحد خرید"), { target: { value: "کیسه" } });
    fireEvent.change(screen.getByLabelText("معادل یک واحد به گرم"), { target: { value: "یک کیلو" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت کالا" }));

    expect((await screen.findByRole("alert")).textContent).toContain("مقدار تبدیل");
    expect(api.saveInventoryStockItem).not.toHaveBeenCalled();
  });

  it("keeps a renamed reference conversion selected while editing an untracked stock item", async () => {
    const legacy = {
      ...stock,
      balance: { quantityOnHand: null, carryingValueAmount: null, movingAverageCostPerBaseUnit: null, trackingStartedAt: null },
      conversions: [{ id: "kg-conversion", label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }],
      referencePurchase: null,
    };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([legacy], "stockItems") as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.click(screen.getByRole("button", { name: "ویرایش قهوه" }));
    fireEvent.click(screen.getByText("تنظیم واحدهای خرید و تبدیل"));
    fireEvent.change(screen.getByLabelText("نام واحد خرید"), { target: { value: "کیسه" } });
    expect((screen.getByLabelText("واحد بسته") as HTMLSelectElement).value).toBe("کیسه");
    fireEvent.change(screen.getByLabelText("مقدار هر بسته"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("قیمت هر بسته (تومان)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
    await waitFor(() => expect(api.saveInventoryStockItem).toHaveBeenCalledWith(legacy.id, expect.objectContaining({
      referencePurchase: { conversionLabel: "کیسه", packageQuantity: "1", priceAmount: 100 },
      conversions: [{ id: "kg-conversion", label: "کیسه", baseQuantityPerPack: "1000", isActive: true }],
    })));
  });

  it("clears the selected named conversion before it can collide with the base-unit token", async () => {
    const legacy = {
      ...stock,
      balance: { quantityOnHand: null, carryingValueAmount: null, movingAverageCostPerBaseUnit: null, trackingStartedAt: null },
      conversions: [{ id: "kg-conversion", label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }],
      referencePurchase: { conversionId: "kg-conversion", conversionLabel: "کیلوگرم", packageQuantity: "2", baseQuantityPerPack: "1000", priceAmount: 400_000 },
    };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([legacy], "stockItems") as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.click(screen.getByRole("button", { name: "ویرایش قهوه" }));
    fireEvent.click(screen.getByText("تنظیم واحدهای خرید و تبدیل"));
    fireEvent.change(screen.getByLabelText("نام واحد خرید"), { target: { value: "GRAM" } });
    expect((screen.getByLabelText("واحد بسته") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("هزینه‌ی هر گرم").parentElement?.textContent).toContain("—");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
    expect((await screen.findByRole("alert")).textContent).toContain("نام واحد تبدیل");
    expect(api.saveInventoryStockItem).not.toHaveBeenCalled();
  });

  it("allows a zero opening balance after removing a selected package from an untracked legacy item", async () => {
    const legacy = {
      ...stock,
      isPackagingMaterial: true,
      balance: { quantityOnHand: null, carryingValueAmount: null, movingAverageCostPerBaseUnit: null, trackingStartedAt: null },
      conversions: [{ id: "old-pack", label: "جعبه", baseQuantityPerPack: "12", isActive: true }],
      referencePurchase: null,
    };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([legacy], "stockItems") as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.click(screen.getByRole("button", { name: "ویرایش قهوه" }));
    fireEvent.click(screen.getByText("تنظیم واحدهای خرید و تبدیل"));
    fireEvent.click(screen.getByRole("button", { name: "حذف واحد" }));
    expect((screen.getByLabelText("واحد بسته") as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
    await waitFor(() => expect(api.saveInventoryStockItem).toHaveBeenCalledWith(legacy.id, expect.objectContaining({
      isPackagingMaterial: true,
      openingStock: { method: "PACKAGE_COUNT", packageCount: 0, looseQuantity: "0" },
      conversions: [],
    })));
  });

  it("moves the base-unit package selection with an editable untracked item's base unit", async () => {
    const legacy = {
      ...stock,
      balance: { quantityOnHand: null, carryingValueAmount: null, movingAverageCostPerBaseUnit: null, trackingStartedAt: null },
      conversions: [],
      referencePurchase: null,
    };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([legacy], "stockItems") as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.click(screen.getByRole("button", { name: "ویرایش قهوه" }));
    fireEvent.change(screen.getByLabelText("واحد مبنا"), { target: { value: "PIECE" } });
    expect((screen.getByLabelText("واحد بسته") as HTMLSelectElement).value).toBe("PIECE");
  });

  it("allows unrelated edits to a legacy conversion that already used its base-unit token", async () => {
    const legacy = {
      ...stock,
      conversions: [{ id: "legacy-base-token", label: "GRAM", baseQuantityPerPack: "1000", isActive: true }],
      referencePurchase: null,
    };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([legacy], "stockItems") as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.click(screen.getByRole("button", { name: "ویرایش قهوه" }));
    fireEvent.change(screen.getByLabelText("حد هشدار موجودی (گرم) · اختیاری"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
    await waitFor(() => expect(api.saveInventoryStockItem).toHaveBeenCalledWith(legacy.id, expect.objectContaining({
      lowStockThreshold: "25",
      conversions: [{ id: "legacy-base-token", label: "GRAM", baseQuantityPerPack: "1000", isActive: true }],
    })));
  });

  it("keeps an oversized pasted package price from crashing preview arithmetic", async () => {
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.change(screen.getByLabelText("نام کالا"), { target: { value: "قهوه تازه" } });
    fireEvent.change(screen.getByLabelText("مقدار هر بسته"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("قیمت هر بسته (تومان)"), { target: { value: "9".repeat(310) } });
    expect(screen.getByText("هزینه‌ی هر گرم").parentElement?.textContent).toContain("—");
    fireEvent.click(screen.getByRole("button", { name: "ثبت کالا" }));
    expect((await screen.findByRole("alert")).textContent).toContain("اندازه، واحد و قیمت بسته‌ی خرید");
    expect(api.saveInventoryStockItem).not.toHaveBeenCalled();
  });

  it("creates a stock item with an exact fractional package conversion", async () => {
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.change(screen.getByLabelText("نام کالا"), { target: { value: "قهوه تازه" } });
    fireEvent.change(screen.getByLabelText("نام واحد خرید"), { target: { value: "بسته" } });
    fireEvent.change(screen.getByLabelText("معادل یک واحد به گرم"), { target: { value: "250.125" } });
    fireEvent.change(screen.getByLabelText("واحد بسته"), { target: { value: "بسته" } });
    fireEvent.change(screen.getByLabelText("مقدار هر بسته"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("قیمت هر بسته (تومان)"), { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت کالا" }));

    await waitFor(() => expect(api.saveInventoryStockItem).toHaveBeenCalledWith(null, expect.objectContaining({
      name: "قهوه تازه", baseUnit: "GRAM", referencePurchase: { conversionLabel: "بسته", packageQuantity: "1", priceAmount: 50000 },
      openingStock: { method: "PACKAGE_COUNT", packageCount: 0, looseQuantity: "0" },
      conversions: [{ label: "بسته", baseQuantityPerPack: "250.125", isActive: true }],
    })));
  });

  it("saves the packaging-material classification when creating a stock item", async () => {
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.change(screen.getByLabelText("نام کالا"), { target: { value: "لیوان کاغذی" } });
    fireEvent.change(screen.getByLabelText("واحد مبنا"), { target: { value: "PIECE" } });
    fireEvent.change(screen.getByLabelText("مقدار هر بسته"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("قیمت هر بسته (تومان)"), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /این کالا بسته‌بندی است/ }));
    fireEvent.click(screen.getByRole("button", { name: "ثبت کالا" }));
    await waitFor(() => expect(api.saveInventoryStockItem).toHaveBeenCalledWith(null, expect.objectContaining({ name: "لیوان کاغذی", isPackagingMaterial: true, referencePurchase: { conversionLabel: "PIECE", packageQuantity: "50", priceAmount: 100000 } })));
  });

  it("preserves opening quantity when switching between package and direct entry", async () => {
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.change(screen.getByLabelText("نام کالا"), { target: { value: "پودر هات چاکلت" } });
    fireEvent.change(screen.getByLabelText("مقدار هر بسته"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("قیمت هر بسته (تومان)"), { target: { value: "400000" } });
    fireEvent.change(screen.getByLabelText("تعداد بسته‌های کامل"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("مقدار باز (گرم)"), { target: { value: "300" } });
    expect(screen.getByText("هزینه‌ی هر گرم").parentElement?.textContent).toContain("۲۰۰");
    expect(screen.getByText("موجودی کل (گرم)").parentElement?.textContent).toContain("۶٬۳۰۰");
    expect(screen.getByText("ارزش موجودی برآوردی").parentElement?.textContent).toContain("۱,۲۶۰,۰۰۰");

    fireEvent.change(screen.getByLabelText("روش ثبت موجودی"), { target: { value: "TOTAL_QUANTITY" } });
    expect((screen.getByLabelText("مقدار کل (گرم)") as HTMLInputElement).value).toBe("6,300");
    fireEvent.change(screen.getByLabelText("روش ثبت موجودی"), { target: { value: "PACKAGE_COUNT" } });
    expect((screen.getByLabelText("تعداد بسته‌های کامل") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("مقدار باز (گرم)") as HTMLInputElement).value).toBe("300");

    fireEvent.click(screen.getByRole("button", { name: "ثبت کالا" }));
    await waitFor(() => expect(api.saveInventoryStockItem).toHaveBeenCalledWith(null, expect.objectContaining({
      openingStock: { method: "PACKAGE_COUNT", packageCount: 3, looseQuantity: "300" },
    })));
  });

  it("preserves a large direct total when its derived package count would exceed the safe integer range", async () => {
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.change(screen.getByLabelText("نام کالا"), { target: { value: "ریز بسته" } });
    fireEvent.change(screen.getByLabelText("نام واحد خرید"), { target: { value: "ریز" } });
    fireEvent.change(screen.getByLabelText("معادل یک واحد به گرم"), { target: { value: "0.000001" } });
    fireEvent.change(screen.getByLabelText("واحد بسته"), { target: { value: "ریز" } });
    fireEvent.change(screen.getByLabelText("مقدار هر بسته"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("قیمت هر بسته (تومان)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("روش ثبت موجودی"), { target: { value: "TOTAL_QUANTITY" } });
    fireEvent.change(screen.getByLabelText("مقدار کل (گرم)"), { target: { value: "10000000000" } });
    fireEvent.change(screen.getByLabelText("روش ثبت موجودی"), { target: { value: "PACKAGE_COUNT" } });
    expect((screen.getByLabelText("تعداد بسته‌های کامل") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("مقدار باز (گرم)") as HTMLInputElement).value).toBe("10,000,000,000");
    fireEvent.click(screen.getByRole("button", { name: "ثبت کالا" }));
    await waitFor(() => expect(api.saveInventoryStockItem).toHaveBeenCalledWith(null, expect.objectContaining({
      openingStock: { method: "PACKAGE_COUNT", packageCount: 0, looseQuantity: "10000000000" },
    })));
  });

  it("loads and updates an existing packaging-material classification", async () => {
    const packagingStock = { ...stock, isPackagingMaterial: true };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([packagingStock], "stockItems") as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.click(screen.getByRole("button", { name: "ویرایش قهوه" }));
    const checkbox = await screen.findByRole("checkbox", { name: /این کالا بسته‌بندی است/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
    await waitFor(() => expect(api.saveInventoryStockItem).toHaveBeenCalledWith(stock.id, expect.objectContaining({ isPackagingMaterial: false, expectedVersion: stock.version })));
  });

  it("shows an inline API validation error and retains the entered purchase quantity", async () => {
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.createInventoryPurchase).mockResolvedValue({ ok: false, error: { kind: "response", message: "مقدار مرجوعی بیش از خرید است." } } as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "خریدها" }));
    fireEvent.change(screen.getByLabelText("مقدار خرید (گرم)"), { target: { value: "0.75" } });
    fireEvent.click(screen.getByRole("button", { name: "ایجاد پیش‌نویس خرید" }));

    expect((await screen.findByRole("alert")).textContent).toContain("مقدار مرجوعی");
    expect((screen.getByLabelText("مقدار خرید (گرم)") as HTMLInputElement).value).toBe("0.75");
  });

  it("reviews a purchase receipt before posting and lets the Manager cancel", async () => {
    const draft = { id: "purchase-1", version: 1, status: "DRAFT", supplier: "تأمین‌کننده", receivedAt: "2026-10-13T08:00:00.000Z", lines: [{ id: "line-1", stockItemId: stock.id, baseQuantityReceived: "50", directCostAmount: 12_000 }] };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.readInventoryPurchases).mockResolvedValue(list([draft], "purchases") as never);
    vi.mocked(api.postInventoryPurchase).mockResolvedValue(ok({ ...draft, status: "POSTED" }) as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "خریدها" }));

    await screen.findByText("تأمین‌کننده");
    fireEvent.click(screen.getByRole("button", { name: "ثبت رسید در موجودی" }));
    const dialog = screen.getByRole("alertdialog", { name: "بررسی رسید خرید" });
    expect(dialog.textContent).toContain("50 گرم");
    expect(dialog.textContent).toContain("12,000");
    expect(api.postInventoryPurchase).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "بازگشت" }));
    expect(api.postInventoryPurchase).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "ثبت رسید در موجودی" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "ثبت رسید در موجودی" }));
    await waitFor(() => expect(api.postInventoryPurchase).toHaveBeenCalledWith("purchase-1", 1, expect.any(String)));
  });

  it("shows the count adjustments and absorbed order before posting", async () => {
    const draft = { id: "count-1", kind: "PHYSICAL", status: "DRAFT", version: 2, lines: [{ stockItemId: stock.id, observedQuantity: "99.5", observedValueAmount: 19_900, differenceQuantity: "-0.5" }] };
    const waiting = { id: "pending-1", orderNumber: "42", knownCogsAmount: 405, recognizedAt: "2026-10-13T08:00:00.000Z", isCostComplete: true, missingStockItemIds: [] };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.readInventoryCounts).mockResolvedValue(list([draft], "counts") as never);
    vi.mocked(api.readPendingInventoryConsumption).mockResolvedValue(list([waiting], "consumptions") as never);
    vi.mocked(api.postInventoryCount).mockResolvedValue(ok({ ...draft, status: "POSTED" }) as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "شمارش انبار" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /سفارش 42/ }));
    fireEvent.click(screen.getByRole("button", { name: "ثبت شمارش" }));

    const dialog = screen.getByRole("alertdialog", { name: "بررسی ثبت شمارش" });
    expect(dialog.textContent).toContain("اختلاف -0.5");
    expect(dialog.textContent).toContain("42");
    expect(api.postInventoryCount).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت شمارش در موجودی" }));
    await waitFor(() => expect(api.postInventoryCount).toHaveBeenCalledWith("count-1", { expectedVersion: 2, absorbedOrderConsumptionIds: ["pending-1"] }, expect.any(String)));
  });

  it("saves a reusable option recipe and links it to product costing", async () => {
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [{ optionGroupId: "group-1", options: [{ optionId: "option-1" }] }] }], optionGroups: [{ id: "group-1", name: "اندازه", options: [{ id: "option-1", name: "دبل", isActive: true, archivedAt: null }] }], categories: [], options: [] } as never;
    const savedRecipe = { id: "recipe-1", name: "اسپرسو دبل option-", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "component-1", label: "قهوه", sourceKind: "STOCK_ITEM", stockItemId: stock.id, quantity: "18" }] };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.saveInventoryRecipe).mockResolvedValue(ok({ data: savedRecipe }) as never);
    vi.mocked(api.saveProductCosting).mockResolvedValue(ok({ data: { mode: "RECIPE", recipeId: "recipe-1", optionRecipes: [{ optionId: "option-1", recipeId: "recipe-1", recipeQuantity: "1" }], optionRules: [], combinations: [], version: 1 } }) as never);
    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    fireEvent.change(await screen.findByLabelText("مقدار (گرم)"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
    await waitFor(() => expect(api.saveInventoryRecipe).toHaveBeenCalledWith(null, expect.objectContaining({
      ingredientName: "اسپرسو", components: [expect.objectContaining({ stockItemId: stock.id, quantity: "18" })],
    })));
    await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({
      mode: "RECIPE", optionRecipes: [{ optionId: "option-1", recipeId: "recipe-1", recipeQuantity: "1" }],
    })));
  });

  it("gives an optional no-additive selection its own base recipe instead of reusing the first option recipe", async () => {
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [{ optionGroupId: "group-1", minSelections: 0, options: [{ optionId: "option-1" }] }] }], optionGroups: [{ id: "group-1", name: "افزودنی", options: [{ id: "option-1", name: "دبل", isActive: true, archivedAt: null }] }], categories: [], options: [] } as never;
    const optionRecipe = { id: "existing-option-recipe", name: "Espresso double", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "coffee", label: "قهوه", sourceKind: "STOCK_ITEM", stockItemId: stock.id, nestedRecipeId: null, quantity: "20", displayOrder: 0 }] };
    const baseRecipe = { ...optionRecipe, id: "base-recipe", name: "Espresso base", components: [{ ...optionRecipe.components[0], quantity: "18" }] };
    const savedOptionRecipe = { ...optionRecipe, version: 2 };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([optionRecipe], "recipes") as never);
    vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: { mode: "RECIPE", recipeId: optionRecipe.id, recipeQuantity: "1", extrasRecipeId: null, servedAlongside: [], optionRecipes: [{ optionId: "option-1", recipeId: optionRecipe.id, recipeQuantity: "1" }], optionRules: [], combinations: [], version: 1 } }) as never);
    vi.mocked(api.saveInventoryRecipe).mockResolvedValueOnce(ok({ data: baseRecipe }) as never).mockResolvedValueOnce(ok({ data: savedOptionRecipe }) as never);
    vi.mocked(api.saveProductCosting).mockResolvedValue(ok({ data: { mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", extrasRecipeId: null, servedAlongside: [], optionRecipes: [{ optionId: "option-1", recipeId: savedOptionRecipe.id, recipeQuantity: "1" }], optionRules: [], combinations: [], version: 2 } }) as never);

    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    await screen.findByText("بدون افزودنی");
    const quantities = screen.getAllByLabelText("مقدار (گرم)");
    fireEvent.change(quantities[0]!, { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));

    await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({
      recipeId: baseRecipe.id,
      optionRecipes: [{ optionId: "option-1", recipeId: savedOptionRecipe.id, recipeQuantity: "1" }],
    })));
    expect(api.saveInventoryRecipe).toHaveBeenNthCalledWith(1, null, expect.objectContaining({ components: [expect.objectContaining({ quantity: "18" })] }));
    expect(api.saveInventoryRecipe).toHaveBeenNthCalledWith(2, optionRecipe.id, expect.objectContaining({ components: [expect.objectContaining({ quantity: "20" })] }));
  });

  it("does not offer an empty option selection when another option group is required", async () => {
    const costingCatalog = {
      products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [
        { optionGroupId: "required-group", minSelections: 1, options: [{ optionId: "required-option" }] },
        { optionGroupId: "optional-group", minSelections: 0, options: [{ optionId: "optional-option" }] },
      ] }],
      optionGroups: [
        { id: "required-group", name: "اندازه", options: [{ id: "required-option", name: "معمولی", isActive: true, archivedAt: null }] },
        { id: "optional-group", name: "افزودنی", options: [{ id: "optional-option", name: "کوکی", isActive: true, archivedAt: null }] },
      ],
      categories: [], options: [],
    } as never;
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    await screen.findByText("معمولی");

    expect(screen.queryByText("بدون افزودنی")).toBeNull();
    expect(screen.getByText("کوکی")).toBeTruthy();
  });

  it("treats a deactivated required option group as absent from the menu", async () => {
    const costingCatalog = {
      products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [
        { optionGroupId: "inactive-group", minSelections: 1, options: [{ optionId: "inactive-option" }] },
      ] }],
      optionGroups: [], categories: [], options: [],
    } as never;
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));

    expect(await screen.findByRole("group", { name: /مواد اصلی محصول.*بدون گزینه/ })).toBeTruthy();
  });

  it("saves served-alongside rows beside the product without putting them in the reusable main recipe", async () => {
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [] }], optionGroups: [], categories: [], options: [] } as never;
    const cookie = { ...stock, id: "stock-cookie", name: "کوکی", baseUnit: "PIECE" as const };
    const baseRecipe = { id: "base-recipe", name: "Espresso", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "coffee", label: "قهوه", sourceKind: "STOCK_ITEM", stockItemId: stock.id, nestedRecipeId: null, quantity: "18", displayOrder: 0 }] };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock, cookie], "stockItems") as never);
    vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([baseRecipe], "recipes") as never);
    vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: { mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", extrasRecipeId: null, servedAlongside: [], optionRecipes: [], optionRules: [], combinations: [], version: 1 } }) as never);
    vi.mocked(api.saveInventoryRecipe).mockResolvedValue(ok({ data: baseRecipe }) as never);
    vi.mocked(api.saveProductCosting).mockResolvedValue(ok({ data: { mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", extrasRecipeId: null, servedAlongside: [{ sourceKind: "STOCK_ITEM", stockItemId: cookie.id, quantity: "1" }], optionRecipes: [], optionRules: [], combinations: [], version: 2 } }) as never);

    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    fireEvent.click(await screen.findByRole("button", { name: "افزودن مورد سرو در کنار محصول" }));
    const picker = screen.getByLabelText("قلم افزودنی");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "کوکی" } });
    fireEvent.click(await screen.findByRole("option", { name: "کوکی" }));
    fireEvent.change(screen.getByLabelText("مقدار برای هر واحد (عدد)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));

    await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({
      servedAlongside: [{ sourceKind: "STOCK_ITEM", stockItemId: cookie.id, quantity: "1" }],
    })));
    expect(api.saveInventoryRecipe).not.toHaveBeenCalled();
  });

  it("saves a product estimate without rewriting its recipe and restores the recipe when toggled off", async () => {
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [] }], optionGroups: [], categories: [], options: [] } as never;
    const baseRecipe = { id: "base-recipe", name: "Espresso", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "coffee", label: "قهوه", sourceKind: "STOCK_ITEM", stockItemId: stock.id, nestedRecipeId: null, quantity: "18", displayOrder: 0 }] };
    const config = { mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "2", useEstimatedCost: false, estimatedCostAmount: null, extrasRecipeId: null, servedAlongside: [], takeawayPackaging: [], optionRecipes: [], optionRules: [], combinations: [], version: 1 };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([baseRecipe], "recipes") as never);
    vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: config }) as never);
    vi.mocked(api.saveInventoryRecipe).mockResolvedValue(ok({ data: baseRecipe }) as never);
    vi.mocked(api.saveProductCosting)
      .mockResolvedValueOnce(ok({ data: { ...config, useEstimatedCost: true, estimatedCostAmount: 2_500, version: 2 } }) as never)
      .mockResolvedValueOnce(ok({ data: { ...config, useEstimatedCost: false, estimatedCostAmount: 2_500, version: 3 } }) as never);

    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    const toggle = await screen.findByLabelText("هزینه‌ی نهایی را به‌صورت تخمینی ثبت می‌کنم");
    fireEvent.click(toggle);
    expect(screen.queryByLabelText("مقدار (گرم)")).toBeNull();
    fireEvent.change(screen.getByLabelText("هزینه‌ی تخمینی هر واحد (تومان)"), { target: { value: "2500" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));

    await waitFor(() => expect(api.saveProductCosting).toHaveBeenNthCalledWith(1, "product-1", expect.objectContaining({ useEstimatedCost: true, estimatedCostAmount: 2500, expectedVersion: 1 })));
    expect(vi.mocked(api.saveProductCosting).mock.calls[0]?.[1]).not.toHaveProperty("recipeId");
    expect(api.saveInventoryRecipe).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(await screen.findByLabelText("مقدار (گرم)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
    await waitFor(() => expect(api.saveProductCosting).toHaveBeenNthCalledWith(2, "product-1", expect.objectContaining({ mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "2", useEstimatedCost: false, expectedVersion: 2 })));
    expect(api.saveInventoryRecipe).not.toHaveBeenCalled();
  });

  it("restores a saved recipe while skipping untouched inherited option drafts", async () => {
    const costingCatalog = {
      products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [{ optionGroupId: "group-1", minSelections: 0, options: [{ optionId: "option-1" }] }] }],
      optionGroups: [{ id: "group-1", name: "اندازه", options: [{ id: "option-1", name: "دبل", isActive: true, archivedAt: null }] }],
      categories: [], options: [],
    } as never;
    const baseRecipe = { id: "base-recipe", name: "Espresso", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "coffee", label: "قهوه", sourceKind: "STOCK_ITEM", stockItemId: stock.id, nestedRecipeId: null, quantity: "18", displayOrder: 0 }] };
    const config = { mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", useEstimatedCost: true, estimatedCostAmount: 2_500, extrasRecipeId: null, servedAlongside: [], takeawayPackaging: [], optionRecipes: [], optionRules: [], combinations: [], version: 2 };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([baseRecipe], "recipes") as never);
    vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: config }) as never);
    vi.mocked(api.saveProductCosting).mockResolvedValue(ok({ data: { ...config, useEstimatedCost: false, version: 3 } }) as never);

    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    fireEvent.click(await screen.findByLabelText("هزینه‌ی نهایی را به‌صورت تخمینی ثبت می‌کنم"));
    const quantities = await screen.findAllByLabelText("مقدار (گرم)");
    expect((quantities[0] as HTMLInputElement).value).toBe("18");
    expect((quantities[1] as HTMLInputElement).value).toBe("");
    expect((quantities[1] as HTMLInputElement).required).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));

    await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({
      mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", useEstimatedCost: false, expectedVersion: 2,
    })));
    expect(api.saveInventoryRecipe).not.toHaveBeenCalled();
  });

  it("saves an estimated side add-on without validating untouched inherited option drafts", async () => {
    const costingCatalog = {
      products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [{ optionGroupId: "group-1", minSelections: 0, options: [{ optionId: "option-1" }] }] }],
      optionGroups: [{ id: "group-1", name: "اندازه", options: [{ id: "option-1", name: "دبل", isActive: true, archivedAt: null }] }],
      categories: [], options: [],
    } as never;
    const baseRecipe = { id: "base-recipe", name: "Espresso", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "coffee", label: "قهوه", sourceKind: "STOCK_ITEM", stockItemId: stock.id, nestedRecipeId: null, quantity: "18", displayOrder: 0 }] };
    const config = { mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", useEstimatedCost: false, estimatedCostAmount: null, extrasRecipeId: null, servedAlongside: [], takeawayPackaging: [], optionRecipes: [], optionRules: [], combinations: [], version: 1 };
    const updatedConfig = { ...config, servedAlongside: [{ sourceKind: "ESTIMATED_COST", name: "کوکی آماده", estimatedCostAmount: 500 }], version: 2 };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([baseRecipe], "recipes") as never);
    vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: config }) as never);
    vi.mocked(api.saveProductCosting).mockResolvedValue(ok({ data: updatedConfig }) as never);

    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    const ingredientAmounts = await screen.findAllByLabelText("مقدار (گرم)");
    expect((ingredientAmounts[1] as HTMLInputElement).value).toBe("");
    expect((ingredientAmounts[1] as HTMLInputElement).required).toBe(false);

    fireEvent.click(await screen.findByRole("button", { name: "افزودن مورد سرو در کنار محصول" }));
    fireEvent.click(screen.getByLabelText("هزینه‌ی تخمینی برای افزودنی 1"));
    fireEvent.change(screen.getByLabelText("نام افزودنی 1"), { target: { value: "کوکی آماده" } });
    fireEvent.change(screen.getByLabelText("هزینه‌ی تخمینی برای هر واحد محصول (تومان)"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));

    await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({
      mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", useEstimatedCost: false,
      servedAlongside: [{ sourceKind: "ESTIMATED_COST", name: "کوکی آماده", estimatedCostAmount: 500, previousSource: { sourceKind: "STOCK_ITEM", stockItemId: stock.id, quantity: "1" } }],
    })));
    expect(api.saveInventoryRecipe).not.toHaveBeenCalled();
  });

  it("lets each served-alongside row use its own estimated cost and keeps the old recipe mapping", async () => {
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [] }], optionGroups: [], categories: [], options: [] } as never;
    const baseRecipe = { id: "base-recipe", name: "Espresso", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "coffee", label: "قهوه", sourceKind: "STOCK_ITEM", stockItemId: stock.id, nestedRecipeId: null, quantity: "18", displayOrder: 0 }] };
    const sideRecipe = { id: "side-recipe", name: "کوکی کنار قهوه", ingredientName: "کوکی", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "cookie", label: "کوکی", sourceKind: "STOCK_ITEM", stockItemId: stock.id, nestedRecipeId: null, quantity: "1", displayOrder: 0 }] };
    const baseConfig = { mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", useEstimatedCost: false, estimatedCostAmount: null, extrasRecipeId: null, servedAlongside: [{ sourceKind: "RECIPE", recipeId: sideRecipe.id, quantity: "1" }], optionRecipes: [], optionRules: [], combinations: [], version: 1 };
    const estimatedSideConfig = { ...baseConfig, servedAlongside: [{ sourceKind: "ESTIMATED_COST", name: "کوکی آماده", estimatedCostAmount: 0, previousSource: { sourceKind: "RECIPE", recipeId: sideRecipe.id, quantity: "1" } }], version: 2 };
    const restoredSideConfig = { ...baseConfig, servedAlongside: [{ sourceKind: "RECIPE", recipeId: sideRecipe.id, quantity: "1", previousEstimatedCost: { name: "کوکی آماده", estimatedCostAmount: 0 } }], version: 3 };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([baseRecipe, sideRecipe], "recipes") as never);
    vi.mocked(api.readProductCosting).mockResolvedValueOnce(ok({ data: baseConfig }) as never).mockResolvedValueOnce(ok({ data: restoredSideConfig }) as never);
    vi.mocked(api.saveInventoryRecipe).mockResolvedValue(ok({ data: baseRecipe }) as never);
    vi.mocked(api.saveProductCosting).mockResolvedValueOnce(ok({ data: estimatedSideConfig }) as never).mockResolvedValueOnce(ok({ data: restoredSideConfig }) as never);

    const view = render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    fireEvent.click(await screen.findByLabelText("هزینه‌ی تخمینی برای افزودنی 1"));
    fireEvent.change(screen.getByLabelText("نام افزودنی 1"), { target: { value: "کوکی آماده" } });
    const estimatedAmount = screen.getByLabelText("هزینه‌ی تخمینی برای هر واحد محصول (تومان)") as HTMLInputElement;
    expect(estimatedAmount.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
    expect(api.saveProductCosting).not.toHaveBeenCalled();
    fireEvent.change(estimatedAmount, { target: { value: "0" } });
    expect(screen.queryByLabelText("دستور افزودنی")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));

    await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({
      servedAlongside: [{ sourceKind: "ESTIMATED_COST", name: "کوکی آماده", estimatedCostAmount: 0, previousSource: { sourceKind: "RECIPE", recipeId: sideRecipe.id, quantity: "1" } }],
    })));
    fireEvent.click(screen.getByLabelText("هزینه‌ی تخمینی برای افزودنی 1"));
    expect(screen.queryByLabelText("نام افزودنی 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
    await waitFor(() => expect(api.saveProductCosting).toHaveBeenNthCalledWith(2, "product-1", expect.objectContaining({
      servedAlongside: [{ sourceKind: "RECIPE", recipeId: sideRecipe.id, quantity: "1", previousEstimatedCost: { name: "کوکی آماده", estimatedCostAmount: 0 } }],
    })));
    view.unmount();

    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    fireEvent.click(await screen.findByLabelText("هزینه‌ی تخمینی برای افزودنی 1"));
    expect((screen.getByLabelText("نام افزودنی 1") as HTMLInputElement).value).toBe("کوکی آماده");
    expect((screen.getByLabelText("هزینه‌ی تخمینی برای هر واحد محصول (تومان)") as HTMLInputElement).value).toBe("0");
  });

  it("omits incomplete alternate served-alongside drafts when saving either mode", async () => {
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [] }], optionGroups: [], categories: [], options: [] } as never;
    const baseRecipe = { id: "base-recipe", name: "Espresso", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "coffee", label: "قهوه", sourceKind: "STOCK_ITEM", stockItemId: stock.id, nestedRecipeId: null, quantity: "18", displayOrder: 0 }] };
    const config = { mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", useEstimatedCost: false, estimatedCostAmount: null, extrasRecipeId: null, servedAlongside: [{ sourceKind: "STOCK_ITEM", stockItemId: stock.id, quantity: "1", previousEstimatedCost: { name: "کوکی آماده", estimatedCostAmount: 500 } }], takeawayPackaging: [], optionRecipes: [], optionRules: [], combinations: [], version: 1 };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([baseRecipe], "recipes") as never);
    vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: config }) as never);
    vi.mocked(api.saveProductCosting).mockResolvedValue(ok({ data: { ...config, version: 2 } }) as never);

    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    fireEvent.click(await screen.findByLabelText("هزینه‌ی تخمینی برای افزودنی 1"));
    fireEvent.change(screen.getByLabelText("نام افزودنی 1"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("هزینه‌ی تخمینی برای هر واحد محصول (تومان)"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("هزینه‌ی تخمینی برای افزودنی 1"));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
    await waitFor(() => expect(api.saveProductCosting).toHaveBeenNthCalledWith(1, "product-1", expect.objectContaining({
      servedAlongside: [{ sourceKind: "STOCK_ITEM", stockItemId: stock.id, quantity: "1" }],
    })));

    fireEvent.change(screen.getByLabelText("مقدار برای هر واحد (گرم)"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("هزینه‌ی تخمینی برای افزودنی 1"));
    fireEvent.change(screen.getByLabelText("نام افزودنی 1"), { target: { value: "کوکی آماده" } });
    fireEvent.change(screen.getByLabelText("هزینه‌ی تخمینی برای هر واحد محصول (تومان)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
    await waitFor(() => expect(api.saveProductCosting).toHaveBeenNthCalledWith(2, "product-1", expect.objectContaining({
      servedAlongside: [{ sourceKind: "ESTIMATED_COST", name: "کوکی آماده", estimatedCostAmount: 100 }],
    })));
  });

  it("loads a reusable served-alongside recipe and persists its removal without changing the main recipe", async () => {
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [] }], optionGroups: [], categories: [], options: [] } as never;
    const baseRecipe = { id: "base-recipe", name: "Espresso", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "coffee", label: "قهوه", sourceKind: "STOCK_ITEM", stockItemId: stock.id, nestedRecipeId: null, quantity: "18", displayOrder: 0 }] };
    const cookieRecipe = { id: "cookie-recipe", name: "کوکی کنار محصول", ingredientName: "کوکی", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "cookie", label: "کوکی", sourceKind: "STOCK_ITEM", stockItemId: "stock-cookie", nestedRecipeId: null, quantity: "1", displayOrder: 0 }] };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([baseRecipe, cookieRecipe], "recipes") as never);
    vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: { mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", extrasRecipeId: null, servedAlongside: [{ sourceKind: "RECIPE", recipeId: cookieRecipe.id, quantity: "1" }], optionRecipes: [], optionRules: [], combinations: [], version: 1 } }) as never);
    vi.mocked(api.saveInventoryRecipe).mockResolvedValue(ok({ data: baseRecipe }) as never);
    vi.mocked(api.saveProductCosting).mockResolvedValue(ok({ data: { mode: "RECIPE", recipeId: baseRecipe.id, recipeQuantity: "1", extrasRecipeId: null, servedAlongside: [], optionRecipes: [], optionRules: [], combinations: [], version: 2 } }) as never);

    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    expect((await screen.findByLabelText("نوع افزودنی 1") as HTMLSelectElement).value).toBe("RECIPE");
    expect(screen.getByLabelText("دستور افزودنی")).toHaveProperty("value", cookieRecipe.name);
    fireEvent.click(screen.getByRole("button", { name: "حذف افزودنی 1" }));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));

    await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({ servedAlongside: [] })));
    expect(api.saveInventoryRecipe).not.toHaveBeenCalled();
    expect(api.saveInventoryRecipe).not.toHaveBeenCalledWith(cookieRecipe.id, expect.anything());
  });

  it("creates a physical count and asks for one reason when a quantity differs", async () => {
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "شمارش انبار" }));
    fireEvent.change(screen.getByLabelText("مقدار گرم"), { target: { value: "99.5" } });
    fireEvent.change(screen.getByLabelText("ارزش موجودی (تومان)"), { target: { value: "19900" } });
    fireEvent.change(screen.getByLabelText("دلیل اختلاف موجودی (برای کل شمارش)"), { target: { value: "اصلاح شمارش" } });
    fireEvent.click(screen.getByRole("button", { name: "ایجاد پیش‌نویس شمارش" }));

    await waitFor(() => expect(api.createInventoryCount).toHaveBeenCalledWith({ lines: [{ stockItemId: stock.id, observedQuantity: "99.5", observedValueAmount: 19900 }], reason: "اصلاح شمارش", kind: "PHYSICAL" }));
  });
});

it("shows gross profit before turnover activation even when stock consumption is unavailable", async () => {
  vi.mocked(api.readGrossProfitReport).mockResolvedValue(ok({
    data: {
      totals: { netSalesAmount: 10000, knownCogsAmount: 200, theoreticalCogsAmount: 200, grossProfitAmount: 9800, grossMarginPercent: "98.00" },
      products: [{ productId: "product-1", productName: "اسپرسو", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 10000, completeCostRevenueAmount: 10000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCostRevenueOfTotalSalesPercent: "0.00", incompleteCostRevenueSharePercent: null, knownCogsAmount: 200, theoreticalCogsAmount: 200, grossProfitAmount: 9800, grossMarginPercent: "98.00", completeOrderItemCount: 1, incompleteOrderItemCount: 0 }],
      costCoverage: { totalEligibleNetSalesAmount: 10000, completeCostRevenueAmount: 10000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCoveragePercent: "0.00", completeOrderItemCount: 1, incompleteOrderItemCount: 0, channels: [{ channel: "TABLE", netSalesAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0, coveragePercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 0 }, { channel: "TAKEAWAY", netSalesAmount: 10000, completeCostRevenueAmount: 10000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", completeOrderItemCount: 1, incompleteOrderItemCount: 0 }] }, pendingConsumptionCount: 0,
      inventoryConsumption: { amount: null, isEstimate: true, varianceAmount: null, missingValuationCount: 0 },
    },
    meta: { range: { from: "2026-11-10T20:30:00.000Z", to: "2026-11-11T20:30:00.000Z" } },
  }) as never);
  render(<InventoryWorkspace catalog={catalog} turnoverEnabled={false} role="DEVELOPER" />);
  fireEvent.click(await screen.findByRole("button", { name: "سود ناخالص" }));
  await screen.findByText("برای این بازه در دسترس نیست");
  expect(screen.getAllByText("۹,۸۰۰").length).toBeGreaterThan(0);
  expect(screen.getAllByText("۹۸.۰۰٪").length).toBeGreaterThan(0);
  expect(screen.getByText(/تا فعال‌سازی گردش موجودی/)).toBeTruthy();
});

it("opens the current costing setup for a product from its historical priority row", async () => {
  vi.mocked(api.readGrossProfitReport).mockResolvedValue(ok({
    data: {
      totals: { netSalesAmount: 10000, theoreticalCogsAmount: null, knownCogsAmount: 0, grossProfitAmount: null, grossMarginPercent: null },
      products: [{ productId: "product-1", productName: "اسپرسو", channel: "TABLE", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 10000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 10000, coveragePercent: "0.00", incompleteCostRevenueOfTotalSalesPercent: "100.00", incompleteCostRevenueSharePercent: "100.00", theoreticalCogsAmount: null, knownCogsAmount: 0, grossProfitAmount: null, grossMarginPercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 1 }],
      costCoverage: { totalEligibleNetSalesAmount: 10000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 10000, coveragePercent: "0.00", incompleteCoveragePercent: "100.00", completeOrderItemCount: 0, incompleteOrderItemCount: 1, channels: [{ channel: "TABLE", netSalesAmount: 10000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 10000, coveragePercent: "0.00", completeOrderItemCount: 0, incompleteOrderItemCount: 1 }, { channel: "TAKEAWAY", netSalesAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0, coveragePercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 0 }] },
      pendingConsumptionCount: 0,
      inventoryConsumption: { amount: null, isEstimate: true, varianceAmount: null, missingValuationCount: 0 },
    },
    meta: { requestId: "test", range: { from: "2026-11-10T20:30:00.000Z", to: "2026-11-11T20:30:00.000Z" } },
  }) as never);
  render(<InventoryWorkspace catalog={packagingCatalog} role="DEVELOPER" />);
  fireEvent.click(await screen.findByRole("button", { name: "سود ناخالص" }));
  fireEvent.click(await screen.findByRole("button", { name: "بررسی هزینه‌ی فعلی" }));
  await waitFor(() => expect(api.readProductCosting).toHaveBeenLastCalledWith("product-1"));
  expect(screen.getByRole("button", { name: "دستور تهیه و هزینه" }).getAttribute("aria-pressed")).toBe("true");
});

it("does not offer current-cost inspection for an archived historical product", async () => {
  const archivedProduct = { id: "archived-product", name: "محصول بایگانی‌شده", pricingMode: "FIXED", isActive: false, archivedAt: "2026-11-01T00:00:00.000Z", optionGroups: [] };
  const activeProduct = { id: "active-product", name: "محصول فعال", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [] };
  const historicalCatalog = { categories: [], products: [archivedProduct, activeProduct], optionGroups: [], options: [] } as never;
  vi.mocked(api.readGrossProfitReport).mockResolvedValue(ok({
    data: {
      totals: { netSalesAmount: 15000, theoreticalCogsAmount: null, knownCogsAmount: 0, grossProfitAmount: null, grossMarginPercent: null },
      products: [
        { productId: archivedProduct.id, productName: archivedProduct.name, channel: "TABLE", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 10000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 10000, coveragePercent: "0.00", incompleteCostRevenueOfTotalSalesPercent: "66.67", incompleteCostRevenueSharePercent: "66.67", theoreticalCogsAmount: null, knownCogsAmount: 0, grossProfitAmount: null, grossMarginPercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
        { productId: activeProduct.id, productName: activeProduct.name, channel: "TAKEAWAY", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 5000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 5000, coveragePercent: "0.00", incompleteCostRevenueOfTotalSalesPercent: "33.33", incompleteCostRevenueSharePercent: "33.33", theoreticalCogsAmount: null, knownCogsAmount: 0, grossProfitAmount: null, grossMarginPercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
      ],
      costCoverage: { totalEligibleNetSalesAmount: 15000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 15000, coveragePercent: "0.00", incompleteCoveragePercent: "100.00", completeOrderItemCount: 0, incompleteOrderItemCount: 2, channels: [
        { channel: "TABLE", netSalesAmount: 10000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 10000, coveragePercent: "0.00", completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
        { channel: "TAKEAWAY", netSalesAmount: 5000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 5000, coveragePercent: "0.00", completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
      ] },
      pendingConsumptionCount: 0,
      inventoryConsumption: { amount: null, isEstimate: true, varianceAmount: null, missingValuationCount: 0 },
    },
    meta: { requestId: "test", range: { from: "2026-11-10T20:30:00.000Z", to: "2026-11-11T20:30:00.000Z" } },
  }) as never);

  render(<InventoryWorkspace catalog={historicalCatalog} role="DEVELOPER" />);
  fireEvent.click(await screen.findByRole("button", { name: "سود ناخالص" }));
  const priorityRegion = await screen.findByRole("region", { name: "محصولات با اولویت تکمیل هزینه" });
  const archivedRow = within(priorityRegion).getByRole("rowheader", { name: /محصول بایگانی‌شده/ });
  expect(archivedRow.textContent).toContain("تنظیم فعلی این محصول در دسترس نیست");
  expect(within(archivedRow).queryByRole("button", { name: "بررسی هزینه‌ی فعلی" })).toBeNull();
  expect(within(priorityRegion).getAllByRole("button", { name: "بررسی هزینه‌ی فعلی" })).toHaveLength(1);

  fireEvent.click(within(priorityRegion).getByRole("button", { name: "بررسی هزینه‌ی فعلی" }));
  await waitFor(() => expect(api.readProductCosting).toHaveBeenLastCalledWith(activeProduct.id));
  expect(api.readProductCosting).not.toHaveBeenCalledWith(archivedProduct.id);
});

it("omits the disabled turnover notice after activation while keeping purchase entry available", async () => {
  render(<InventoryWorkspace catalog={catalog} turnoverEnabled />);
  await screen.findByRole("heading", { name: "پیش‌نویس خرید" });
  expect(screen.queryByText(/تا فعال‌سازی گردش موجودی/)).toBeNull();
});


it("saves a manual fractional stock threshold and permits clearing it", async () => {
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([{...stock, lowStockThreshold: "12.125001"}], "stockItems") as never);
  render(<InventoryWorkspace catalog={catalog} />);
  fireEvent.click(await screen.findByRole("button", {name:"اقلام موجودی"}));
  fireEvent.click(await screen.findByRole("button", {name:"ویرایش قهوه"}));
  const input = screen.getByLabelText("حد هشدار موجودی (گرم) · اختیاری") as HTMLInputElement;
  expect(input.value).toBe("12.125001");
  fireEvent.change(input, {target:{value:""}});
  fireEvent.click(screen.getByRole("button",{name:"ذخیره تغییرات"}));
  await waitFor(()=>expect(api.saveInventoryStockItem).toHaveBeenCalledWith(stock.id,expect.objectContaining({lowStockThreshold:null,expectedVersion:stock.version})));
});

const packagingCatalog = { products: [{ id: "product-1", name: "اسپرسو", priceAmount: 10000, pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [] }], optionGroups: [], categories: [], options: [] } as never;
const cupStock = { ...stock, id: "cup-1", name: "لیوان", baseUnit: "PIECE" };
const baseRecipe = { id: "recipe-1", name: "اسپرسو مواد اصلی محصول", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "coffee", sourceKind: "STOCK_ITEM", stockItemId: stock.id, quantity: "18" }] };
const packagingConfiguration = { mode: "RECIPE", recipeId: "recipe-1", recipeQuantity: "1", extrasRecipeId: null, optionRecipes: [], optionRules: [], combinations: [], version: 1, takeawayPackaging: [{ stockItemId: "cup-1", quantity: "1" }] };
function mockPackaging() {
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock, cupStock], "stockItems") as never);
  vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([baseRecipe], "recipes") as never);
  vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: packagingConfiguration }) as never);
  vi.mocked(api.saveInventoryRecipe).mockResolvedValue(ok({ data: baseRecipe }) as never);
  vi.mocked(api.saveProductCosting).mockResolvedValue(ok({ data: packagingConfiguration }) as never);
}
it("loads, edits, saves and removes takeaway packaging while preserving the base recipe", async () => {
  mockPackaging();
  render(<InventoryWorkspace catalog={packagingCatalog} role="DEVELOPER" />);
  fireEvent.click(await screen.findByRole("button", { name: "مدیریت انبار" }));
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  const packaging = await screen.findByLabelText("قلم بسته‌بندی 1");
  expect((packaging as HTMLInputElement).value).toBe(cupStock.name);
  expect((screen.getByLabelText("مقدار (گرم)") as HTMLInputElement).value).toBe("18");
  fireEvent.change(screen.getByLabelText("مقدار بسته‌بندی 1 (عدد)"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
  await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({ takeawayPackaging: [{ stockItemId: "cup-1", quantity: "2" }] })));
  await screen.findByText("دستور تهیه ذخیره شد.");
  fireEvent.click(screen.getByRole("button", { name: "حذف بسته‌بندی 1" }));
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
  await waitFor(() => expect(api.saveProductCosting).toHaveBeenLastCalledWith("product-1", expect.objectContaining({ takeawayPackaging: [] })));
});
it("sends the preview channel and invalidates old results after switching it", async () => {
  mockPackaging();
  vi.mocked(api.previewProductCosting).mockResolvedValue(ok({ data: { isComplete: true, knownCostAmount: 3700, components: [], missingReasons: [] } }) as never);
  render(<InventoryWorkspace catalog={packagingCatalog} role="DEVELOPER" />);
  fireEvent.click(await screen.findByRole("button", { name: "مدیریت انبار" }));
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  const channel = await screen.findByLabelText("نوع سفارش برای محاسبه‌ی هزینه");
  fireEvent.click(screen.getByRole("button", { name: "محاسبه‌ی هزینه‌ی مواد اصلی محصول" }));
  await waitFor(() => expect(api.previewProductCosting).toHaveBeenLastCalledWith("product-1", expect.objectContaining({ channel: "TABLE" })));
  await screen.findByText(/هزینه‌ی مواد کامل است/);
  fireEvent.change(channel, { target: { value: "TAKEAWAY" } });
  expect(screen.queryByText(/هزینه‌ی مواد کامل است/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "محاسبه‌ی هزینه‌ی مواد اصلی محصول" }));
  await waitFor(() => expect(api.previewProductCosting).toHaveBeenLastCalledWith("product-1", expect.objectContaining({ channel: "TAKEAWAY" })));
});
it("blocks duplicate packaging rows without saving recipes or configuration", async () => {
  mockPackaging();
  render(<InventoryWorkspace catalog={packagingCatalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  await screen.findByLabelText("قلم بسته‌بندی 1");
  fireEvent.click(screen.getByRole("button", { name: "افزودن بسته‌بندی بیرون‌بر" }));
  chooseInventoryOption("قلم بسته‌بندی 2", cupStock.name);
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
  await screen.findByRole("alert");
  expect(api.saveInventoryRecipe).not.toHaveBeenCalled();
  expect(api.saveProductCosting).not.toHaveBeenCalled();
});
it("shows dine-in and takeaway margins for the same product as distinct rows", async () => {
  const row = { productId: "product-1", productName: "اسپرسو", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 10000, completeCostRevenueAmount: 10000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCostRevenueOfTotalSalesPercent: "0.00", incompleteCostRevenueSharePercent: null, knownCogsAmount: 2000, theoreticalCogsAmount: 2000, grossProfitAmount: 8000, grossMarginPercent: "80.00", completeOrderItemCount: 1, incompleteOrderItemCount: 0 };
  vi.mocked(api.readGrossProfitReport).mockResolvedValue(ok({ data: { totals: { netSalesAmount: 20000, theoreticalCogsAmount: 4500, knownCogsAmount: 4500, grossProfitAmount: 15500, grossMarginPercent: "77.50" }, products: [{ ...row, channel: "TABLE" }, { ...row, channel: "TAKEAWAY", knownCogsAmount: 2500, theoreticalCogsAmount: 2500, grossProfitAmount: 7500, grossMarginPercent: "75.00" }], costCoverage: { totalEligibleNetSalesAmount: 20000, completeCostRevenueAmount: 20000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", incompleteCoveragePercent: "0.00", completeOrderItemCount: 2, incompleteOrderItemCount: 0, channels: [{ channel: "TABLE", netSalesAmount: 10000, completeCostRevenueAmount: 10000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", completeOrderItemCount: 1, incompleteOrderItemCount: 0 }, { channel: "TAKEAWAY", netSalesAmount: 10000, completeCostRevenueAmount: 10000, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", completeOrderItemCount: 1, incompleteOrderItemCount: 0 }] }, pendingConsumptionCount: 0, inventoryConsumption: { amount: null, isEstimate: true, varianceAmount: null, missingValuationCount: 0 } }, meta: { range: { from: "2026-11-10T20:30:00.000Z", to: "2026-11-11T20:30:00.000Z" } } }) as never);
  render(<InventoryWorkspace catalog={packagingCatalog} role="DEVELOPER" />);
  fireEvent.click(await screen.findByRole("button", { name: "سود ناخالص" }));
  const table = await screen.findByRole("region", { name: "جدول سود محصولات" });
  expect(within(table).getByRole("rowheader", { name: /اسپرسو.*داخل کافه/ })).toBeTruthy();
  expect(within(table).getByRole("rowheader", { name: /اسپرسو.*بیرون‌بر/ })).toBeTruthy();
  expect(within(table).getAllByRole("row")).toHaveLength(3);
});

it("creates a reusable takeaway cookie from a nested preparation and wrapper without a menu product", async () => {
  mockPackaging();
  render(<InventoryWorkspace catalog={catalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "دستورهای مشترک" }));
  fireEvent.change(screen.getByLabelText("نام دستور مشترک"), { target: { value: "کوکی بیرون‌بر" } });
  fireEvent.change(screen.getByLabelText("نوع جزء 1"), { target: { value: "RECIPE" } });
  chooseInventoryOption("جزء 1", baseRecipe.name);
  fireEvent.click(screen.getByRole("button", { name: "افزودن جزء به دستور مشترک" }));
  chooseInventoryOption("جزء 2", cupStock.name);
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستور مشترک" }));
  await waitFor(() => expect(api.saveInventoryRecipe).toHaveBeenCalledWith(null, expect.objectContaining({ name: "کوکی بیرون‌بر", outputUnit: "PIECE", yieldQuantity: "1", components: [expect.objectContaining({ sourceKind: "RECIPE", nestedRecipeId: "recipe-1", quantity: "1" }), expect.objectContaining({ sourceKind: "STOCK_ITEM", stockItemId: "cup-1", quantity: "1" })] })));
  expect(api.saveProductCosting).not.toHaveBeenCalled();
});
it("saves normal and takeaway ingredients as separate complete recipes", async () => {
  mockPackaging();
  const cookieRecipe = { ...baseRecipe, id: "cookie-take", name: "کوکی بیرون‌بر" };
  vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([baseRecipe, cookieRecipe], "recipes") as never);
  vi.mocked(api.saveInventoryRecipe).mockResolvedValueOnce(ok({ data: baseRecipe }) as never).mockResolvedValueOnce(ok({ data: { ...baseRecipe, id: "latte-take" } }) as never);
  render(<InventoryWorkspace catalog={packagingCatalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  fireEvent.click(await screen.findByLabelText("دستور مواد بیرون‌بر جداگانه"));
  const takeaway = screen.getByRole("group", { name: /مواد اصلی محصول.*بیرون‌بر/ });
  fireEvent.change(within(takeaway).getByLabelText("نوع ماده"), { target: { value: "RECIPE" } });
  const picker = within(takeaway).getByRole("combobox", { name: "دستور تهیه" });
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: "کوکی بیرون‌بر" } });
  fireEvent.click(within(takeaway).getByRole("option", { name: "کوکی بیرون‌بر" }));
  fireEvent.change(within(takeaway).getByLabelText("مقدار (عدد)"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
  await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({ recipeId: "recipe-1", takeawayRecipeId: "latte-take", takeawayOptionRecipes: [] })));
  expect(api.saveInventoryRecipe).toHaveBeenNthCalledWith(2, null, expect.objectContaining({ components: [expect.objectContaining({ sourceKind: "RECIPE", nestedRecipeId: "cookie-take", quantity: "1" })] }));
});
it("loads separate takeaway recipes and can clear the override to inherit normal ingredients", async () => {
  mockPackaging();
  vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([baseRecipe, { ...baseRecipe, id: "latte-take", components: [{ ...baseRecipe.components[0], quantity: "22" }] }], "recipes") as never);
  vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: { ...packagingConfiguration, takeawayRecipeId: "latte-take" } }) as never);
  render(<InventoryWorkspace catalog={packagingCatalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  const toggle = await screen.findByLabelText("دستور مواد بیرون‌بر جداگانه");
  const takeaway = screen.getByRole("group", { name: /مواد اصلی محصول.*بیرون‌بر/ });
  expect((within(takeaway).getByLabelText("مقدار (گرم)") as HTMLInputElement).value).toBe("22");
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
  await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({ takeawayRecipeId: null, takeawayOptionRecipes: [] })));
});
it("saves a complete-pair holder rule with minimum and maximum quantity", async () => {
  mockPackaging();
  render(<InventoryWorkspace catalog={packagingCatalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  fireEvent.change(await screen.findByLabelText("روش محاسبه‌ی بسته‌بندی 1"), { target: { value: "PER_GROUP" } });
  fireEvent.change(screen.getByLabelText("تعداد واحد در هر گروه 1"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("حداقل تعداد محصول برای بسته‌بندی 1"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("حداکثر تعداد محصول برای بسته‌بندی 1"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
  await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalledWith("product-1", expect.objectContaining({ takeawayPackaging: [{ stockItemId: "cup-1", quantity: "1", mode: "PER_GROUP", groupSize: 2, minQuantity: 2, maxQuantity: 4 }] })));
});
it("retries a failed takeaway save using the latest saved normal recipe version", async () => {
  mockPackaging();
  vi.mocked(api.saveInventoryRecipe)
    .mockResolvedValueOnce(ok({ data: { ...baseRecipe, version: 2 } }) as never)
    .mockResolvedValueOnce({ ok: false, error: { kind: "response", status: 422, code: "BUSINESS_RULE_VIOLATION", message: "نام دستور تکراری است" } } as never)
    .mockResolvedValueOnce(ok({ data: { ...baseRecipe, version: 3 } }) as never)
    .mockResolvedValueOnce(ok({ data: { ...baseRecipe, id: "latte-take", version: 1 } }) as never);
  render(<InventoryWorkspace catalog={packagingCatalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  fireEvent.click(await screen.findByLabelText("دستور مواد بیرون‌بر جداگانه"));
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
  await screen.findByRole("alert");
  expect(api.saveProductCosting).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
  await waitFor(() => expect(api.saveProductCosting).toHaveBeenCalled());
  expect(api.saveInventoryRecipe).toHaveBeenNthCalledWith(3, "recipe-1", expect.objectContaining({ expectedVersion: 2 }));
});
it("rejects an inverted packaging quantity range before saving any recipe", async () => {
  mockPackaging();
  render(<InventoryWorkspace catalog={packagingCatalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  fireEvent.change(await screen.findByLabelText("حداقل تعداد محصول برای بسته‌بندی 1"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("حداکثر تعداد محصول برای بسته‌بندی 1"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
  await screen.findByText(/شرط تعداد بسته‌بندی را بررسی کنید/);
  expect(api.saveInventoryRecipe).not.toHaveBeenCalled();
  expect(api.saveProductCosting).not.toHaveBeenCalled();
});

it("opens sales channel reporting from the inventory dashboard", async () => {
  render(<InventoryWorkspace catalog={catalog} role="DEVELOPER" />);
  fireEvent.click(await screen.findByRole("button", { name: "فروش کانال‌ها" }));
  await screen.findByText("جمع سفارش‌های تسویه‌شده");
  expect(api.readSalesChannelReport).toHaveBeenCalledTimes(1);
  expect(screen.getByText("در این بازه سفارش واجد شرایطی ثبت نشده است.")).toBeTruthy();
});

it("shows all five analysis views only to Developer", async () => {
  const exclusiveLabels = ["نمای کلی", "فروش کانال‌ها", "اوج و مشارکت", "سود ناخالص", "آزمایش قیمت‌گذاری"];
  const { unmount } = render(<InventoryWorkspace catalog={catalog} role="MANAGER" />);
  await screen.findByRole("heading", { name: "پیش‌نویس خرید" });
  for (const label of exclusiveLabels) expect(screen.queryByRole("button", { name: label })).toBeNull();
  unmount();
  render(<InventoryWorkspace catalog={catalog} role="DEVELOPER" />);
  await screen.findByText("جمع سفارش‌های تسویه‌شده");
  for (const label of exclusiveLabels) expect(screen.getByRole("button", { name: label })).toBeTruthy();
});
