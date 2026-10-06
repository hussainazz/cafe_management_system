import { roundDiscountedAmount, type DiscountInput } from "@cafe/contracts";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";

export function calculatedDiscount(amount: number, discount: DiscountInput): number {
  if (!discount) return 0;
  const requested = discount.kind === "PERCENTAGE" ? Math.floor((amount * discount.value) / 100) : discount.value;
  if (requested > amount) {
    throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A discount cannot exceed the item or order amount.");
  }
  return requested;
}

export function discountedFinalAmount(amount: number, discount: DiscountInput) {
  if (!discount) return { discountAmount: 0, finalAmount: amount };
  const finalAmount = Math.min(amount, roundDiscountedAmount(amount - calculatedDiscount(amount, discount)));
  return { discountAmount: amount - finalAmount, finalAmount };
}

export function catalogSaleDiscountAmount(
  baseAmount: number,
  discount: DiscountInput,
  pricingMode: "FIXED" | "WEIGHTED_PER_KG",
  weightGrams: number | null | undefined,
  quantity: number,
): number {
  if (!discount) return 0;
  if (discount.kind === "PERCENTAGE") return calculatedDiscount(baseAmount, discount);
  const unitDiscount = pricingMode === "WEIGHTED_PER_KG"
    ? Math.floor((discount.value * (weightGrams ?? 0) * quantity) / 1000)
    : discount.value * quantity;
  return Math.min(baseAmount, unitDiscount);
}

export function allocationAmountForQuantity(input: {
  finalLineAmount: number;
  itemQuantity: number;
  alreadyAllocatedQuantity: number;
  quantity: number;
}): number {
  const allocatedThrough = Math.floor((input.finalLineAmount * input.alreadyAllocatedQuantity) / input.itemQuantity);
  const allocatedAfter = Math.floor((input.finalLineAmount * (input.alreadyAllocatedQuantity + input.quantity)) / input.itemQuantity);
  return allocatedAfter - allocatedThrough;
}

export function paymentStatusForBalance(paidAmount: number, balanceAmount: number): "UNPAID" | "PARTIALLY_PAID" | "PAID" {
  return paidAmount === 0 ? "UNPAID" : balanceAmount === 0 ? "PAID" : "PARTIALLY_PAID";
}
