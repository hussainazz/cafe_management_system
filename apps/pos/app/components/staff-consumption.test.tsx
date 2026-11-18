// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StaffConsumption } from "./staff-consumption";

const api = vi.hoisted(() => ({ readPersonnelProfiles: vi.fn(), createPersonnelProfile: vi.fn(), readStaffConsumption: vi.fn(), discountStaffConsumption: vi.fn(), deleteOpenOrder: vi.fn() }));
vi.mock("../lib/api-client", () => api);
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

it("lets staff create a benefit and apply a discount without showing removal", async () => {
  const profile = { id: "person", name: "پریسا", createdAt: new Date().toISOString() };
  api.readPersonnelProfiles.mockResolvedValue({ ok: true, data: [] });
  api.createPersonnelProfile.mockResolvedValue({ ok: true, data: profile });
  api.readStaffConsumption.mockResolvedValue({ ok: true, data: { data: [{ id: "order", version: 1, dailyOrderNumber: 1, username: "staff", createdAt: new Date().toISOString(), totalAmount: 10000, discountAmount: 0, items: [] }], meta: { nextCursor: null } } });
  api.discountStaffConsumption.mockResolvedValue({ ok: true });
  const startOrder = vi.fn();
  render(<StaffConsumption role="STAFF" onOpenMenu={() => {}} onStartOrder={startOrder} />);
  fireEvent.change(await screen.findByLabelText("نام پرسنل"), { target: { value: "پریسا" } });
  fireEvent.click(screen.getByRole("button", { name: "ایجاد پروفایل" }));
  await waitFor(() => expect(api.createPersonnelProfile).toHaveBeenCalledWith("پریسا"));
  fireEvent.click(screen.getByRole("button", { name: "افزودن سفارش برای پرسنل" }));
  expect(startOrder).toHaveBeenCalledWith(profile);
  fireEvent.click(await screen.findByRole("button", { name: "تخفیف" }));
  fireEvent.change(await screen.findByLabelText("مبلغ تخفیف به تومان"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "ثبت تخفیف" }));
  await waitFor(() => expect(api.discountStaffConsumption).toHaveBeenCalledWith("order", 1, { kind: "FIXED", value: 1000 }));
  expect(screen.queryByRole("button", { name: "حذف" })).toBeNull();
});
