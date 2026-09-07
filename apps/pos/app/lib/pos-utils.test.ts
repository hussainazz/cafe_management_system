import { describe, expect, it } from "vitest";
import { elapsedLabel, formatToman, sumAmounts } from "./pos-utils";

describe("POS display utilities", () => {
  it("formats server integer amounts as Persian Toman values", () => {
    expect(formatToman(185_000)).toBe("185,000");
  });

  it("formats elapsed occupancy without negative time", () => {
    const now = Date.parse("2026-09-05T12:30:00.000Z");
    expect(elapsedLabel("2026-09-05T11:05:00.000Z", now)).toBe("1 ساعت و 25 دقیقه");
    expect(elapsedLabel("2026-09-05T12:35:00.000Z", now)).toBe("0 دقیقه");
  });

  it("sums table and draft amounts without currency conversion", () => {
    expect(sumAmounts([165_000, 205_000, 0])).toBe(370_000);
  });
});
