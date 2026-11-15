type ActiveSettlement = { totalAmount: number; reversal?: unknown; recordedAt?: Date };

export type EligibleSalesOrder = {
  state: string;
  paymentStatus: string;
  isStaffConsumption: boolean;
  totalAmount: number;
  paymentSettlements: ActiveSettlement[];
};

export function activeSalesSettlements<T extends ActiveSettlement>(order: { paymentSettlements: T[] }) {
  return order.paymentSettlements.filter((settlement) => settlement.reversal == null);
}

export function isEligibleSettledOrder(order: EligibleSalesOrder) {
  if (order.state !== "CLOSED" || order.paymentStatus !== "PAID" || order.isStaffConsumption) return false;
  const active = activeSalesSettlements(order);
  if (active.length === 0) return false;
  return active.reduce((sum, settlement) => sum + BigInt(settlement.totalAmount), 0n) === BigInt(order.totalAmount);
}

export function salesChannel(order: {
  channel: "TABLE" | "TAKEAWAY";
  inventorySaleChannel: "TABLE" | "TAKEAWAY" | null;
  deferredAt?: Date | null;
}): "TABLE" | "TAKEAWAY" | "UNKNOWN" {
  if (order.deferredAt && order.inventorySaleChannel === null && order.channel === "TAKEAWAY") return "UNKNOWN";
  return order.inventorySaleChannel ?? order.channel;
}
