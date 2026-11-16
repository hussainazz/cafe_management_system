import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PricingExperimentCreatedResponseSchema, PricingExperimentReportResponseSchema, PricingScenarioResponseSchema, SalesAnalyticsResponseSchema } from "@cafe/contracts";
import { buildApp } from "../../src/app.js";
import { hashPassword } from "../../src/auth/password.js";
import { paidFinanceOrder } from "../fixtures/finance-analytics.js";

const app = buildApp();
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

async function fixture() {
  const manager = await app.prisma.user.create({ data: { username: `finance.${randomUUID()}`, passwordHash: await hashPassword("CafePassword2026"), role: "DEVELOPER" } });
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: manager.username, password: "CafePassword2026" } });
  expect(login.statusCode).toBe(200);
  const cookies = Object.fromEntries(login.cookies.map(({ name, value }) => [name, value]));
  const createCategory = (name: string) => app.prisma.category.create({ data: { name, displayOrder: 1 } });
  const a = await createCategory("Drinks"), b = await createCategory("Tea");
  const product = (categoryId: string, name: string, priceAmount: number, systemKey: string | null = null) => app.prisma.product.create({ data: { categoryId, name, priceAmount, systemKey, preparationDeadlineMinutes: 5, displayOrder: 1 } });
  const coffee = await product(a.id, "Coffee", 10_000), tea = await product(b.id, "Tea", 10_000);
  const packA = await product(a.id, "Drinks packaging", 500, "PACKING"), packB = await product(b.id, "Tea packaging", 700, "PACKING");
  const group = await app.prisma.optionGroup.create({ data: { name: "Size" } });
  const option = await app.prisma.option.create({ data: { optionGroupId: group.id, name: "Large", priceAmount: 3_000, displayOrder: 1 } });
  for (const menu of [coffee, tea]) await app.prisma.productOptionGroup.create({ data: { productId: menu.id, optionGroupId: group.id, displayOrder: 1, minSelections: 0, maxSelections: 1, allowedOptions: { create: { optionId: option.id, displayOrder: 1 } } } });
  const sale = (date: string, lines: Parameters<typeof paidFinanceOrder>[1]["lines"], channel: "TABLE" | "TAKEAWAY" = "TAKEAWAY") => paidFinanceOrder(app.prisma, { actorId: manager.id, date, lines, channel });
  const simulate = async (rules: unknown[], extra = {}) => {
    const response = await app.inject({ method: "POST", url: "/api/v1/admin/reports/pricing-experiments/simulate", cookies, payload: { fromDate: "2026-10-03", toDate: "2026-10-03", rules, ...extra } });
    expect(response.statusCode, response.body).toBe(200);
    return PricingScenarioResponseSchema.parse(response.json()).data;
  };
  const experiment = async (targets: Array<{ targetKind: "PRODUCT" | "OPTION" | "PACKAGING"; productId: string; optionId?: string; previousPriceAmount: number; proposedPriceAmount: number }>) => {
    const response = await app.inject({ method: "POST", url: "/api/v1/admin/pricing-experiments", cookies, payload: { name: "Regression experiment", effectiveAt: "2026-10-02T06:30:00.000Z", expectedEvaluationDays: 7, comparisonDays: 7, targets } });
    expect(response.statusCode, response.body).toBe(201);
    const id = PricingExperimentCreatedResponseSchema.parse(response.json()).data.experiment.id;
    const report = await app.inject({ method: "GET", url: `/api/v1/admin/pricing-experiments/${id}`, cookies });
    expect(report.statusCode, report.body).toBe(200);
    return PricingExperimentReportResponseSchema.parse(report.json()).data;
  };
  return { manager, cookies, coffee, tea, packA, packB, option, sale, simulate, experiment };
}

