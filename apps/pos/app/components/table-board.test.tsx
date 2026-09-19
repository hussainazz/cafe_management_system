// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PosTable } from "@cafe/contracts";
import { TableBoard } from "./orders-workspace";

function table(id: string, name: string, hasOrder: boolean): PosTable {
  return {
    id,
    name,
    waiterCallEnabled: true,
    occupancyState: hasOrder ? "OCCUPIED" : "AVAILABLE",
    occupiedAt: null,
    occupancyReminderAt: null,
    activeOrders: hasOrder ? [{ id: "60000000-0000-4000-8000-000000000001", orderNumber: "order", dailyOrderNumber: 1, paymentStatus: "UNPAID", itemPreparationDeadlineMinutes: [], createdAt: new Date().toISOString() }] : [],
  };
}

afterEach(cleanup);

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
    onClosePanel={vi.fn()}
    onEditOrder={vi.fn()}
    onCheckout={vi.fn()}
    onPrint={vi.fn()}
    onRequestTransfer={noop}
  />);
}

describe("independent table board", () => {
  it("does not render QR routing controls", () => {
    renderBoard([table("40000000-0000-4000-8000-000000000003", "3", false), table("40000000-0000-4000-8000-000000000005", "5", false)]);
    expect(screen.queryByText("QR مشترک")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "تخصیص موقت QR" })).toBeNull();
  });

  it("preserves the table tile context-menu guard", () => {
    renderBoard([table("40000000-0000-4000-8000-000000000005", "5", false)]);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    screen.getByRole("button", { name: /^5/ }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
