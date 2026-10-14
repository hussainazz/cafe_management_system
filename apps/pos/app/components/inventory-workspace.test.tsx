// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryWorkspace } from "./inventory-workspace";
import * as api from "../lib/api-client";

vi.mock("../lib/api-client", () => ({
  archiveInventoryRecipe: vi.fn(), archiveInventoryStockItem: vi.fn(), createInventoryCount: vi.fn(),
  createInventoryPurchase: vi.fn(), previewProductCosting: vi.fn(), postInventoryCount: vi.fn(),
  postInventoryPurchase: vi.fn(), readGrossProfitReport: vi.fn(), readInventoryCounts: vi.fn(),
  readInventoryMovements: vi.fn(), readInventoryPurchases: vi.fn(), readInventoryRecipes: vi.fn(),
  readInventoryStockItems: vi.fn(), readPendingInventoryConsumption: vi.fn(), readProductCosting: vi.fn(),
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

function list(data: unknown, key: string) { return ok({ data: { [key]: data }, meta: { requestId: "test" } }); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([], "stockItems") as never);
  vi.mocked(api.readInventoryPurchases).mockResolvedValue(list([], "purchases") as never);
  vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([], "recipes") as never);
  vi.mocked(api.readInventoryCounts).mockResolvedValue(list([], "counts") as never);
  vi.mocked(api.readInventoryMovements).mockResolvedValue(list([], "movements") as never);
  vi.mocked(api.readPendingInventoryConsumption).mockResolvedValue(list([], "consumptions") as never);
  vi.mocked(api.readGrossProfitReport).mockResolvedValue({ ok: false, error: { kind: "response", message: "گزارشی برای نمایش نیست" } } as never);
  vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: null }) as never);
  vi.mocked(api.saveInventoryStockItem).mockResolvedValue(ok(stock) as never);
  vi.mocked(api.createInventoryCount).mockResolvedValue(ok({ id: "count-1" }) as never);
});

afterEach(() => cleanup());

describe("InventoryWorkspace", () => {
  it("counts only the selected item without changing an unrelated item", async () => {
    const other = { ...stock, id: "stock-2", name: "شیر" };
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock, other], "stockItems") as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "شمارش انبار" }));
    fireEvent.change(screen.getByLabelText("نوع شمارش"), { target: { value: "PHYSICAL" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "شمارش شیر" }));
    fireEvent.change(screen.getByLabelText("مقدار گرم"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "ایجاد پیش‌نویس شمارش" }));
    await waitFor(() => expect(api.createInventoryCount).toHaveBeenCalledWith({ kind: "PHYSICAL", lines: [{ stockItemId: stock.id, observedQuantity: "80", observedValueAmount: 20000 }] }));
  });
  it("blocks costing edits after a configuration read fails and allows a read retry", async () => {
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", isActive: true, archivedAt: null, optionGroups: [] }], optionGroups: [], categories: [], options: [] } as never;
    vi.mocked(api.readProductCosting).mockResolvedValue({ ok: false, error: { kind: "response", code: "SERVICE_UNAVAILABLE", message: "Database unavailable", requestId: "costing-read-123" } } as never);
    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    expect((await screen.findByRole("alert")).textContent).toContain("costing-read-123");
    expect(screen.queryByLabelText("روش محاسبه")).toBeNull();
    vi.mocked(api.readProductCosting).mockResolvedValue(ok({ data: null }) as never);
    fireEvent.click(screen.getByRole("button", { name: "بارگذاری تنظیم هزینه" }));
    await screen.findByLabelText("روش محاسبه");
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
    expect(alert.textContent).toContain("مقدار خرید (ردیف ۱)");
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
    fireEvent.click(screen.getByRole("checkbox", { name: /سفارش 42/ }));
    fireEvent.click(screen.getByRole("button", { name: "ثبت شمارش" }));

    const dialog = screen.getByRole("alertdialog", { name: "بررسی ثبت شمارش" });
    expect(dialog.textContent).toContain("اختلاف -0.5");
    expect(dialog.textContent).toContain("42");
    expect(api.postInventoryCount).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت شمارش در موجودی" }));
    await waitFor(() => expect(api.postInventoryCount).toHaveBeenCalledWith("count-1", { expectedVersion: 2, absorbedOrderConsumptionIds: ["pending-1"] }, expect.any(String)));
  });

  it("selects a recipe component by its readable name in an option rule", async () => {
    const recipe = { id: "recipe-1", name: "اسپرسو", ingredientName: "اسپرسو", isActive: true, archivedAt: null, version: 1, outputUnit: "PIECE", yieldQuantity: "1", components: [{ componentKey: "coffee", label: "قهوه", sourceKind: "STOCK_ITEM", stockItemId: stock.id, quantity: "18" }] };
    const costingCatalog = { products: [{ id: "product-1", name: "اسپرسو", isActive: true, archivedAt: null, optionGroups: [{ options: [{ optionId: "option-1" }] }] }], optionGroups: [{ id: "group-1", name: "اندازه", options: [{ id: "option-1", name: "دبل" }] }], categories: [], options: [] } as never;
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    vi.mocked(api.readInventoryRecipes).mockResolvedValue(list([recipe], "recipes") as never);
    render(<InventoryWorkspace catalog={costingCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دستور تهیه و هزینه" }));
    fireEvent.change(await screen.findByLabelText("دستور تهیه‌ی پایه"), { target: { value: "recipe-1" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن قاعده‌ی گزینه" }));

    const selector = screen.getByLabelText("ماده‌ی دستور پایه") as HTMLSelectElement;
    expect(within(selector).getByRole("option", { name: "قهوه" })).toBeTruthy();
    fireEvent.change(selector, { target: { value: "coffee" } });
    expect(selector.value).toBe("coffee");
  });

  it("changes count eligibility with count type and submits observed stock values", async () => {
    vi.mocked(api.readInventoryStockItems).mockResolvedValue(list([stock], "stockItems") as never);
    render(<InventoryWorkspace catalog={catalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "شمارش انبار" }));
    expect((screen.getByLabelText(/نوع شمارش/) as HTMLSelectElement).value).toBe("OPENING");
    fireEvent.change(screen.getByLabelText(/نوع شمارش/), { target: { value: "PHYSICAL" } });
    fireEvent.change(screen.getByLabelText("مقدار گرم"), { target: { value: "99.5" } });
    fireEvent.change(screen.getByLabelText("ارزش موجودی (تومان)"), { target: { value: "19900" } });
    fireEvent.click(screen.getByRole("button", { name: "ایجاد پیش‌نویس شمارش" }));

    await waitFor(() => expect(api.createInventoryCount).toHaveBeenCalledWith({ kind: "PHYSICAL", lines: [{ stockItemId: stock.id, observedQuantity: "99.5", observedValueAmount: 19900 }] }));
  });
});
