import type {
  CreatePricingExperimentRequest,
  PricingScenarioRequest,
} from "@cafe/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes, type ErrorCode } from "../../errors/application-error.js";
import { tehranReportRange } from "../admin/daily-report.service.js";
import {
  activeRevenue,
  hasCompleteCostSnapshot,
  loadRecognizedConsumptions,
} from "./gross-profit.service.js";
import { isEligibleSettledOrder, salesChannel } from "./sales-report-eligibility.js";

const FIXED_MONTHLY_COST = 265_000_000n;
const MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);
const SCALE = 1_000_000n;
const tehranDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit",
});
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", weekday: "short" });
const weekdayIndex: Record<string, number> = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };

type ExperimentTarget = {
  id: string; targetKey: string; targetKind: "PRODUCT" | "OPTION" | "PACKAGING";
  productId: string; productNameSnapshot: string; optionId: string | null; optionNameSnapshot: string | null;
  previousPriceAmount: number | null; proposedPriceAmount: number;
};
type OptionSnap = { optionId: string; optionName: string; quantity: number };
type ProductGroup = {
  key: string; productId: string; productName: string; categoryId: string | null; categoryName: string | null;
  channel: "TABLE" | "TAKEAWAY" | "UNKNOWN"; options: OptionSnap[]; quantity: number;
  revenue: bigint; cogs: bigint; knownCogs: bigint; completeRevenue: bigint; incompleteRevenue: bigint;
  complete: boolean; affected: boolean; orderIds: Set<string>;
  currentPriceAmount: number | null; targetKinds: Set<"PRODUCT" | "OPTION">;
};
type PeriodAggregate = {
  dateSet: string[]; fromDate: string | null; toDate: string | null;
  orderCount: number; orderIds: Set<string>; takeawayOrderIds: Set<string>; orderValue: bigint;
  itemUnits: number; affectedItemUnits: number; netRevenue: bigint; affectedRevenue: bigint;
  unaffectedRevenue: bigint; unattributedRevenue: bigint; ingredientCogs: bigint; totalCogs: bigint;
  completeRevenue: bigint; incompleteRevenue: bigint; knownContribution: bigint;
  allCostsComplete: boolean; orderDiscount: bigint; itemDiscount: bigint;
  groups: Map<string, ProductGroup>; consumptions: any[];
};

function fail(status: number, code: ErrorCode, message: string): never {
  throw new ApplicationError(status, code, message);
}
function signedAmount(value: bigint): number {
  if (value < -MAX_AMOUNT || value > MAX_AMOUNT) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A reported amount exceeds the supported Toman range.");
  return Number(value);
}
function amount(value: bigint): number {
  if (value < 0n || value > MAX_AMOUNT) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A reported amount exceeds the supported Toman range.");
  return Number(value);
}
function unitPriceAmount(value: bigint): number {
  if (value < 0n || value > 2_147_483_647n) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A proposed unit price exceeds the supported Toman range.");
  return Number(value);
}
function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + denominator / 2n) / denominator);
}
function percent(numerator: bigint, denominator: bigint): string | null {
  if (denominator === 0n) return null;
  if (denominator < 0n) return percent(-numerator, -denominator);
  const scaled = roundedDivide(numerator * 10_000n, denominator);
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
function ratioChange(before: bigint, after: bigint): string | null {
  return before === 0n ? null : percent(after - before, before < 0n ? -before : before);
}
function average(value: bigint, count: number): number | null {
  return count > 0 ? amount(roundedDivide(value, BigInt(count))) : null;
}
function localDate(date: Date): string { return tehranDateFormatter.format(date); }
function weekday(date: string): number {
  const parsed = new Date(`${date}T12:00:00+03:30`);
  return weekdayIndex[weekdayFormatter.format(parsed)] ?? 0;
}
function addDays(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
function datesInRange(from: string, to: string): string[] {
  return Array.from({ length: Math.max(0, daysBetween(from, to)) }, (_, index) => addDays(from, index));
}
function rangeOfDates(dates: string[]) {
  return dates.length ? { from: dates[0]!, to: dates.at(-1)! } : null;
}
function scaledAmount(value: bigint, days: number): bigint {
  return days > 0 ? roundedDivide(value * 30n, BigInt(days)) : 0n;
}
function targetKey(kind: string, productId: string, optionId?: string | null) {
  return `${kind}:${productId}:${optionId ?? ""}`;
}
function optionsFor(item: any): OptionSnap[] {
  const row = item.orderItem ?? item;
  const divisor = row.pricingModeSnapshot === "WEIGHTED_PER_KG" ? 1 : row.quantity;
  return [...(row.options ?? [])].map((option: any) => ({
    optionId: option.optionId, optionName: option.optionNameSnapshot, quantity: option.quantity / divisor,
  })).sort((a, b) => a.optionId.localeCompare(b.optionId));
}
function groupKey(productId: string, channel: string, options: OptionSnap[]) {
  return `${productId}:${channel}:${options.map((option) => `${option.optionId}=${option.quantity}`).join(",")}`;
}
function isTargeted(target: ExperimentTarget, item: any) {
  if (target.targetKind === "PRODUCT") return item.orderItem.productId === target.productId;
  if (target.targetKind === "PACKAGING") return false;
  return item.orderItem.productId === target.productId &&
    item.orderItem.options.some((option: any) => option.optionId === target.optionId);
}
function createGroup(item: any, channel: "TABLE" | "TAKEAWAY" | "UNKNOWN", options: OptionSnap[]): ProductGroup {
  const product = item.orderItem.product;
  return {
    key: groupKey(item.orderItem.productId, channel, options),
    productId: item.orderItem.productId,
    productName: item.orderItem.productNameSnapshot || product.name,
    categoryId: product.categoryId ?? null,
    categoryName: product.category?.name ?? null,
    channel, options, quantity: 0, revenue: 0n, cogs: 0n, knownCogs: 0n,
    completeRevenue: 0n, incompleteRevenue: 0n, complete: true,
    affected: false, orderIds: new Set(),
    currentPriceAmount: product.priceAmount ?? null, targetKinds: new Set(),
  };
}

async function historyForTargets(prisma: PrismaClient, effectiveAt: Date, targets: ExperimentTarget[]) {
  const productIds = [...new Set(targets.map((target) => target.productId))];
  const optionIds = [...new Set(targets.flatMap((target) => target.optionId ? [target.optionId] : []))];
  const changes = await prisma.catalogPriceChange.findMany({
    where: { OR: [
      { productId: { in: productIds } },
      ...(optionIds.length ? [{ optionId: { in: optionIds } }] : []),
    ] },
    orderBy: [{ effectiveAt: "asc" }, { recordedAt: "asc" }],
    select: { id: true, productId: true, optionId: true, dimension: true, previousAmount: true,
      newAmount: true, previousEffectivePriceAmount: true, newEffectivePriceAmount: true, effectiveAt: true },
  });
  const effectiveDate = localDate(effectiveAt);
  return targets.map((target) => {
    const matchingDimension = (change: any) => target.targetKind === "OPTION"
      ? change.productId === target.productId && change.optionId === target.optionId && ["OPTION_PRICE", "PRODUCT_OPTION_OVERRIDE"].includes(change.dimension)
      : target.targetKind === "PACKAGING"
        ? change.productId === target.productId && change.dimension === "PACKAGING_CHARGE"
        : change.productId === target.productId && ["PRODUCT_BASE_PRICE", "PRODUCT_DISCOUNT"].includes(change.dimension);
    const allTargetChanges = changes.filter(matchingDimension);
    const sameDay = allTargetChanges.filter((change) => change.effectiveAt && localDate(change.effectiveAt) === effectiveDate);
    const amountMatches = (change: any) => (change.newEffectivePriceAmount ?? change.newAmount) === target.proposedPriceAmount;
    const matching = sameDay.filter(amountMatches);
    const chosen: any | null = matching.length === 1 ? matching[0]! : null;
    const historyStatus = matching.length > 1 ? "AMBIGUOUS"
      : matching.length === 1 && target.previousPriceAmount !== null &&
        (chosen.previousEffectivePriceAmount ?? chosen.previousAmount) !== target.previousPriceAmount ? "MISMATCHED"
      : matching.length === 1 ? "MATCHED"
      : sameDay.length > 0 || allTargetChanges.length > 0 ? "MISMATCHED" : "MISSING";
    const oldEventAmount = chosen?.previousEffectivePriceAmount ?? chosen?.previousAmount ?? null;
    return {
      ...target,
      priceHistory: {
        status: historyStatus,
        changeIds: (matching.length ? matching : sameDay).map((change: any) => change.id),
        effectiveAt: chosen?.effectiveAt?.toISOString() ?? (sameDay.length === 1 ? sameDay[0]!.effectiveAt?.toISOString() ?? null : null),
        originalPriceMatches: target.previousPriceAmount === null || !chosen ? null : oldEventAmount === target.previousPriceAmount,
      },
      _matchedChange: chosen,
    };
  });
}

async function readExperiment(prisma: PrismaClient, experimentId: string) {
  const row = await prisma.pricingExperiment.findUnique({
    where: { id: experimentId },
    include: { createdBy: { select: { id: true, username: true } }, targets: { orderBy: [{ targetKind: "asc" }, { targetKey: "asc" }] } },
  });
  if (!row) fail(404, ErrorCodes.NOT_FOUND, "The requested pricing experiment was not found.");
  const targets = await historyForTargets(prisma, row.effectiveAt, row.targets as ExperimentTarget[]);
  return {
    ...row,
    effectiveAt: row.effectiveAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    notes: row.notes,
    createdBy: row.createdBy,
    targets: targets.map(({ _matchedChange, ...target }) => target),
    _targetHistory: targets,
  };
}

export async function listPricingExperiments(prisma: PrismaClient) {
  const rows = await prisma.pricingExperiment.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    include: { createdBy: { select: { id: true, username: true } }, targets: { orderBy: [{ targetKind: "asc" }, { targetKey: "asc" }] } },
  });
  const results = await Promise.all(rows.map((row) => historyForTargets(prisma, row.effectiveAt, row.targets as ExperimentTarget[])));
  return { experiments: rows.map((row, index) => ({
    id: row.id, name: row.name, effectiveAt: row.effectiveAt.toISOString(),
    expectedEvaluationDays: row.expectedEvaluationDays, comparisonDays: row.comparisonDays,
    notes: row.notes, createdAt: row.createdAt.toISOString(), createdBy: row.createdBy,
    targets: results[index]!.map(({ _matchedChange, ...target }) => target),
  })) };
}

