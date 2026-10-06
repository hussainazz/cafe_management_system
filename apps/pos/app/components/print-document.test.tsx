// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrintDocument } from "./print-document";
import { acknowledgeBarTicket, prepareBarTicket, readOrderReceipt, readSettlementReceipt } from "../lib/api-client";
vi.mock("../lib/api-client", () => ({ acknowledgeBarTicket: vi.fn(), prepareBarTicket: vi.fn(), readOrderReceipt: vi.fn(), readSettlementReceipt: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const receipt = { displayTime: "today", totalAmount: 100, items: [{ productName: "Coffee", quantity: 1, options: [], lineTotalAmount: 100, isPaid: true }] };
describe("print completion", () => {
  it.each(["receipt", "settlement"] as const)("paid %s receipt has no struck-through class", async (kind) => {
    vi.spyOn(window, "print").mockImplementation(() => {});
    vi.mocked(readOrderReceipt).mockResolvedValue({ ok: true, replayed: false, data: receipt } as never);
    vi.mocked(readSettlementReceipt).mockResolvedValue({ ok: true, replayed: false, data: receipt } as never);
    const { container } = render(<PrintDocument kind={kind} orderId="order" settlementId="settlement" />);
    await waitFor(() => expect(container.querySelector(".thermal-item")).not.toBeNull());
    expect(container.querySelector(".thermal-item--paid")).toBeNull();
  });
  it("acknowledges the prepared ticket after invoking print without waiting for afterprint", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    vi.mocked(prepareBarTicket).mockResolvedValue({ ok: true, replayed: false, data: { preparationId: "prep", dailyOrderNumber: 1, context: "takeaway", items: [] } });
    vi.mocked(acknowledgeBarTicket).mockResolvedValue({ ok: true, replayed: false, data: { acknowledged: true } });
    const completed = vi.fn();
    window.addEventListener("cafe-print-complete", completed, { once: true });
    render(<PrintDocument kind="bar-ticket" orderId="order" />);
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    await waitFor(() => expect(acknowledgeBarTicket).toHaveBeenCalledOnce());
    expect(acknowledgeBarTicket).toHaveBeenCalledWith("order", "prep");
    expect(completed).toHaveBeenCalledOnce();
  });
  it("reports bounded acknowledgment failure after invoking print", async () => {
    vi.spyOn(window, "print").mockImplementation(() => {});
    vi.mocked(prepareBarTicket).mockResolvedValue({ ok: true, replayed: false, data: { preparationId: "prep", dailyOrderNumber: 1, context: "takeaway", items: [] } });
    vi.mocked(acknowledgeBarTicket).mockResolvedValue({ ok: false, error: { kind: "network", message: "ack failed" } });
    const completed = vi.fn();
    window.addEventListener("cafe-print-complete", completed, { once: true });
    const { container } = render(<PrintDocument kind="bar-ticket" orderId="order" />);
    await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
    await waitFor(() => expect(acknowledgeBarTicket).toHaveBeenCalledTimes(3));
    expect(acknowledgeBarTicket).toHaveBeenCalledTimes(3);
    expect(completed.mock.calls[0]![0].detail.error).toBe("ack failed");
    expect(container.querySelector(".thermal-error")?.textContent).toBe("ack failed");
  });

});
