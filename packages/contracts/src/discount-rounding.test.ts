import { describe, expect, it } from "vitest";
import { roundDiscountedAmount } from "./index.js";

describe("roundDiscountedAmount", () => {
  it.each([
    [0, 0],
    [499, 0],
    [500, 1_000],
    [1_499, 1_000],
    [1_500, 2_000],
    [44_499, 44_000],
    [44_500, 45_000],
  ])("rounds %i to %i Toman using nearest-thousand half-up rules", (amount, expected) => {
    expect(roundDiscountedAmount(amount)).toBe(expected);
  });
});
