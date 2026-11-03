// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeferredOrders } from "./deferred-orders";

const read = vi.hoisted(() => vi.fn());
vi.mock("../lib/api-client", () => ({ readOrderList: read }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("shows the customer and opens the selected unpaid order", async () => {
  read.mockResolvedValue({ ok: true, data: { data: { orders: [{ id: "unpaid-1", dailyOrderNumber: 7, deferredCustomerName: "مریم", balanceAmount: 25000 }] }, meta: { page: { nextCursor: null } } } });
  const open = vi.fn();
  render(<DeferredOrders onOpenMenu={() => {}} onOpenOrder={open} />);
  fireEvent.click(await screen.findByRole("button", { name: /مریم/ }));
  expect(open).toHaveBeenCalledWith("unpaid-1");
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ state: "OPEN", deferred: "true" }));
});