describe("Finance analytics numerical regressions", () => {
  it("stamps new lines, preserves first entry through quantity edits, and retains legacy nulls", async () => {
    const f = await fixture();
    const startedAt = Date.now();
    const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies: f.cookies,
      headers: { "idempotency-key": randomUUID() }, payload: { channel: "TAKEAWAY", items: [{ productId: f.coffee.id, quantity: 1, options: [] }] } });
    expect(created.statusCode, created.body).toBe(201);
    const order = created.json().data;
    const original = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(original.enteredAt?.getTime()).toBeGreaterThanOrEqual(startedAt);
    const editStart = Date.now();
    const edited = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: f.cookies,
      payload: { expectedVersion: order.version, items: [{ productId: f.coffee.id, quantity: 2, options: [] }, { productId: f.tea.id, quantity: 1, options: [] }] } });
    expect(edited.statusCode, edited.body).toBe(200);
    const lines = await app.prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(lines.find((line) => line.productId === f.coffee.id)).toMatchObject({ id: original.id, quantity: 2, enteredAt: original.enteredAt });
    expect(lines.find((line) => line.productId === f.tea.id)?.enteredAt?.getTime()).toBeGreaterThanOrEqual(editStart);
    await app.prisma.orderItem.update({ where: { id: original.id }, data: { enteredAt: null } });
    const legacy = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies: f.cookies,
      payload: { expectedVersion: edited.json().data.version, items: [{ productId: f.coffee.id, quantity: 3, options: [] }, { productId: f.tea.id, quantity: 1, options: [] }] } });
    expect(legacy.statusCode, legacy.body).toBe(200);
    expect((await app.prisma.orderItem.findUniqueOrThrow({ where: { id: original.id } })).enteredAt).toBeNull();
  });

  it("applies option changes once to recorded counts across repeated lines and partial selections", async () => {
    const f = await fixture();
    await f.sale("2026-10-03", [
      { product: f.coffee, quantity: 2, revenue: 26_000, cost: 8_000, options: [{ ...f.option, price: 3_000, quantity: 2 }] },
      { product: f.coffee, quantity: 3, revenue: 33_000, cost: 12_000, options: [{ ...f.option, price: 3_000, quantity: 1 }] },
    ]);
    const result = await f.simulate([{ targetKind: "OPTION", productId: f.coffee.id, optionId: f.option.id, adjustmentAmount: 1_000 }]);
    expect(result.scenarios.find((row) => row.volumeChangePercent === "0.00")).toMatchObject({ netRevenueAmount: 62_000, contributionAmount: 42_000, breakEvenVolumeDeclinePercent: "7.14" });
    expect(result.scenarios.find((row) => row.volumeChangePercent === "-20.00")).toMatchObject({ netRevenueAmount: 49_600, contributionAmount: 33_600 });
    const report = await f.experiment([{ targetKind: "PRODUCT", productId: f.coffee.id, previousPriceAmount: 10_000, proposedPriceAmount: 11_000 }]);
    expect(report.products.map((row) => row.options[0]?.quantity).sort()).toEqual([1 / 3, 1]);
  });

  it("converts product and option price changes using historical weights and pricing modes", async () => {
    const f = await fixture();
    await f.sale("2026-10-03", [{ product: f.coffee, weightGrams: 500, revenue: 6_500, cost: 2_000, options: [{ ...f.option, price: 3_000, quantity: 1 }] }]);
    const result = await f.simulate([{ targetKind: "PRODUCT", productId: f.coffee.id, adjustmentAmount: 1_000 }, { targetKind: "OPTION", productId: f.coffee.id, optionId: f.option.id, adjustmentAmount: 1_000 }]);
    expect(result.scenarios.find((row) => row.volumeChangePercent === "0.00")).toMatchObject({ netRevenueAmount: 7_500, contributionAmount: 5_500 });
    expect(result.scenarios.find((row) => row.volumeChangePercent === "-20.00")).toMatchObject({ netRevenueAmount: 6_000, contributionAmount: 4_400 });
  });

  it("limits category packaging changes, affected cohorts, and volume scaling to the selected charge", async () => {
    const f = await fixture();
    for (const date of ["2026-10-01", "2026-10-03"]) {
      await f.sale(date, [{ product: f.coffee, revenue: 10_000, cost: 4_100, packagingCost: 100 }, { product: f.packA, revenue: 500, cost: 0 }]);
      // The same menu product can appear with another category's charge.
      await f.sale(date, [{ product: f.coffee, revenue: 10_000, cost: 4_100, packagingCost: 100 }, { product: f.packB, revenue: 700, cost: 0 }]);
    }
    const result = await f.simulate([{ targetKind: "PACKAGING", productId: f.packA.id, adjustmentAmount: 1_000 }]);
    expect(result.rules[0]?.affectedItemUnits).toBe(1);
    expect(result.scenarios.find((row) => row.volumeChangePercent === "0.00")).toMatchObject({ netRevenueAmount: 22_200, contributionAmount: 14_000 });
    expect(result.scenarios.find((row) => row.volumeChangePercent === "-20.00")).toMatchObject({ netRevenueAmount: 19_900, contributionAmount: 12_520 });
    const report = await f.experiment([{ targetKind: "PACKAGING", productId: f.packA.id, previousPriceAmount: 500, proposedPriceAmount: 1_500 }]);
    expect(report.periods.after.affectedItemUnits).toBe(1);
    expect(report.products.map((row) => row.affected).sort()).toEqual([false, true]);
    expect(report.breakEven.products[0]?.priceIncreaseAmount).toBe(0);
  });

  it("keeps the same per-unit option variant and independently verifies each decomposition factor", async () => {
    const f = await fixture();
    await f.sale("2026-10-01", [{ product: f.coffee, quantity: 2, revenue: 26_000, cost: 10_000, options: [{ ...f.option, price: 3_000, quantity: 2 }] }]);
    await f.sale("2026-10-03", [{ product: { ...f.coffee, priceAmount: 13_000 }, revenue: 16_000, cost: 5_000, options: [{ ...f.option, price: 3_000, quantity: 1 }] }]);
    const report = await f.experiment([{ targetKind: "PRODUCT", productId: f.coffee.id, previousPriceAmount: 10_000, proposedPriceAmount: 13_000 }]);
    expect(report.products).toHaveLength(1);
    expect(report.products[0]).toMatchObject({ quantityBefore: 2, quantityAfter: 1, options: [{ optionId: f.option.id, optionName: f.option.name, quantity: 1 }] });
    expect(report.decomposition).toMatchObject({ priceEffectAmount: 4_500, volumeEffectAmount: -9_500, mixEffectAmount: 0, unitCostEffectAmount: 0, observedContributionChangeAmount: -5_000, residualAmount: 0 });
  });

  it("counts overlapping product and option contribution gains only once", async () => {
    const f = await fixture();
    await f.sale("2026-10-01", [{ product: f.coffee, revenue: 13_000, cost: 5_000, options: [{ ...f.option, price: 3_000, quantity: 1 }] }]);
    await f.sale("2026-10-03", [{ product: { ...f.coffee, priceAmount: 12_000 }, revenue: 16_000, cost: 5_000, options: [{ ...f.option, price: 4_000, quantity: 1 }] }]);
    const report = await f.experiment([{ targetKind: "PRODUCT", productId: f.coffee.id, previousPriceAmount: 10_000, proposedPriceAmount: 12_000 }, { targetKind: "OPTION", productId: f.coffee.id, optionId: f.option.id, previousPriceAmount: 3_000, proposedPriceAmount: 4_000 }]);
    expect(report.breakEven.wholeAffectedGroupDeclinePercent).toBe("27.27");
    expect(report.breakEven.products.find((row) => row.optionId === f.option.id)?.priceIncreaseAmount).toBe(1_000);
    expect(report.decomposition).toMatchObject({ priceEffectAmount: 3_000, volumeEffectAmount: 0, mixEffectAmount: 0, unitCostEffectAmount: 0 });
  });

  it("withholds break-even, margins and surplus when affected costs are incomplete", async () => {
    const f = await fixture();
    await f.sale("2026-10-03", [{ product: f.coffee, revenue: 10_000, cost: null, knownCost: 2_000 }, { product: f.tea, revenue: 10_000, cost: 4_000 }]);
    const result = await f.simulate([{ targetKind: "PRODUCT", productId: f.coffee.id, adjustmentAmount: 1_000 }]);
    expect(result.scenarios.every((row) => row.breakEvenVolumeDeclinePercent === null && row.contributionAmount === null && row.operatingSurplusAmount === null && !row.costsComplete)).toBe(true);
    const completeTarget = await f.simulate([{ targetKind: "PRODUCT", productId: f.tea.id, adjustmentAmount: 1_000 }]);
    expect(completeTarget.scenarios.find((row) => row.volumeChangePercent === "0.00")).toMatchObject({ contributionAmount: null, costsComplete: false, breakEvenVolumeDeclinePercent: "14.29" });
  });

  it("does not present a tolerable decline when costs grow faster than realized prices", async () => {
    const f = await fixture();
    await f.sale("2026-10-01", [{ product: f.coffee, revenue: 10_000, cost: 4_000 }]);
    await f.sale("2026-10-03", [{ product: { ...f.coffee, priceAmount: 11_000 }, revenue: 11_000, cost: 6_000 }]);
    const report = await f.experiment([{ targetKind: "PRODUCT", productId: f.coffee.id, previousPriceAmount: 10_000, proposedPriceAmount: 11_000 }]);
    expect(report.breakEven.products[0]).toMatchObject({ previousUnitContributionAmount: 6_000, newUnitContributionAmount: 5_000, maximumTolerableUnitDeclinePercent: null, contributionBenefitAtObservedVolumeAmount: -1_000 });
    expect(report.breakEven.wholeAffectedGroupDeclinePercent).toBeNull();
    expect(report.decomposition).toMatchObject({ priceEffectAmount: 1_000, unitCostEffectAmount: -2_000, volumeEffectAmount: 0, mixEffectAmount: 0 });
  });

  it("matches shared option history to its product and uses effective prices for discounted targets", async () => {
    const f = await fixture();
    const change = (productId: string, dimension: "PRODUCT_OPTION_OVERRIDE" | "PRODUCT_DISCOUNT", oldAmount: number, newAmount: number, oldEffective: number, newEffective: number, optionId?: string) => app.prisma.catalogPriceChange.create({ data: {
      changeSetId: randomUUID(), productId, productNameSnapshot: "Coffee", dimension, previousAmount: oldAmount, newAmount,
      previousEffectivePriceAmount: oldEffective, newEffectivePriceAmount: newEffective, effectiveAt: new Date("2026-10-02T06:30:00Z"), source: "POS_PRODUCT_UPDATE", actorId: f.manager.id,
      ...(optionId ? { optionId, optionNameSnapshot: f.option.name } : {}),
    } });
    await change(f.tea.id, "PRODUCT_OPTION_OVERRIDE", 3_000, 4_000, 3_000, 4_000, f.option.id);
    const target = { targetKind: "OPTION" as const, productId: f.coffee.id, optionId: f.option.id, previousPriceAmount: 3_000, proposedPriceAmount: 4_000 };
    expect((await f.experiment([target])).experiment.targets[0]?.priceHistory.status).toBe("MISSING");
    const ownEvent = await change(f.coffee.id, "PRODUCT_OPTION_OVERRIDE", 3_000, 4_000, 3_000, 4_000, f.option.id);
    expect((await f.experiment([target])).experiment.targets[0]?.priceHistory).toMatchObject({ status: "MATCHED", originalPriceMatches: true, changeIds: [ownEvent.id] });
    await change(f.coffee.id, "PRODUCT_DISCOUNT", 13_000, 13_000, 12_000, 11_000);
    expect((await f.experiment([{ targetKind: "PRODUCT", productId: f.coffee.id, previousPriceAmount: 12_000, proposedPriceAmount: 11_000 }])).experiment.targets[0]?.priceHistory).toMatchObject({ status: "MATCHED", originalPriceMatches: true });
  });

  it("reconciles same-day operational and financial packaging sales with exact costed peaks and AOV", async () => {
    const f = await fixture();
    await f.sale("2026-10-03T05:00:00Z", [{ product: f.coffee, revenue: 10_000, cost: 4_100, packagingCost: 100 }, { product: f.packA, revenue: 500, cost: 0 }]);
    await f.sale("2026-10-03T06:00:00Z", [{ product: f.tea, revenue: 10_000, cost: 12_000 }], "TABLE");
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/reports/sales-analytics?fromDate=2026-10-03&toDate=2026-10-03&intervalMinutes=30", cookies: f.cookies });
    expect(response.statusCode, response.body).toBe(200);
    const report = SalesAnalyticsResponseSchema.parse(response.json()).data;
    expect(report.overview.operationalDemand).toMatchObject({ orderCount: 2, itemUnits: 2, netSalesAmount: 20_500, averageOrderValueAmount: 10_250 });
    expect(report.overview.financialRecognition).toMatchObject({ netSalesAmount: 20_500, totalContributionAmount: 4_400, knownContributionAmount: 4_400, costCoveragePercent: "100.00", averageOrderValueAmount: 10_250 });
    expect(report.insights.highestRevenuePeriod).toMatchObject({ hour: 8, minute: 30, amount: 10_500 });
    expect(report.insights.highestKnownContributionPeriod).toMatchObject({ hour: 8, minute: 30, amount: 6_400 });
    expect(report.productFinancialSeries.find((row) => row.productId === f.tea.id)).toMatchObject({ totalContributionAmount: -2_000, totalContributionMarginPercent: "-20.00" });
    expect(report.productFinancialSeries.find((row) => row.productId === f.coffee.id)).toMatchObject({ contributionBeforePackagingAmount: 6_000, combinedContributionAfterPackagingAmount: 6_400 });
    expect(report.operationalBuckets.reduce((sum, row) => sum + row.netSalesAmount, 0)).toBe(20_500);
  });

  it("separates known contribution from incomplete costs and keeps filtered and empty buckets honest", async () => {
    const f = await fixture();
    await f.sale("2026-10-03", [{ product: f.coffee, revenue: 10_000, cost: 4_000 }, { product: f.tea, revenue: 5_000, cost: null, knownCost: 2_000 }]);
    const read = async (date: string, productId?: string) => {
      const response = await app.inject({ method: "GET", url: `/api/v1/admin/reports/sales-analytics?fromDate=${date}&toDate=${date}${productId ? `&productIds=${productId}` : ""}`, cookies: f.cookies });
      expect(response.statusCode, response.body).toBe(200);
      return SalesAnalyticsResponseSchema.parse(response.json()).data;
    };
    const mixed = await read("2026-10-03");
    expect(mixed.overview.financialRecognition).toMatchObject({ netSalesAmount: 15_000, completeCostRevenueAmount: 10_000, incompleteCostRevenueAmount: 5_000,
      knownCogsAmount: 6_000, knownContributionAmount: 6_000, totalContributionAmount: null, totalContributionMarginPercent: null, costCoveragePercent: "66.67", isCostComplete: false });
    expect((await read("2026-10-03", f.coffee.id)).overview.financialRecognition).toMatchObject({ totalContributionAmount: 6_000, costCoveragePercent: "100.00" });
    expect((await read("2026-10-03", f.tea.id)).overview.financialRecognition).toMatchObject({ knownContributionAmount: 0, totalContributionAmount: null, costCoveragePercent: "0.00" });
    const empty = await read("2026-10-04");
    expect(empty.overview.financialRecognition).toMatchObject({ orderCount: 0, netSalesAmount: 0, totalContributionAmount: 0, totalContributionMarginPercent: null, costCoveragePercent: null, averageOrderValueAmount: null });
    expect(empty.insights.highestRevenuePeriod).toBeNull();
  });
});