export async function createPricingExperiment(
  prisma: PrismaClient, actor: { id: string }, requestId: string, input: CreatePricingExperimentRequest,
) {
  const productIds = [...new Set(input.targets.map((target) => target.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, priceAmount: true, systemKey: true, archivedAt: true,
      productOptionGroups: { select: { allowedOptions: { select: { optionId: true, option: { select: { id: true, name: true, archivedAt: true } } } } } } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  for (const target of input.targets) {
    const product = productById.get(target.productId);
    if (!product || product.archivedAt) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Every target must reference an active catalog product.");
    if (product.systemKey === "PACKING") fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A packaging product cannot be a pricing experiment target.");
    if (target.targetKind === "OPTION") {
      const option = product.productOptionGroups.flatMap((group) => group.allowedOptions).find((link) => link.optionId === target.optionId)?.option;
      if (!option || option.archivedAt) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The selected option is not available for that product.");
    }
  }
  const row = await prisma.$transaction(async (tx) => {
    const experiment = await tx.pricingExperiment.create({ data: {
      name: input.name, effectiveAt: new Date(input.effectiveAt),
      expectedEvaluationDays: input.expectedEvaluationDays, comparisonDays: input.comparisonDays,
      notes: input.notes?.trim() || null, createdById: actor.id,
    } });
    const targets = input.targets.map((target) => {
      const product = productById.get(target.productId)!;
      const link = target.optionId ? product.productOptionGroups.flatMap((group) => group.allowedOptions).find((entry) => entry.optionId === target.optionId) : null;
      return {
        experimentId: experiment.id,
        targetKey: targetKey(target.targetKind, target.productId, target.optionId),
        targetKind: target.targetKind,
        productId: target.productId,
        optionId: target.optionId ?? null,
        productNameSnapshot: product.name,
        optionNameSnapshot: link?.option.name ?? null,
        previousPriceAmount: target.previousPriceAmount ?? null,
        proposedPriceAmount: target.proposedPriceAmount,
      };
    });
    await tx.pricingExperimentTarget.createMany({ data: targets });
    await tx.auditLog.create({ data: {
      actorId: actor.id, requestId, operation: "CREATE_PRICING_EXPERIMENT",
      entityType: "PRICING_EXPERIMENT", entityId: experiment.id,
      afterSnapshot: { name: input.name, effectiveAt: input.effectiveAt, expectedEvaluationDays: input.expectedEvaluationDays,
        comparisonDays: input.comparisonDays, targets } as any,
    } });
    return experiment;
  });
  return readExperiment(prisma, row.id);
}

function comparisonDates(effectiveAt: Date, comparisonDays: number, today = localDate(new Date())) {
  const effectiveDate = localDate(effectiveAt);
  const beforeCandidates = Array.from({ length: comparisonDays }, (_, index) => addDays(effectiveDate, index - comparisonDays));
  const lastFullDate = addDays(today, -1);
  const afterCandidates = Array.from({ length: comparisonDays }, (_, index) => addDays(effectiveDate, index + 1)).filter((date) => date <= lastFullDate);
  const beforeByWeekday = new Map<number, string[]>();
  const afterByWeekday = new Map<number, string[]>();
  for (const date of beforeCandidates) beforeByWeekday.set(weekday(date), [...(beforeByWeekday.get(weekday(date)) ?? []), date]);
  for (const date of afterCandidates) afterByWeekday.set(weekday(date), [...(afterByWeekday.get(weekday(date)) ?? []), date]);
  const before: string[] = [];
  const after: string[] = [];
  for (let day = 0; day < 7; day += 1) {
    const preRows = beforeByWeekday.get(day) ?? [];
    const postRows = afterByWeekday.get(day) ?? [];
    const count = Math.min(preRows.length, postRows.length);
    if (count > 0) {
      before.push(...preRows.slice(-count));
      after.push(...postRows.slice(0, count));
    }
  }
  if (before.length === 0 && after.length === 0) {
    // Short custom windows can contain no matching weekdays. Keep the
    // requested full-day windows and disclose the mismatch instead of
    // returning two empty periods.
    before.push(...beforeCandidates);
    after.push(...afterCandidates);
  }
  return {
    effectiveDate,
    before: before.sort(), after: after.sort(),
    excludedCurrentPartialDay: today > effectiveDate,
    effectiveDayExcluded: true,
  };
}

async function consumptionsForDates(prisma: PrismaClient, dates: string[]) {
  const bounds = rangeOfDates(dates);
  if (!bounds) return [];
  const range = tehranReportRange({ fromDate: bounds.from, toDate: bounds.to });
  const rows = await loadRecognizedConsumptions(prisma, range) as any[];
  const selected = rows.filter((row) => dates.includes(localDate(row.recognizedAt)) && isEligibleSettledOrder(row.order));
  const latestByOrder = new Map<string, any>();
  for (const row of selected) {
    const previous = latestByOrder.get(row.orderId);
    if (!previous || previous.recognizedAt < row.recognizedAt ||
      (previous.recognizedAt.getTime() === row.recognizedAt.getTime() && previous.id < row.id)) latestByOrder.set(row.orderId, row);
  }
  return [...latestByOrder.values()];
}

function summarize(consumptions: any[], dates: string[], targets: ExperimentTarget[]): PeriodAggregate {
  const bounds = rangeOfDates(dates);
  const groupMap = new Map<string, ProductGroup>();
  const orderIds = new Set<string>();
  const takeawayOrderIds = new Set<string>();
  let orderValue = 0n; let itemUnits = 0; let affectedItemUnits = 0;
  let netRevenue = 0n; let ingredientCogs = 0n; let totalCogs = 0n;
  let completeRevenue = 0n; let incompleteRevenue = 0n; let knownContribution = 0n;
  let allCostsComplete = true; let orderDiscount = 0n; let itemDiscount = 0n;
  const targetRows = targets;

  for (const consumption of consumptions) {
    const order = consumption.order;
    const channel = salesChannel(order);
    orderIds.add(order.id);
    if (channel === "TAKEAWAY") takeawayOrderIds.add(order.id);
    orderValue += BigInt(order.totalAmount);
    orderDiscount += BigInt(order.discountAmount ?? 0);
    for (const item of consumption.items) {
      const row = item.orderItem;
      const revenue = activeRevenue(row.settlementAllocations);
      const costComplete = hasCompleteCostSnapshot(item);
      const cost = BigInt(item.theoreticalCogsAmount ?? item.knownCogsAmount ?? 0);
      const itemChannel = (item.costSnapshot as any)?.orderChannel ?? channel;
      const lineOptions = optionsFor(item);
      const affected = targetRows.some((target) => isTargeted(target, item));
      netRevenue += revenue;
      ingredientCogs += BigInt(item.knownCogsAmount ?? 0);
      knownContribution += revenue - BigInt(item.knownCogsAmount ?? 0);
      itemDiscount += BigInt(row.discountAmount ?? 0);
      if (costComplete) { completeRevenue += revenue; totalCogs += cost; }
      else { incompleteRevenue += revenue; allCostsComplete = false; }
      itemUnits += item.quantity;
      if (affected) affectedItemUnits += item.quantity;
      const variantKey = groupKey(row.productId, itemChannel, lineOptions);
      const key = variantKey;
      const group = groupMap.get(key) ?? createGroup(item, itemChannel, lineOptions);
      group.key = key;
      group.quantity += item.quantity;
      group.revenue += revenue;
      group.cogs += cost;
      group.knownCogs += BigInt(item.knownCogsAmount ?? 0);
      if (costComplete) group.completeRevenue += revenue;
      else group.incompleteRevenue += revenue;
      group.complete &&= costComplete;
      group.affected ||= affected;
      group.orderIds.add(order.id);
      for (const target of targetRows) {
        if (target.targetKind !== "PACKAGING" && isTargeted(target, item)) group.targetKinds.add(target.targetKind);
      }
      groupMap.set(key, group);
    }
  }
  let affectedRevenue = 0n; let unaffectedRevenue = 0n; let groupedRevenue = 0n;
  for (const group of groupMap.values()) {
    groupedRevenue += group.revenue;
    if (group.affected) affectedRevenue += group.revenue;
    else unaffectedRevenue += group.revenue;
  }
  const unattributedRevenue = netRevenue > groupedRevenue ? netRevenue - groupedRevenue : 0n;
  return {
    dateSet: dates, fromDate: bounds?.from ?? null, toDate: bounds?.to ?? null,
    orderCount: orderIds.size, orderIds, takeawayOrderIds, orderValue, itemUnits, affectedItemUnits,
    netRevenue, affectedRevenue, unaffectedRevenue, unattributedRevenue, ingredientCogs, totalCogs,
    completeRevenue, incompleteRevenue, knownContribution, allCostsComplete,
    orderDiscount, itemDiscount, groups: groupMap, consumptions,
  };
}

function periodMetrics(summary: PeriodAggregate) {
  const includedDays = summary.dateSet.length;
  const complete = summary.allCostsComplete;
  const contribution = complete ? summary.netRevenue - summary.totalCogs : null;
  const monthlyContribution = contribution === null ? null : scaledAmount(contribution, includedDays);
  const monthlyRevenue = scaledAmount(summary.netRevenue, includedDays);
  const fixedCoverage = monthlyContribution === null ? null : percent(monthlyContribution, FIXED_MONTHLY_COST);
  const contributionMargin = contribution === null ? null : percent(contribution, summary.netRevenue);
  const breakEvenRevenue = contribution !== null && contribution > 0n && summary.netRevenue > 0n
    ? (FIXED_MONTHLY_COST * summary.netRevenue + contribution - 1n) / contribution : null;
  const marginOfSafety = breakEvenRevenue === null ? null : monthlyRevenue - breakEvenRevenue;
  const affectedContribution = [...summary.groups.values()].filter((group) => group.affected).every((group) => group.complete)
    ? [...summary.groups.values()].filter((group) => group.affected).reduce((sum, group) => sum + group.revenue - group.cogs, 0n) : null;
  const unaffectedContribution = [...summary.groups.values()].filter((group) => !group.affected).every((group) => group.complete)
    ? [...summary.groups.values()].filter((group) => !group.affected).reduce((sum, group) => sum + group.revenue - group.cogs, 0n) : null;
  const weekdayCounts = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, dayCount: summary.dateSet.filter((date) => weekday(date) === dayOfWeek).length }));
  return {
    fromDate: summary.fromDate, toDate: summary.toDate, requestedDayCount: includedDays,
    includedDayCount: includedDays, weekdayCounts,
    orderCount: summary.orderCount, itemUnits: summary.itemUnits, affectedItemUnits: summary.affectedItemUnits,
    netRevenueAmount: amount(summary.netRevenue), affectedNetRevenueAmount: amount(summary.affectedRevenue),
    unaffectedNetRevenueAmount: amount(summary.unaffectedRevenue), unattributedNetRevenueAmount: amount(summary.unattributedRevenue),
    affectedContributionAmount: affectedContribution === null ? null : signedAmount(affectedContribution),
    unaffectedContributionAmount: unaffectedContribution === null ? null : signedAmount(unaffectedContribution),
    averageSellingPriceAmount: average(summary.netRevenue, summary.itemUnits),
    averageOrderValueAmount: average(summary.netRevenue, summary.orderCount),
    ingredientCogsAmount: amount(summary.ingredientCogs), completeCostRevenueAmount: amount(summary.completeRevenue),
    incompleteCostRevenueAmount: amount(summary.incompleteRevenue),
    variableCostAmount: complete ? amount(summary.totalCogs) : null,
    knownContributionAmount: signedAmount(summary.knownContribution),
    contributionAmount: contribution === null ? null : signedAmount(contribution),
    contributionMarginPercent: contributionMargin,
    contributionPerOrderAmount: contribution === null || summary.orderCount === 0 ? null : signedAmount(roundedDivide(contribution, BigInt(summary.orderCount))),
    costCoveragePercent: summary.netRevenue === 0n ? null : percent(summary.completeRevenue, summary.netRevenue),
    monthlyEquivalentContributionAmount: monthlyContribution === null ? null : signedAmount(monthlyContribution),
    fixedCostCoveragePercent: fixedCoverage,
    operatingSurplusAmount: monthlyContribution === null ? null : signedAmount(monthlyContribution - FIXED_MONTHLY_COST),
    breakEvenRevenueAmount: breakEvenRevenue === null ? null : amount(breakEvenRevenue),
    marginOfSafetyAmount: marginOfSafety === null ? null : signedAmount(marginOfSafety),
    marginOfSafetyPercent: marginOfSafety === null || monthlyRevenue === 0n ? null : percent(marginOfSafety, monthlyRevenue),
    takeawayOrderCount: summary.takeawayOrderIds.size,
    takeawayMixPercent: summary.orderCount === 0 ? null : percent(BigInt(summary.takeawayOrderIds.size), BigInt(summary.orderCount)),
    orderDiscountAmount: amount(summary.orderDiscount), itemDiscountAmount: amount(summary.itemDiscount),
    _contribution: contribution, _monthlyRevenue: monthlyRevenue,
  };
}

