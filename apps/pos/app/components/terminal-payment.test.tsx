// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalAttempt, TerminalIntent } from "@cafe/contracts";
import { SettlementSheet } from "./orders-workspace";
import { setRecoveryUser } from "../lib/automatic-recovery";
const api = vi.hoisted(() => ({ terminalConfig: vi.fn(), terminalActive: vi.fn(), terminalRead: vi.fn(), terminalPrepare: vi.fn(), terminalReconcile: vi.fn(), readOrder: vi.fn(), recordSettlement: vi.fn(), editSettlement: vi.fn() }));
const bridge = vi.hoisted(() => ({ sendTerminalPurchase: vi.fn() }));
vi.mock("../lib/api-client", () => api);
vi.mock("../lib/sep-payment", () => bridge);
const order = { id: "50000000-0000-4000-8000-000000000001", dailyOrderNumber: 42, version: 1, subtotalAmount: 10000, discountAmount: 0, balanceAmount: 10000, items: [{ id: "50000000-0000-4000-8000-000000000002", productNameSnapshot: "قهوه", quantity: 1, lineTotalAmount: 10000, options: [] }], settlements: [] } as unknown as import("../lib/api-client").PosOrderDetail;
const intent = { attemptId: "50000000-0000-4000-8000-000000000003" } as TerminalIntent;
function attempt(extra: Partial<TerminalAttempt> = {}): TerminalAttempt {
  return { id: intent.attemptId, orderId: "50000000-0000-4000-8000-000000000001", bridgeId: "50000000-0000-4000-8000-000000000004", terminalId: "31187710", cardAmount: 10000, settlementAmount: 10000, payments: [{ method: "CARD_TERMINAL", amount: 10000 }], orderVersion: 2, version: 1, status: "PENDING", createdAt: new Date().toISOString(), dispatchedAt: null, resultReceivedAt: null, responseCode: null, rrn: null, trace: null, settlementId: null, resolvedAt: null, manualVerificationRequired: true, authorization: intent, ...extra };
}
const ok = (data: unknown) => ({ ok: true, data, replayed: false });
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); setRecoveryUser("terminal-fake-user");
  api.terminalConfig.mockResolvedValue(ok({ enabled: true })); api.terminalActive.mockResolvedValue(ok(null));
  api.terminalPrepare.mockResolvedValue(ok(attempt())); api.terminalRead.mockResolvedValue(ok(attempt({ authorization: null })));
  bridge.sendTerminalPurchase.mockResolvedValue(true);
});
afterEach(cleanup);
async function mount() {
  const onSuccess = vi.fn(); render(<SettlementSheet order={order} onClose={vi.fn()} onSuccess={onSuccess} />);
  await screen.findByLabelText("ارسال مبلغ به کارت‌خوان"); return onSuccess;
}
async function start() {
  fireEvent.click(screen.getByLabelText("ارسال مبلغ به کارت‌خوان"));
  fireEvent.click(screen.getByRole("button", { name: "شروع پرداخت با کارت‌خوان" }));
  await waitFor(() => expect(api.terminalPrepare).toHaveBeenCalledTimes(1));
}
describe("Terminal-assisted settlement", () => {
  it("requires explicit action, sends only once, and never posts a local approval as payment", async () => {
    const onSuccess = await mount(); expect(api.terminalPrepare).not.toHaveBeenCalled(); expect(bridge.sendTerminalPurchase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("ارسال مبلغ به کارت‌خوان"));
    const button = screen.getByRole("button", { name: "شروع پرداخت با کارت‌خوان" }); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(bridge.sendTerminalPurchase).toHaveBeenCalledTimes(1));
    expect(api.terminalPrepare).toHaveBeenCalledTimes(1); expect(api.recordSettlement).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "ثبت پرداخت" })).toBeNull();
  });
  it("keeps bridge-offline results uncertain and recovers a server attempt after refresh without sending again", async () => {
    bridge.sendTerminalPurchase.mockResolvedValue(false); await mount(); await start();
    await screen.findByText(/پاسخ برنامه کارت‌خوان دریافت نشد/);
    cleanup(); api.terminalActive.mockResolvedValue(ok(attempt({ status: "UNKNOWN", dispatchedAt: new Date().toISOString(), authorization: null })));
    render(<SettlementSheet order={order} onClose={vi.fn()} onSuccess={vi.fn()} />);
    await screen.findByRole("region", { name: "وضعیت پرداخت کارت‌خوان" });
    expect(bridge.sendTerminalPurchase).toHaveBeenCalledTimes(1); expect(api.terminalPrepare).toHaveBeenCalledTimes(1);
  });
  it("keeps reconciliation available when the feature is disabled and requires explicit receipt verification", async () => {
    api.terminalConfig.mockResolvedValue(ok({ enabled: false }));
    const a = attempt({ status: "UNKNOWN", version: 3, responseCode: "00", dispatchedAt: new Date().toISOString(), authorization: null });
    api.terminalActive.mockResolvedValue(ok(a)); api.terminalReconcile.mockResolvedValue(ok({ ...a, status: "SUCCEEDED", settlementId: "settlement" })); api.readOrder.mockResolvedValue(ok({ ...order, version: 3 }));
    const onSuccess = vi.fn(); render(<SettlementSheet order={order} onClose={vi.fn()} onSuccess={onSuccess} />);
    const confirm = await screen.findByRole("button", { name: "تأیید برداشت و ثبت پرداخت" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true); expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /برداشت موفق و مبلغ/ })); fireEvent.click(confirm);
    await screen.findByText("پرداخت پس از بررسی ثبت شد.");
    expect(api.terminalReconcile).toHaveBeenCalledWith(a.id, { expectedVersion: 3, decision: "SUCCEEDED", basis: "TERMINAL_RECEIPT", receiptChecked: true, cardAmount: 10000 });
    fireEvent.click(screen.getByRole("button", { name: "بازگشت به سفارش" })); await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(bridge.sendTerminalPurchase).not.toHaveBeenCalled();
  });
  it("supports separate partial amounts for two cards using the existing amount allocation contract", async () => {
    await mount(); fireEvent.click(screen.getByLabelText("پرداخت بخشی از مبلغ سفارش"));
    fireEvent.change(screen.getByLabelText("مبلغ این بخش (تومان)"), { target: { value: "4000" } });
    await start();
    expect(api.terminalPrepare.mock.calls[0]![1]).toMatchObject({ allocationMode: "AMOUNT", amount: 4000, payments: [{ method: "CARD_TERMINAL", amount: 4000 }] });
  });
  it("does not dispatch an idempotent recovery response and requires both no-charge and stopped-worker checks", async () => {
    api.terminalPrepare.mockResolvedValue({ ...ok(attempt()), replayed: true }); await mount(); await start();
    expect(bridge.sendTerminalPurchase).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "تأیید عدم برداشت" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "مدرک را بررسی کردم و مبلغی کسر نشده است." })); expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "کارت‌خوان آماده است و پردازش این پرداخت در ویندوز متوقف شده است." }));
    api.terminalReconcile.mockResolvedValue(ok(attempt({ status: "FAILED" }))); fireEvent.click(button);
    await waitFor(() => expect(api.terminalReconcile).toHaveBeenCalledTimes(1));
    expect(api.terminalReconcile.mock.calls[0]![1]).toMatchObject({ noChargeConfirmed: true, bridgeStoppedConfirmed: true, terminalIdleConfirmed: true });
  });
});
