// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PosTable } from "@cafe/contracts";
import { TableBoard } from "./orders-workspace";

const firstId = "40000000-0000-4000-8000-000000000009";
const secondId = "40000000-0000-4000-8000-000000000010";
const familyId = "50000000-0000-4000-8000-000000000001";

function table(id: string, name: string, hasOrder: boolean): PosTable {
  return {
    id,
    name,
    qrFamilyId: familyId,
    qrFamilyMembers: [{ id: firstId, name: "7" }, { id: secondId, name: "8" }, { id: "40000000-0000-4000-8000-000000000011", name: "سوشال" }],
    qrAssignment: null,
    waiterCallEnabled: true,
    occupancyState: hasOrder ? "OCCUPIED" : "AVAILABLE",
    occupiedAt: null,
    occupancyReminderAt: null,
    activeOrders: hasOrder ? [{ id: "60000000-0000-4000-8000-000000000001", orderNumber: "order", dailyOrderNumber: 1, paymentStatus: "UNPAID", itemPreparationDeadlineMinutes: [], createdAt: new Date().toISOString() }] : [],
  };
}

function renderBoard(tables: PosTable[]) {
  const noop = vi.fn(async () => undefined);
  return render(<TableBoard
    tables={tables}
    tableSeatingLimitMinutes={null}
    calls={[]}
    orders={tables.flatMap((item) => item.activeOrders.map((order) => ({ id: order.id, tableId: item.id, channel: "TABLE" as const, paymentStatus: order.paymentStatus, dailyOrderNumber: order.dailyOrderNumber, totalAmount: 0, balanceAmount: 0 })))}
    selectedTableId={null}
    selectedOrder={null}
    onSelect={vi.fn()}
    onAcknowledgeWaiterCall={vi.fn()}
    acknowledgingTableId={null}
    onMakeAvailable={noop}
    onActivateQrAssignment={noop}
    onCancelQrAssignment={noop}
    onClosePanel={vi.fn()}
    onEditOrder={vi.fn()}
    onCheckout={vi.fn()}
    onPrint={vi.fn()}
    onRequestTransfer={noop}
  />);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("shared-table hold gestures", () => {
  const pointerDown = (element: Element) => {
    const event = new Event("pointerdown", { bubbles: true });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: "touch" },
      clientX: { value: 10 },
      clientY: { value: 10 },
    });
    fireEvent(element, event);
  };

  it("opens QR routing on touch-hold for an anchor table with an order", () => {
    vi.useFakeTimers();
    renderBoard([table(firstId, "7", true), table(secondId, "8", false)]);
    const main = screen.getByRole("button", { name: /7/ });
    pointerDown(main);
    act(() => vi.advanceTimersByTime(650));
    expect(screen.getByRole("dialog", { name: "تخصیص موقت QR" })).toBeTruthy();
  });

  it("opens QR assignment on touch-hold when the shared table has no order", () => {
    vi.useFakeTimers();
    renderBoard([table(firstId, "7", false), table(secondId, "8", false)]);
    expect(screen.queryByRole("button", { name: "تخصیص گروه بعدی با QR" })).toBeNull();
    pointerDown(screen.getByRole("button", { name: /^7/ }));
    act(() => vi.advanceTimersByTime(650));
    expect(screen.getByRole("dialog", { name: "تخصیص موقت QR" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "سوشال" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "8" })).toBeNull();
  });

  it("shows the shared-QR indicator on both tables in the QR group", () => {
    renderBoard([table(firstId, "7", false), table(secondId, "8", false)]);
    expect(screen.getAllByText("QR مشترک")).toHaveLength(2);
  });

  it("does not use a hold gesture to occupy a non-anchor table", () => {
    vi.useFakeTimers();
    renderBoard([table("40000000-0000-4000-8000-000000000006", "5", false)]);
    pointerDown(screen.getByRole("button", { name: /^5/ }));
    act(() => vi.advanceTimersByTime(800));
    expect(screen.queryByRole("dialog", { name: "تخصیص موقت QR" })).toBeNull();
  });

  it("prevents the browser context menu on table tiles", () => {
    renderBoard([table("40000000-0000-4000-8000-000000000006", "5", false)]);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const main = screen.getByRole("button", { name: /^5/ });
    main.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
