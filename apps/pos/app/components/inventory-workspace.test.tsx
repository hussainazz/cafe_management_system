// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryWorkspace } from "./inventory-workspace";
import * as api from "../lib/api-client";

vi.mock("../lib/api-client", () => ({
  archiveInventoryRecipe: vi.fn(), archiveInventoryStockItem: vi.fn(), createInventoryCount: vi.fn(),
  createInventoryPurchase: vi.fn(), previewProductCosting: vi.fn(), postInventoryCount: vi.fn(),
  postInventoryPurchase: vi.fn(), readGrossProfitReport: vi.fn(), readInventoryCounts: vi.fn(),
  readInventoryMovements: vi.fn(), readInventoryPurchases: vi.fn(), readInventoryRecipes: vi.fn(),
  readInventoryStockItems: vi.fn(), readPendingInventoryConsumption: vi.fn(), readProductCosting: vi.fn(), readSalesChannelReport: vi.fn(),
  returnInventoryPurchase: vi.fn(), saveInventoryRecipe: vi.fn(), saveInventoryStockItem: vi.fn(),
  saveProductCosting: vi.fn(), updateInventoryCount: vi.fn(), updateInventoryPurchase: vi.fn(),
}));

const stock = {
  id: "stock-1", name: "قهوه", category: "مواد اولیه", baseUnit: "GRAM", isActive: true,
  archivedAt: null, version: 1, conversions: [],
  balance: { quantityOnHand: "100", carryingValueAmount: 20_000, movingAverageCostPerBaseUnit: "200", trackingStartedAt: "2026-10-13T08:00:00.000Z" },
  createdAt: "2026-10-13T08:00:00.000Z", updatedAt: "2026-10-13T08:00:00.000Z",
};
const ok = (data: unknown) => ({ ok: true, data });
const catalog = { categories: [], products: [], optionGroups: [], options: [] } as never;