function isGroupAffected(group: ProductGroup, target: ExperimentTarget) {
  if (target.targetKind === "PRODUCT") return group.productId === target.productId;
  if (target.targetKind === "PACKAGING") return false;
  return group.productId === target.productId && group.options.some((option) => option.optionId === target.optionId);
}
function makeProductRows(before: PeriodAggregate, after: PeriodAggregate, targets: any[], currentCatalogPrices: Map<string, number>) {
  const keys = new Set([...before.groups.keys(), ...after.groups.keys()]);
  for (const target of targets) {
    if (![...before.groups.values(), ...after.groups.values()].some((group) => group.productId === target.productId &&
      (target.targetKind !== "OPTION" || group.options.some((option) => option.optionId === target.optionId)))) {
      keys.add(`target:${target.targetKey}`);
    }
  }
  return [...keys].map((key) => {
    const pre = before.groups.get(key); const post = after.groups.get(key);
    const sample = post ?? pre;
    const targetRows = targets.filter((target) => target.productId === sample?.productId || (!sample && key === `target:${target.targetKey}`));
    const applies = (target: any) => !sample || isGroupAffected(sample, target);
    const appliedTargets = targetRows.filter(applies);
    const affected = Boolean(sample?.affected || appliedTargets.length);
    const quantityBefore = pre?.quantity ?? 0; const quantityAfter = post?.quantity ?? 0;
    const revenueBefore = pre?.revenue ?? 0n; const revenueAfter = post?.revenue ?? 0n;
    const contributionBefore = !pre || pre.quantity === 0 ? 0n : pre.complete ? pre.revenue - pre.cogs : null;
    const contributionAfter = !post || post.quantity === 0 ? 0n : post.complete ? post.revenue - post.cogs : null;
    const target = appliedTargets[0] ?? targetRows[0];
    const change = target?._matchedChange;
    const previousPrice = change?.previousEffectivePriceAmount ?? change?.previousAmount ?? target?.previousPriceAmount ?? null;
    const experimentPrice = change?.newEffectivePriceAmount ?? change?.newAmount ?? target?.proposedPriceAmount ?? null;
    const currentPrice = target?.targetKind === "OPTION" && target.optionId
      ? currentCatalogPrices.get(`option:${target.productId}:${target.optionId}`) ?? currentCatalogPrices.get(`option:${target.optionId}`) ?? null
      : currentCatalogPrices.get(`product:${target?.productId ?? sample?.productId}`) ?? sample?.currentPriceAmount ?? null;
    const options = sample?.options ?? (target?.optionId ? [{ optionId: target.optionId, optionName: target.optionNameSnapshot, quantity: 1 }] : []);
    const completeRevenue = post?.completeRevenue ?? 0n;
    return {
      productId: sample?.productId ?? target.productId,
      productName: sample?.productName ?? target?.productNameSnapshot ?? "محصول نامشخص",
      categoryId: sample?.categoryId ?? null, categoryName: sample?.categoryName ?? null,
      channel: sample?.channel ?? "UNKNOWN", options,
      affected, targetKinds: [...new Set(appliedTargets.map((row) => row.targetKind))],
      previousPriceAmount: previousPrice, experimentPriceAmount: experimentPrice, currentCatalogPriceAmount: currentPrice,
      averageRealizedPriceBeforeAmount: average(revenueBefore, quantityBefore), averageRealizedPriceAfterAmount: average(revenueAfter, quantityAfter),
      quantityBefore, quantityAfter,
      quantityChangePercent: quantityBefore === 0 ? null : percent(BigInt(quantityAfter - quantityBefore), BigInt(quantityBefore)),
      unitShareBeforePercent: before.itemUnits === 0 ? null : percent(BigInt(quantityBefore), BigInt(before.itemUnits)),
      unitShareAfterPercent: after.itemUnits === 0 ? null : percent(BigInt(quantityAfter), BigInt(after.itemUnits)),
      revenueBeforeAmount: amount(revenueBefore), revenueAfterAmount: amount(revenueAfter), revenueChangeAmount: signedAmount(revenueAfter - revenueBefore),
      revenueShareBeforePercent: before.netRevenue === 0n ? null : percent(revenueBefore, before.netRevenue),
      revenueShareAfterPercent: after.netRevenue === 0n ? null : percent(revenueAfter, after.netRevenue),
      unitCostBeforeAmount: quantityBefore > 0 && pre?.complete ? amount(roundedDivide(pre.cogs, BigInt(quantityBefore))) : null,
      unitCostAfterAmount: quantityAfter > 0 && post?.complete ? amount(roundedDivide(post.cogs, BigInt(quantityAfter))) : null,
      contributionBeforeAmount: contributionBefore === null ? null : signedAmount(contributionBefore),
      contributionAfterAmount: contributionAfter === null ? null : signedAmount(contributionAfter),
      contributionChangeAmount: contributionBefore === null || contributionAfter === null ? null : signedAmount(contributionAfter - contributionBefore),
      costCoveragePercent: revenueAfter === 0n ? null : percent(completeRevenue, revenueAfter),
    };
  }).sort((left, right) => Number(right.affected) - Number(left.affected) || right.revenueAfterAmount - left.revenueAfterAmount || left.productName.localeCompare(right.productName, "fa"));
}

