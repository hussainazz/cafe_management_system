// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderDesk, OrdersWorkspace } from "./orders-workspace";
import { readRecovery, setRecoveryUser, writeRecovery } from "../lib/automatic-recovery";
import { readRecentItemNotes } from "../lib/recent-item-notes";
const api = vi.hoisted(() => ({ posApiFailureEvent: "run-cafe:api-failure", createOpenOrder: vi.fn(), readOrder: vi.fn(), updateOpenOrder: vi.fn(), readPosCatalog: vi.fn(), readPosTables: vi.fn(), readWaiterCalls: vi.fn(), readOpenOrders: vi.fn() }));
vi.mock("../lib/api-client", () => api);
afterEach(cleanup);
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
function desk(paymentStatus?: "UNPAID" | "PARTIALLY_PAID", weighted = false, itemId = "item", version = 1, includeAddedItem = false) {
  const product = { id: "product", name: "قهوه", priceAmount: 50000, pricingMode: weighted ? "WEIGHTED_PER_KG" : "FIXED", isAvailable: false, optionGroups: weighted ? [{ id: "optional", name: "افزودنی", minSelections: 0, maxSelections: 1, options: [] }] : [] };
  const order = paymentStatus ? { id: "order", state: "OPEN", version, dailyOrderNumber: 1, channel: "TAKEAWAY", paymentStatus, totalAmount: includeAddedItem ? 80000 : 50000, balanceAmount: 25000, discountAmount: 0, settlements: [], items: [{ id: itemId, productId: "product", productNameSnapshot: "قهوه", quantity: 1, lineTotalAmount: 50000, note: null, weightGrams: null, pricingModeSnapshot: "FIXED", options: [] }, ...(includeAddedItem ? [{ id: "added-item", productId: "dessert", productNameSnapshot: "کیک", quantity: 1, lineTotalAmount: 30000, note: null, weightGrams: null, pricingModeSnapshot: "FIXED", options: [] }] : [])] } : null;
  render(<OrderDesk catalog={[{ id: "category", name: "نوشیدنی", products: [product] }] as never} table={null} channel="TAKEAWAY" initialOrder={order as never} onOrder={vi.fn(async () => undefined)} onDone={vi.fn()} onTableClearNeeded={vi.fn()} onCreateFailure={vi.fn(async () => undefined)} onDirtyChange={vi.fn()} onSubmitReady={vi.fn()} takeawayOrders={[]} onOpenTakeaway={vi.fn(async () => undefined)} onCloseTakeawayPanel={vi.fn()} />);
  return order;
}
describe("OrderDesk order workflow", () => {
  it("allows unavailable active catalog cards and shows quantity totals once", () => {
    desk();
    const card = screen.getByRole("button", { name: "قهوه" });
    expect((card as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(card); fireEvent.click(card);
    fireEvent.click(screen.getByRole("button", { name: /قهوه × 2/ }));
    expect(document.querySelector(".quantity__total")?.textContent).toBe("100,000");
    expect(document.querySelector(".order-total strong")?.textContent).toBe("100,000");
  });
  it("shows a weighted line total once when quantity exceeds one", () => {
    desk(undefined, true);
    fireEvent.click(screen.getByRole("button", { name: /قهوه.*دارای انتخاب/ }));
    fireEvent.change(screen.getByLabelText("وزن"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن به سفارش" }));
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
    fireEvent.click(screen.getByRole("button", { name: "قهوه" }));
    expect((screen.getByRole("button", { name: "تأیید و ثبت ویرایش" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("remembers a note only after a successful creation", async () => {
    desk();
    fireEvent.click(screen.getByRole("button", { name: "قهوه" }));
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
    fireEvent.click(screen.getByRole("button", { name: "قهوه" }));
    api.createOpenOrder.mockResolvedValueOnce({ ok: false, error: { status: 409, code: "IDEMPOTENCY_CONFLICT", message: "collision" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سفارش" }));
    await screen.findByText("collision");
    const firstKey = api.createOpenOrder.mock.calls[0]![1];

    fireEvent.click(screen.getByRole("button", { name: "قهوه" }));
    api.createOpenOrder.mockResolvedValueOnce({ ok: false, error: { status: 500, message: "still unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سفارش" }));
    await screen.findByText("still unavailable");

    expect(api.createOpenOrder.mock.calls[1]![1]).not.toBe(firstKey);
    expect(api.createOpenOrder.mock.calls[1]![0].items[0]!.quantity).toBe(2);
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
    fireEvent.click(screen.getByRole("button", { name: "قهوه" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "قهوه" }));
    expect(screen.getByRole("button", { name: /قهوه × 1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /سالن/ }));
    fireEvent.click(screen.getByRole("button", { name: "دور ریختن" }));

    expect(readRecovery("desk:TAKEAWAY:takeaway:new:draft")).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /بیرون‌بر/ }));
    expect(screen.queryByRole("button", { name: /قهوه × 1/ })).toBeNull();
    expect(screen.getByText("سفارش خالی است")).toBeTruthy();
  });
});
