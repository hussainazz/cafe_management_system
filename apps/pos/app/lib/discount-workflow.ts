export type DiscountKind = "FIXED" | "PERCENTAGE";
export type DiscountDraft = { kind: DiscountKind; value: string; reason?: string };

export function discountPayload(draft: DiscountDraft) {
  const value = Number(draft.value);
  if (!Number.isInteger(value) || value <= 0 || (draft.kind === "PERCENTAGE" && value > 100)) return null;
  const reason = draft.reason?.trim();
  return { kind: draft.kind, value, ...(reason ? { reason } : {}) } as const;
}

export function canChangeDiscount(paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID", target: "item" | "order") {
  return target === "order" ? paymentStatus === "UNPAID" : paymentStatus === "UNPAID";
}
