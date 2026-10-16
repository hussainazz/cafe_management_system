// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as automaticRecovery from "../lib/automatic-recovery";
import { setRecoveryUser } from "../lib/automatic-recovery";
import { ManagerWorkspace } from "./manager-workspace";

const catalog = { categories: [{ id: "category-1", name: "قهوه", isActive: true, isPosVisible: true }], products: [], optionGroups: [], tables: [] };

const api = vi.hoisted(() => ({
  readManagerCatalog: vi.fn(), readManagerStaff: vi.fn(), readManagerSettings: vi.fn(),
  readPaymentHistory: vi.fn(), readDailyReport: vi.fn(), readAuditLog: vi.fn(), readOrder: vi.fn(), readOrderList: vi.fn(),
  readInventoryStockItems: vi.fn(), readInventoryPurchases: vi.fn(), readInventoryRecipes: vi.fn(), readInventoryCounts: vi.fn(), readInventoryMovements: vi.fn(), readPendingInventoryConsumption: vi.fn(), readGrossProfitReport: vi.fn(), readProductCosting: vi.fn(),
  deleteOpenOrder: vi.fn(),
  archiveCategory: vi.fn(), archiveOption: vi.fn(), archiveProduct: vi.fn(), archiveProductImage: vi.fn(), archiveTable: vi.fn(), deactivateStaff: vi.fn(), reactivateStaff: vi.fn(), saveCategory: vi.fn(), saveOption: vi.fn(), saveOptionGroup: vi.fn(), saveProduct: vi.fn(), saveSettings: vi.fn(), activateInventory: vi.fn(), saveStaff: vi.fn(), saveTable: vi.fn(), uploadProductImage: vi.fn(), reorderCategories: vi.fn(), reorderProducts: vi.fn(),
}));

vi.mock("../lib/api-client", () => api);