function categoryRows(before: PeriodAggregate, after: PeriodAggregate) {
  const map = new Map<string, { name: string; id: string | null; beforeRev: bigint; afterRev: bigint; beforeCont: bigint; afterCont: bigint; beforeComplete: boolean; afterComplete: boolean }>();
  for (const [summary, side] of [[before, "before"], [after, "after"]] as const) for (const group of summary.groups.values()) {
    const key = group.categoryId ?? "unknown";
    const row = map.get(key) ?? { name: group.categoryName ?? "دسته‌بندی نامشخص", id: group.categoryId, beforeRev: 0n, afterRev: 0n, beforeCont: 0n, afterCont: 0n, beforeComplete: true, afterComplete: true };
    if (side === "before") { row.beforeRev += group.revenue; row.beforeCont += group.revenue - group.cogs; row.beforeComplete &&= group.complete; }
    else { row.afterRev += group.revenue; row.afterCont += group.revenue - group.cogs; row.afterComplete &&= group.complete; }
    map.set(key, row);
  }
  return [...map.values()].map((row) => ({
    categoryId: row.id, categoryName: row.name,
    affected: [...before.groups.values(), ...after.groups.values()].some((group) => group.categoryId === row.id && group.affected),
    netRevenueBeforeAmount: amount(row.beforeRev), netRevenueAfterAmount: amount(row.afterRev),
    contributionBeforeAmount: row.beforeComplete ? signedAmount(row.beforeCont) : null,
    contributionAfterAmount: row.afterComplete ? signedAmount(row.afterCont) : null,
    revenueShareBeforePercent: before.netRevenue === 0n ? null : percent(row.beforeRev, before.netRevenue),
    revenueShareAfterPercent: after.netRevenue === 0n ? null : percent(row.afterRev, after.netRevenue),
  })).sort((a, b) => b.netRevenueAfterAmount - a.netRevenueAfterAmount);
}

function permutations<T>(rows: T[]): T[][] {
  if (!rows.length) return [[]];
  return rows.flatMap((row, index) => permutations(rows.filter((_, current) => current !== index)).map((tail) => [row, ...tail]));
}
function shapleyDecomposition(before: PeriodAggregate, after: PeriodAggregate) {
  const beforeGroupedContribution = [...before.groups.values()].reduce((sum, group) => sum + group.revenue - group.cogs, 0n);
  const afterGroupedContribution = [...after.groups.values()].reduce((sum, group) => sum + group.revenue - group.cogs, 0n);
  const complete = before.allCostsComplete && after.allCostsComplete &&
    beforeGroupedContribution === before.netRevenue - before.totalCogs &&
    afterGroupedContribution === after.netRevenue - after.totalCogs;
  const observed = periodMetrics(before)._contribution !== null && periodMetrics(after)._contribution !== null
    ? periodMetrics(after)._contribution! - periodMetrics(before)._contribution! : null;
  const limitations = [] as string[];
  if (!before.allCostsComplete || !after.allCostsComplete) limitations.push("هزینه‌ی متغیر برخی اقلام کامل نیست.");
  if (beforeGroupedContribution !== before.netRevenue - before.totalCogs || afterGroupedContribution !== after.netRevenue - after.totalCogs) limitations.push("جمع مشارکت گروه‌های قابل انتساب با جمع کافه برابر نیست.");
  if (!complete || observed === null) return {
    method: "میانگین ارزش حاشیه‌ای شاپلی روی قیمت تحقق‌یافته، حجم کل، ترکیب محصول/گزینه/کانال و هزینه‌ی متغیر؛ اثرها فقط با پوشش کامل هزینه گزارش می‌شوند.",
    priceEffectAmount: null, volumeEffectAmount: null, mixEffectAmount: null, unitCostEffectAmount: null,
    observedContributionChangeAmount: observed === null ? null : signedAmount(observed), residualAmount: observed === null ? null : signedAmount(observed),
    reconciles: false, limitations,
  };
  const preGroups = before.groups; const postGroups = after.groups;
  const keys = [...new Set([...preGroups.keys(), ...postGroups.keys()])];
  const unitValues = new Map<string, { prePrice: bigint; postPrice: bigint; preCost: bigint; postCost: bigint; preQ: number; postQ: number }>();
  for (const key of keys) {
    const pre = preGroups.get(key); const post = postGroups.get(key);
    const preQ = pre?.quantity ?? 0; const postQ = post?.quantity ?? 0;
    const qPre = BigInt(preQ || postQ || 1); const qPost = BigInt(postQ || preQ || 1);
    const preRevenue = pre?.revenue ?? post?.revenue ?? 0n; const postRevenue = post?.revenue ?? pre?.revenue ?? 0n;
    const preCost = pre?.cogs ?? post?.cogs ?? 0n; const postCost = post?.cogs ?? pre?.cogs ?? 0n;
    unitValues.set(key, {
      prePrice: roundedDivide(preRevenue * SCALE, qPre), postPrice: roundedDivide(postRevenue * SCALE, qPost),
      preCost: roundedDivide(preCost * SCALE, qPre), postCost: roundedDivide(postCost * SCALE, qPost), preQ, postQ,
    });
  }
  const calc = (mask: number) => {
    const volumeAfter = Boolean(mask & 1); const mixAfter = Boolean(mask & 2);
    const priceAfter = Boolean(mask & 4); const costAfter = Boolean(mask & 8);
    const qSide = volumeAfter ? postGroups : preGroups;
    const mixSide = mixAfter ? postGroups : preGroups;
    const qTotal = [...qSide.values()].reduce((sum, group) => sum + group.quantity, 0);
    const mixTotal = [...mixSide.values()].reduce((sum, group) => sum + group.quantity, 0);
    if (qTotal === 0 || mixTotal === 0) return 0n;
    let weightedMargin = 0n;
    for (const key of keys) {
      const mixQuantity = BigInt(mixSide.get(key)?.quantity ?? 0);
      const row = unitValues.get(key)!;
      const price = priceAfter ? row.postPrice : row.prePrice;
      const cost = costAfter ? row.postCost : row.preCost;
      weightedMargin += mixQuantity * (price - cost);
    }
    return roundedDivide(BigInt(qTotal) * weightedMargin, BigInt(mixTotal));
  };
  const factors = [
    { name: "volume", bit: 1 }, { name: "mix", bit: 2 }, { name: "price", bit: 4 }, { name: "cost", bit: 8 },
  ];
  const sums = new Map(factors.map((factor) => [factor.name, 0n]));
  for (const ordering of permutations(factors)) {
    let mask = 0; let previous = calc(mask);
    for (const factor of ordering) {
      mask |= factor.bit;
      const next = calc(mask);
      sums.set(factor.name, sums.get(factor.name)! + next - previous);
      previous = next;
    }
  }
  let values = Object.fromEntries([...sums.entries()].map(([name, value]) => [name, roundedDivide(value, 24n * SCALE)])) as Record<string, bigint>;
  const reconciliation = observed - Object.values(values).reduce((sum, value) => sum + value, 0n);
  values.mix = (values.mix ?? 0n) + reconciliation;
  limitations.push("اثر گردکردن به نزدیک‌ترین تومان در اثر ترکیب منظور شده تا جمع دقیقاً با تغییر مشاهده‌شده برابر بماند.");
  return {
    method: "میانگین ارزش حاشیه‌ای شاپلی روی چهار عامل قیمت تحقق‌یافته، حجم کل، ترکیب محصول/گزینه/کانال و هزینه‌ی متغیر. اثر قیمت تخفیف و مبلغ بسته‌بندی را دربرمی‌گیرد؛ اثر هزینه شامل بهای مواد و بسته‌بندی ثبت‌شده است. هر ترتیب از ۲۴ ترتیب ممکن وزن برابر دارد؛ باقی‌مانده‌ی گردکردن به اثر ترکیب افزوده می‌شود.",
    priceEffectAmount: signedAmount(values.price!), volumeEffectAmount: signedAmount(values.volume!),
    mixEffectAmount: signedAmount(values.mix!), unitCostEffectAmount: signedAmount(values.cost!),
    observedContributionChangeAmount: signedAmount(observed), residualAmount: 0,
    reconciles: true, limitations,
  };
}

