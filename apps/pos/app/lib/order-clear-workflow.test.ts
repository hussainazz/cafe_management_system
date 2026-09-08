import { describe, expect, it, vi } from "vitest";
import { canClearTableAfterDeletion, deleteAndClearTableOrder } from "./order-clear-workflow";

const order = { id: "order-1", orderNumber: "101" } as never;
const deleted = { ok: true as const, data: order, replayed: false };
const failed = { ok: false as const, error: { kind: "network" as const, message: "ارتباط قطع شد." } };

describe("controlled order clearing", () => {
  it("clears a table only when the deleted order is its final active order", () => {
    expect(canClearTableAfterDeletion(1)).toBe(true);
    expect(canClearTableAfterDeletion(0)).toBe(false);
    expect(canClearTableAfterDeletion(2)).toBe(false);
  });

  it("deletes a takeaway order without issuing a table-clear request", async () => {
    const deleteOrder = vi.fn().mockResolvedValue(deleted);
    const result = await deleteAndClearTableOrder(deleteOrder, null);

    expect(result).toEqual({ status: "complete", order });
    expect(deleteOrder).toHaveBeenCalledOnce();
  });

  it("deletes a table order before clearing its table", async () => {
    const deleteOrder = vi.fn().mockResolvedValue(deleted);
    const clearTable = vi.fn().mockResolvedValue({ ok: true, data: {}, replayed: false });

    await expect(deleteAndClearTableOrder(deleteOrder, clearTable)).resolves.toEqual({ status: "complete", order });
    expect(deleteOrder.mock.invocationCallOrder[0]!).toBeLessThan(clearTable.mock.invocationCallOrder[0]!);
  });

  it("retains a focused table-clear retry state when deletion has already succeeded", async () => {
    const deleteOrder = vi.fn().mockResolvedValue(deleted);
    const clearTable = vi.fn().mockResolvedValue(failed);
    const retryClear = vi.fn().mockResolvedValue({ ok: true, data: {}, replayed: false });

    await expect(deleteAndClearTableOrder(deleteOrder, clearTable)).resolves.toMatchObject({
      status: "needs-table-clear",
      order,
      error: failed.error,
    });
    await expect(retryClear()).resolves.toMatchObject({ ok: true });
    expect(deleteOrder).toHaveBeenCalledOnce();
    expect(clearTable).toHaveBeenCalledOnce();
    expect(retryClear).toHaveBeenCalledOnce();
  });

  it("does not clear a table when logical deletion is rejected", async () => {
    const deleteOrder = vi.fn().mockResolvedValue(failed);
    const clearTable = vi.fn();

    await expect(deleteAndClearTableOrder(deleteOrder, clearTable)).resolves.toEqual({
      status: "delete-failed",
      error: failed.error,
    });
    expect(clearTable).not.toHaveBeenCalled();
  });
});
