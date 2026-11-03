// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StaffConsumption } from "./staff-consumption";

const api = vi.hoisted(() => ({ readPosCatalog: vi.fn(), readStaffConsumption: vi.fn(), createStaffConsumption: vi.fn(), discountStaffConsumption: vi.fn(), deleteOpenOrder: vi.fn() }));
vi.mock("../lib/api-client", () => api);
vi.mock("./product-picker", () => ({ ProductPicker: ({ card, onSelectOptions }: any) => <button onClick={() => onSelectOptions(card.products[0], [])}>{card.name}</button> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

it("lets staff create a benefit and apply a discount without showing removal", async () => {
  const product = { id: "coffee", name: "قهوه", pricingMode: "FIXED", optionGroups: [] };
  api.readPosCatalog.mockResolvedValue({ ok: true, data: [{ id: "drinks", name: "نوشیدنی", products: [product] }] });
  api.readStaffConsumption.mockResolvedValue({ ok: true, data: { data: [{ id: "order", version: 1, dailyOrderNumber: 1, username: "staff", createdAt: new Date().toISOString(), totalAmount: 10000, discountAmount: 0, items: [] }], meta: { nextCursor: null } } });
  api.createStaffConsumption.mockResolvedValue({ ok: true });
  api.discountStaffConsumption.mockResolvedValue({ ok: true });
  render(<StaffConsumption role="STAFF" onOpenMenu={() => {}} />);
  fireEvent.change(await screen.findByLabelText("نام شخص آغازکننده (اختیاری)"), { target: { value: "پریسا" } });
  fireEvent.click(await screen.findByText("قهوه"));
  fireEvent.click(screen.getByRole("button", { name: "ثبت سفارش پرسنل" }));
  await waitFor(() => expect(api.createStaffConsumption).toHaveBeenCalledWith(expect.objectContaining({ channel: "TAKEAWAY", items: [{ productId: "coffee", quantity: 1, options: [] }] }), expect.any(String), "پریسا"));
  fireEvent.click(await screen.findByRole("button", { name: "تخفیف" }));
  fireEvent.change(await screen.findByLabelText("مبلغ تخفیف به تومان"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "ثبت تخفیف" }));
  await waitFor(() => expect(api.discountStaffConsumption).toHaveBeenCalledWith("order", 1, { kind: "FIXED", value: 1000 }));
  expect(screen.queryByRole("button", { name: "حذف" })).toBeNull();
});
