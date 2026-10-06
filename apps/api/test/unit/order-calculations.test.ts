import { describe, expect, it } from "vitest";
import { ApplicationError } from "../../src/errors/application-error.js";
import {
  allocationAmountForQuantity,
  calculatedDiscount,
  catalogSaleDiscountAmount,
  discountedFinalAmount,
  paymentStatusForBalance,
} from "../../src/modules/orders/order-calculations.js";

describe("order pricing calculations", () => {
  it("calculates fixed and percentage discounts in integer Toman", () => {
    expect(calculatedDiscount(10_001, { kind: "PERCENTAGE", value: 15 })).toBe(1_500);
    expect(calculatedDiscount(10_000, { kind: "FIXED", value: 1_250 })).toBe(1_250);
    expect(discountedFinalAmount(10_000, { kind: "FIXED", value: 1_500 })).toEqual({
      discountAmount: 1_000,
      finalAmount: 9_000,
    });
  });

  it("rejects discounts above the amount and caps catalog fixed offers", () => {
    expect(() => calculatedDiscount(1_000, { kind: "FIXED", value: 1_001 })).toThrow(ApplicationError);
    expect(catalogSaleDiscountAmount(2_000, { kind: "FIXED", value: 3_000 }, "FIXED", null, 1)).toBe(2_000);
  });

  it("calculates weighted and percentage catalog offers", () => {
    expect(catalogSaleDiscountAmount(60_000, { kind: "FIXED", value: 100_000 }, "WEIGHTED_PER_KG", 250, 2)).toBe(50_000);
    expect(catalogSaleDiscountAmount(60_000, { kind: "PERCENTAGE", value: 10 }, "FIXED", null, 1)).toBe(6_000);
  });
});

describe("selected-quantity settlement allocation", () => {
  it("allocates a rounded line total without losing a remainder", () => {
    const parts = [0, 1, 2].map((alreadyAllocatedQuantity) => allocationAmountForQuantity({
      finalLineAmount: 10_001,
      itemQuantity: 3,
      alreadyAllocatedQuantity,
      quantity: 1,
    }));
    expect(parts).toEqual([3_333, 3_334, 3_334]);
    expect(parts.reduce((sum, amount) => sum + amount, 0)).toBe(10_001);
  });

  it("derives unpaid, partial, and paid status from the remaining balance", () => {
    expect(paymentStatusForBalance(0, 10_000)).toBe("UNPAID");
    expect(paymentStatusForBalance(4_000, 6_000)).toBe("PARTIALLY_PAID");
    expect(paymentStatusForBalance(10_000, 0)).toBe("PAID");
  });
});