function productBreakEven(before: PeriodAggregate, after: PeriodAggregate, targets: any[]) {
  const optionPrice = (summary: PeriodAggregate, target: ExperimentTarget) => {
    let value = 0n; let count = 0n;
    for (const consumption of summary.consumptions) for (const item of consumption.items) {
      if (item.orderItem.productId !== target.productId) continue;
      const option = item.orderItem.options.find((row: any) => row.optionId === target.optionId);
      if (!option) continue;
      value += BigInt(option.priceSnapshot) * BigInt(option.quantity);
      count += BigInt(option.quantity);
    }
    return count > 0n ? roundedDivide(value, count) : null;
  };
  const rows = targets.map((target) => {
    const pre = [...before.groups.values()].filter((group) => isGroupAffected(group, target));
    const post = [...after.groups.values()].filter((group) => isGroupAffected(group, target));
    const beforeQty = pre.reduce((sum, group) => sum + group.quantity, 0);
    const afterQty = post.reduce((sum, group) => sum + group.quantity, 0);
    const costComplete = pre.every((group) => group.complete) && post.every((group) => group.complete);
    const beforeContribution = costComplete ? pre.reduce((sum, group) => sum + group.revenue - group.cogs, 0n) : null;
    const afterContribution = costComplete ? post.reduce((sum, group) => sum + group.revenue - group.cogs, 0n) : null;
    const oldUnitContribution = beforeQty > 0 && beforeContribution !== null ? roundedDivide(beforeContribution, BigInt(beforeQty)) : null;
    const newUnitContribution = afterQty > 0 && afterContribution !== null ? roundedDivide(afterContribution, BigInt(afterQty)) : null;
    const oldRealized = target.targetKind === "OPTION" ? optionPrice(before, target) : beforeQty > 0
      ? roundedDivide(pre.reduce((sum, group) => sum + group.revenue, 0n), BigInt(beforeQty)) : null;
    const newRealized = target.targetKind === "OPTION" ? optionPrice(after, target) : afterQty > 0
      ? roundedDivide(post.reduce((sum, group) => sum + group.revenue, 0n), BigInt(afterQty)) : null;
    const increase = oldRealized === null || newRealized === null ? null : newRealized - oldRealized;
    const contributionGain = beforeQty > 0 && afterQty > 0 && beforeContribution !== null && afterContribution !== null
      ? afterContribution - roundedDivide(beforeContribution * BigInt(afterQty), BigInt(beforeQty)) : null;
    const threshold = contributionGain !== null && contributionGain > 0n && afterContribution !== null && afterContribution > 0n
      ? percent(contributionGain, afterContribution) : null;
    return {
      productId: target.productId, optionId: target.optionId,
      label: target.optionNameSnapshot ? `${target.productNameSnapshot}، ${target.optionNameSnapshot}` : target.productNameSnapshot,
      previousUnitContributionAmount: oldUnitContribution === null ? null : signedAmount(oldUnitContribution),
      newUnitContributionAmount: newUnitContribution === null ? null : signedAmount(newUnitContribution),
      priceIncreaseAmount: increase === null ? null : signedAmount(increase),
      maximumTolerableUnitDeclinePercent: threshold,
      contributionBenefitAtObservedVolumeAmount: contributionGain === null ? null : signedAmount(contributionGain),
    };
  });
  const affectedPre = [...before.groups.values()].filter((group) => group.affected);
  const affectedPost = [...after.groups.values()].filter((group) => group.affected);
  const allAffectedComplete = affectedPre.every((group) => group.complete) && affectedPost.every((group) => group.complete);
  const afterCount = affectedPost.reduce((sum, group) => sum + group.quantity, 0);
  const afterContribution = afterCount > 0 ? affectedPost.reduce((sum, group) => sum + group.revenue - group.cogs, 0n) : null;
  // Apply the observed earlier unit contribution to the later mix once per
  // sale group. Target rows can overlap and must never be summed here.
  const hasBaseline = affectedPost.every((group) => (before.groups.get(group.key)?.quantity ?? 0) > 0);
  const baselineAtPostVolume = affectedPost.reduce((sum, group) => {
    const previous = before.groups.get(group.key);
    return sum + (previous?.quantity ? roundedDivide((previous.revenue - previous.cogs) * BigInt(group.quantity), BigInt(previous.quantity)) : 0n);
  }, 0n);
  const contributionGain = afterContribution === null ? null : afterContribution - baselineAtPostVolume;
  const wholeDecline = allAffectedComplete && hasBaseline && afterContribution !== null && afterContribution > 0n && contributionGain !== null && contributionGain > 0n
    ? percent(contributionGain, afterContribution) : null;
  const totalBefore = periodMetrics(before)._contribution; const totalAfter = periodMetrics(after)._contribution;
  return {
    products: rows,
    wholeAffectedGroupDeclinePercent: wholeDecline,
    overallOrderCountChangePercent: before.orderCount === 0 ? null : percent(BigInt(after.orderCount - before.orderCount), BigInt(before.orderCount)),
    totalContributionChangeAmount: totalBefore === null || totalAfter === null ? null : signedAmount(totalAfter - totalBefore),
    assumption: "آستانه، افت حجمی است که مشارکت هر واحد را به سطح پیش از تغییر برمی‌گرداند؛ تغییر بهای مواد و بسته‌بندی هم در آن حساب می‌شود. جمع کل با ترکیب فروش پس از تغییر و بدون تکرار هدف‌های هم‌پوشان محاسبه می‌شود. ردیف‌های هدف جداگانه‌اند و نباید با هم جمع شوند. این محاسبه تقاضا را پیش‌بینی نمی‌کند.",
  };
}

