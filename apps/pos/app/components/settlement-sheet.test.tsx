// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettlementSheet } from "./orders-workspace";

const api = vi.hoisted(() => ({
  recordSettlement: vi.fn(),
  editSettlement: vi.fn(),
}));

vi.mock("../lib/api-client", () => api);

afterEach(cleanup);

function renderSettlement(totalAmount = 500_000) {
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
  render(<SettlementSheet order={order} onClose={vi.fn()} onSuccess={vi.fn()} />);
}

function amountInput(index: number) {
  return screen.getByLabelText(`مبلغ روش پرداخت ${index}`) as HTMLInputElement;
}

describe("SettlementSheet payment methods", () => {
  it("pre-fills a second method with the unpaid remainder", () => {
    renderSettlement();
    fireEvent.change(amountInput(1), { target: { value: "300000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    expect(amountInput(2).value).toBe("200000");
  });

  it("subtracts all existing methods when adding a third method", () => {
    renderSettlement(1_000_000);
    fireEvent.change(amountInput(1), { target: { value: "400000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    fireEvent.change(amountInput(2), { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    expect(amountInput(3).value).toBe("350000");
  });

  it("uses zero when existing methods already cover the total", () => {
    renderSettlement();
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    expect(amountInput(2).value).toBe("0");
  });

  it("never initializes a negative remainder", () => {
    renderSettlement();
    fireEvent.change(amountInput(1), { target: { value: "600000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    expect(amountInput(2).value).toBe("0");
  });

  it("allows staff to edit an automatically populated amount", () => {
    renderSettlement();
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    fireEvent.change(amountInput(2), { target: { value: "125000" } });
    expect(amountInput(2).value).toBe("125000");
  });

  it("does not replace the amount input while typing consecutive digits", () => {
    renderSettlement();
    const input = amountInput(1);
    input.focus();
    for (const value of ["3", "35", "350", "3500", "35000", "350000"]) {
      fireEvent.change(input, { target: { value } });
      expect(amountInput(1)).toBe(input);
    }
    expect(input.value).toBe("350000");
  });

  it("preserves focus while the amount changes", () => {
    renderSettlement();
    const input = amountInput(1);
    input.focus();
    fireEvent.change(input, { target: { value: "350000" } });
    expect(document.activeElement).toBe(input);
  });

  it("preserves the entered amount when the payment method changes", () => {
    renderSettlement();
    const input = amountInput(1);
    const method = screen.getByLabelText("روش") as HTMLSelectElement;
    fireEvent.change(input, { target: { value: "350000" } });
    fireEvent.change(method, { target: { value: "CARD_TRANSFER" } });
    expect(amountInput(1)).toBe(input);
    expect(input.value).toBe("350000");
  });

  it("recalculates correctly after removing and adding a method", () => {
    renderSettlement();
    fireEvent.change(amountInput(1), { target: { value: "300000" } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    fireEvent.click(screen.getByRole("button", { name: "حذف روش پرداخت 2" }));
    fireEvent.click(screen.getByRole("button", { name: "افزودن روش" }));
    expect(amountInput(2).value).toBe("200000");
  });

  it("keeps the existing single-method settlement behavior", () => {
    renderSettlement();
    expect(amountInput(1).value).toBe("500000");
    expect(screen.queryByRole("button", { name: "حذف روش پرداخت 1" })).toBeNull();
    expect(screen.getByText("مبالغ با هم برابرند.")).toBeTruthy();
  });
});
