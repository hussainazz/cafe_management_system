export type DiscountKind = "FIXED" | "PERCENTAGE";
export type DiscountDraft = { kind: DiscountKind; value: string; reason: string };

export function discountPayload(draft: DiscountDraft) {
  const value = Number(draft.value);
  if (!Number.isInteger(value) || value <= 0 || (draft.kind === "PERCENTAGE" && value > 100) || !draft.reason.trim()) return null;
  return { kind: draft.kind, value, reason: draft.reason.trim() } as const;
}

export function canChangeDiscount(paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID", target: "item" | "order") {
  return target === "order" ? paymentStatus === "UNPAID" : paymentStatus === "UNPAID";
}
