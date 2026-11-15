import { describe, expect, it } from "vitest";
import { calculatePricingShapleyEffects, pricingExperimentComparisonDates } from "../src/modules/inventory/pricing-experiment.service.js";

describe("pricing experiment comparison methodology", () => {
  it("matches full days by Tehran weekday and excludes the effective and current partial days", () => {
    const result = pricingExperimentComparisonDates(new Date("2026-11-01T20:30:00.000Z"), 7, "2026-11-06");
    expect(result.effectiveDate).toBe("2026-11-02");
    expect(result.effectiveDayExcluded).toBe(true);
    expect(result.excludedCurrentPartialDay).toBe(true);
    expect(result.after).not.toContain("2026-11-02");
    expect(result.after).not.toContain("2026-11-06");
    expect(result.before.length).toBe(result.after.length);
    const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
    expect(result.before.map(weekday).sort()).toEqual(result.after.map(weekday).sort());
    expect(result.before.some((date) => result.after.includes(date))).toBe(false);
  });

  it("uses equal weekday compositions when both full seven-day periods are available", () => {
    const result = pricingExperimentComparisonDates(new Date("2026-11-01T20:30:00.000Z"), 7, "2026-11-20");
    expect(result.before).toHaveLength(7);
    expect(result.after).toHaveLength(7);
    expect(result.before.map((date) => new Date(`${date}T12:00:00Z`).getUTCDay()).sort())
      .toEqual(result.after.map((date) => new Date(`${date}T12:00:00Z`).getUTCDay()).sort());
  });

  it("keeps short custom windows when adjacent days have no equivalent weekday", () => {
    const result = pricingExperimentComparisonDates(new Date("2026-11-02T08:30:00.000Z"), 1, "2026-11-20");
    expect(result.before).toEqual(["2026-11-01"]);
    expect(result.after).toEqual(["2026-11-03"]);
  });

  it("reconciles price, volume, mix, and unit-cost effects to observed contribution", () => {
    const result = calculatePricingShapleyEffects(
      [
        { key: "coffee", quantity: 10, revenue: 100_000n, cost: 40_000n },
        { key: "tea", quantity: 10, revenue: 50_000n, cost: 20_000n },
      ],
      [
        { key: "coffee", quantity: 8, revenue: 96_000n, cost: 44_000n },
        { key: "tea", quantity: 12, revenue: 72_000n, cost: 24_000n },
      ],
    );
    expect(result.observed).toBe(10_000);
    expect(result.residual).toBe(0);
    const effects = [result.price, result.volume, result.mix, result.cost] as Array<number | null>;
    expect(effects.every((effect) => effect !== null)).toBe(true);
    expect(effects.reduce<number>((sum, effect) => sum + (effect ?? 0), 0)).toBe(result.observed);
  });

  it("reports a positive price effect alongside a unit-volume decline", () => {
    const result = calculatePricingShapleyEffects(
      [{ key: "coffee", quantity: 10, revenue: 100_000n, cost: 40_000n }],
      [{ key: "coffee", quantity: 8, revenue: 96_000n, cost: 32_000n }],
    );
    expect(result.observed).toBe(4_000);
    expect(result).toMatchObject({ price: 18_000, volume: -14_000, mix: 0, cost: 0 });
    expect([result.price, result.volume, result.mix, result.cost].reduce<number>((sum, effect) => sum + (effect ?? 0), 0)).toBe(4_000);
  });

  it("reconciles to zero when the before and after product periods are identical", () => {
    const rows = [
      { key: "coffee", quantity: 10, revenue: 100_000n, cost: 40_000n },
      { key: "tea", quantity: 5, revenue: 25_000n, cost: 10_000n },
    ];
    expect(calculatePricingShapleyEffects(rows, rows)).toMatchObject({
      price: 0, volume: 0, mix: 0, cost: 0, observed: 0, residual: 0,
    });
  });

  it("attributes replacement of a disappearing product to mix without inventing price or cost changes", () => {
    expect(calculatePricingShapleyEffects(
      [{ key: "coffee", quantity: 10, revenue: 100_000n, cost: 40_000n }, { key: "tea", quantity: 10, revenue: 50_000n, cost: 20_000n }],
      [{ key: "tea", quantity: 20, revenue: 100_000n, cost: 40_000n }],
    )).toMatchObject({ price: 0, volume: 0, mix: -30_000, cost: 0, observed: -30_000, residual: 0 });
  });

  it("returns no invented effects for empty periods and excludes the entire current Tehran day", () => {
    expect(calculatePricingShapleyEffects([], [])).toMatchObject({ price: 0, volume: 0, mix: 0, cost: 0, observed: 0, residual: 0 });
    const dates = pricingExperimentComparisonDates(new Date("2026-10-02T20:29:59.999Z"), 14, "2026-10-04");
    expect(dates.effectiveDate).toBe("2026-10-02");
    expect(dates.after).toEqual(["2026-10-03"]);
    expect(dates.before).toHaveLength(1);
  });
});
