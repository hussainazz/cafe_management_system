// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderDesk } from "./orders-workspace";
import { readRecentItemNotes } from "../lib/recent-item-notes";
const api = vi.hoisted(() => ({ createOpenOrder: vi.fn(), readOrder: vi.fn(), updateOpenOrder: vi.fn() }));
vi.mock("../lib/api-client", () => api);
afterEach(cleanup);
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
function desk(paymentStatus?: "UNPAID" | "PARTIALLY_PAID", weighted = false) {
  const product = { id: "product", name: "قهوه", priceAmount: 50000, pricingMode: weighted ? "WEIGHTED_PER_KG" : "FIXED", isAvailable: false, optionGroups: weighted ? [{ id: "optional", name: "افزودنی", minSelections: 0, maxSelections: 1, options: [] }] : [] };
  const order = paymentStatus ? { id: "order", state: "OPEN", version: 1, dailyOrderNumber: 1, channel: "TAKEAWAY", paymentStatus, totalAmount: 50000, balanceAmount: 25000, discountAmount: 0, settlements: [], items: [{ id: "item", productId: "product", productNameSnapshot: "قهوه", quantity: 1, lineTotalAmount: 50000, note: null, weightGrams: null, pricingModeSnapshot: "FIXED", options: [] }] } : null;
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
});
