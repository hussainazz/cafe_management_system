import type { PosTable } from "@cafe/contracts";
import type { ApiResult, PosActiveWaiterCall } from "./api-client";

type PendingWaiterCall = Pick<PosActiveWaiterCall, "tableId" | "version">;

export async function acknowledgeAndOpenWaiterCall({
  call,
  table,
  acknowledge,
  refresh,
  openTable,
}: {
  call: PendingWaiterCall;
  table: PosTable;
  acknowledge: (tableId: string, expectedVersion: number) => Promise<ApiResult<PosTable>>;
  refresh: () => Promise<void>;
  openTable: (table: PosTable) => Promise<void>;
}) {
  const result = await acknowledge(table.id, call.version);
  if (!result.ok) return { status: "failed" as const, error: result.error };

  await refresh();
  await openTable(result.data);
  return { status: "acknowledged" as const, table: result.data };
}