function dailyPoints(before: PeriodAggregate, after: PeriodAggregate, effectiveDate: string) {
  const byDate = new Map<string, { orderIds: Set<string>; units: number; revenue: bigint; cogs: bigint; complete: boolean }>();
  for (const summary of [before, after]) for (const consumption of summary.consumptions) {
    const date = localDate(consumption.recognizedAt);
    const row = byDate.get(date) ?? { orderIds: new Set<string>(), units: 0, revenue: 0n, cogs: 0n, complete: true };
    row.orderIds.add(consumption.orderId);
    for (const item of consumption.items) {
      row.revenue += activeRevenue(item.orderItem.settlementAllocations);
      row.units += item.quantity;
      if (hasCompleteCostSnapshot(item)) row.cogs += BigInt(item.theoreticalCogsAmount!);
      else row.complete = false;
    }
    byDate.set(date, row);
  }
  for (const date of [...before.dateSet, ...after.dateSet]) {
    if (!byDate.has(date)) byDate.set(date, { orderIds: new Set<string>(), units: 0, revenue: 0n, cogs: 0n, complete: true });
  }
  const rows: Array<{ date: string; phase: "BEFORE" | "EFFECTIVE_DAY" | "AFTER"; experimentStartMarker: boolean; orderCount: number; itemUnits: number; netRevenueAmount: number; contributionAmount: number | null; contributionMarginPercent: string | null }> = [...byDate.entries()].map(([date, row]) => ({
    date, phase: date < effectiveDate ? "BEFORE" as const : "AFTER" as const,
    experimentStartMarker: false, orderCount: row.orderIds.size, itemUnits: row.units,
    netRevenueAmount: amount(row.revenue),
    contributionAmount: row.complete ? signedAmount(row.revenue - row.cogs) : null,
    contributionMarginPercent: row.complete ? percent(row.revenue - row.cogs, row.revenue) : null,
  }));
  rows.push({ date: effectiveDate, phase: "EFFECTIVE_DAY" as const, experimentStartMarker: true,
    orderCount: 0, itemUnits: 0, netRevenueAmount: 0, contributionAmount: null, contributionMarginPercent: null });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function compareChanges(before: any, after: any) {
  const beforeContribution = before.monthlyEquivalentContributionAmount === null ? null : BigInt(before.monthlyEquivalentContributionAmount);
  const afterContribution = after.monthlyEquivalentContributionAmount === null ? null : BigInt(after.monthlyEquivalentContributionAmount);
  const beforeRevenue = BigInt(before.netRevenueAmount); const afterRevenue = BigInt(after.netRevenueAmount);
  const beforeAffectedQty = BigInt(before.affectedItemUnits); const afterAffectedQty = BigInt(after.affectedItemUnits);
  const beforeAov = before.averageOrderValueAmount === null ? null : BigInt(before.averageOrderValueAmount);
  const afterAov = after.averageOrderValueAmount === null ? null : BigInt(after.averageOrderValueAmount);
  const beforeCoverage = before.fixedCostCoveragePercent;
  const afterCoverage = after.fixedCostCoveragePercent;
  const coverageChange = beforeCoverage === null || afterCoverage === null ? null : (Number(afterCoverage) - Number(beforeCoverage)).toFixed(2);
  const beforeSafety = before.marginOfSafetyAmount === null ? null : BigInt(before.marginOfSafetyAmount);
  const afterSafety = after.marginOfSafetyAmount === null ? null : BigInt(after.marginOfSafetyAmount);
  const beforeSafetyRate = before.marginOfSafetyPercent;
  const afterSafetyRate = after.marginOfSafetyPercent;
  return {
    totalContributionAmount: beforeContribution === null || afterContribution === null ? null : signedAmount(afterContribution - beforeContribution),
    totalContributionPercent: beforeContribution === null || afterContribution === null ? null : ratioChange(beforeContribution, afterContribution),
    netRevenueAmount: signedAmount(afterRevenue - beforeRevenue), netRevenuePercent: ratioChange(beforeRevenue, afterRevenue),
    affectedQuantity: Number(afterAffectedQty - beforeAffectedQty), affectedQuantityPercent: ratioChange(beforeAffectedQty, afterAffectedQty),
    averageOrderValueAmount: beforeAov === null || afterAov === null ? null : signedAmount(afterAov - beforeAov),
    averageOrderValuePercent: beforeAov === null || afterAov === null ? null : ratioChange(beforeAov, afterAov),
    fixedCostCoveragePercent: coverageChange,
    marginOfSafetyAmount: beforeSafety === null || afterSafety === null ? null : signedAmount(afterSafety - beforeSafety),
    marginOfSafetyPercent: beforeSafetyRate === null || afterSafetyRate === null ? null : (Number(afterSafetyRate) - Number(beforeSafetyRate)).toFixed(2),
  };
}

function assessment(status: "IN_PROGRESS" | "READY" | "INCONCLUSIVE", before: any, after: any, history: any[], expectedDays: number) {
  const reasons: string[] = [];
  if (status === "IN_PROGRESS") reasons.push("دوره‌ی ارزیابی هنوز کامل نشده است.");
  if (before.orderCount + after.orderCount === 0) reasons.push("در دوره‌های انتخاب‌شده سفارش واجد شرایط ثبت نشده است.");
  if (after.includedDayCount < Math.min(expectedDays, 7)) reasons.push("روزهای کامل کافی برای مقایسه ثبت نشده‌اند.");
  if (before.contributionAmount === null || after.contributionAmount === null) reasons.push("پوشش هزینه برای محاسبه‌ی مشارکت کامل کافی نیست.");
  if (history.length === 0 || history.some((target) => target.priceHistory.status !== "MATCHED")) reasons.push("تاریخچه‌ی قیمت برای همه‌ی هدف‌ها با تغییر ثبت‌شده تطبیق ندارد.");
  const conclusive = status === "READY" && before.orderCount + after.orderCount > 0 && before.contributionAmount !== null && after.contributionAmount !== null &&
    after.includedDayCount >= Math.min(expectedDays, 7) && history.length > 0 && history.every((target) => target.priceHistory.status === "MATCHED");
  if (!conclusive) return { outcome: "INCONCLUSIVE" as const, summaryFa: `نتیجه قطعی نیست. ${reasons.join(" ") || "داده‌های مقایسه برای نتیجه‌گیری کافی نیستند."}`, reasons };
  const change = BigInt(after.contributionAmount) - BigInt(before.contributionAmount);
  if (change > 0n) return { outcome: "IMPROVED" as const, summaryFa: `مشارکت مشاهده‌شده ${new Intl.NumberFormat("fa-IR").format(Number(change))} تومان افزایش یافت. این مقایسه به‌تنهایی اثر علّی قیمت را ثابت نمی‌کند.`, reasons: ["مشارکت کامل بر پایه‌ی بهای ثبت‌شده افزایش یافته است.", "تغییرات تخفیف، مناسبت‌ها و عوامل ثبت‌نشده را هنگام تصمیم‌گیری در نظر بگیرید."] };
  if (change < 0n) return { outcome: "DECLINED" as const, summaryFa: `مشارکت مشاهده‌شده ${new Intl.NumberFormat("fa-IR").format(Number(-change))} تومان کاهش یافت. این مقایسه به‌تنهایی اثر علّی قیمت را ثابت نمی‌کند.`, reasons: ["مشارکت کامل نسبت به دوره‌ی قبل کاهش یافته است.", "ترکیب محصول، تخفیف و هزینه‌ی مواد نیز تغییر نتیجه را توضیح می‌دهند."] };
  return { outcome: "INCONCLUSIVE" as const, summaryFa: "مشارکت مشاهده‌شده تغییر نکرده است؛ افزایش درآمد به‌تنهایی به‌معنای موفقیت نیست.", reasons: ["تغییر مشارکت صفر بوده است."] };
}

export async function pricingExperimentReport(prisma: PrismaClient, experimentId: string, comparisonDaysOverride?: number) {
  const experiment = await readExperiment(prisma, experimentId);
  const history = experiment._targetHistory;
  const targets = experiment.targets as ExperimentTarget[];
  const comparisonDays = comparisonDaysOverride ?? experiment.comparisonDays;
  const dates = comparisonDates(new Date(experiment.effectiveAt), comparisonDays);
  const [beforeRows, afterRows] = await Promise.all([
    consumptionsForDates(prisma, dates.before), consumptionsForDates(prisma, dates.after),
  ]);
  const before = summarize(beforeRows, dates.before, targets);
  const after = summarize(afterRows, dates.after, targets);
  const beforeMetrics = periodMetrics(before); const afterMetrics = periodMetrics(after);
  beforeMetrics.requestedDayCount = comparisonDays;
  afterMetrics.requestedDayCount = comparisonDays;
  const daysSinceExpectedEnd = addDays(dates.effectiveDate, experiment.expectedEvaluationDays);
  const today = localDate(new Date());
  const minimumDays = Math.min(experiment.expectedEvaluationDays, Math.max(1, Math.floor(comparisonDays / 7) * 7 || comparisonDays));
  const periodReady = today > daysSinceExpectedEnd && after.dateSet.length >= minimumDays;
  const noEligibleOrders = before.orderCount + after.orderCount === 0;
  const missingCosts = !before.allCostsComplete || !after.allCostsComplete;
  const mismatchedHistory = history.length === 0 || history.some((target: any) => target.priceHistory.status !== "MATCHED");
  const hasRetiredPackagingTarget = history.some((target: ExperimentTarget) => target.targetKind === "PACKAGING");
  const status = !periodReady ? "IN_PROGRESS" as const : missingCosts || mismatchedHistory || noEligibleOrders || hasRetiredPackagingTarget ? "INCONCLUSIVE" as const : "READY" as const;
  const metricsForAssessment = { ...beforeMetrics, contributionAmount: beforeMetrics.contributionAmount };
  const assessmentResult = assessment(status, metricsForAssessment, afterMetrics, history, experiment.expectedEvaluationDays);
  const currentProductIds = [...new Set(history.map((target: any) => target.productId))];
  const currentOptionIds = [...new Set(history.flatMap((target: any) => target.optionId ? [target.optionId] : []))];
  const [currentProducts, currentOptions] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: currentProductIds } }, select: { id: true, priceAmount: true } }),
    currentOptionIds.length ? prisma.option.findMany({ where: { id: { in: currentOptionIds } }, select: { id: true, priceAmount: true } }) : Promise.resolve([]),
  ]);
  const productOptionPrices = currentOptionIds.length ? await prisma.productOptionGroupOption.findMany({
    where: { productId: { in: currentProductIds }, optionId: { in: currentOptionIds } },
    select: { productId: true, optionId: true, priceAmountOverride: true },
  }) : [];
  const currentCatalogPrices = new Map<string, number>([
    ...currentProducts.map((row) => [`product:${row.id}`, row.priceAmount] as [string, number]),
    ...currentOptions.map((row) => [`option:${row.id}`, row.priceAmount] as [string, number]),
    ...productOptionPrices.flatMap((row) => row.priceAmountOverride === null ? [] : [[`option:${row.productId}:${row.optionId}`, row.priceAmountOverride] as [string, number]]),
  ]);
  const decomposition = shapleyDecomposition(before, after);
  const products = makeProductRows(before, after, history, currentCatalogPrices);
  const categories = categoryRows(before, after);
  const discountRateBefore = before.netRevenue === 0n ? null : percent(before.orderDiscount + before.itemDiscount, before.netRevenue);
  const discountRateAfter = after.netRevenue === 0n ? null : percent(after.orderDiscount + after.itemDiscount, after.netRevenue);
  const qualityFlags: { code: string; severity: "INFO" | "WARNING" | "BLOCKER"; messageFa: string }[] = [];
  if (!dates.after.length) qualityFlags.push({ code: "NO_COMPLETE_POST_DAYS", severity: "BLOCKER", messageFa: "پس از تاریخ تغییر، روز کامل قابل مقایسه ثبت نشده است." });
  if (noEligibleOrders) qualityFlags.push({ code: "NO_ELIGIBLE_ORDERS", severity: "BLOCKER", messageFa: "در دو بازه‌ی مقایسه‌شده سفارش واجد شرایطی ثبت نشده است." });
  if (dates.after.length < comparisonDays) qualityFlags.push({ code: "POST_PERIOD_INCOMPLETE", severity: "WARNING", messageFa: `از ${comparisonDays} روز درخواستی، ${dates.after.length} روز هم‌روزِ هفته با بازه‌ی پیش از تغییر قابل استفاده است.` });
  if (!before.allCostsComplete || !after.allCostsComplete) qualityFlags.push({ code: "COSTS_INCOMPLETE", severity: "BLOCKER", messageFa: "برای بخشی از فروش، بهای کامل ثبت نشده است. مشارکت کل و مازاد عملیاتی محاسبه نمی‌شود." });
  if (hasRetiredPackagingTarget) qualityFlags.push({ code: "RETIRED_PACKAGING_TARGET", severity: "WARNING", messageFa: "این آزمایش هدف بسته‌بندی دارد که دیگر در گزارش فروش یا شبیه‌سازی قیمت استفاده نمی‌شود." });
  if (history.some((target: any) => target.priceHistory.status !== "MATCHED")) qualityFlags.push({ code: "PRICE_HISTORY_MISMATCH", severity: "WARNING", messageFa: "برای یک یا چند هدف، رویداد تغییر قیمت پیدا نشد یا مقادیر با آزمایش تطبیق ندارند." });
  if (discountRateBefore !== discountRateAfter) qualityFlags.push({ code: "DISCOUNT_MIX_CHANGED", severity: "WARNING", messageFa: "سهم تخفیف از فروش میان دو دوره تغییر کرده است." });
  qualityFlags.push({ code: "EXTERNAL_CONFOUNDERS_UNKNOWN", severity: "INFO", messageFa: "داده‌ی مناسبت‌ها، آب‌وهوا، تعطیلی عملیاتی، موجودی کالا و رویدادهای ویژه در سامانه ثبت نمی‌شود." });
  const priceHistoryIds = new Set(history.flatMap((target: any) => target.priceHistory.changeIds));
  const eventRange = dates.before.length && dates.after.length ? await prisma.catalogPriceChange.count({ where: {
    effectiveAt: { gte: tehranReportRange({ fromDate: dates.before[0]!, toDate: dates.after.at(-1)! }).from,
      lt: tehranReportRange({ fromDate: dates.before[0]!, toDate: dates.after.at(-1)! }).to },
  } }) : 0;
  const daily = dailyPoints(before, after, dates.effectiveDate);
  return {
    experiment: { ...experiment, targets: experiment.targets },
    status,
    assessment: assessmentResult,
    periods: {
      before: beforeMetrics, after: afterMetrics,
      weekdayCompositionMatched: before.dateSet.length === after.dateSet.length && before.dateSet.map(weekday).sort().join(",") === after.dateSet.map(weekday).sort().join(","),
      excludedCurrentPartialDay: dates.excludedCurrentPartialDay, effectiveDayExcluded: dates.effectiveDayExcluded,
    },
    changes: compareChanges(beforeMetrics, afterMetrics),
    daily, products, categories,
    decomposition,
    breakEven: productBreakEven(before, after, history),
    controls: {
      affectedContributionChangePercent: beforeMetrics.affectedContributionAmount === null || afterMetrics.affectedContributionAmount === null
        ? null : ratioChange(BigInt(beforeMetrics.affectedContributionAmount), BigInt(afterMetrics.affectedContributionAmount)),
      unaffectedContributionChangePercent: beforeMetrics.unaffectedContributionAmount === null || afterMetrics.unaffectedContributionAmount === null
        ? null : ratioChange(BigInt(beforeMetrics.unaffectedContributionAmount), BigInt(afterMetrics.unaffectedContributionAmount)),
      relativeContributionChangePercent: beforeMetrics.affectedContributionAmount === null || afterMetrics.affectedContributionAmount === null ||
        beforeMetrics.unaffectedContributionAmount === null || afterMetrics.unaffectedContributionAmount === null ? null
        : (Number(ratioChange(BigInt(beforeMetrics.affectedContributionAmount), BigInt(afterMetrics.affectedContributionAmount)) ?? "0") -
          Number(ratioChange(BigInt(beforeMetrics.unaffectedContributionAmount), BigInt(afterMetrics.unaffectedContributionAmount)) ?? "0")).toFixed(2),
      comparisonIsObservational: true as const,
    },
    confounders: {
      discountsChanged: discountRateBefore === null || discountRateAfter === null ? null : discountRateBefore !== discountRateAfter,
      catalogPriceChanges: Math.max(0, eventRange - priceHistoryIds.size),
      holidays: "UNKNOWN" as const, weather: "UNKNOWN" as const, productAvailability: "UNKNOWN" as const,
      operationalClosures: "UNKNOWN" as const, specialEvents: "UNKNOWN" as const,
    },
    dataQuality: {
      flags: qualityFlags, costCoverageComplete: before.allCostsComplete && after.allCostsComplete,
      validOrderCount: before.orderCount + after.orderCount,
    },
  };
}

