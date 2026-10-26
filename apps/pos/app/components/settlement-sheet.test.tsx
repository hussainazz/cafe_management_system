// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setRecoveryUser } from "../lib/automatic-recovery";
import { SettlementSheet } from "./orders-workspace";

const api = vi.hoisted(() => ({
  terminalConfig: vi.fn(async () => ({ ok: true, data: { enabled: false } })),
  terminalActive: vi.fn(async () => ({ ok: true, data: null })),
  recordSettlement: vi.fn(),
  editSettlement: vi.fn(),
}));

vi.mock("../lib/api-client", () => api);

afterEach(cleanup);

async function renderSettlement(totalAmount = 500_000) {
  const item = {
    id: "item-1",
    productNameSnapshot: "قهوه",
    quantity: 1,
    lineTotalAmount: totalAmount,
    productId: "product-1",
    weightGrams: null,
    pricingModeSnapshot: "FIXED",
    note: null,
    options: [],
  };
  const order = {
    id: "order-1",
    dailyOrderNumber: 42,
    version: 1,
    subtotalAmount: totalAmount,
    discountAmount: 0,
    items: [item],
    settlements: [],
  } as never;
  render(<StrictMode><SettlementSheet order={order} onClose={vi.fn()} onSuccess={vi.fn()} /></StrictMode>);
  await waitFor(() => expect(screen.queryByRole("button", { name: "در حال بررسی…" })).toBeNull());
}

function amountInput(index: number) {
  return screen.getByLabelText(`مبلغ روش پرداخت ${index}`) as HTMLInputElement;
}

describe("SettlementSheet payment methods", async () => {
  it("pre-fills a second method with the unpaid remainder", async () => {
    await renderSettlement();
    fireEvent.change(amountInput(1), { target: { value: "300000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    expect(amountInput(2).value).toBe("200000");
  });

  it("subtracts all existing methods when adding a third method", async () => {
    await renderSettlement(1_000_000);
    fireEvent.change(amountInput(1), { target: { value: "400000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    fireEvent.change(amountInput(2), { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    expect(amountInput(3).value).toBe("350000");
  });

  it("uses zero when existing methods already cover the total", async () => {
    await renderSettlement();
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    expect(amountInput(2).value).toBe("0");
  });

  it("never initializes a negative remainder", async () => {
    await renderSettlement();
    fireEvent.change(amountInput(1), { target: { value: "600000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    expect(amountInput(2).value).toBe("0");
  });

  it("allows staff to edit an automatically populated amount", async () => {
    await renderSettlement();
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    fireEvent.change(amountInput(2), { target: { value: "125000" } });
    expect(amountInput(2).value).toBe("125000");
  });

  it("does not replace the amount input while typing consecutive digits", async () => {
    await renderSettlement();
    const input = amountInput(1);
    input.focus();
    for (const value of ["3", "35", "350", "3500", "35000", "350000"]) {
      fireEvent.change(input, { target: { value } });
      expect(amountInput(1)).toBe(input);
    }
    expect(input.value).toBe("350000");
  });

  it("preserves focus while the amount changes", async () => {
    await renderSettlement();
    const input = amountInput(1);
    input.focus();
    fireEvent.change(input, { target: { value: "350000" } });
    expect(document.activeElement).toBe(input);
  });

  it("preserves the entered amount when the payment method changes", async () => {
    await renderSettlement();
    const input = amountInput(1);
    const method = screen.getByLabelText("روش پرداخت") as HTMLSelectElement;
    fireEvent.change(input, { target: { value: "350000" } });
    fireEvent.change(method, { target: { value: "CARD_TRANSFER" } });
    expect(amountInput(1)).toBe(input);
    expect(input.value).toBe("350000");
  });

  it("recalculates correctly after removing and adding a method", async () => {
    await renderSettlement();
    fireEvent.change(amountInput(1), { target: { value: "300000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    fireEvent.click(screen.getByRole("button", { name: "حذف روش پرداخت 2" }));
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    expect(amountInput(2).value).toBe("200000");
  });

  it("keeps the existing single-method settlement behavior", async () => {
    await renderSettlement();
    expect(amountInput(1).value).toBe("500000");
    expect(screen.queryByRole("button", { name: "حذف روش پرداخت 1" })).toBeNull();
    expect((screen.getByRole("button", { name: "ثبت پرداخت" }) as HTMLButtonElement).disabled).toBe(false);
  });
});


describe("payment recovery", async () => {
  it("restores tender inputs after remount and isolates another user", async () => {
    setRecoveryUser("recovery-user-a");
    sessionStorage.clear();
    await renderSettlement();
    fireEvent.change(amountInput(1), { target: { value: "300000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    cleanup();
    await renderSettlement();
    expect(amountInput(1).value).toBe("300000");
    expect(amountInput(2).value).toBe("200000");
    cleanup();
    setRecoveryUser("recovery-user-b");
    await renderSettlement();
    expect(amountInput(1).value).toBe("500000");
    expect(screen.queryByLabelText("مبلغ روش پرداخت 2")).toBeNull();
  });
});


it("does not replay uncertain payment after remount and preserves its retry key", async () => {
  setRecoveryUser("uncertain-payment"); api.recordSettlement.mockClear();
  api.recordSettlement.mockResolvedValue({ ok: false, error: { message: "uncertain payment" } });
  await renderSettlement();
  fireEvent.click(screen.getByRole("button", { name: "ثبت پرداخت" }));
  await screen.findByText("uncertain payment");
  const key = api.recordSettlement.mock.calls[0]![2];
  cleanup(); await renderSettlement();
  expect(api.recordSettlement).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "ثبت پرداخت" }));
  await waitFor(() => expect(api.recordSettlement).toHaveBeenCalledTimes(2));
  expect(api.recordSettlement.mock.calls[1]![2]).toBe(key);
});


it("preserves deliberately unreconciled single tender through actual reload and StrictMode effect replay", async () => {
  setRecoveryUser("unreconciled-reload"); await renderSettlement(100000);
  fireEvent.change(amountInput(1), { target: { value: "50000" } });
  cleanup(); setRecoveryUser("other-user"); setRecoveryUser("unreconciled-reload");
  await renderSettlement(100000);
  expect(amountInput(1).value).toBe("50000");
  expect((screen.getByRole("button", { name: "ثبت پرداخت" }) as HTMLButtonElement).disabled).toBe(true);
});
