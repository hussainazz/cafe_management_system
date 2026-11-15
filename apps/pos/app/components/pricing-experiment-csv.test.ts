import { describe, expect, it } from "vitest";
import type { PricingExperimentReport } from "../lib/api-client";
import { pricingExperimentCsv } from "./pricing-experiment-csv";

describe("pricing experiment CSV export", () => {
  it("uses a UTF-8 BOM, CSV quoting, and includes strategy assessment and fixed-cost comparisons", () => {
    const period = { requestedDayCount: 7 } as never;
    const report = {
      data: {
        experiment: { name: 'Coffee, "large"', effectiveAt: "2026-11-02T08:30:00.000Z" },
        periods: { before: period, after: period },
        products: [], categories: [], daily: [],
        decomposition: { method: "Shapley", priceEffectAmount: 1, volumeEffectAmount: -1, mixEffectAmount: 0,
          unitCostEffectAmount: 0, observedContributionChangeAmount: 0, residualAmount: 0 },
        breakEven: { products: [], wholeAffectedGroupDeclinePercent: null },
        dataQuality: { flags: [] }, assessment: { outcome: "INCONCLUSIVE", summaryFa: "Needs more data" },
        changes: { fixedCostCoveragePercent: "0.00", marginOfSafetyAmount: 0, marginOfSafetyPercent: "0.00" },
      },
    } as unknown as PricingExperimentReport;
    const csv = pricingExperimentCsv(report);
    expect(csv.startsWith("\uFEFF" )).toBe(true);
    expect(csv).toContain('"Coffee, ""large"""');
    expect(csv).toContain('"اثر قیمت"');
    expect(csv).toContain('"تغییر پوشش هزینه‌ی ثابت"');
    expect(csv).toContain('"INCONCLUSIVE"');
  });
});