function scenarioPeriods(fromDate: string, toDate: string) {
  const range = tehranReportRange({ fromDate, toDate });
  const dayCount = daysBetween(fromDate, toDate);
  if (dayCount > 93) fail(400, ErrorCodes.VALIDATION_ERROR, "Scenario ranges cannot exceed 93 calendar days.");
  if (toDate >= localDate(new Date())) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The scenario end date must be a completed day in Tehran.");
  return { range, dates: datesInRange(fromDate, toDate) };
}

// Price snapshots use integer Toman. Apply a per-kg change to the recorded
// weight, and an option change to its recorded line count exactly once.
function matchesScenarioItem(row: any, rule: PricingScenarioRequest["rules"][number]) {
  if (rule.targetKind === "PRODUCT") return row.productId === rule.productId;
  if (rule.targetKind === "CATEGORY") return row.product.categoryId === rule.categoryId;
  return rule.targetKind === "OPTION" && row.productId === rule.productId && row.options.some((option: any) => option.optionId === rule.optionId);
}
function scenarioLineAdjustment(row: any, rules: PricingScenarioRequest["rules"]) {
  const baseDelta = rules.filter((rule) => rule.targetKind !== "OPTION").reduce((sum, rule) => sum + BigInt(rule.adjustmentAmount), 0n);
  const beforeBase = BigInt(row.basePriceSnapshot);
  const afterBase = beforeBase + baseDelta;
  if (afterBase < 0n) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A simulated base price cannot be negative.");
  let beforeOptions = 0n; let afterOptions = 0n;
  for (const option of row.options) {
    const delta = rules.filter((rule) => rule.targetKind === "OPTION" && rule.optionId === option.optionId).reduce((sum, rule) => sum + BigInt(rule.adjustmentAmount), 0n);
    const afterPrice = BigInt(option.priceSnapshot) + delta;
    if (afterPrice < 0n) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A simulated option price cannot be negative.");
    beforeOptions += BigInt(option.priceSnapshot) * BigInt(option.quantity);
    afterOptions += afterPrice * BigInt(option.quantity);
  }
  const quantity = BigInt(row.quantity);
  if (row.pricingModeSnapshot !== "WEIGHTED_PER_KG") return baseDelta * quantity + afterOptions - beforeOptions;
  const grams = BigInt(row.weightGrams);
  return afterBase * grams * quantity / 1000n - beforeBase * grams * quantity / 1000n
    + afterOptions * grams * quantity / 1000n - beforeOptions * grams * quantity / 1000n;
}

