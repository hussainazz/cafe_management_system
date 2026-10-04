import { describe, expect, it } from "vitest";
import { canChangeDiscount, discountPayload } from "./discount-workflow";

describe("discount workflow", () => {
  it("accepts reasoned fixed and percentage payloads", () => {
    expect(discountPayload({ kind: "FIXED", value: "1000", reason: "  خوش‌حسابی " })).toEqual({ kind: "FIXED", value: 1000, reason: "خوش‌حسابی" });
    expect(discountPayload({ kind: "PERCENTAGE", value: "15", reason: "مشتری ثابت" })).toEqual({ kind: "PERCENTAGE", value: 15, reason: "مشتری ثابت" });
  });
  it("allows an omitted or blank reason and rejects invalid discount values", () => {
    expect(discountPayload({ kind: "FIXED", value: "0", reason: "x" })).toBeNull();
    expect(discountPayload({ kind: "FIXED", value: "10", reason: " " })).toEqual({ kind: "FIXED", value: 10 });
    expect(discountPayload({ kind: "FIXED", value: "10" })).toEqual({ kind: "FIXED", value: 10 });
    expect(discountPayload({ kind: "PERCENTAGE", value: "101", reason: "x" })).toBeNull();
  });
  it("locks all discount changes after the first settlement", () => {
    expect(canChangeDiscount("UNPAID", "item")).toBe(true);
    expect(canChangeDiscount("UNPAID", "order")).toBe(true);
    expect(canChangeDiscount("PARTIALLY_PAID", "item")).toBe(false);
    expect(canChangeDiscount("PAID", "order")).toBe(false);
  });
});
