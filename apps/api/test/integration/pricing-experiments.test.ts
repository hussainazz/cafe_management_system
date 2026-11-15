import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PricingExperimentCreatedResponseSchema, PricingExperimentReportResponseSchema, PricingScenarioResponseSchema } from "@cafe/contracts";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

async function login(role: "MANAGER" | "STAFF") {
  const username = `${role.toLowerCase()}.${randomUUID()}`;
  const user = await app.prisma.user.create({ data: { username, role, passwordHash: await hashPassword("CafePassword2026") } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  expect(response.statusCode, response.body).toBe(200);
  return { user, cookies: Object.fromEntries(response.cookies.map(({ name, value }) => [name, value])) };
}

async function product(categoryId: string, name: string, priceAmount: number, systemKey: string | null = null) {
  return app.prisma.product.create({ data: { categoryId, name, priceAmount, systemKey, preparationDeadlineMinutes: 5, displayOrder: 1 } });
}

async function recordPriceChange(input: {
  actorId: string; productId: string; productName: string; effectiveAt: Date; dimension: "PRODUCT_BASE_PRICE" | "PRODUCT_OPTION_OVERRIDE" | "PACKAGING_CHARGE";
  previousAmount: number | null; newAmount: number | null; previousEffectivePriceAmount: number | null; newEffectivePriceAmount: number | null; optionId?: string; optionName?: string;
}) {
  return app.prisma.catalogPriceChange.create({ data: {
    changeSetId: randomUUID(), productId: input.productId, productNameSnapshot: input.productName,
    ...(input.optionId ? { optionId: input.optionId, optionNameSnapshot: input.optionName } : {}),
    dimension: input.dimension, previousAmount: input.previousAmount, newAmount: input.newAmount,
    previousEffectivePriceAmount: input.previousEffectivePriceAmount, newEffectivePriceAmount: input.newEffectivePriceAmount,
    source: input.dimension === "PRODUCT_OPTION_OVERRIDE" ? "POS_PRODUCT_UPDATE" : "POS_PRODUCT_UPDATE",
    effectiveAt: input.effectiveAt, actorId: input.actorId,
  } });
}

async function financialOrder(input: {
  actorId: string; managerId: string; date: string; productId: string; productName: string; listedProductPrice: number;
  productRevenue: number; productCost: number | null; knownProductCost?: number; packagingProductId?: string; packagingPrice?: number;
  packagingMaterialCost?: number; orderDiscount?: number; split?: boolean; state?: "CLOSED" | "DELETED"; staffConsumption?: boolean; reversed?: boolean;
}) {
  const date = new Date(`${input.date}T08:30:00.000Z`);
  const packagingPrice = input.packagingPrice ?? 0;
  const totalAmount = input.productRevenue + packagingPrice;
  const subtotalAmount = input.listedProductPrice + packagingPrice;
  const discount = input.orderDiscount ?? 0;
  const orderItems: Array<Record<string, unknown>> = [{
    productId: input.productId, productNameSnapshot: input.productName, basePriceSnapshot: input.listedProductPrice,
    quantity: 1, lineTotalAmount: input.productRevenue, displayOrder: 0,
  }];
  if (input.packagingProductId && packagingPrice > 0) orderItems.push({
    productId: input.packagingProductId, productNameSnapshot: "بسته‌بندی", basePriceSnapshot: packagingPrice,
    quantity: 1, lineTotalAmount: packagingPrice, displayOrder: 1,
  });
  const order = await app.prisma.order.create({ data: {
    orderNumber: randomUUID(), createdById: input.actorId, channel: "TAKEAWAY", inventorySaleChannel: "TAKEAWAY",
    state: input.state ?? "CLOSED", paymentStatus: "PAID", subtotalAmount, discountAmount: discount,
    ...(discount > 0 ? { discountKind: "FIXED", discountValue: discount, discountReason: "Test promotion" } : {}),
    totalAmount, paidAmount: totalAmount, balanceAmount: 0, isStaffConsumption: input.staffConsumption ?? false,
    ...(input.state === "DELETED" ? { deletedAt: date, deletedById: input.managerId, deletionReason: "Test deletion" } : {}),
    items: { create: orderItems as never },
  }, include: { items: { orderBy: { displayOrder: "asc" } } } });
  const menuItem = order.items[0]!;
  const packingItem = order.items[1];
  const pieces = input.split ? 2 : 1;
  const allocations = Array.from({ length: pieces }, (_, index) => {
    const divisor = pieces;
    const productAmount = index === pieces - 1 ? input.productRevenue - Math.floor(input.productRevenue / divisor) * (pieces - 1) : Math.floor(input.productRevenue / divisor);
    const packingAmount = index === pieces - 1 ? packagingPrice - Math.floor(packagingPrice / divisor) * (pieces - 1) : Math.floor(packagingPrice / divisor);
    return { productAmount, packingAmount, totalAmount: productAmount + packingAmount };
  });
  const settlements = [];
  for (const [index, allocation] of allocations.entries()) settlements.push(await app.prisma.paymentSettlement.create({ data: {
    orderId: order.id, recordedById: input.actorId, idempotencyKey: `${order.id}-${index}`, totalAmount: allocation.totalAmount,
    allocationMode: "AMOUNT", recordedAt: date,
    payments: { create: [{ method: "CASH", amount: allocation.totalAmount }] },
    allocations: { create: [
      { orderItemId: menuItem.id, quantity: 0, amount: allocation.productAmount },
      ...(packingItem ? [{ orderItemId: packingItem.id, quantity: 0, amount: allocation.packingAmount }] : []),
    ] },
  } }));
  if (input.reversed) await app.prisma.settlementReversal.create({ data: { settlementId: settlements[0]!.id, recordedById: input.managerId, reason: "Test reversal" } });
  const packageCost = input.packagingMaterialCost ?? 0;
  const itemCost = input.productCost;
  const totalCost = itemCost === null ? null : itemCost;
  await app.prisma.orderConsumption.create({ data: {
    orderId: order.id, cycleNumber: 1, paymentSettlementId: settlements.at(-1)!.id, status: "POSTED", recognizedById: input.actorId,
    recognizedAt: date, resolvedAt: date, theoreticalCogsAmount: totalCost, knownCogsAmount: totalCost ?? (input.knownProductCost ?? 0),
    isCostComplete: totalCost !== null, costSnapshot: { orderChannel: "TAKEAWAY" },
    items: { create: [
      { orderItemId: menuItem.id, productNameSnapshot: input.productName, quantity: 1, theoreticalCogsAmount: totalCost,
        knownCogsAmount: totalCost ?? (input.knownProductCost ?? 0), isCostComplete: totalCost !== null,
        costSnapshot: { orderChannel: "TAKEAWAY", packagingAttributionComplete: true, components: [{ quantity: String(totalCost ?? 0), packagingQuantity: packageCost > 0 ? "1" : "0", isPackagingMaterial: packageCost > 0, knownCostAmount: totalCost, packagingKnownCostAmount: packageCost, nonPackagingKnownCostAmount: totalCost === null ? null : totalCost - packageCost }] } },
      ...(packingItem ? [{ orderItemId: packingItem.id, productNameSnapshot: "بسته‌بندی", quantity: 1, theoreticalCogsAmount: 0,
        knownCogsAmount: 0, isCostComplete: true, costSnapshot: { orderChannel: "TAKEAWAY", packagingAttributionComplete: true, components: [] } }] : []),
    ] },
  } });
  return order;
}

describe("Manager pricing experiments", () => {
  it("associates real product and option price history, enforces Manager access, and simulates all policy types without catalog writes", async () => {
    const manager = await login("MANAGER"); const staff = await login("STAFF");
    const category = await app.prisma.category.create({ data: { name: `Scenario ${randomUUID()}`, displayOrder: 1 } });
    const productRow = await product(category.id, "Scenario coffee", 12_000);
    const optionGroup = await app.prisma.optionGroup.create({ data: { name: `Scenario size ${randomUUID()}` } });
    const option = await app.prisma.option.create({ data: { optionGroupId: optionGroup.id, name: "Large", priceAmount: 3_000, displayOrder: 1 } });
    await app.prisma.productOptionGroup.create({ data: {
      productId: productRow.id, optionGroupId: optionGroup.id, displayOrder: 1, minSelections: 1, maxSelections: 1,
      allowedOptions: { create: { optionId: option.id, displayOrder: 1, priceAmountOverride: 4_500 } },
    } });
    const packingCategory = await app.prisma.category.create({ data: { name: `Packing ${randomUUID()}`, displayOrder: 2 } });
    const packing = await product(packingCategory.id, "Packaging fee", 700, "PACKING");
    const effectiveAt = new Date("2026-11-02T08:30:00.000Z");
    await recordPriceChange({ actorId: manager.user.id, productId: productRow.id, productName: productRow.name, effectiveAt,
      dimension: "PRODUCT_BASE_PRICE", previousAmount: 10_000, newAmount: 12_000, previousEffectivePriceAmount: 10_000, newEffectivePriceAmount: 12_000 });
    await recordPriceChange({ actorId: manager.user.id, productId: productRow.id, productName: productRow.name, optionId: option.id, optionName: option.name, effectiveAt,
      dimension: "PRODUCT_OPTION_OVERRIDE", previousAmount: null, newAmount: 4_500, previousEffectivePriceAmount: 3_000, newEffectivePriceAmount: 4_500 });

    const request = { name: "Coffee and size pricing", effectiveAt: effectiveAt.toISOString(), expectedEvaluationDays: 7, comparisonDays: 7,
      targets: [
        { targetKind: "PRODUCT", productId: productRow.id, previousPriceAmount: 10_000, proposedPriceAmount: 12_000 },
        { targetKind: "OPTION", productId: productRow.id, optionId: option.id, previousPriceAmount: 3_000, proposedPriceAmount: 4_500 },
      ] };
    const deniedCreate = await app.inject({ method: "POST", url: "/api/v1/admin/pricing-experiments", cookies: staff.cookies, payload: request });
    expect(deniedCreate.statusCode).toBe(403);
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/pricing-experiments", cookies: manager.cookies, payload: request });
    expect(created.statusCode, created.body).toBe(201);
    const experiment = PricingExperimentCreatedResponseSchema.parse(created.json()).data.experiment;
    expect(experiment.targets.map((row) => row.priceHistory)).toEqual([
      expect.objectContaining({ status: "MATCHED", originalPriceMatches: true }),
      expect.objectContaining({ status: "MATCHED", originalPriceMatches: true }),
    ]);
    expect((await app.prisma.product.findUniqueOrThrow({ where: { id: productRow.id } })).priceAmount).toBe(12_000);
    expect((await app.prisma.option.findUniqueOrThrow({ where: { id: option.id } })).priceAmount).toBe(3_000);
    expect((await app.prisma.productOptionGroupOption.findFirstOrThrow({ where: { productId: productRow.id, optionId: option.id } })).priceAmountOverride).toBe(4_500);

    const deniedReport = await app.inject({ method: "GET", url: `/api/v1/admin/pricing-experiments/${experiment.id}`, cookies: staff.cookies });
    expect(deniedReport.statusCode).toBe(403);
    const listed = await app.inject({ method: "GET", url: "/api/v1/admin/pricing-experiments", cookies: manager.cookies });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().data.experiments[0]?.id).toBe(experiment.id);
    const emptyReportResponse = await app.inject({ method: "GET", url: `/api/v1/admin/pricing-experiments/${experiment.id}`, cookies: manager.cookies });
    const emptyReport = PricingExperimentReportResponseSchema.parse(emptyReportResponse.json()).data;
    expect(emptyReport.status).toBe("INCONCLUSIVE");
    expect(emptyReport.dataQuality.flags).toEqual(expect.arrayContaining([expect.objectContaining({ code: "NO_ELIGIBLE_ORDERS", severity: "BLOCKER" })]));

    const mismatched = await app.inject({ method: "POST", url: "/api/v1/admin/pricing-experiments", cookies: manager.cookies, payload: {
      name: "Unmatched catalog change", effectiveAt: effectiveAt.toISOString(), expectedEvaluationDays: 7, comparisonDays: 7,
      targets: [{ targetKind: "PRODUCT", productId: productRow.id, previousPriceAmount: null, proposedPriceAmount: 13_000 }],
    } });
    expect(mismatched.statusCode, mismatched.body).toBe(201);
    expect((await app.prisma.pricingExperimentTarget.findFirstOrThrow({ where: { productId: productRow.id, proposedPriceAmount: 13_000 } })).previousPriceAmount).toBeNull();
    expect(mismatched.json().data.experiment.targets[0]).toMatchObject({ previousPriceAmount: null, priceHistory: { status: "MISMATCHED", originalPriceMatches: null } });

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const yesterday = new Date(`${today}T00:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const toDate = yesterday.toISOString().slice(0, 10);
    const from = new Date(`${toDate}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 2);
    const fromDate = from.toISOString().slice(0, 10);
    const simulationBody = { fromDate, toDate, rules: [
      { targetKind: "PRODUCT", productId: productRow.id, adjustmentAmount: 1_000 },
      { targetKind: "CATEGORY", categoryId: category.id, adjustmentAmount: 500 },
      { targetKind: "OPTION", productId: productRow.id, optionId: option.id, adjustmentAmount: 200 },
      { targetKind: "PACKAGING", productId: packing.id, adjustmentAmount: 100 },
    ] };
    const deniedSimulation = await app.inject({ method: "POST", url: "/api/v1/admin/reports/pricing-experiments/simulate", cookies: staff.cookies, payload: simulationBody });
    expect(deniedSimulation.statusCode).toBe(403);
    const simulated = await app.inject({ method: "POST", url: "/api/v1/admin/reports/pricing-experiments/simulate", cookies: manager.cookies, payload: simulationBody });
    expect(simulated.statusCode, simulated.body).toBe(200);
    const simulation = PricingScenarioResponseSchema.parse(simulated.json()).data;
    expect(simulation.rules.map((row) => row.targetKind)).toEqual(["PRODUCT", "CATEGORY", "OPTION", "PACKAGING"]);
    expect(simulation.rules.find((row) => row.targetKind === "OPTION")?.currentPriceAmount).toBe(4_500);
    expect(simulation.rules.find((row) => row.targetKind === "CATEGORY")?.currentPriceAmount).toBe(12_000);
    expect(simulation.scenarios.map((row) => row.volumeChangePercent)).toEqual(["-20.00", "-15.00", "-10.00", "-5.00", "0.00"]);
    const todayRejected = await app.inject({ method: "POST", url: "/api/v1/admin/reports/pricing-experiments/simulate", cookies: manager.cookies,
      payload: { ...simulationBody, toDate: today } });
    expect(todayRejected.statusCode).toBe(422);
    expect((await app.prisma.product.findUniqueOrThrow({ where: { id: productRow.id } })).priceAmount).toBe(12_000);
    expect((await app.prisma.product.findUniqueOrThrow({ where: { id: packing.id } })).priceAmount).toBe(700);
  });

  it("compares settled snapshots, discounts and packaging recovery while excluding reversed, deleted and staff orders", async () => {
    const manager = await login("MANAGER"); const staff = await login("STAFF");
    const category = await app.prisma.category.create({ data: { name: `Financial ${randomUUID()}`, displayOrder: 1 } });
    const coffee = await product(category.id, "Experiment coffee", 12_000);
    const tea = await product(category.id, "Unchanged tea", 5_000);
    const packingCategory = await app.prisma.category.create({ data: { name: `Financial packing ${randomUUID()}`, displayOrder: 2 } });
    const packing = await product(packingCategory.id, "Experiment packaging", 700, "PACKING");
    const effectiveAt = new Date("2026-11-02T08:30:00.000Z");
    await recordPriceChange({ actorId: manager.user.id, productId: coffee.id, productName: coffee.name, effectiveAt,
      dimension: "PRODUCT_BASE_PRICE", previousAmount: 10_000, newAmount: 12_000, previousEffectivePriceAmount: 10_000, newEffectivePriceAmount: 12_000 });
    await recordPriceChange({ actorId: manager.user.id, productId: packing.id, productName: packing.name, effectiveAt,
      dimension: "PACKAGING_CHARGE", previousAmount: 500, newAmount: 700, previousEffectivePriceAmount: 500, newEffectivePriceAmount: 700 });

    await financialOrder({ actorId: staff.user.id, managerId: manager.user.id, date: "2026-11-01", productId: coffee.id, productName: coffee.name,
      listedProductPrice: 10_000, productRevenue: 10_000, productCost: 4_300, packagingProductId: packing.id, packagingPrice: 500, packagingMaterialCost: 300 });
    await financialOrder({ actorId: staff.user.id, managerId: manager.user.id, date: "2026-11-01", productId: tea.id, productName: tea.name,
      listedProductPrice: 5_000, productRevenue: 5_000, productCost: 2_000 });
    const afterCoffee = await financialOrder({ actorId: staff.user.id, managerId: manager.user.id, date: "2026-11-08", productId: coffee.id, productName: coffee.name,
      listedProductPrice: 12_000, productRevenue: 11_000, productCost: 4_300, packagingProductId: packing.id, packagingPrice: 700,
      packagingMaterialCost: 300, orderDiscount: 1_000, split: true });
    await financialOrder({ actorId: staff.user.id, managerId: manager.user.id, date: "2026-11-08", productId: tea.id, productName: tea.name,
      listedProductPrice: 5_000, productRevenue: 4_000, productCost: 2_000, orderDiscount: 1_000 });
    await financialOrder({ actorId: staff.user.id, managerId: manager.user.id, date: "2026-11-08", productId: coffee.id, productName: coffee.name,
      listedProductPrice: 12_000, productRevenue: 12_000, productCost: 4_300, packagingProductId: packing.id, packagingPrice: 700,
      packagingMaterialCost: 300, reversed: true });
    await financialOrder({ actorId: staff.user.id, managerId: manager.user.id, date: "2026-11-08", productId: coffee.id, productName: coffee.name,
      listedProductPrice: 12_000, productRevenue: 12_000, productCost: 4_300, state: "DELETED" });
    await financialOrder({ actorId: manager.user.id, managerId: manager.user.id, date: "2026-11-08", productId: coffee.id, productName: coffee.name,
      listedProductPrice: 12_000, productRevenue: 12_000, productCost: 4_300, staffConsumption: true });

    const created = await app.inject({ method: "POST", url: "/api/v1/admin/pricing-experiments", cookies: manager.cookies, payload: {
      name: "Coffee and packaging", effectiveAt: effectiveAt.toISOString(), expectedEvaluationDays: 7, comparisonDays: 7,
      targets: [
        { targetKind: "PRODUCT", productId: coffee.id, previousPriceAmount: 10_000, proposedPriceAmount: 12_000 },
        { targetKind: "PACKAGING", productId: packing.id, previousPriceAmount: 500, proposedPriceAmount: 700 },
      ],
    } });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.experiment.id as string;
    const reportResponse = await app.inject({ method: "GET", url: `/api/v1/admin/pricing-experiments/${id}`, cookies: manager.cookies });
    expect(reportResponse.statusCode, reportResponse.body).toBe(200);
    const report = PricingExperimentReportResponseSchema.parse(reportResponse.json()).data;
    expect(report.status).toBe("READY");
    expect(report.periods).toMatchObject({ weekdayCompositionMatched: true, effectiveDayExcluded: true, excludedCurrentPartialDay: true });
    expect(report.periods.before).toMatchObject({ orderCount: 2, itemUnits: 2, netRevenueAmount: 15_500, contributionAmount: 9_200 });
    expect(report.periods.after).toMatchObject({ orderCount: 2, itemUnits: 2, netRevenueAmount: 15_700, contributionAmount: 9_400, orderDiscountAmount: 2_000 });
    expect(report.periods.before).toMatchObject({ packagingChargeRevenueAmount: 500, packagingMaterialCostAmount: 300, packagingDeficitAmount: -200, packagingRecoveryRatePercent: "166.67" });
    expect(report.periods.after).toMatchObject({ packagingChargeRevenueAmount: 700, packagingMaterialCostAmount: 300, packagingDeficitAmount: -400, packagingRecoveryRatePercent: "233.33" });
    expect(report.dataQuality.validOrderCount).toBe(4);
    expect(report.changes.totalContributionAmount).toBe(857);
    expect(report.decomposition.reconciles).toBe(true);
    expect(report.decomposition.observedContributionChangeAmount).toBe(200);
    const coffeeRow = report.products.find((row) => row.productId === coffee.id && row.channel === "TAKEAWAY")!;
    expect(coffeeRow).toMatchObject({ affected: true, quantityBefore: 1, quantityAfter: 1, averageRealizedPriceBeforeAmount: 10_000, averageRealizedPriceAfterAmount: 11_000,
      revenueBeforeAmount: 10_500, revenueAfterAmount: 11_700, revenueShareBeforePercent: "67.74", revenueShareAfterPercent: "74.52" });
    const coffeeBreakEven = report.breakEven.products.find((row) => row.productId === coffee.id)!;
    const packagingBreakEven = report.breakEven.products.find((row) => row.productId === packing.id)!;
    // Both targets cover the same order cohort. Each row compares its full
    // observed unit contribution; the whole-group result counts the cohort once.
    expect(coffeeBreakEven).toMatchObject({ priceIncreaseAmount: 1_000, contributionBenefitAtObservedVolumeAmount: 1_200, maximumTolerableUnitDeclinePercent: "16.22" });
    expect(packagingBreakEven).toMatchObject({ priceIncreaseAmount: 200, contributionBenefitAtObservedVolumeAmount: 1_200 });
    expect(report.breakEven.wholeAffectedGroupDeclinePercent).toBe("16.22");

    const scenarioResponse = await app.inject({ method: "POST", url: "/api/v1/admin/reports/pricing-experiments/simulate", cookies: manager.cookies, payload: {
      fromDate: "2026-11-08", toDate: "2026-11-08", customVolumeChangePercent: -20,
      rules: [
        { targetKind: "PRODUCT", productId: coffee.id, adjustmentAmount: 1_000 },
        { targetKind: "PACKAGING", productId: packing.id, adjustmentAmount: 100 },
      ],
    } });
    expect(scenarioResponse.statusCode, scenarioResponse.body).toBe(200);
    const simulation = PricingScenarioResponseSchema.parse(scenarioResponse.json()).data;
    expect(simulation.source).toMatchObject({ orderCount: 2, netRevenueAmount: 15_700, contributionAmount: 9_400 });
    expect(simulation.scenarios.find((row) => row.volumeChangePercent === "0.00")).toMatchObject({ netRevenueAmount: 16_800, contributionAmount: 10_500, packagingDeficitAmount: -500 });
    expect(simulation.scenarios.find((row) => row.volumeChangePercent === "-20.00")).toMatchObject({ netRevenueAmount: 14_240, contributionAmount: 8_800, packagingDeficitAmount: -400, breakEvenVolumeDeclinePercent: "12.94" });
    expect((await app.prisma.product.findUniqueOrThrow({ where: { id: coffee.id } })).priceAmount).toBe(12_000);
    expect((await app.prisma.product.findUniqueOrThrow({ where: { id: packing.id } })).priceAmount).toBe(700);

    const afterConsumption = await app.prisma.orderConsumption.findFirstOrThrow({ where: { orderId: afterCoffee.id }, include: { items: true } });
    const coffeeItem = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId: afterCoffee.id, productId: coffee.id } });
    await app.prisma.orderConsumptionItem.updateMany({ where: { orderConsumptionId: afterConsumption.id, orderItemId: coffeeItem.id }, data: { theoreticalCogsAmount: null, knownCogsAmount: 2_000, isCostComplete: false } });
    await app.prisma.orderConsumption.updateMany({ where: { orderId: afterCoffee.id }, data: { theoreticalCogsAmount: null, isCostComplete: false } });
    const incompleteResponse = await app.inject({ method: "GET", url: `/api/v1/admin/pricing-experiments/${id}`, cookies: manager.cookies });
    const incomplete = PricingExperimentReportResponseSchema.parse(incompleteResponse.json()).data;
    expect(incomplete.status).toBe("INCONCLUSIVE");
    expect(incomplete.periods.after).toMatchObject({ contributionAmount: null, operatingSurplusAmount: null });
    expect(incomplete.periods.after.knownContributionAmount).toBe(11_700);
    expect(incomplete.decomposition.reconciles).toBe(false);
  });
});
