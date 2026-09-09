import { describe, expect, it } from "vitest";
import {
  elapsedLabel,
  formatToman,
  positiveIntegerAmount,
  settlementAllocationAmount,
  settlementAvailability,
  sumAmounts,
} from "./pos-utils";

describe("POS display utilities", () => {
  it("formats server integer amounts as Persian Toman values", () => {
    expect(formatToman(185_000)).toBe("185,000");
  });

  it("formats elapsed occupancy without negative time", () => {
    const now = Date.parse("2026-09-05T12:30:00.000Z");
    expect(elapsedLabel("2026-09-05T11:05:00.000Z", now)).toBe("1 ساعت و 25 دقیقه");
    expect(elapsedLabel("2026-09-05T12:35:00.000Z", now)).toBe("0 دقیقه");
    expect(elapsedLabel("2026-09-05T12:24:00.000Z", now)).toBe("6 دقیقه");
  });

  it("sums table and draft amounts without currency conversion", () => {
    expect(sumAmounts([165_000, 205_000, 0])).toBe(370_000);
  });

  it("derives the still-settleable quantities and their authoritative line shares", () => {
    const available = settlementAvailability(
      [
        { id: "espresso", quantity: 3, lineTotalAmount: 100 },
        { id: "tea", quantity: 1, lineTotalAmount: 25 },
      ],
      [{ reversedAt: null, allocations: [{ orderItemId: "espresso", quantity: 1 }] }],
    );

    expect(available.map(({ item, availableQuantity }) => [item.id, availableQuantity])).toEqual([
      ["espresso", 2],
      ["tea", 1],
    ]);
    expect(settlementAllocationAmount({ ...available[0]!, quantity: 1 })).toBe(33);
    expect(settlementAllocationAmount({ ...available[0]!, quantity: 2 })).toBe(67);
  });

  it("accepts only positive integer-Toman tender amounts", () => {
    expect(positiveIntegerAmount("50000")).toBe(50_000);
    expect(positiveIntegerAmount("50.5")).toBe(0);
    expect(positiveIntegerAmount("0")).toBe(0);
  });
});