function list(data: unknown, key: string) { const page = { limit: 20, nextCursor: null, hasMore: false }; return ok({ data: { [key]: data, page }, meta: { requestId: "test", page } }); }

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
  fireEvent.change(screen.getByLabelText("محصول منو"), { target: { value: "product-2" } });
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
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [{ options: [{ optionId: "option-1" }] }] }], optionGroups: [{ id: "group-1", name: "اندازه", options: [{ id: "option-1", name: "دبل", isActive: true, archivedAt: null }] }], categories: [], options: [] } as never;
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
    fireEvent.change(screen.getByLabelText("نام بسته‌بندی"), { target: { value: "کیسه" } });
    fireEvent.change(screen.getByLabelText("مقدار هر بسته به گرم"), { target: { value: "یک کیلو" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت کالا" }));

    expect((await screen.findByRole("alert")).textContent).toContain("مقدار تبدیل");
    expect(api.saveInventoryStockItem).not.toHaveBeenCalled();
  });

  it("creates a stock item with an exact fractional package conversion", async () => {
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "اقلام موجودی" }));
    fireEvent.change(screen.getByLabelText("نام کالا"), { target: { value: "قهوه تازه" } });
    fireEvent.change(screen.getByLabelText("نام بسته‌بندی"), { target: { value: "بسته" } });
    fireEvent.change(screen.getByLabelText("مقدار هر بسته به گرم"), { target: { value: "250.125" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت کالا" }));

    await waitFor(() => expect(api.saveInventoryStockItem).toHaveBeenCalledWith(null, expect.objectContaining({
      name: "قهوه تازه", baseUnit: "GRAM", conversions: [{ label: "بسته", baseQuantityPerPack: "250.125", isActive: true }],
    })));
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
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", pricingMode: "FIXED", isActive: true, archivedAt: null, optionGroups: [{ options: [{ optionId: "option-1" }] }] }], optionGroups: [{ id: "group-1", name: "اندازه", options: [{ id: "option-1", name: "دبل", isActive: true, archivedAt: null }] }], categories: [], options: [] } as never;
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
      products: [{ productId: "product-1", productName: "اسپرسو", netSalesAmount: 10000, knownCogsAmount: 200, theoreticalCogsAmount: 200, grossProfitAmount: 9800, grossMarginPercent: "98.00", completeOrderItemCount: 1, incompleteOrderItemCount: 0 }],
      costCoverage: { completeOrderItemCount: 1, incompleteOrderItemCount: 0 }, pendingConsumptionCount: 0,
      inventoryConsumption: { amount: null, isEstimate: true, varianceAmount: null, missingValuationCount: 0 },
    },
    meta: { range: { from: "2026-11-10T20:30:00.000Z", to: "2026-11-11T20:30:00.000Z" } },
  }) as never);
  render(<InventoryWorkspace catalog={catalog} turnoverEnabled={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "سود ناخالص" }));
  await screen.findByText("برای این بازه در دسترس نیست");
  expect(screen.getAllByText("۹,۸۰۰").length).toBeGreaterThan(0);
  expect(screen.getAllByText("۹۸.۰۰٪").length).toBeGreaterThan(0);
  expect(screen.getByText(/تا فعال‌سازی گردش موجودی/)).toBeTruthy();
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
  render(<InventoryWorkspace catalog={packagingCatalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
  const packaging = await screen.findByLabelText("قلم بسته‌بندی 1");
  expect((packaging as HTMLSelectElement).value).toBe("cup-1");
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
  render(<InventoryWorkspace catalog={packagingCatalog} />);
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
  fireEvent.change(screen.getByLabelText("قلم بسته‌بندی 2"), { target: { value: "cup-1" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی دستورهای تهیه" }));
  await screen.findByRole("alert");
  expect(api.saveInventoryRecipe).not.toHaveBeenCalled();
  expect(api.saveProductCosting).not.toHaveBeenCalled();
});
it("shows dine-in and takeaway margins for the same product as distinct rows", async () => {
  const row = { productId: "product-1", productName: "اسپرسو", netSalesAmount: 10000, knownCogsAmount: 2000, theoreticalCogsAmount: 2000, grossProfitAmount: 8000, grossMarginPercent: "80.00", completeOrderItemCount: 1, incompleteOrderItemCount: 0 };
  vi.mocked(api.readGrossProfitReport).mockResolvedValue(ok({ data: { totals: { netSalesAmount: 20000, theoreticalCogsAmount: 4500, knownCogsAmount: 4500, grossProfitAmount: 15500, grossMarginPercent: "77.50" }, products: [{ ...row, channel: "TABLE" }, { ...row, channel: "TAKEAWAY", knownCogsAmount: 2500, theoreticalCogsAmount: 2500, grossProfitAmount: 7500, grossMarginPercent: "75.00" }], costCoverage: { completeOrderItemCount: 2, incompleteOrderItemCount: 0 }, pendingConsumptionCount: 0, inventoryConsumption: { amount: null, isEstimate: true, varianceAmount: null, missingValuationCount: 0 } }, meta: { range: { from: "2026-11-10T20:30:00.000Z", to: "2026-11-11T20:30:00.000Z" } } }) as never);
  render(<InventoryWorkspace catalog={packagingCatalog} />);
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
  fireEvent.change(screen.getByLabelText("جزء 1"), { target: { value: "recipe-1" } });
  fireEvent.click(screen.getByRole("button", { name: "افزودن جزء به دستور مشترک" }));
  fireEvent.change(screen.getByLabelText("جزء 2"), { target: { value: "cup-1" } });
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

it("opens sales channel analytics from the inventory dashboard", async () => {
  render(<InventoryWorkspace catalog={catalog} />);
  fireEvent.click(await screen.findByRole("button", { name: "آمار فروش" }));
  await screen.findByText("جمع سفارش‌های تسویه‌شده");
  expect(api.readSalesChannelReport).toHaveBeenCalledTimes(1);
  expect(screen.getByText("در این بازه سفارش واجد شرایطی ثبت نشده است.")).toBeTruthy();
});
