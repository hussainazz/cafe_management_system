// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderDesk, OrdersWorkspace } from "./orders-workspace";
import { readRecovery, setRecoveryUser, writeRecovery } from "../lib/automatic-recovery";
import { readRecentItemNotes } from "../lib/recent-item-notes";
const api = vi.hoisted(() => ({ posApiFailureEvent: "run-cafe:api-failure", createOpenOrder: vi.fn(), readOrder: vi.fn(), updateOpenOrder: vi.fn(), readPosCatalog: vi.fn(), readPosTables: vi.fn(), readWaiterCalls: vi.fn(), readOpenOrders: vi.fn() }));
const printing = vi.hoisted(() => ({ printDocument: vi.fn(), printRoute: vi.fn((id: string, kind: string) => `/pos/print/${id}/${kind}`) }));
vi.mock("../lib/api-client", () => api);
vi.mock("../lib/print-routes", () => printing);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
function desk(paymentStatus?: "UNPAID" | "PARTIALLY_PAID", weighted = false, itemId = "item", version = 1, includeAddedItem = false) {
  const product = { id: "product", name: "قهوه", priceAmount: 50000, pricingMode: weighted ? "WEIGHTED_PER_KG" : "FIXED", isAvailable: false, optionGroups: weighted ? [{ id: "optional", name: "افزودنی", minSelections: 0, maxSelections: 1, options: [] }] : [] };
  const order = paymentStatus ? { id: "order", state: "OPEN", version, dailyOrderNumber: 1, channel: "TAKEAWAY", paymentStatus, totalAmount: includeAddedItem ? 80000 : 50000, balanceAmount: 25000, discountAmount: 0, settlements: [], items: [{ id: itemId, productId: "product", productNameSnapshot: "قهوه", quantity: 1, lineTotalAmount: 50000, note: null, weightGrams: null, pricingModeSnapshot: "FIXED", options: [] }, ...(includeAddedItem ? [{ id: "added-item", productId: "dessert", productNameSnapshot: "کیک", quantity: 1, lineTotalAmount: 30000, note: null, weightGrams: null, pricingModeSnapshot: "FIXED", options: [] }] : [])] } : null;
  render(<OrderDesk catalog={[{ id: "category", name: "نوشیدنی", products: [product] }] as never} table={null} channel="TAKEAWAY" initialOrder={order as never} onOrder={vi.fn(async () => undefined)} onDone={vi.fn()} onTableClearNeeded={vi.fn()} onCreateFailure={vi.fn(async () => undefined)} onDirtyChange={vi.fn()} onSubmitReady={vi.fn()} takeawayOrders={[]} onOpenTakeaway={vi.fn(async () => undefined)} onCloseTakeawayPanel={vi.fn()} />);
  if (order) fireEvent.click(screen.getByRole("button", { name: "ویرایش سفارش" }));
  return order;
}
describe("OrderDesk order workflow", () => {
  it("keeps the mobile category thumb and wheel/keyboard scrolling aligned with RTL", async () => {
    vi.stubGlobal("innerWidth", 390);
    desk();
    const list = document.querySelector(".categories__list") as HTMLElement;
    Object.defineProperties(list, { clientWidth: { value: 200 }, scrollWidth: { value: 1000 } });
    fireEvent.resize(window);
    const scrollbar = await screen.findByRole("scrollbar", { name: "دسته‌های محصولات" });
    const thumb = scrollbar.querySelector("span")!;
    expect(thumb.style.right).toBe("0%");
    expect(thumb.style.left).toBe("auto");
    fireEvent.keyDown(scrollbar, { key: "End" });
    expect(list.scrollLeft).toBe(-800);
    fireEvent.scroll(list);
    await waitFor(() => expect(scrollbar.getAttribute("aria-valuenow")).toBe("800"));
    expect(thumb.style.right).toBe("80%");
    fireEvent.keyDown(scrollbar, { key: "Home" });
    expect(list.scrollLeft).toBe(0);
    fireEvent.wheel(list, { deltaY: 100, deltaX: 0 });
    expect(list.scrollLeft).toBe(-100);
    fireEvent.scroll(list);
    await waitFor(() => expect(scrollbar.getAttribute("aria-valuenow")).toBe("100"));
  });
  it("keeps the tile quantity synchronized with the order and restores its add action at zero", () => {
    desk();
    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    expect(screen.getByLabelText("تعداد انتخاب‌شده قهوه").textContent).toBe("۱");
    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    expect(screen.getByLabelText("تعداد انتخاب‌شده قهوه").textContent).toBe("۲");
    expect(document.querySelector(".order-total strong")?.textContent).toBe("100,000");
    fireEvent.click(screen.getByRole("button", { name: "کم کردن قهوه در کارت محصول" }));
    expect(screen.getByLabelText("تعداد انتخاب‌شده قهوه").textContent).toBe("۱");
    expect(document.querySelector(".order-total strong")?.textContent).toBe("50,000");
    fireEvent.click(screen.getByRole("button", { name: "کم کردن قهوه در کارت محصول" }));
    expect(screen.queryByLabelText("تعداد انتخاب‌شده قهوه")).toBeNull();
    expect(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }).textContent).toBe("+");
    expect(document.querySelector(".order-total strong")?.textContent).toBe("0");
  });

  it("allows unavailable active catalog cards and shows quantity totals once", () => {
    desk();
    const card = screen.getByRole("button", { name: "افزودن قهوه به سفارش" });
    expect((card as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(card); fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    fireEvent.click(screen.getByRole("button", { name: /قهوه × 2/ }));
    expect(document.querySelector(".quantity__total")?.textContent).toBe("100,000");
    expect(document.querySelector(".order-total strong")?.textContent).toBe("100,000");
  });
  it.each([
    ["bar-ticket", "تأیید سفارش و چاپ فیش بار"],
    ["receipt", "تأیید سفارش و چاپ رسید مشتری"],
  ] as const)("saves a discounted order at the rounded POS total and starts the %s print action", async (kind, buttonName) => {
    const product = { id: "product", name: "قهوه", priceAmount: 50_000, pricingMode: "FIXED", saleDiscountKind: "PERCENTAGE", saleDiscountValue: 11, isAvailable: true, optionGroups: [] };
    const onOrder = vi.fn(async () => undefined);
    render(<OrderDesk catalog={[{ id: "category", name: "نوشیدنی", products: [product] }] as never} table={null} channel="TAKEAWAY" initialOrder={null} onOrder={onOrder} onDone={vi.fn()} onTableClearNeeded={vi.fn()} onCreateFailure={vi.fn(async () => undefined)} onDirtyChange={vi.fn()} onSubmitReady={vi.fn()} takeawayOrders={[]} onOpenTakeaway={vi.fn(async () => undefined)} onCloseTakeawayPanel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    expect(document.querySelector(".order-total strong")?.textContent).toBe("45,000");

    api.createOpenOrder.mockResolvedValueOnce({ ok: true, data: { id: "saved-order" } });
    api.readOrder.mockResolvedValueOnce({ ok: true, data: { id: "saved-order", version: 1, items: [] } });
    printing.printDocument.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    await waitFor(() => expect(api.createOpenOrder).toHaveBeenCalledOnce());
    await waitFor(() => expect(printing.printDocument).toHaveBeenCalledOnce());
    expect(api.createOpenOrder.mock.calls[0]![0].items).toEqual([{ productId: "product", quantity: 1, options: [] }]);
    expect(onOrder).toHaveBeenCalledOnce();
    expect(printing.printRoute).toHaveBeenCalledWith("saved-order", kind);
    expect(printing.printDocument).toHaveBeenCalledWith(`/pos/print/saved-order/${kind}`);
  });
  it("shows a weighted line total once when quantity exceeds one", () => {
    desk(undefined, true);
    fireEvent.click(screen.getByRole("button", { name: "انتخاب گزینه‌های قهوه" }));
    fireEvent.change(screen.getByLabelText("وزن"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("dialog").querySelector(".pos-product__add")!);
    fireEvent.click(screen.getByRole("button", { name: /قهوه · 250 گرم × 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "زیاد کردن قهوه" }));
    expect(document.querySelector(".quantity__total")?.textContent).toBe("25,000");
    expect(document.querySelector(".order-total strong")?.textContent).toBe("25,000");
  });
  it("keeps partially paid takeaway catalog reachable and locks settled line reductions/notes", () => {
    desk("PARTIALLY_PAID");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /قهوه × 1/ }));
    expect(screen.queryByRole("button", { name: "کم کردن قهوه" })).toBeNull();
    expect(screen.queryByLabelText("یادداشت قهوه")).toBeNull();
    expect(screen.getByRole("button", { name: "زیاد کردن قهوه" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    expect((screen.getByRole("button", { name: "تأیید و ثبت ویرایش" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("remembers a note only after a successful creation", async () => {
    desk();
    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    fireEvent.click(screen.getByRole("button", { name: /قهوه × 1/ }));
    fireEvent.change(screen.getByLabelText("یادداشت قهوه"), { target: { value: "  داغ  " } });
    api.createOpenOrder.mockResolvedValueOnce({ ok: false, error: { message: "failed" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سفارش" }));
    await screen.findByText("failed");
    expect(readRecentItemNotes("product")).toEqual([]);
    api.createOpenOrder.mockResolvedValueOnce({ ok: true, data: { id: "order" } });
    api.readOrder.mockResolvedValueOnce({ ok: false, error: { message: "detail failed" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سفارش" }));
    await waitFor(() => expect(readRecentItemNotes("product")).toEqual(["داغ"]));
  });

  it("uses a fresh idempotency key when a failed takeaway draft is changed", async () => {
    setRecoveryUser("changed-create-payload");
    desk();
    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    api.createOpenOrder.mockResolvedValueOnce({ ok: false, error: { status: 409, code: "IDEMPOTENCY_CONFLICT", message: "collision" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سفارش" }));
    await screen.findByText("collision");
    const firstKey = api.createOpenOrder.mock.calls[0]![1];

    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    api.createOpenOrder.mockResolvedValueOnce({ ok: false, error: { status: 500, message: "still unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سفارش" }));
    await screen.findByText("still unavailable");

    expect(api.createOpenOrder.mock.calls[1]![1]).not.toBe(firstKey);
    expect(api.createOpenOrder.mock.calls[1]![0].items[0]!.quantity).toBe(2);
  });
});

describe("unpaid lines after payment by item", () => {
  beforeEach(() => { sessionStorage.clear(); setRecoveryUser("partial-item-tests"); });
  function partialDesk(mode: "ITEM_QUANTITY" | "AMOUNT" | null = "ITEM_QUANTITY", mixed = false) {
    const paid = { id: "paid-item", productId: "coffee", productNameSnapshot: "قهوه", basePriceSnapshot: 50_000, quantity: 1, lineTotalAmount: 50_000, discountAmount: 0, discountKind: null, discountValue: null, note: null, weightGrams: null, pricingModeSnapshot: "FIXED", options: [] };
    const unpaid = { ...paid, id: "unpaid-item", productId: "cake", productNameSnapshot: "کیک", quantity: 2, lineTotalAmount: 110_000, note: "یادداشت قبلی", options: [{ optionId: "extra", optionNameSnapshot: "افزودنی", priceSnapshot: 5_000, quantity: 2 }] };
    const settlement = { id: "settlement", allocationMode: mode, totalAmount: 50_000, recordedAt: "2026-10-17T08:00:00.000Z", reversedAt: null, payments: [{ method: "CASH", amount: 50_000, reference: null }], allocations: [{ orderItemId: paid.id, quantity: 1, amount: 50_000 }] };
    const order = { id: "partial-order", state: "OPEN", version: 2, dailyOrderNumber: 1, channel: "TAKEAWAY", paymentStatus: "PARTIALLY_PAID", subtotalAmount: 160_000, totalAmount: 160_000, paidAmount: 50_000, balanceAmount: 110_000, discountAmount: 0, discountKind: null, discountValue: null, items: [paid, unpaid], settlements: [settlement, ...(mixed ? [{ ...settlement, id: "amount-settlement", allocationMode: "AMOUNT" }] : [])] };
    const onDone = vi.fn();
    const mount = () => {
      render(<OrderDesk catalog={[]} table={null} channel="TAKEAWAY" initialOrder={order as never} onOrder={vi.fn(async () => undefined)} onDone={onDone} onTableClearNeeded={vi.fn()} onCreateFailure={vi.fn(async () => undefined)} onDirtyChange={vi.fn()} onSubmitReady={vi.fn()} takeawayOrders={[]} onOpenTakeaway={vi.fn(async () => undefined)} onCloseTakeawayPanel={vi.fn()} />);
      const editButton = screen.queryByRole("button", { name: "ویرایش سفارش" });
      if (editButton) fireEvent.click(editButton);
    };
    mount();
    return { order, mount, onDone };
  }

  it("edits an unpaid line's quantity/options and note while the paid line stays locked", async () => {
    partialDesk();
    fireEvent.click(screen.getByRole("button", { name: /قهوه × 1/ }));
    expect(screen.queryByRole("button", { name: "کم کردن قهوه" })).toBeNull();
    expect(screen.queryByLabelText("یادداشت قهوه")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /کیک × 2/ }));
    fireEvent.change(screen.getByLabelText("یادداشت کیک"), { target: { value: "  بدون شکر  " } });
    fireEvent.click(screen.getByRole("button", { name: "کم کردن کیک" }));
    expect(document.querySelector(".order-total strong")?.textContent).toBe("105,000");
    expect(screen.getByRole("button", { name: /کیک × 1/ }).textContent).toContain("55,000");
    api.updateOpenOrder.mockResolvedValueOnce({ ok: false, error: { message: "Save retry" } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ثبت ویرایش" }));
    await screen.findByText("Save retry");
    expect(api.updateOpenOrder).toHaveBeenCalledWith("partial-order", { expectedVersion: 2, itemUpdates: [{ orderItemId: "unpaid-item", quantity: 1, note: "بدون شکر" }] });
  });

  it("retains a pending removal through a failed save and editor recovery", async () => {
    setRecoveryUser("per-item-removal-recovery");
    const { mount } = partialDesk();
    fireEvent.click(screen.getByRole("button", { name: /کیک × 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "کم کردن کیک" }));
    fireEvent.click(screen.getByRole("button", { name: "کم کردن کیک" }));
    expect(screen.queryByRole("button", { name: /کیک ×/ })).toBeNull();
    expect(screen.getByRole("button", { name: /قهوه × 1/ })).toBeTruthy();
    api.updateOpenOrder.mockResolvedValueOnce({ ok: false, error: { message: "Connection lost" } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ثبت ویرایش" }));
    await screen.findByText("Connection lost");
    expect(api.updateOpenOrder).toHaveBeenCalledWith("partial-order", { expectedVersion: 2, itemUpdates: [{ orderItemId: "unpaid-item", quantity: 0 }] });
    cleanup();
    mount();
    expect(screen.queryByRole("button", { name: /کیک ×/ })).toBeNull();
    expect((screen.getByRole("button", { name: "تأیید و ثبت ویرایش" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["AMOUNT", null] as const)("keeps untouched lines locked when the payment mode is %s", (mode) => {
    partialDesk(mode);
    fireEvent.click(screen.getByRole("button", { name: /کیک × 2/ }));
    expect(screen.queryByRole("button", { name: "کم کردن کیک" })).toBeNull();
    expect(screen.queryByLabelText("یادداشت کیک")).toBeNull();
  });

  it("keeps unpaid lines locked for mixed item/amount payments", () => {
    partialDesk("ITEM_QUANTITY", true);
    fireEvent.click(screen.getByRole("button", { name: /کیک × 2/ }));
    expect(screen.queryByRole("button", { name: "کم کردن کیک" })).toBeNull();
    expect(screen.queryByLabelText("یادداشت کیک")).toBeNull();
  });

  it("saves clearing an unpaid note without sending an unchanged quantity", async () => {
    partialDesk();
    fireEvent.click(screen.getByRole("button", { name: /کیک × 2/ }));
    fireEvent.change(screen.getByLabelText("یادداشت کیک"), { target: { value: "  " } });
    api.updateOpenOrder.mockResolvedValueOnce({ ok: false, error: { message: "Note retry" } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ثبت ویرایش" }));
    await screen.findByText("Note retry");
    expect(api.updateOpenOrder).toHaveBeenCalledWith("partial-order", { expectedVersion: 2, itemUpdates: [{ orderItemId: "unpaid-item", note: null }] });
  });

  it("reports an order closed by editing without claiming another payment was recorded", async () => {
    const { order, onDone } = partialDesk();
    fireEvent.click(screen.getByRole("button", { name: /کیک × 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "کم کردن کیک" }));
    fireEvent.click(screen.getByRole("button", { name: "کم کردن کیک" }));
    api.updateOpenOrder.mockResolvedValueOnce({ ok: true, data: { ...order, version: 3, state: "CLOSED", paymentStatus: "PAID", items: [order.items[0]], balanceAmount: 0, subtotalAmount: 50_000, totalAmount: 50_000 } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ثبت ویرایش" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("ویرایش ثبت شد و سفارش بیرون‌بر بسته شد."));
  });
});


describe("mounted order recovery", () => {
  it("renders an authoritative newly added takeaway item when recovered editor rows are stale", async () => {
    setRecoveryUser("new-item-stale-editor");
    writeRecovery("desk:TAKEAWAY:takeaway:order:version", 1);
    writeRecovery("desk:TAKEAWAY:takeaway:order:saved", [{ id: "item", productId: "product", name: "قهوه", quantity: 1, originalQuantity: 1, weightGrams: null, pricingModeSnapshot: "FIXED", note: "", originalNote: null, options: [], lineTotalAmount: 50000 }]);

    desk("UNPAID", false, "item", 1, true);

    expect(screen.getByRole("button", { name: /کیک × 1/ })).toBeTruthy();
    expect(screen.queryByText(/ویرایش قبلی فقط برای بررسی/)).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: /کیک × 1/ })).toBeTruthy());
  });

  it("restores additions, quantities and notes without replaying uncertain creation", async () => {
    setRecoveryUser("order-recovery-draft");
    desk();
    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    fireEvent.click(screen.getByRole("button", { name: /قهوه × 1/ }));
    fireEvent.change(screen.getByLabelText("یادداشت قهوه"), { target: { value: "کم شکر" } });
    api.createOpenOrder.mockResolvedValueOnce({ ok: false, error: { message: "uncertain" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سفارش" }));
    await screen.findByText("uncertain");
    const key = api.createOpenOrder.mock.calls[0]![1];
    cleanup(); desk();
    expect(api.createOpenOrder).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /قهوه × 1/ }));
    expect((screen.getByLabelText("یادداشت قهوه") as HTMLInputElement).value).toBe("کم شکر");
    api.createOpenOrder.mockResolvedValueOnce({ ok: false, error: { message: "retry uncertain" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سفارش" }));
    await screen.findByText("retry uncertain");
    expect(api.createOpenOrder.mock.calls[1]![1]).toBe(key);
  });
  it("acknowledges the saved version before a post-save workspace remount", async () => {
    setRecoveryUser("successful-save-remount");
    const original = desk("UNPAID")!;
    fireEvent.click(screen.getByRole("button", { name: /قهوه × 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "زیاد کردن قهوه" }));
    api.updateOpenOrder.mockResolvedValueOnce({ ok: true, data: { ...original, version: 2, items: original.items.map(item => ({ ...item, quantity: 2 })) } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ثبت ویرایش" }));
    await waitFor(() => expect(api.updateOpenOrder).toHaveBeenCalledTimes(1));
    cleanup(); desk("UNPAID", false, "item", 2);
    expect(screen.queryByText(/ویرایش قبلی فقط برای بررسی/)).toBeNull();
    expect(screen.getByRole("button", { name: /قهوه × 2/ })).toBeTruthy();
  });

  it("silently drops stale recovered edits and shows the current server order", async () => {
    setRecoveryUser("order-recovery-stale");
    desk("UNPAID");
    fireEvent.click(screen.getByRole("button", { name: /قهوه × 1/ }));
    fireEvent.change(screen.getByLabelText("یادداشت قهوه"), { target: { value: "یادداشت قبلی" } });
    cleanup();
    writeRecovery("desk:TAKEAWAY:takeaway:order:version", 0);
    desk("UNPAID", false, "changed-server-item");
    expect(screen.queryByText(/ویرایش قبلی فقط برای بررسی/)).toBeNull();
    expect(screen.getByRole("button", { name: /قهوه × 1/ })).toBeTruthy();
    expect(api.updateOpenOrder).not.toHaveBeenCalled();
    await waitFor(() => expect(readRecovery("desk:TAKEAWAY:takeaway:order:draft")).toEqual([]));
    expect(readRecovery("desk:TAKEAWAY:takeaway:order:saved")).toEqual([
      expect.objectContaining({ id: "changed-server-item", quantity: 1, note: "" }),
    ]);
  });
});


describe("authoritative workspace recovery", () => {
  it.each([0, 1])("restores a fresh takeaway draft as editable with null context, existing takeaways and retained version %s", async (retainedVersion) => {
    setRecoveryUser("fresh-takeaway-workspace");
    writeRecovery("channel", "TAKEAWAY");
    writeRecovery("order-context", { tableId: null, orderId: null, version: null, editing: false, checkout: false });
    writeRecovery("desk:TAKEAWAY:takeaway:new:version", retainedVersion);
    writeRecovery("desk:TAKEAWAY:takeaway:new:draft", [{ key: "retained", product: { id: "product", name: "قهوه", priceAmount: 140000, pricingMode: "FIXED", optionGroups: [] }, quantity: 2, note: "داغ", weightGrams: null, options: [] }]);
    api.readPosCatalog.mockResolvedValue({ ok: true, data: [{ id: "category", name: "نوشیدنی", products: [{ id: "product", name: "قهوه", priceAmount: 140000, pricingMode: "FIXED", optionGroups: [] }] }] });
    api.readPosTables.mockResolvedValue({ ok: true, data: { tables: [], tableSeatingLimitMinutes: null } });
    api.readWaiterCalls.mockResolvedValue({ ok: true, data: [] });
    api.readOpenOrders.mockResolvedValue({ ok: true, data: [{ id: "unrelated", channel: "TAKEAWAY", dailyOrderNumber: 4, paymentStatus: "UNPAID", balanceAmount: 50000 }] });
    // Clear the module cache to simulate a browser reload rather than a same-page remount.
    setRecoveryUser("other-user"); setRecoveryUser("fresh-takeaway-workspace");
    render(<StrictMode><OrdersWorkspace refreshing={false} onActivityChange={vi.fn()} onOpenMenu={vi.fn()} menuOpen={false} /></StrictMode>);
    const draft = await screen.findByRole("button", { name: /قهوه × 2/ });
    expect(screen.queryByText(/ویرایش قبلی فقط برای بررسی/)).toBeNull();
    expect(screen.getByRole("button", { name: "ثبت سفارش" })).toBeTruthy();
    fireEvent.click(draft);
    expect((screen.getByLabelText("یادداشت قهوه") as HTMLInputElement).value).toBe("داغ");
    expect(api.readOrder).not.toHaveBeenCalled();
    expect(api.createOpenOrder).not.toHaveBeenCalled();
  });

  it.each(["closed", "deleted"])("clears stale local work when the prior order is %s", async (state) => {
    setRecoveryUser(`workspace-${state}`);
    writeRecovery("order-context", { tableId: null, orderId: "old", version: 1, editing: true, checkout: true });
    writeRecovery("desk:TABLE:takeaway:old:draft", [{ key: "retained", product: { id: "product", name: "قهوه قبلی", priceAmount: 50000, pricingMode: "FIXED", optionGroups: [] }, quantity: 2, note: "داغ", weightGrams: null, options: [] }]);
    api.readPosCatalog.mockResolvedValue({ ok: true, data: [] });
    api.readPosTables.mockResolvedValue({ ok: true, data: { tables: [], tableSeatingLimitMinutes: null } });
    api.readWaiterCalls.mockResolvedValue({ ok: true, data: [] });
    api.readOpenOrders.mockResolvedValue({ ok: true, data: [] });
    api.readOrder.mockResolvedValue(state === "closed" ? { ok: true, data: { id: "old", state: "CLOSED" } } : { ok: false, error: { status: 404, message: "missing" } });
    const mount = () => render(<OrdersWorkspace refreshing={false} onActivityChange={vi.fn()} onOpenMenu={vi.fn()} menuOpen={false} />);
    mount();
    await waitFor(() => expect(readRecovery("desk:TABLE:takeaway:old:draft")).toBeUndefined());
    expect(screen.queryByText("قهوه قبلی · تعداد 2 · داغ")).toBeNull();
    expect(screen.queryByText(/کار قبلی فقط برای بررسی/)).toBeNull();
    expect(api.updateOpenOrder).not.toHaveBeenCalled();
    expect(api.createOpenOrder).not.toHaveBeenCalled();
    expect(readRecovery("order-context")).toEqual({ tableId: null, orderId: null, version: null, editing: false, checkout: false });
  });
});

describe("discarding a takeaway draft", () => {
  it("removes the draft from recovery storage before the takeaway workspace is reopened", async () => {
    setRecoveryUser("discard-takeaway-draft");
    writeRecovery("channel", "TAKEAWAY");
    writeRecovery("order-context", { tableId: null, orderId: null, version: null, editing: false, checkout: false });
    api.readPosCatalog.mockResolvedValue({ ok: true, data: [{ id: "category", name: "نوشیدنی", products: [{ id: "product", name: "قهوه", priceAmount: 50000, pricingMode: "FIXED", isAvailable: true, optionGroups: [] }] }] });
    api.readPosTables.mockResolvedValue({ ok: true, data: { tables: [], tableSeatingLimitMinutes: null } });
    api.readWaiterCalls.mockResolvedValue({ ok: true, data: [] });
    api.readOpenOrders.mockResolvedValue({ ok: true, data: [] });

    render(<OrdersWorkspace refreshing={false} onActivityChange={vi.fn()} onOpenMenu={vi.fn()} menuOpen={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "افزودن قهوه به سفارش" }));
    expect(screen.getByRole("button", { name: /قهوه × 1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "بستن سفارش بیرون‌بر" }));
    fireEvent.click(screen.getByRole("button", { name: "حذف تغییرات" }));

    expect(readRecovery("desk:TAKEAWAY:takeaway:new:draft")).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /بیرون‌بر/ }));
    expect(screen.queryByRole("button", { name: /قهوه × 1/ })).toBeNull();
    expect(screen.getByText("سفارش خالی است")).toBeTruthy();
  });
});

describe("active table header", () => {
  async function openSelectedTable() {
    setRecoveryUser("active-table-header");
    writeRecovery("channel", "TABLE");
    writeRecovery("order-context", { tableId: "table", orderId: null, version: null, editing: false, checkout: false });
    api.readPosCatalog.mockResolvedValue({ ok: true, data: [{ id: "category", name: "نوشیدنی", products: [{ id: "product", name: "قهوه", priceAmount: 50000, pricingMode: "FIXED", isAvailable: true, optionGroups: [] }] }] });
    api.readPosTables.mockResolvedValue({ ok: true, data: { tables: [{ id: "table", name: "2", occupancyStatus: "AVAILABLE", activeOrders: [] }], tableSeatingLimitMinutes: null } });
    api.readWaiterCalls.mockResolvedValue({ ok: true, data: [] });
    api.readOpenOrders.mockResolvedValue({ ok: true, data: [] });
    render(<OrdersWorkspace refreshing={false} onActivityChange={vi.fn()} onOpenMenu={vi.fn()} menuOpen={false} />);
    return screen.findByRole("button", { name: "بستن میز انتخاب‌شده" });
  }

  it("moves the selected context into the header and restores modes when closed", async () => {
    const close = await openSelectedTable();
    expect(document.querySelector(".workspace-header")?.textContent).toContain("میز ۲");
    expect(screen.queryByRole("tablist", { name: "نوع سفارش" })).toBeNull();
    expect(document.querySelector(".desk-context")).toBeNull();
    fireEvent.click(close);
    expect(screen.getByRole("tablist", { name: "نوع سفارش" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "بستن میز انتخاب‌شده" })).toBeNull();
  });

  it("protects unsaved products on close and clears their recovery only on discard", async () => {
    const close = await openSelectedTable();
    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    fireEvent.click(close);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "ادامه ویرایش" }).at(-1)!);
    expect(screen.getByRole("button", { name: /قهوه × 1/ })).toBeTruthy();
    fireEvent.click(close);
    fireEvent.click(screen.getByRole("button", { name: "حذف تغییرات" }));
    expect(readRecovery("desk:TABLE:table:new:draft")).toBeUndefined();
    expect(screen.getByRole("tablist", { name: "نوع سفارش" })).toBeTruthy();
    expect(api.createOpenOrder).not.toHaveBeenCalled();
  });
});