export async function simulatePricingScenario(prisma: PrismaClient, input: PricingScenarioRequest) {
  const { dates } = scenarioPeriods(input.fromDate, input.toDate);
  const consumptions = await consumptionsForDates(prisma, dates);
  const summary = summarize(consumptions, dates, []);
  const sourceMetrics = periodMetrics(summary);
  const productIds = [...new Set(input.rules.flatMap((rule) => rule.productId ? [rule.productId] : []))];
  const categoryIds = [...new Set(input.rules.flatMap((rule) => rule.categoryId ? [rule.categoryId] : []))];
  const products = await prisma.product.findMany({ where: { OR: [{ id: { in: productIds } }, { categoryId: { in: categoryIds }, archivedAt: null }] }, select: { id: true, name: true, priceAmount: true, categoryId: true, systemKey: true, archivedAt: true, isActive: true } });
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true, kind: true, archivedAt: true } });
  const optionIds = [...new Set(input.rules.flatMap((rule) => rule.optionId ? [rule.optionId] : []))];
  const options = await prisma.option.findMany({ where: { id: { in: optionIds } }, select: { id: true, name: true, priceAmount: true, archivedAt: true, isActive: true } });
  const productOptions = optionIds.length ? await prisma.productOptionGroupOption.findMany({
    where: { productId: { in: productIds }, optionId: { in: optionIds } },
    select: { productId: true, optionId: true, priceAmountOverride: true },
  }) : [];
  const productOptionByKey = new Map(productOptions.map((row) => [`${row.productId}:${row.optionId}`, row]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const optionById = new Map(options.map((option) => [option.id, option]));
  const categoryProducts = new Map<string, typeof products>();
  for (const product of products) if (product.categoryId) categoryProducts.set(product.categoryId, [...(categoryProducts.get(product.categoryId) ?? []), product]);
  const rules = input.rules.map((rule) => {
    const product = rule.productId ? productById.get(rule.productId) : null;
    const category = rule.categoryId ? categoryById.get(rule.categoryId) : null;
    const option = rule.optionId ? optionById.get(rule.optionId) : null;
    if (rule.targetKind === "PRODUCT" && (!product || !product.isActive || product.archivedAt || product.systemKey === "PACKING")) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The product pricing rule requires an active menu product.");
    if (rule.targetKind === "OPTION" && (!product || !product.isActive || product.archivedAt || !option || !option.isActive || option.archivedAt || !productOptionByKey.has(`${rule.productId}:${rule.optionId}`))) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The option rule requires an active option linked to the selected product.");
    if (rule.categoryId && (!category || category.archivedAt || category.kind !== "SOURCE")) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Category-wide rules must reference an active source category.");
    if (rule.targetKind === "CATEGORY" && (!category || category.archivedAt || category.kind !== "SOURCE")) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The category pricing rule requires an active source category.");
    const categoryRows = rule.categoryId ? (categoryProducts.get(rule.categoryId) ?? []).filter((row) => row.isActive && !row.archivedAt && row.systemKey !== "PACKING") : [];
    const currentPrice = rule.targetKind === "OPTION" ? productOptionByKey.get(`${rule.productId}:${rule.optionId}`)?.priceAmountOverride ?? option!.priceAmount
      : rule.targetKind === "CATEGORY" ? categoryRows.length ? Math.round(categoryRows.reduce((sum, row) => sum + row.priceAmount, 0) / categoryRows.length) : 0
        : product?.priceAmount ?? 0;
    const proposed = currentPrice + rule.adjustmentAmount;
    if (proposed < 0) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Scenario prices cannot be negative.");
    unitPriceAmount(BigInt(proposed));
    for (const row of categoryRows) unitPriceAmount(BigInt(row.priceAmount) + BigInt(rule.adjustmentAmount));
    const label = rule.targetKind === "OPTION" ? `${product!.name}، ${option!.name}`
      : rule.targetKind === "CATEGORY" ? `دسته‌ی ${category!.name}` : product!.name;
    const affectedUnits = [...summary.groups.values()].filter((group) => {
      if (rule.targetKind === "PRODUCT") return group.productId === rule.productId;
      if (rule.targetKind === "OPTION") return group.productId === rule.productId && group.options.some((entry) => entry.optionId === rule.optionId);
      return group.categoryId === rule.categoryId;
    }).reduce((sum, group) => sum + group.quantity, 0);
    return { ...rule, label, currentPriceAmount: currentPrice, proposedPriceAmount: proposed, affectedUnits };
  });
  let affectedRevenue = 0n;
  let affectedCost = 0n;
  let priceBenefit = 0n;
  let affectedCostsComplete = true;
  for (const consumption of consumptions) {
    for (const item of consumption.items) {
      const row = item.orderItem;
      if (row.product.systemKey === "PACKING") continue;
      const matchingRules = rules.filter((rule) => matchesScenarioItem(row, rule));
      if (matchingRules.length === 0) continue;
      const revenue = activeRevenue(row.settlementAllocations);
      const delta = scenarioLineAdjustment(row, matchingRules);
      if (revenue + delta < 0n) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A simulated line revenue cannot be negative.");
      priceBenefit += delta;
      affectedRevenue += revenue;
      affectedCost += BigInt(item.theoreticalCogsAmount ?? 0);
      affectedCostsComplete &&= hasCompleteCostSnapshot(item);
    }
  }
  const postPriceAffectedContribution = affectedRevenue - affectedCost + priceBenefit;
  const breakEven = affectedCostsComplete && postPriceAffectedContribution > 0n && priceBenefit > 0n
    ? percent(priceBenefit, postPriceAffectedContribution) : null;
  const presetVolumes = [-20, -15, -10, -5, 0];
  const volumeChanges = [...new Set([...presetVolumes, ...(input.customVolumeChangePercent === undefined ? [] : [input.customVolumeChangePercent])])].sort((a, b) => a - b);
  const scenarios = volumeChanges.map((volumePercent) => {
    const scaledFactor = BigInt(Math.round((100 + volumePercent) * 10_000));
    const scale = (value: bigint) => roundedDivide(value * scaledFactor, 1_000_000n);
    const simulatedRevenue = summary.netRevenue - affectedRevenue + scale(affectedRevenue + priceBenefit);
    const simulatedCost = summary.totalCogs - affectedCost + scale(affectedCost);
    const contribution = summary.allCostsComplete ? simulatedRevenue - simulatedCost : null;
    const monthlyContribution = contribution === null ? null : scaledAmount(contribution, dates.length);
    return {
      volumeChangePercent: volumePercent.toFixed(2),
      netRevenueAmount: amount(simulatedRevenue), contributionAmount: contribution === null ? null : signedAmount(contribution),
      monthlyEquivalentContributionAmount: monthlyContribution === null ? null : signedAmount(monthlyContribution),
      fixedCostCoveragePercent: monthlyContribution === null ? null : percent(monthlyContribution, FIXED_MONTHLY_COST),
      operatingSurplusAmount: monthlyContribution === null ? null : signedAmount(monthlyContribution - FIXED_MONTHLY_COST),
      breakEvenVolumeDeclinePercent: breakEven, costsComplete: summary.allCostsComplete,
    };
  });
  return {
    source: sourceMetrics,
    scenarios,
    assumptions: [
      "بازه‌ی مبنا شامل روزهای کامل در منطقه‌ی زمانی تهران است؛ روز جاریِ ناقص حذف می‌شود.",
      "قیمت فرضی به قیمت تحقق‌یافته‌ی هر واحد افزوده می‌شود؛ نرخ تخفیف، ترکیب گزینه‌ها و بهای مواد ثابت می‌ماند.",
      "حساسیت حجم روی گروه‌های مشمول اعمال می‌شود؛ تغییر سفارش یکتا یا رفتار مشتری از آن استنباط نمی‌شود.",
      "افت سربه‌سر فقط برای گروه مشمول با بهای کامل محاسبه می‌شود. اگر بهای محصول‌های دیگر ناقص باشد، مشارکت کل همچنان نامشخص می‌ماند.",
      "هزینه‌ی ثابت ماهانه ۲۶۵٬۰۰۰٬۰۰۰ تومان و ماه معادل ۳۰ روز فرض شده است.",
    ],
    rules: rules.map((rule) => ({ targetKind: rule.targetKind, label: rule.label, currentPriceAmount: rule.currentPriceAmount,
      proposedPriceAmount: rule.proposedPriceAmount, affectedItemUnits: rule.affectedUnits })),
  };
}

export function pricingExperimentComparisonDates(effectiveAt: Date, comparisonDays: number, today?: string) {
  return comparisonDates(effectiveAt, comparisonDays, today);
}

export function calculatePricingShapleyEffects(
  beforeGroups: Array<{ key: string; quantity: number; revenue: bigint; cost: bigint }>,
  afterGroups: Array<{ key: string; quantity: number; revenue: bigint; cost: bigint }>,
) {
  const before = new Map(beforeGroups.map((row) => [row.key, { ...row, cogs: row.cost, complete: true }]));
  const after = new Map(afterGroups.map((row) => [row.key, { ...row, cogs: row.cost, complete: true }]));
  const beforeRevenue = beforeGroups.reduce((sum, row) => sum + row.revenue, 0n);
  const afterRevenue = afterGroups.reduce((sum, row) => sum + row.revenue, 0n);
  const beforeCost = beforeGroups.reduce((sum, row) => sum + row.cost, 0n);
  const afterCost = afterGroups.reduce((sum, row) => sum + row.cost, 0n);
  const make = (rows: Map<string, any>, netRevenue: bigint, totalCogs: bigint): PeriodAggregate => ({
    dateSet: ["2000-01-01"], fromDate: "2000-01-01", toDate: "2000-01-01", orderCount: 1, orderIds: new Set(["o"]),
    takeawayOrderIds: new Set(), orderValue: netRevenue, itemUnits: [...rows.values()].reduce((sum, row) => sum + row.quantity, 0),
    affectedItemUnits: 0, netRevenue, affectedRevenue: 0n, unaffectedRevenue: netRevenue, unattributedRevenue: 0n,
    ingredientCogs: totalCogs, totalCogs, completeRevenue: netRevenue, incompleteRevenue: 0n, knownContribution: netRevenue - totalCogs,
    allCostsComplete: true, orderDiscount: 0n, itemDiscount: 0n, groups: rows,
    consumptions: [],
  });
  const result = shapleyDecomposition(make(before, beforeRevenue, beforeCost), make(after, afterRevenue, afterCost));
  return { price: result.priceEffectAmount, volume: result.volumeEffectAmount, mix: result.mixEffectAmount, cost: result.unitCostEffectAmount, observed: result.observedContributionChangeAmount, residual: result.residualAmount };
}
