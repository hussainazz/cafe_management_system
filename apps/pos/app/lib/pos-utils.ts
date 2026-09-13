export const englishNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function formatToman(amount: number) {
  return englishNumber.format(amount);
}

export function formatOrderNumber(dailyOrderNumber: number) {
  return `#${englishNumber.format(dailyOrderNumber)}`;
}

export function elapsedLabel(startedAt: string | null, now = Date.now()) {
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return null;

  const totalMinutes = Math.max(0, Math.floor((now - started) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${englishNumber.format(minutes)} دقیقه`;
  if (minutes === 0) return `${englishNumber.format(hours)} ساعت`;
  return `${englishNumber.format(hours)} ساعت و ${englishNumber.format(minutes)} دقیقه`;
}

export function sumAmounts(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export type SettlementItem = { id: string; quantity: number; lineTotalAmount: number };
export type SettlementAllocation = { orderItemId: string; quantity: number };
export type SettlementRecord = {
  reversedAt: string | null;
  allocations: SettlementAllocation[];
};

export function settlementAvailability<T extends SettlementItem>(
  items: readonly T[],
  settlements: readonly SettlementRecord[],
) {
  const allocated = new Map<string, number>();
  settlements
    .filter((settlement) => !settlement.reversedAt)
    .forEach((settlement) =>
      settlement.allocations.forEach((allocation) =>
        allocated.set(
          allocation.orderItemId,
          (allocated.get(allocation.orderItemId) ?? 0) + allocation.quantity,
        ),
      ),
    );

  return items
    .map((item) => ({
      item,
      alreadyAllocatedQuantity: allocated.get(item.id) ?? 0,
      availableQuantity: item.quantity - (allocated.get(item.id) ?? 0),
    }))
    .filter((entry) => entry.availableQuantity > 0);
}

export function settlementAllocationAmount(entry: {
  item: SettlementItem;
  alreadyAllocatedQuantity: number;
  quantity: number;
}) {
  const { item, alreadyAllocatedQuantity, quantity } = entry;
  const before = Math.floor((item.lineTotalAmount * alreadyAllocatedQuantity) / item.quantity);
  const after = Math.floor(
    (item.lineTotalAmount * (alreadyAllocatedQuantity + quantity)) / item.quantity,
  );
  return after - before;
}

export function positiveIntegerAmount(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}