describe("ManagerWorkspace", () => {
  afterEach(cleanup);
  beforeEach(() => {
    setRecoveryUser(`manager-test-${crypto.randomUUID()}`);
    vi.clearAllMocks();
    api.readManagerCatalog.mockResolvedValue({ ok: true, data: catalog });
    api.readManagerStaff.mockResolvedValue({ ok: true, data: [] });
    api.readManagerSettings.mockResolvedValue({ ok: true, data: { id: "00000000-0000-4000-8000-000000000001", tableSeatingLimitMinutes: null, inventoryActivatedAt: "2026-10-15T00:00:00.000Z", updatedAt: new Date().toISOString() } });
    api.readPaymentHistory.mockResolvedValue({ ok: true, data: [] });
    api.readOrderList.mockResolvedValue({ ok: true, data: { data: { orders: [] }, meta: { page: { limit: 100, nextCursor: null, hasMore: false } } } });
    api.readDailyReport.mockResolvedValue({ ok: true, data: null });
    api.readAuditLog.mockResolvedValue({ ok: true, data: { data: { entries: [] }, meta: { page: { nextCursor: null } } } });
    api.readInventoryStockItems.mockResolvedValue({ ok: true, data: { data: { stockItems: [] }, meta: { requestId: "test" } } });
    api.readInventoryPurchases.mockResolvedValue({ ok: true, data: { data: { purchases: [], page: { limit: 20, nextCursor: null, hasMore: false } }, meta: { requestId: "test" } } });
    api.readInventoryRecipes.mockResolvedValue({ ok: true, data: { data: { recipes: [] }, meta: { requestId: "test" } } });
    api.readInventoryCounts.mockResolvedValue({ ok: true, data: { data: { counts: [], page: { limit: 20, nextCursor: null, hasMore: false } }, meta: { requestId: "test" } } });
    api.readInventoryMovements.mockResolvedValue({ ok: true, data: { data: { movements: [] }, meta: { requestId: "test", page: { limit: 20, nextCursor: null, hasMore: false } } } });
    api.readPendingInventoryConsumption.mockResolvedValue({ ok: true, data: { data: { consumptions: [] }, meta: { requestId: "test" } } });
    api.readGrossProfitReport.mockResolvedValue({ ok: false, error: { kind: "response", message: "No inventory report" } });
    api.readProductCosting.mockResolvedValue({ ok: true, data: { data: null, meta: { requestId: "test" } } });
  });

  it("shows inactive inventory without fetching inventory data", async () => {
    api.readManagerSettings.mockResolvedValue({ ok: true, data: { id: "settings", tableSeatingLimitMinutes: null, inventoryActivatedAt: null, updatedAt: new Date().toISOString() } });
    render(<ManagerWorkspace section="inventory" menuOpen={false} onOpenMenu={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "انبار غیرفعال است" })).toBeTruthy();
    expect(api.readInventoryStockItems).not.toHaveBeenCalled();
    expect(api.readPendingInventoryConsumption).not.toHaveBeenCalled();
  });

  it("confirms activation and locks the switch after the server accepts it", async () => {
    const inactive = { id: "settings", tableSeatingLimitMinutes: null, inventoryActivatedAt: null, updatedAt: new Date().toISOString() };
    api.readManagerSettings.mockResolvedValueOnce({ ok: true, data: inactive }).mockResolvedValue({ ok: true, data: { ...inactive, inventoryActivatedAt: "2026-10-15T00:00:00.000Z" } });
    api.activateInventory.mockResolvedValue({ ok: true });
    render(<ManagerWorkspace section="settings" menuOpen={false} onOpenMenu={vi.fn()} />);
    const toggle = await screen.findByRole("checkbox", { name: "فعال‌سازی انبار" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(api.activateInventory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "تأیید" }));
    await waitFor(() => expect(api.activateInventory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "فعال‌سازی انبار" }) as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByRole("checkbox", { name: "فعال‌سازی انبار" }) as HTMLInputElement).checked).toBe(true);
  });

  it("opens the Manager inventory workspace and loads its inventory data", async () => {
    render(<ManagerWorkspace section="inventory" menuOpen={false} onOpenMenu={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "پیش‌نویس خرید" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "شمارش انبار" }));
    await waitFor(() => expect(api.readInventoryCounts).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "سود ناخالص" }));
    expect(await screen.findByRole("heading", { name: "گزارش سود ناخالص" })).toBeTruthy();
    await waitFor(() => expect(api.readInventoryStockItems).toHaveBeenCalledTimes(1));
    expect(api.readInventoryPurchases).toHaveBeenCalledTimes(1);
    expect(api.readInventoryRecipes).toHaveBeenCalledTimes(1);
    expect(api.readInventoryMovements).not.toHaveBeenCalled();
    expect(api.readPendingInventoryConsumption).toHaveBeenCalledTimes(1);
    expect(api.readGrossProfitReport).toHaveBeenCalledTimes(1);
  });

  it("restores applied and draft finance filters and table panel from actual session storage", async () => {
    setRecoveryUser("manager-remount"); sessionStorage.clear();
    const mount = (section: "finance" | "settings" = "finance") => render(<ManagerWorkspace section={section} menuOpen={false} onOpenMenu={() => undefined} />);
    mount(); await waitFor(() => expect(api.readPaymentHistory).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("از ساعت"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("تا ساعت"), { target: { value: "15:00" } });
    fireEvent.submit(screen.getByLabelText("از تاریخ").closest("form")!);
    await waitFor(() => expect(api.readPaymentHistory).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("از ساعت"), { target: { value: "10:00" } });
    cleanup(); setRecoveryUser("other-user"); setRecoveryUser("manager-remount"); mount();
    await waitFor(() => expect(api.readPaymentHistory).toHaveBeenCalledTimes(3));
    expect(api.readPaymentHistory).toHaveBeenLastCalledWith(expect.objectContaining({ fromTime: "09:00", toTime: "15:00" }));
    expect((screen.getByLabelText("از ساعت") as HTMLInputElement).value).toBe("10:00");
    cleanup(); mount("settings");
    fireEvent.click(await screen.findByRole("button", { name: "میزها" })); cleanup();
    setRecoveryUser("other-user"); setRecoveryUser("manager-remount"); mount("settings");
    expect(await screen.findByText("افزودن میز")).toBeTruthy();
  });

  it("keeps a partial initial-load failure visible after sibling reads succeed", async () => {
    api.readManagerStaff.mockResolvedValue({ ok: false, error: { kind: "response", message: "Staff unavailable" } });
    render(<ManagerWorkspace menuOpen={false} onOpenMenu={() => undefined} />);
    expect(await screen.findByText("بخشی از اطلاعات مدیریت به‌روز نیست.")).toBeTruthy();
    expect(screen.getByText("Staff unavailable")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "تنظیمات کافه" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "میزها" })).toBeTruthy();
  });

  it("keeps Manager on the active panel after an ordinary API response error", async () => {
    const recovery = vi.spyOn(automaticRecovery, "requestAutomaticRecovery");
    render(<ManagerWorkspace section="inventory" menuOpen={false} onOpenMenu={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "سود ناخالص" }));
    expect(await screen.findByRole("heading", { name: "گزارش سود ناخالص" })).toBeTruthy();

    window.dispatchEvent(new CustomEvent("run-cafe:api-failure", {
      detail: { kind: "response", status: 422, code: "BUSINESS_RULE_VIOLATION", message: "Invalid return quantity" },
    }));

    expect(screen.getByRole("heading", { name: "گزارش سود ناخالص" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "اتصال برقرار است" })).toBeTruthy();
    expect(recovery).not.toHaveBeenCalled();
  });

  it("keeps General Settings available when the Personnel read fails", async () => {
    api.readManagerStaff.mockResolvedValue({ ok: false, error: { kind: "response", message: "Staff unavailable" } });
    render(<ManagerWorkspace menuOpen={false} onOpenMenu={() => undefined} />);
    expect(await screen.findByRole("button", { name: "تنظیمات" })).toBeTruthy();
    expect(await screen.findByText("تنظیمات کافه")).toBeTruthy();
    expect(screen.getByText("فهرست پرسنل بارگذاری نشد.")).toBeTruthy();
  });

  it("does not refetch finance data while audit filters are being typed", async () => {
    render(<ManagerWorkspace menuOpen={false} onOpenMenu={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "حسابرسی" }));
    await waitFor(() => expect(api.readAuditLog).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("عملیات"), { target: { value: "UPDATE_PRODUCT" } });
    expect(api.readAuditLog).toHaveBeenCalledTimes(1);
    expect(api.readPaymentHistory).toHaveBeenCalledTimes(1);
    fireEvent.submit(screen.getByLabelText("عملیات").closest("form")!);
    await waitFor(() => expect(api.readAuditLog).toHaveBeenCalledTimes(2));
    expect(api.readPaymentHistory).toHaveBeenCalledTimes(1);
  });

  it("applies complete Tehran-date payment filters only after Apply and resets to today", async () => {
    render(<ManagerWorkspace section="finance" menuOpen={false} onOpenMenu={() => undefined} />);
    await waitFor(() => expect(api.readPaymentHistory).toHaveBeenCalledTimes(1));
    expect(api.readPaymentHistory).toHaveBeenLastCalledWith(expect.objectContaining({ fromDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), toDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    fireEvent.click(screen.getByRole("button", { name: "بازه دلخواه" }));
    expect((screen.getByLabelText("از تاریخ") as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "06/25" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ"), { target: { value: "06/29" } });
    fireEvent.change(screen.getByLabelText("از ساعت"), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("تا ساعت"), { target: { value: "22:30" } });
    expect(api.readPaymentHistory).toHaveBeenCalledTimes(1);
    fireEvent.submit(screen.getByLabelText("از تاریخ").closest("form")!);
    await waitFor(() => expect(api.readPaymentHistory).toHaveBeenCalledTimes(2));
    expect(api.readPaymentHistory).toHaveBeenLastCalledWith({ fromDate: "2026-09-16", toDate: "2026-09-20", fromTime: "18:00", toTime: "22:30" });
    fireEvent.click(screen.getByRole("button", { name: "بازنشانی فیلترها" }));
    await waitFor(() => expect(api.readPaymentHistory).toHaveBeenCalledTimes(3));
    expect((screen.getByLabelText("از ساعت") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("بارگذاری بیشتر")).toBeNull();
  });

  it("applies shift presets to history and summary together without excluding the last minute", async () => {
    render(<ManagerWorkspace section="finance" menuOpen={false} onOpenMenu={() => undefined} />);
    await waitFor(() => expect(api.readPaymentHistory).toHaveBeenCalledTimes(1));
    const dates = api.readPaymentHistory.mock.calls[0]![0];
    for (const [shift, bounds] of [
      ["morning", { fromTime: "08:00", toTime: "16:00" }],
      ["evening", { fromTime: "16:00" }],
      ["all", {}],
    ] as const) {
      fireEvent.change(screen.getByLabelText("بازه‌ی پرداخت"), { target: { value: shift } });
      await waitFor(() => expect(api.readPaymentHistory).toHaveBeenLastCalledWith({ ...dates, ...bounds }));
      expect(api.readDailyReport).toHaveBeenLastCalledWith({ ...dates, ...bounds });
    }
    fireEvent.change(screen.getByLabelText("از ساعت"), { target: { value: "10:00" } });
    expect((screen.getByLabelText("بازه‌ی پرداخت") as HTMLSelectElement).value).toBe("all");
    expect(screen.queryByRole("option", { name: "بازه‌ی دلخواه" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "بازنشانی فیلترها" }));
    expect((screen.getByLabelText("بازه‌ی پرداخت") as HTMLSelectElement).value).toBe("all");
  });

  it("renders the finance dashboard metrics and applies date presets and custom clock bounds", async () => {
    api.readDailyReport.mockResolvedValue({ ok: true, data: {
      meta: { range: { from: "2026-10-14T20:30:00.000Z", to: "2026-10-15T20:29:59.999Z" } },
      data: { salesAmount: 2_270_000, paidAmount: 2_720_000, orderCount: 1, paymentMethodTotals: { cashAmount: 120_000, cardTerminalAmount: 2_250_000, cardTransferAmount: 350_000 }, discounts: { totalAmount: 0 }, reversals: { count: 0, amount: 0 } },
    } });
    render(<ManagerWorkspace section="finance" menuOpen={false} onOpenMenu={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "نمای کلی مالی" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "فیلترهای بیشتر" })).toBeNull();
    expect(screen.getByLabelText("از تاریخ")).toBeTruthy();
    expect(screen.getByLabelText("بازه‌ی پرداخت")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "بازه‌ی دلخواه" })).toBeNull();
    expect(await screen.findByText("2,270,000")).toBeTruthy();
    expect(screen.getByText("کل", { selector: "span" }).parentElement?.textContent).toContain("2,270,000");
    expect(screen.getByText("تسویه شده", { selector: "span" }).parentElement?.textContent).toContain("2,720,000");
    expect(screen.getByText("کارت‌به‌کارت", { selector: "span" }).parentElement?.textContent).toContain("350,000");
    expect(screen.getByText("نقدی", { selector: "span" }).parentElement?.textContent).toContain("120,000");
    expect(screen.queryByText("تعداد سفارش", { selector: "span" })).toBeNull();
    expect(screen.queryByText("تخفیف", { selector: "span" })).toBeNull();
    fireEvent.click(screen.getByText("جزئیات گزارش و برگشت‌ها"));
    expect(screen.getByText("تعداد سفارش", { selector: "dt" }).nextElementSibling?.textContent).toBe("1 سفارش");
    expect(screen.getByText("تخفیف", { selector: "dt" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "دیروز" }));
    await waitFor(() => expect(api.readDailyReport).toHaveBeenCalledTimes(2));
    expect(api.readDailyReport.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ fromDate: expect.any(String), toDate: expect.any(String) }));
    fireEvent.click(screen.getByRole("button", { name: "7 روز اخیر" }));
    await waitFor(() => expect(api.readPaymentHistory).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole("button", { name: "بازه دلخواه" }));
    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "07/22" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ"), { target: { value: "07/22" } });
    fireEvent.click(screen.getByRole("button", { name: "روز بعد برای تاریخ شروع" }));
    expect((screen.getByLabelText("از تاریخ") as HTMLInputElement).value).toBe("07/23");
    fireEvent.click(screen.getByRole("button", { name: "روز قبل برای تاریخ شروع" }));
    expect((screen.getByLabelText("از تاریخ") as HTMLInputElement).value).toBe("07/22");
    expect(screen.queryByRole("option", { name: "بازه‌ی دلخواه" })).toBeNull();
    fireEvent.change(screen.getByLabelText("از ساعت"), { target: { value: "12:00" } });
    fireEvent.change(screen.getByLabelText("تا ساعت"), { target: { value: "18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "نمایش نتایج" }));
    await waitFor(() => expect(api.readPaymentHistory).toHaveBeenLastCalledWith(expect.objectContaining({ fromTime: "12:00", toTime: "18:00" })));
    expect(api.readDailyReport).toHaveBeenLastCalledWith(expect.objectContaining({ fromTime: "12:00", toTime: "18:00" }));
  });

  it("does not expose settlement reversal in payment history", async () => {
    api.readPaymentHistory.mockResolvedValue({ ok: true, data: [{ id: "settlement-1", orderId: "order-1", orderNumber: "1001", dailyOrderNumber: 1, orderState: "CLOSED", totalAmount: 25_000, recordedAt: "2026-09-13T08:00:00.000Z", recordedBy: { username: "manager" }, channel: "TABLE", table: { name: "1" }, reversedAt: null, payments: [{ method: "CASH" }] }] });
    render(<ManagerWorkspace section="finance" menuOpen={false} onOpenMenu={() => undefined} />);
    expect(screen.queryByText("برگشت تسویه")).toBeNull();
    expect(await screen.findByText("ویرایش پرداخت")).toBeTruthy();
    expect(await screen.findByText("حذف سفارش")).toBeTruthy();
  });

  it("renders payment history as a sortable table", async () => {
    api.readPaymentHistory.mockResolvedValue({
      ok: true,
      data: [
          { id: "settlement-2", orderId: "order-2", orderNumber: "1002", dailyOrderNumber: 2, totalAmount: 40_000, recordedAt: "2026-09-13T09:00:00.000Z", recordedBy: { username: "z" }, channel: "TAKEAWAY", table: null, reversedAt: null, payments: [{ method: "CASH" }] },
          { id: "settlement-1", orderId: "order-1", orderNumber: "1001", dailyOrderNumber: 1, totalAmount: 20_000, recordedAt: "2026-09-13T08:00:00.000Z", recordedBy: { username: "a" }, channel: "TABLE", table: { name: "1" }, reversedAt: null, payments: [{ method: "CARD_TERMINAL" }] },
        ],
    });
    render(<ManagerWorkspace section="finance" menuOpen={false} onOpenMenu={() => undefined} />);
    const table = await screen.findByRole("table", { name: "تاریخچه پرداخت‌ها" });
    expect(table.className).toContain("manager-payment-table");
    expect(screen.queryByText(/شناسه پرداخت/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "مبلغ" }));
    expect(screen.getByRole("columnheader", { name: "مبلغ ↓" }).getAttribute("aria-sort")).toBe("descending");
  });

  it("keeps order filters exclusive and shows prior unpaid orders in their own list", async () => {
    api.readOrderList.mockResolvedValue({ ok: true, data: {
      data: { orders: [{ id: "old-order", orderNumber: "OLD-1", dailyOrderNumber: 1, channel: "TAKEAWAY", tableId: null, state: "OPEN", paymentStatus: "UNPAID", version: 1, totalAmount: 80_000, balanceAmount: 80_000, createdAt: "2026-09-14T08:00:00.000Z" }] },
      meta: { page: { limit: 100, nextCursor: null, hasMore: false } },
    } });
    render(<ManagerWorkspace section="finance" menuOpen={false} onOpenMenu={() => undefined} />);
    const historyTable = await screen.findByRole("table", { name: "تاریخچه پرداخت‌ها" });
    const multiSettlementFilter = screen.getByRole("button", { name: "تسویه‌ی چندمرحله‌ای" });
    const unpaidFilter = screen.getByRole("button", { name: "پرداخت‌نشده‌ی روزهای قبل" });
    const discountFilter = screen.getByRole("button", { name: "سفارش‌های تخفیف‌دار" });

    fireEvent.click(multiSettlementFilter);
    await waitFor(() => expect(api.readPaymentHistory).toHaveBeenLastCalledWith(expect.any(Object), "MULTIPLE_SETTLEMENTS"));
    expect(multiSettlementFilter.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(discountFilter);
    await waitFor(() => expect(api.readPaymentHistory).toHaveBeenLastCalledWith(expect.any(Object), "DISCOUNTED"));
    expect(multiSettlementFilter.getAttribute("aria-pressed")).toBe("false");
    expect(discountFilter.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(unpaidFilter);
    const priorOrders = await screen.findByRole("table", { name: "سفارش‌های پرداخت‌نشده‌ی روزهای قبل" });
    expect(priorOrders).not.toBe(historyTable);
    expect(await screen.findByText("سفارش‌های پرداخت‌نشده پیش از شروع این بازه")).toBeTruthy();
    expect((await screen.findAllByText("80,000")).length).toBe(2);
    await waitFor(() => expect(api.readOrderList).toHaveBeenCalledWith(expect.objectContaining({ state: "OPEN", paymentStatus: "UNPAID", limit: 100, to: expect.any(String) })));
    expect(discountFilter.getAttribute("aria-pressed")).toBe("false");
    expect(unpaidFilter.getAttribute("aria-pressed")).toBe("true");
  });

  it("offers logical payment deletion for each payment-history row", async () => {
    api.readPaymentHistory.mockResolvedValueOnce({ ok: true, data: [{ id: "settlement-1", orderId: "order-1", orderNumber: "1001", dailyOrderNumber: 1, orderState: "CLOSED", totalAmount: 20_000, recordedAt: "2026-09-13T08:00:00.000Z", recordedBy: { username: "manager" }, channel: "TAKEAWAY", table: null, reversedAt: null, payments: [{ method: "CASH" }] }] }).mockResolvedValueOnce({ ok: true, data: [{ id: "settlement-1", orderId: "order-1", orderNumber: "1001", dailyOrderNumber: 1, orderState: "DELETED", totalAmount: 20_000, recordedAt: "2026-09-13T08:00:00.000Z", recordedBy: { username: "manager" }, channel: "TAKEAWAY", table: null, reversedAt: null, payments: [{ method: "CASH" }] }] });
    api.readOrder.mockResolvedValue({ ok: true, data: { version: 4, dailyOrderNumber: 1 } });
    api.deleteOpenOrder.mockResolvedValue({ ok: true });
    render(<ManagerWorkspace section="finance" menuOpen={false} onOpenMenu={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "حذف سفارش" }));
    fireEvent.click(screen.getByText("تأیید"));
    await waitFor(() => expect(api.deleteOpenOrder).toHaveBeenCalledWith("order-1", { expectedVersion: 4 }));
    expect(await screen.findByText("حذف‌شده")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ویرایش پرداخت" })).toBeNull();
    expect(screen.queryByRole("button", { name: "حذف سفارش" })).toBeNull();
  });

  it("opens the settlement sheet directly instead of the historical order-details dialog", async () => {
    api.readPaymentHistory.mockResolvedValue({ ok: true, data: [{ id: "settlement-1", orderId: "order-1", orderNumber: "1001", dailyOrderNumber: 1, totalAmount: 20_000, recordedAt: "2026-09-13T08:00:00.000Z", recordedBy: { username: "manager" }, channel: "TABLE", table: { name: "1" }, reversedAt: null, payments: [{ method: "CASH", amount: 20_000, reference: null }] }] });
    api.readOrder.mockResolvedValue({ ok: true, data: {
      id: "order-1", orderNumber: "1001", dailyOrderNumber: 1, channel: "TABLE", tableId: "table-1", tableName: "1", state: "CLOSED", paymentStatus: "PAID", version: 2,
      discountAmount: 0, discountKind: null, discountValue: null, discountReason: null, subtotalAmount: 20_000, totalAmount: 20_000, paidAmount: 20_000, balanceAmount: 0, createdAt: "2026-09-13T07:00:00.000Z",
      items: [{ id: "item-1", productId: "product-1", productNameSnapshot: "قهوه", basePriceSnapshot: 20_000, quantity: 1, note: null, discountKind: null, discountValue: null, discountAmount: 0, discountReason: null, lineTotalAmount: 20_000, options: [] }],
      settlements: [{ id: "settlement-1", totalAmount: 20_000, recordedAt: "2026-09-13T08:00:00.000Z", reversedAt: null, allocations: [{ orderItemId: "item-1", quantity: 1, amount: 20_000 }], payments: [{ method: "CASH", amount: 20_000, reference: null }] }],
    } });
    render(<ManagerWorkspace section="finance" menuOpen={false} onOpenMenu={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش پرداخت" }));
    expect(await screen.findByRole("heading", { name: "اصلاح پرداخت #1" })).toBeTruthy();
    expect(screen.queryByText("سفارش ذخیره‌شده")).toBeNull();
  });

  it("shows upload progress while an item image is being sent", async () => {
    let finishUpload: (() => void) | undefined;
    api.readManagerCatalog.mockResolvedValue({
      ok: true,
      data: {
        ...catalog,
        products: [{
          id: "product-1",
          categoryId: "category-1",
          name: "ترک",
          priceAmount: 185_000,
          isAvailable: true,
          isActive: true,
          preparationDeadlineMinutes: 5,
          image: null,
        }],
      },
    });
    api.uploadProductImage.mockImplementation(
      () => new Promise((resolve) => { finishUpload = () => resolve({ ok: true }); }),
    );
    render(<ManagerWorkspace section="catalog" menuOpen={false} onOpenMenu={() => undefined} />);
    await screen.findByText("ترک");
    fireEvent.click(screen.getByText("ترک"));
    fireEvent.click(screen.getByRole("tab", { name: "تصویر" }));
    const file = new File(["image"], "turkish.webp", { type: "image/webp" });
    const imageInput = screen.getByLabelText("تصویر JPEG/PNG/WebP") as HTMLInputElement;
    Object.defineProperty(imageInput, "files", { value: [file] });
    fireEvent.change(imageInput);
    fireEvent.submit(imageInput.closest("form")!);
    expect(await screen.findByRole("progressbar", { name: "پیشرفت بارگذاری تصویر" })).toBeTruthy();
    expect(screen.getByText("0٪")).toBeTruthy();
    finishUpload?.();
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
  });
});
