import type { ApiFailure, ApiResult, PosOrderDetail } from "./api-client";

type DeleteOrder = () => Promise<ApiResult<PosOrderDetail>>;
type ClearTable = () => Promise<ApiResult<unknown>>;

export type OrderClearResult =
  | { status: "complete"; order: PosOrderDetail }
  | { status: "needs-table-clear"; order: PosOrderDetail; error: ApiFailure }
  | { status: "delete-failed"; error: ApiFailure };

export function canClearTableAfterDeletion(activeOrderCount: number | undefined): boolean {
  return activeOrderCount === 1;
}

/**
 * Deletion is authoritative and must not be replayed when only the subsequent
 * physical-table cleanup fails. The caller keeps the returned clear retry
 * separate from the already-completed logical deletion.
 */
export async function deleteAndClearTableOrder(
  deleteOrder: DeleteOrder,
  clearTable: ClearTable | null,
): Promise<OrderClearResult> {
  const deleted = await deleteOrder();
  if (!deleted.ok) return { status: "delete-failed", error: deleted.error };
  if (!clearTable) return { status: "complete", order: deleted.data };

  const cleared = await clearTable();
  return cleared.ok
    ? { status: "complete", order: deleted.data }
    : { status: "needs-table-clear", order: deleted.data, error: cleared.error };
}
