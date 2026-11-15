import { PricingExperimentReportResponseSchema } from "@cafe/contracts";

// A complete response checked against the public contract, shared by dashboard
// and CSV tests so successful rendering cannot rely on an incomplete mock.
export function pricingExperimentReportFixture(status: "READY" | "IN_PROGRESS" | "INCONCLUSIVE" = "READY") {
  const productId = "11111111-1111-4111-8111-111111111111";
  const experimentId = "22222222-2222-4222-8222-222222222222";
  const incomplete = status === "INCONCLUSIVE";
  const period = {
    fromDate: "2026-10-01", toDate: "2026-10-07", requestedDayCount: 7, includedDayCount: 7,
    weekdayCounts: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, dayCount: 1 })),
    orderCount: 1, itemUnits: 1, affectedItemUnits: 1, netRevenueAmount: 10_000, affectedNetRevenueAmount: 10_000,
    unaffectedNetRevenueAmount: 0, unattributedNetRevenueAmount: 0, affectedContributionAmount: incomplete ? null : -1_000,
    unaffectedContributionAmount: 0, averageSellingPriceAmount: 10_000, averageOrderValueAmount: 10_000,
    ingredientCogsAmount: 11_000, completeCostRevenueAmount: incomplete ? 0 : 10_000, incompleteCostRevenueAmount: incomplete ? 10_000 : 0,
    packagingChargeRevenueAmount: 0, packagingMaterialCostAmount: 0, packagingDeficitAmount: 0,
    packagingRecoveryRatePercent: null, packagingCostCoveragePercent: "100.00", variableCostAmount: incomplete ? null : 11_000,
    knownContributionAmount: -1_000, contributionAmount: incomplete ? null : -1_000, contributionMarginPercent: incomplete ? null : "-10.00",
    contributionPerOrderAmount: incomplete ? null : -1_000, costCoveragePercent: incomplete ? "0.00" : "100.00",
    monthlyEquivalentContributionAmount: incomplete ? null : -4_286, fixedCostCoveragePercent: incomplete ? null : "-0.00",
    operatingSurplusAmount: incomplete ? null : -265_004_286, breakEvenRevenueAmount: null, marginOfSafetyAmount: null,
    marginOfSafetyPercent: null, takeawayOrderCount: 1, takeawayMixPercent: "100.00", orderDiscountAmount: 0, itemDiscountAmount: 0,
  };
  const experiment = {
    id: experimentId, name: "آزمایش قهوه", effectiveAt: "2026-10-08T06:30:00.000Z", expectedEvaluationDays: 7,
    comparisonDays: 7, notes: null, createdAt: "2026-10-08T06:30:00.000Z", createdBy: { id: productId, username: "manager" },
    targets: [{ id: "33333333-3333-4333-8333-333333333333", targetKey: `PRODUCT:${productId}:`, targetKind: "PRODUCT",
      productId, productNameSnapshot: "قهوه", optionId: null, optionNameSnapshot: null, previousPriceAmount: 9_000, proposedPriceAmount: 10_000,
      priceHistory: { status: incomplete ? "MISSING" : "MATCHED", changeIds: [], effectiveAt: null, originalPriceMatches: incomplete ? null : true } }],
  };
  return PricingExperimentReportResponseSchema.parse({ data: {
    experiment, status, assessment: { outcome: status === "READY" ? "DECLINED" : "INCONCLUSIVE", summaryFa: "مشارکت ثبت‌شده برای بررسی آماده است.", reasons: [] },
    periods: { before: period, after: { ...period, fromDate: "2026-10-09", toDate: "2026-10-15" }, weekdayCompositionMatched: true, excludedCurrentPartialDay: true, effectiveDayExcluded: true },
    changes: { totalContributionAmount: incomplete ? null : -4_286, totalContributionPercent: incomplete ? null : "-10.00", netRevenueAmount: 0, netRevenuePercent: "0.00",
      affectedQuantity: 0, affectedQuantityPercent: "0.00", averageOrderValueAmount: 0, averageOrderValuePercent: "0.00", packagingDeficitAmount: 0, packagingDeficitPercent: null,
      fixedCostCoveragePercent: incomplete ? null : "-0.00", marginOfSafetyAmount: null, marginOfSafetyPercent: null },
    daily: [
      { date: "2026-10-07", phase: "BEFORE", experimentStartMarker: false, orderCount: 1, itemUnits: 1, netRevenueAmount: 10_000, contributionAmount: incomplete ? null : -1_000, contributionMarginPercent: incomplete ? null : "-10.00" },
      { date: "2026-10-08", phase: "EFFECTIVE_DAY", experimentStartMarker: true, orderCount: 0, itemUnits: 0, netRevenueAmount: 0, contributionAmount: null, contributionMarginPercent: null },
      { date: "2026-10-09", phase: "AFTER", experimentStartMarker: false, orderCount: 1, itemUnits: 1, netRevenueAmount: 10_000, contributionAmount: incomplete ? null : -1_000, contributionMarginPercent: incomplete ? null : "-10.00" },
    ],
    products: [{ productId, productName: 'قهوه، "بزرگ"', categoryId: null, categoryName: "نوشیدنی", channel: "TAKEAWAY", options: [], affected: true, targetKinds: ["PRODUCT"],
      previousPriceAmount: 9_000, experimentPriceAmount: 10_000, currentCatalogPriceAmount: 10_000, averageRealizedPriceBeforeAmount: 9_000, averageRealizedPriceAfterAmount: 10_000,
      quantityBefore: 1, quantityAfter: 1, quantityChangePercent: "0.00", unitShareBeforePercent: "100.00", unitShareAfterPercent: "100.00",
      revenueBeforeAmount: 9_000, revenueAfterAmount: 10_000, revenueChangeAmount: 1_000, revenueShareBeforePercent: "100.00", revenueShareAfterPercent: "100.00",
      unitCostBeforeAmount: 9_000, unitCostAfterAmount: incomplete ? null : 11_000, contributionBeforeAmount: 0, contributionAfterAmount: incomplete ? null : -1_000,
      contributionChangeAmount: incomplete ? null : -1_000, costCoveragePercent: incomplete ? "0.00" : "100.00" }],
    categories: [{ categoryId: null, categoryName: "نوشیدنی", affected: true, netRevenueBeforeAmount: 9_000, netRevenueAfterAmount: 10_000,
      contributionBeforeAmount: 0, contributionAfterAmount: incomplete ? null : -1_000, revenueShareBeforePercent: "100.00", revenueShareAfterPercent: "100.00" }],
    decomposition: { method: "تجزیه‌ی مشارکت", priceEffectAmount: incomplete ? null : 1_000, volumeEffectAmount: incomplete ? null : 0,
      mixEffectAmount: incomplete ? null : 0, unitCostEffectAmount: incomplete ? null : -2_000, observedContributionChangeAmount: incomplete ? null : -1_000,
      residualAmount: incomplete ? null : 0, reconciles: !incomplete, limitations: incomplete ? ["هزینه‌ی متغیر کامل نیست."] : [] },
    breakEven: { products: [{ productId, optionId: null, label: "قهوه", previousUnitContributionAmount: 0, newUnitContributionAmount: incomplete ? null : -1_000,
      priceIncreaseAmount: 1_000, maximumTolerableUnitDeclinePercent: null, contributionBenefitAtObservedVolumeAmount: incomplete ? null : -1_000 }],
      wholeAffectedGroupDeclinePercent: null, overallOrderCountChangePercent: "0.00", totalContributionChangeAmount: incomplete ? null : -1_000, assumption: "مقایسه بر پایه‌ی مشارکت هر واحد است." },
    controls: { affectedContributionChangePercent: null, unaffectedContributionChangePercent: null, relativeContributionChangePercent: null, comparisonIsObservational: true },
    confounders: { discountsChanged: false, catalogPriceChanges: 0, holidays: "UNKNOWN", weather: "UNKNOWN", productAvailability: "UNKNOWN", operationalClosures: "UNKNOWN", specialEvents: "UNKNOWN" },
    dataQuality: { flags: incomplete ? [{ code: "COSTS_INCOMPLETE", severity: "BLOCKER", messageFa: "بهای کامل ثبت نشده است." }] : [], costCoverageComplete: !incomplete, packagingAttributionComplete: true, validOrderCount: 2 },
  }, meta: { requestId: "test" } });
}
