import { describe, expect, it } from "vitest";
import { CreatePricingExperimentRequestSchema, PricingScenarioRequestSchema } from "./index.js";

const productId = "11111111-1111-4111-8111-111111111111";
const optionId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";

describe("pricing experiment contracts", () => {
  it("permits an unknown original price and validates unique product and option targets", () => {
    const parsed = CreatePricingExperimentRequestSchema.parse({
      name: "Coffee price test", effectiveAt: "2026-11-02T08:30:00.000Z", expectedEvaluationDays: 14,
      comparisonDays: 7, targets: [
        { targetKind: "PRODUCT", productId, previousPriceAmount: null, proposedPriceAmount: 20_000 },
        { targetKind: "OPTION", productId, optionId, previousPriceAmount: 5_000, proposedPriceAmount: 7_000 },
      ],
    });
    expect(parsed.targets[0]?.previousPriceAmount).toBeNull();
    expect(CreatePricingExperimentRequestSchema.safeParse({ ...parsed, targets: [parsed.targets[0], parsed.targets[0]] }).success).toBe(false);
    expect(CreatePricingExperimentRequestSchema.safeParse({ ...parsed, targets: [{ ...parsed.targets[1], optionId: undefined }] }).success).toBe(false);
  });

  it("accepts product, category, and option scenarios and rejects packaging-fee policies", () => {
    const result = PricingScenarioRequestSchema.parse({
      fromDate: "2026-11-01", toDate: "2026-11-07", customVolumeChangePercent: -12.5,
      rules: [
        { targetKind: "PRODUCT", productId, adjustmentAmount: 10_000 },
        { targetKind: "CATEGORY", categoryId, adjustmentAmount: 20_000 },
        { targetKind: "OPTION", productId, optionId, adjustmentAmount: 5_000 },
      ],
    });
    expect(result.rules).toHaveLength(3);
    expect(PricingScenarioRequestSchema.safeParse({ fromDate: "2026-11-01", toDate: "2026-11-07", rules: [{ targetKind: "PACKAGING", productId, adjustmentAmount: 5_000 }] }).success).toBe(false);
    expect(result.customVolumeChangePercent).toBe(-12.5);
  });

  it("rejects future-shaped rules, reversed periods, and scenario payload side effects", () => {
    expect(PricingScenarioRequestSchema.safeParse({ fromDate: "2026-11-07", toDate: "2026-11-01", rules: [{ targetKind: "PRODUCT", productId, adjustmentAmount: 1 }] }).success).toBe(false);
    expect(PricingScenarioRequestSchema.safeParse({ fromDate: "2026-11-01", toDate: "2026-11-07", rules: [{ targetKind: "CATEGORY", productId, adjustmentAmount: 1 }] }).success).toBe(false);
    expect(PricingScenarioRequestSchema.safeParse({ fromDate: "2026-11-01", toDate: "2026-11-07", rules: [{ targetKind: "PRODUCT", productId, adjustmentAmount: 1 }], updateCatalog: true }).success).toBe(false);
  });
});
