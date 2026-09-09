import { describe, expect, it, vi } from "vitest";
import { acknowledgeAndOpenWaiterCall } from "./waiter-call-workflow";

const table = { id: "table-1", name: "1" } as never;
const call = { tableId: "table-1", version: 4 };

describe("waiter-call handling", () => {
  it("acknowledges with the displayed version, refreshes, then opens the table", async () => {
    const acknowledge = vi.fn().mockResolvedValue({ ok: true, data: table, replayed: false });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const openTable = vi.fn().mockResolvedValue(undefined);

    await expect(acknowledgeAndOpenWaiterCall({ call, table, acknowledge, refresh, openTable })).resolves.toMatchObject({
      status: "acknowledged",
    });

    expect(acknowledge).toHaveBeenCalledWith("table-1", 4);
    expect(refresh.mock.invocationCallOrder[0]!).toBeLessThan(openTable.mock.invocationCallOrder[0]!);
    expect(openTable).toHaveBeenCalledWith(table);
  });

  it("keeps the call retryable when acknowledgement is stale or unavailable", async () => {
    const error = { kind: "response" as const, status: 409, message: "درخواست تغییر کرده است." };
    const acknowledge = vi.fn().mockResolvedValue({ ok: false, error });
    const refresh = vi.fn();
    const openTable = vi.fn();

    await expect(acknowledgeAndOpenWaiterCall({ call, table, acknowledge, refresh, openTable })).resolves.toEqual({
      status: "failed",
      error,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(openTable).not.toHaveBeenCalled();
  });
});
