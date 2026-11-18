import type { SalesAnalyticsQuery } from "@cafe/contracts";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import { tehranReportRange } from "../admin/daily-report.service.js";
import { activeRevenue, hasCompleteCostSnapshot, loadRecognizedConsumptions, saleOptions, salesVariantKey, recognizedContribution } from "./gross-profit.service.js";
import { isEligibleSettledOrder, salesChannel } from "./sales-report-eligibility.js";

const MAX_AMOUNT = 2_147_483_647n;
const OPENING_HOUR = 8;
const CLOSING_HOUR = 0;
const OPERATING_HOURS_PER_DAY = 16;
const clockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
});
const weekdayIndex: Record<string, number> = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };
const formatterParts = (date: Date) => Object.fromEntries(clockFormatter.formatToParts(date).map((part) => [part.type, part.value]));

type Clock = { date: string; dayOfWeek: number; hour: number; minute: 0 | 30 };
function clockAt(date: Date, intervalMinutes: 30 | 60): Clock {
  const parts = formatterParts(date);
  const hour = Number(parts.hour);
  const minute = Math.floor(Number(parts.minute) / intervalMinutes) * intervalMinutes;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: weekdayIndex[parts.weekday!]!,
    hour,
    minute: minute as 0 | 30,
  };
}
const clockKey = (clock: Pick<Clock, "dayOfWeek" | "hour" | "minute">) => `${clock.dayOfWeek}:${clock.hour}:${clock.minute}`;
const periodKey = (clock: Clock) => `${clock.date}:${clock.hour}:${clock.minute}`;

function checkedAmount(amount: bigint, signed = false): number {
  if ((!signed && amount < 0n) || amount < -MAX_AMOUNT || amount > MAX_AMOUNT) {
    throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A reported amount exceeds the supported Toman range.");
  }
  return Number(amount);
}

function percent(numerator: bigint, denominator: bigint): string | null {
  if (denominator <= 0n) return null;
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const hundredths = (absolute * 10_000n + denominator / 2n) / denominator;
  return `${negative ? "-" : ""}${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}`;
}

function average(amount: bigint, count: number): number | null {
  if (!count) return null;
  return checkedAmount((amount + BigInt(count) / 2n) / BigInt(count));
}

type Selection = { productIds: Set<string> | null; categoryIds: Set<string> | null; optionIds: Set<string>; channel?: "TABLE" | "TAKEAWAY" };
function matchesItem(item: any, channel: "TABLE" | "TAKEAWAY" | "UNKNOWN", selection: Selection) {
  const row = item.orderItem ?? item;
  if (row.product?.systemKey === "PACKING" && (selection.productIds || selection.categoryIds || selection.optionIds.size)) return false;
  if (selection.productIds && !selection.productIds.has(row.productId)) return false;
  if (selection.categoryIds && !selection.categoryIds.has(row.product?.categoryId ?? "")) return false;
  if (selection.optionIds.size) {
    const itemOptionIds = new Set((row.options ?? []).map((option: any) => option.optionId));
    if (![...selection.optionIds].some((id) => itemOptionIds.has(id))) return false;
  }
  if (selection.channel && selection.channel !== channel) return false;
  return true;
}

function itemOptions(item: any) {
  return saleOptions(item);
}

type DemandAccumulator = {
  orderIds: Set<string>; orderTotal: bigint; itemUnits: number; netSales: bigint; fallbackCount: number;
};
const demandAccumulator = (): DemandAccumulator => ({ orderIds: new Set(), orderTotal: 0n, itemUnits: 0, netSales: 0n, fallbackCount: 0 });

type FinancialAccumulator = {
  orderIds: Set<string>; orderTotal: bigint; itemUnits: number; netSales: bigint; knownCogs: bigint;
  completeRevenue: bigint; incompleteRevenue: bigint; completeItemCount: number; incompleteItemCount: number;
  knownContribution: bigint; totalCogs: bigint;
};
const financialAccumulator = (): FinancialAccumulator => ({
  orderIds: new Set(), orderTotal: 0n, itemUnits: 0, netSales: 0n, knownCogs: 0n,
  completeRevenue: 0n, incompleteRevenue: 0n, completeItemCount: 0, incompleteItemCount: 0,
  knownContribution: 0n, totalCogs: 0n,
});

type ProductDemandAccumulator = {
  clock: Clock; productId: string; productName: string; categoryId: string | null; categoryName: string | null;
  channel: "TABLE" | "TAKEAWAY" | "UNKNOWN"; options: ReturnType<typeof itemOptions>;
  quantity: number; orderIds: Set<string>; sales: bigint; fallbackCount: number;
};
type ProductFinancialAccumulator = {
  clock: Clock; productId: string; productName: string; categoryId: string | null; categoryName: string | null;
  channel: "TABLE" | "TAKEAWAY" | "UNKNOWN"; options: ReturnType<typeof itemOptions>;
  quantity: number; orderIds: Set<string>; sales: bigint; knownCogs: bigint; completeRevenue: bigint;
  incompleteRevenue: bigint; knownContribution: bigint; totalCogs: bigint; isCostComplete: boolean;
};

function makeOverview(acc: FinancialAccumulator) {
  const complete = acc.incompleteItemCount === 0;
  const coverage = acc.netSales === 0n ? null : percent(acc.completeRevenue, acc.netSales);
  return {
    orderCount: acc.orderIds.size,
    itemUnits: acc.itemUnits,
    netSalesAmount: checkedAmount(acc.netSales),
    averageOrderValueAmount: average(acc.orderTotal, acc.orderIds.size),
    knownCogsAmount: checkedAmount(acc.knownCogs),
    completeCostRevenueAmount: checkedAmount(acc.completeRevenue),
    incompleteCostRevenueAmount: checkedAmount(acc.incompleteRevenue),
    completeCostItemCount: acc.completeItemCount,
    incompleteCostItemCount: acc.incompleteItemCount,
    knownContributionAmount: checkedAmount(acc.knownContribution, true),
    knownContributionMarginPercent: percent(acc.knownContribution, acc.completeRevenue),
    totalContributionAmount: complete ? checkedAmount(acc.netSales - acc.totalCogs, true) : null,
    totalContributionMarginPercent: complete ? percent(acc.netSales - acc.totalCogs, acc.netSales) : null,
    costCoveragePercent: coverage,
    isCostComplete: complete,
  };
}

function reportingRangeDays(fromDate: string, toDate: string, weekdays: Set<number> | null = null) {
  const firstDay = Date.parse(`${fromDate}T00:00:00Z`);
  const lastDay = Date.parse(`${toDate}T00:00:00Z`);
  if (!weekdays) return (lastDay - firstDay) / 86_400_000 + 1;
  let matchingDays = 0;
  for (let timestamp = firstDay; timestamp <= lastDay; timestamp += 86_400_000) {
    const dayOfWeek = (new Date(timestamp).getUTCDay() + 1) % 7;
    if (weekdays.has(dayOfWeek)) matchingDays += 1;
  }
  return matchingDays;
}

function timeWindow(hour: number): "NIGHT" | "MORNING" | "AFTERNOON" | "EVENING" {
  if (hour < 6) return "NIGHT";
  if (hour < 12) return "MORNING";
  if (hour < 18) return "AFTERNOON";
  return "EVENING";
}

export async function salesAnalyticsReport(prisma: PrismaClient, query: SalesAnalyticsQuery) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (query.toDate > today) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The analytics end date cannot be in the future.");
  const range = tehranReportRange(query);
  const interval = query.intervalMinutes as 30 | 60;
  const weekdays = query.daysOfWeek?.length ? new Set(query.daysOfWeek) : null;
  const optionIds = new Set(query.optionIds ?? []);
  let productIds: Set<string> | null = query.productIds?.length ? new Set(query.productIds) : null;
  const categoryIds = query.categoryIds?.length ? new Set(query.categoryIds) : null;

  if (categoryIds) {
    const products = await prisma.product.findMany({
      where: { categoryId: { in: [...categoryIds] }, ...(productIds ? { id: { in: [...productIds] } } : {}) },
      select: { id: true },
    });
    const categoryProductIds = new Set(products.map((product) => product.id));
    productIds = productIds ? new Set([...productIds].filter((id) => categoryProductIds.has(id))) : categoryProductIds;
  }
  const selection: Selection = { productIds, categoryIds, optionIds, ...(query.channel ? { channel: query.channel } : {}) };
  const hasNoPossibleProduct = productIds !== null && productIds.size === 0;

  const itemFilter: Prisma.OrderItemWhereInput = {
    ...(productIds ? { productId: { in: [...productIds] } } : {}),
    ...(optionIds.size ? { options: { some: { optionId: { in: [...optionIds] } } } } : {}),
  };
  const constrainedItemFilter = Object.keys(itemFilter).length ? itemFilter : undefined;
  const rangeWhere = { gte: range.from, lt: range.to };
  const orders = hasNoPossibleProduct ? [] : await prisma.order.findMany({
    where: {
      state: "CLOSED", paymentStatus: "PAID", isStaffConsumption: false,
      OR: [
        { createdAt: rangeWhere, ...(constrainedItemFilter ? { items: { some: constrainedItemFilter } } : {}) },
        { items: { some: { ...(constrainedItemFilter ?? {}), enteredAt: rangeWhere } } },
      ],
    },
    select: {
      id: true, state: true, paymentStatus: true, isStaffConsumption: true,
      channel: true, inventorySaleChannel: true, deferredAt: true,
      createdAt: true, totalAmount: true,
      paymentSettlements: {
        where: { reversal: null }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        select: { totalAmount: true, reversal: { select: { id: true } } },
      },
      items: {
        select: {
          id: true, productId: true, quantity: true, enteredAt: true, pricingModeSnapshot: true,
          product: { select: { name: true, systemKey: true, categoryId: true, category: { select: { name: true } } } },
          options: { select: { optionId: true, optionNameSnapshot: true, quantity: true } },
          settlementAllocations: { select: { amount: true, settlement: { select: { reversal: { select: { id: true } } } } } },
        },
      },
    },
  });

  const allConsumptions = hasNoPossibleProduct ? [] : await loadRecognizedConsumptions(prisma, range);
  const operationalBuckets = new Map<string, DemandAccumulator>();
  const financialBuckets = new Map<string, FinancialAccumulator>();
  const demandSeries = new Map<string, ProductDemandAccumulator>();
  const financialSeries = new Map<string, ProductFinancialAccumulator>();
  const fallbackLines = new Set<string>();
  const categorySales = new Map<string, { categoryId: string | null; categoryName: string; window: ReturnType<typeof timeWindow>; sales: bigint }>();

  for (let day = 0; day < 7; day += 1) for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += interval) {
      const clock = { dayOfWeek: day, hour, minute: minute as 0 | 30 };
      const key = clockKey(clock);
      operationalBuckets.set(key, demandAccumulator());
      financialBuckets.set(key, financialAccumulator());
    }
  }

  for (const order of orders) {
    const channel = salesChannel(order);
    if (!isEligibleSettledOrder(order)) continue;
    const matchingItems = order.items.filter((item) => matchesItem(item, channel, selection));
    if (!matchingItems.length) continue;
    const orderClock = clockAt(order.createdAt, interval);
    const orderInRange = order.createdAt >= range.from && order.createdAt < range.to;
    if (orderInRange && (!weekdays || weekdays.has(orderClock.dayOfWeek))) {
      const bucket = operationalBuckets.get(clockKey(orderClock))!;
      bucket.orderIds.add(order.id);
      bucket.orderTotal += BigInt(order.totalAmount);
    }

    for (const item of matchingItems) {
      const entryAt = item.enteredAt ?? order.createdAt;
      const entryClock = clockAt(entryAt, interval);
      if (entryAt < range.from || entryAt >= range.to || (weekdays && !weekdays.has(entryClock.dayOfWeek))) continue;
      if (!item.enteredAt) {
        fallbackLines.add(item.id);
      }
      const amount = activeRevenue(item.settlementAllocations);
      const bucket = operationalBuckets.get(clockKey(entryClock))!;
      bucket.netSales += amount;
      if (item.product.systemKey !== "PACKING") bucket.itemUnits += item.quantity;

      if (item.product.systemKey === "PACKING") continue;
      const options = itemOptions(item);
      const variantKey = salesVariantKey(item.productId, channel === "UNKNOWN" ? "TAKEAWAY" : channel, options);
      const key = `${periodKey(entryClock)}|${variantKey}`;
      const row = demandSeries.get(key) ?? {
        clock: entryClock, productId: item.productId, productName: item.product.name,
        categoryId: item.product.categoryId, categoryName: item.product.category?.name ?? null,
        channel, options, quantity: 0, orderIds: new Set<string>(), sales: 0n, fallbackCount: 0,
      };
      row.quantity += item.quantity;
      row.orderIds.add(order.id);
      row.sales += amount;
      if (!item.enteredAt) row.fallbackCount += 1;
      demandSeries.set(key, row);
    }
  }

  for (const consumption of allConsumptions as any[]) {
    const recognizedClock = clockAt(consumption.recognizedAt, interval);
    if (weekdays && !weekdays.has(recognizedClock.dayOfWeek)) continue;
    const bucket = financialBuckets.get(clockKey(recognizedClock))!;
    const channel = consumption.order.inventorySaleChannel ?? consumption.order.channel;
    let hasMatchedItem = false;

    for (const item of consumption.items) {
      const itemChannel = ((item.costSnapshot as any)?.orderChannel ?? channel) as "TABLE" | "TAKEAWAY";
      const matched = matchesItem(item, itemChannel, selection);
      if (!matched) continue;
      hasMatchedItem = true;
      const revenue = activeRevenue(item.orderItem.settlementAllocations);
      const complete = hasCompleteCostSnapshot(item);
      const cogs = BigInt(item.theoreticalCogsAmount ?? 0);
      bucket.netSales += revenue;
      bucket.knownCogs += BigInt(item.knownCogsAmount ?? 0);
      if (complete) {
        bucket.completeRevenue += revenue;
        bucket.completeItemCount += 1;
        bucket.totalCogs += cogs;
        bucket.knownContribution += recognizedContribution(revenue, cogs);
      } else {
        bucket.incompleteRevenue += revenue;
        bucket.incompleteItemCount += 1;
      }
      if (item.orderItem.product.systemKey !== "PACKING") bucket.itemUnits += item.quantity;

      if (item.orderItem.product.systemKey === "PACKING") continue;
      const options = itemOptions(item);
      const seriesVariant = salesVariantKey(item.orderItem.productId, itemChannel, options);
      const key = `${periodKey(recognizedClock)}|${seriesVariant}`;
      const row = financialSeries.get(key) ?? {
        clock: recognizedClock, productId: item.orderItem.productId,
        productName: item.orderItem.product.name,
        categoryId: item.orderItem.product.categoryId,
        categoryName: item.orderItem.product.category?.name ?? null,
        channel: itemChannel, options, quantity: 0, orderIds: new Set<string>(), sales: 0n,
        knownCogs: 0n, completeRevenue: 0n, incompleteRevenue: 0n, knownContribution: 0n,
        totalCogs: 0n, isCostComplete: true,
      };
      row.quantity += item.quantity;
      row.orderIds.add(consumption.orderId);
      row.sales += revenue;
      row.knownCogs += BigInt(item.knownCogsAmount ?? 0);
      row.isCostComplete &&= complete;
      if (complete) {
        row.completeRevenue += revenue;
        row.totalCogs += cogs;
        row.knownContribution += recognizedContribution(revenue, cogs);
      } else {
        row.incompleteRevenue += revenue;
      }
      financialSeries.set(key, row);
    }

    if (!hasMatchedItem) continue;
    if (!bucket.orderIds.has(consumption.orderId)) {
      bucket.orderIds.add(consumption.orderId);
      bucket.orderTotal += BigInt(consumption.order.totalAmount);
    }

    for (const item of consumption.items) {
      const itemChannel = ((item.costSnapshot as any)?.orderChannel ?? channel) as "TABLE" | "TAKEAWAY";
      if (!matchesItem(item, itemChannel, selection)) continue;
      const revenue = activeRevenue(item.orderItem.settlementAllocations);
      const hourWindow = timeWindow(recognizedClock.hour);
      const categoryId = item.orderItem.product.categoryId ?? null;
      const categoryName = item.orderItem.product.category?.name ?? "دسته‌بندی نامشخص";
      const key = `${hourWindow}:${categoryId ?? "unknown"}`;
      const row = categorySales.get(key) ?? { categoryId, categoryName, window: hourWindow, sales: 0n };
      row.sales += revenue;
      categorySales.set(key, row);
    }
  }

  const operationalRows = [...operationalBuckets.entries()].map(([key, row]) => {
    const [dayOfWeek, hour, minute] = key.split(":").map(Number);
    const count = row.orderIds.size;
    return { dayOfWeek: dayOfWeek!, hour: hour!, minute: minute! as 0 | 30, orderCount: count,
      itemUnits: row.itemUnits, netSalesAmount: checkedAmount(row.netSales),
      averageOrderValueAmount: average(row.orderTotal, count), orderValueSumAmount: checkedAmount(row.orderTotal), hasSales: count > 0 || row.itemUnits > 0 || row.netSales > 0n,
      isScheduledOpen: hour! >= OPENING_HOUR,
      closureKnown: true as const };
  });
  const financialRows = [...financialBuckets.entries()].map(([key, row]) => {
    const [dayOfWeek, hour, minute] = key.split(":").map(Number);
    const complete = row.incompleteItemCount === 0;
    const count = row.orderIds.size;
    return { dayOfWeek: dayOfWeek!, hour: hour!, minute: minute! as 0 | 30, orderCount: count,
      itemUnits: row.itemUnits, netSalesAmount: checkedAmount(row.netSales),
      averageOrderValueAmount: average(row.orderTotal, count), orderValueSumAmount: checkedAmount(row.orderTotal), knownCogsAmount: checkedAmount(row.knownCogs),
      completeCostRevenueAmount: checkedAmount(row.completeRevenue), incompleteCostRevenueAmount: checkedAmount(row.incompleteRevenue),
      completeCostItemCount: row.completeItemCount, incompleteCostItemCount: row.incompleteItemCount,
      knownContributionAmount: checkedAmount(row.knownContribution, true),
      knownContributionMarginPercent: percent(row.knownContribution, row.completeRevenue),
      totalContributionAmount: complete ? checkedAmount(row.netSales - row.totalCogs, true) : null,
      totalContributionMarginPercent: complete ? percent(row.netSales - row.totalCogs, row.netSales) : null,
      costCoveragePercent: row.netSales === 0n ? null : percent(row.completeRevenue, row.netSales),
      isCostComplete: complete, hasSales: count > 0 || row.itemUnits > 0 || row.netSales > 0n,
      isScheduledOpen: hour! >= OPENING_HOUR,
      closureKnown: true as const };
  });

  const operationalOverviewAccumulator = demandAccumulator();
  for (const row of operationalBuckets.values()) {
    row.orderIds.forEach((id) => operationalOverviewAccumulator.orderIds.add(id));
    operationalOverviewAccumulator.orderTotal += row.orderTotal;
    operationalOverviewAccumulator.itemUnits += row.itemUnits;
    operationalOverviewAccumulator.netSales += row.netSales;
    operationalOverviewAccumulator.fallbackCount += row.fallbackCount;
  }
  const totalFinancial = financialAccumulator();
  for (const row of financialBuckets.values()) {
    row.orderIds.forEach((id) => totalFinancial.orderIds.add(id));
    totalFinancial.orderTotal += row.orderTotal;
    totalFinancial.itemUnits += row.itemUnits;
    totalFinancial.netSales += row.netSales;
    totalFinancial.knownCogs += row.knownCogs;
    totalFinancial.completeRevenue += row.completeRevenue;
    totalFinancial.incompleteRevenue += row.incompleteRevenue;
    totalFinancial.completeItemCount += row.completeItemCount;
    totalFinancial.incompleteItemCount += row.incompleteItemCount;
    totalFinancial.knownContribution += row.knownContribution;
    totalFinancial.totalCogs += row.totalCogs;
  }

  const productDemandRows = [...demandSeries.values()].map((row) => ({
    date: row.clock.date, hour: row.clock.hour, minute: row.clock.minute,
    productId: row.productId, productName: row.productName, categoryId: row.categoryId, categoryName: row.categoryName,
    channel: row.channel, options: row.options,
    quantitySold: row.quantity, uniqueOrdersContainingProduct: row.orderIds.size,
    netSalesAmount: checkedAmount(row.sales), itemEntryFallbackCount: row.fallbackCount,
  }));
  const productFinancialRows = [...financialSeries.values()].map((row) => ({
    date: row.clock.date, hour: row.clock.hour, minute: row.clock.minute,
    productId: row.productId, productName: row.productName, categoryId: row.categoryId, categoryName: row.categoryName,
    channel: row.channel, options: row.options,
    quantitySold: row.quantity, uniqueOrdersContainingProduct: row.orderIds.size,
    netSalesAmount: checkedAmount(row.sales), knownCogsAmount: checkedAmount(row.knownCogs),
    completeCostRevenueAmount: checkedAmount(row.completeRevenue), incompleteCostRevenueAmount: checkedAmount(row.incompleteRevenue),
    knownContributionAmount: checkedAmount(row.knownContribution, true),
    knownContributionMarginPercent: percent(row.knownContribution, row.completeRevenue),
    totalContributionAmount: row.isCostComplete ? checkedAmount(recognizedContribution(row.sales, row.totalCogs), true) : null,
    totalContributionMarginPercent: row.isCostComplete ? percent(recognizedContribution(row.sales, row.totalCogs), row.sales) : null,
    costCoveragePercent: row.sales === 0n ? null : percent(row.completeRevenue, row.sales),
    isCostComplete: row.isCostComplete,
  }));

  const productIdsInSeries = new Map<string, { productName: string; quantity: number; orderIds: Set<string>; volumeByClock: Map<string, { clock: Clock; quantity: number }>; weekday: Map<number, { quantity: number; orderIds: Set<string> }>; channel: Map<string, { quantity: number; sales: bigint; orderIds: Set<string> }> }>();
  for (const row of demandSeries.values()) {
    const product = productIdsInSeries.get(row.productId) ?? { productName: row.productName, quantity: 0, orderIds: new Set<string>(), volumeByClock: new Map(), weekday: new Map(), channel: new Map() };
    product.quantity += row.quantity;
    row.orderIds.forEach((id) => product.orderIds.add(id));
    const clockKeyValue = clockKey(row.clock);
    const volume = product.volumeByClock.get(clockKeyValue) ?? { clock: row.clock, quantity: 0 };
    volume.quantity += row.quantity;
    product.volumeByClock.set(clockKeyValue, volume);
    const weekday = product.weekday.get(row.clock.dayOfWeek) ?? { quantity: 0, orderIds: new Set<string>() };
    weekday.quantity += row.quantity;
    row.orderIds.forEach((id) => weekday.orderIds.add(id));
    product.weekday.set(row.clock.dayOfWeek, weekday);
    const channel = product.channel.get(row.channel) ?? { quantity: 0, sales: 0n, orderIds: new Set<string>() };
    channel.quantity += row.quantity;
    channel.sales += row.sales;
    row.orderIds.forEach((id) => channel.orderIds.add(id));
    product.channel.set(row.channel, channel);
    productIdsInSeries.set(row.productId, product);
  }

  const financialPeakRowsByProduct = new Map<string, Map<string, { clock: Clock; revenue: bigint; contribution: bigint; completeRevenue: bigint; incompleteRevenue: bigint }>>();
  for (const row of financialSeries.values()) {
    let periods = financialPeakRowsByProduct.get(row.productId);
    if (!periods) { periods = new Map(); financialPeakRowsByProduct.set(row.productId, periods); }
    const key = clockKey(row.clock);
    const period = periods.get(key) ?? { clock: row.clock, revenue: 0n, contribution: 0n, completeRevenue: 0n, incompleteRevenue: 0n };
    period.revenue += row.sales;
    period.contribution += row.knownContribution;
    period.completeRevenue += row.completeRevenue;
    period.incompleteRevenue += row.incompleteRevenue;
    periods.set(key, period);
  }

  const productPeaks = [...productIdsInSeries.entries()].map(([productId, product]) => {
    const peak = <T extends { clock: Clock }>(rows: T[], value: (row: T) => bigint) => rows.reduce<T | null>((best, row) => best === null || value(row) > value(best) ? row : best, null);
    const volumeRows = [...product.volumeByClock.values()];
    const financeRows = [...(financialPeakRowsByProduct.get(productId)?.values() ?? [])];
    const volume = peak(volumeRows, (row) => BigInt(row.quantity));
    const revenue = peak(financeRows, (row) => row.revenue);
    const contribution = peak(financeRows.filter((row) => row.completeRevenue > 0n), (row) => row.contribution);
    return {
      productId, productName: product.productName, totalQuantity: product.quantity,
      uniqueOrdersContainingProduct: product.orderIds.size,
      highestVolume: volume ? { dayOfWeek: volume.clock.dayOfWeek, hour: volume.clock.hour, minute: volume.clock.minute, quantity: volume.quantity } : null,
      highestRevenue: revenue ? { dayOfWeek: revenue.clock.dayOfWeek, hour: revenue.clock.hour, minute: revenue.clock.minute, amount: checkedAmount(revenue.revenue) } : null,
      highestKnownContribution: contribution ? { dayOfWeek: contribution.clock.dayOfWeek, hour: contribution.clock.hour, minute: contribution.clock.minute,
        amount: checkedAmount(contribution.contribution, true), costCoveragePercent: percent(contribution.completeRevenue, contribution.completeRevenue + contribution.incompleteRevenue) } : null,
      weekdayDistribution: [...product.weekday.entries()].map(([dayOfWeek, row]) => ({ dayOfWeek, quantity: row.quantity, uniqueOrdersContainingProduct: row.orderIds.size })),
      channelDistribution: [...product.channel.entries()].map(([channel, row]) => ({ channel, quantity: row.quantity, uniqueOrdersContainingProduct: row.orderIds.size, netSalesAmount: checkedAmount(row.sales) })),
    };
  });

  const strongestCategoriesByWindow = [...new Set(["NIGHT", "MORNING", "AFTERNOON", "EVENING"] as const)].flatMap((window) => {
    const rows = [...categorySales.values()].filter((row) => row.window === window).sort((a, b) => a.sales === b.sales ? a.categoryName.localeCompare(b.categoryName, "fa") : a.sales > b.sales ? -1 : 1);
    const best = rows[0];
    return best ? [{ window, categoryId: best.categoryId, categoryName: best.categoryName, netSalesAmount: checkedAmount(best.sales) }] : [];
  });
  const bestBy = <T extends { dayOfWeek: number; hour: number; minute: 0 | 30 }>(rows: T[], value: (row: T) => bigint, requirePositive = true): T | null => rows
    .filter((row) => !requirePositive || value(row) > 0n)
    .sort((a, b) => value(a) === value(b) ? a.dayOfWeek - b.dayOfWeek || a.hour - b.hour || a.minute - b.minute : value(a) > value(b) ? -1 : 1)[0] ?? null;
  const busiest = bestBy(operationalRows, (row) => BigInt(row.orderCount));
  const highestRevenue = bestBy(financialRows, (row) => BigInt(row.netSalesAmount));
  const highestContribution = bestBy(financialRows.filter((row) => row.completeCostRevenueAmount > 0), (row) => BigInt(row.knownContributionAmount), false);
  const highestAov = bestBy(financialRows.filter((row) => row.averageOrderValueAmount !== null), (row) => BigInt(row.averageOrderValueAmount!), false);
  const operatingHoursInRange = reportingRangeDays(query.fromDate, query.toDate, weekdays) * OPERATING_HOURS_PER_DAY;
  const totalContributionPerOperatingHour = totalFinancial.completeRevenue > 0n && operatingHoursInRange > 0
    ? checkedAmount(totalFinancial.knownContribution / BigInt(operatingHoursInRange), true)
    : null;

  return {
    data: {
      overview: {
        operationalDemand: {
          orderCount: operationalOverviewAccumulator.orderIds.size,
          itemUnits: operationalOverviewAccumulator.itemUnits,
          netSalesAmount: checkedAmount(operationalOverviewAccumulator.netSales),
          averageOrderValueAmount: average(operationalOverviewAccumulator.orderTotal, operationalOverviewAccumulator.orderIds.size),
          orderValueSumAmount: checkedAmount(operationalOverviewAccumulator.orderTotal),
          itemEntryFallbackCount: fallbackLines.size,
        },
        financialRecognition: makeOverview(totalFinancial),
      },
      operationalBuckets: operationalRows,
      financialBuckets: financialRows,
      productDemandSeries: productDemandRows,
      productFinancialSeries: productFinancialRows,
      productPeaks,
      insights: {
        busiestPeriod: busiest ? { dayOfWeek: busiest.dayOfWeek, hour: busiest.hour, minute: busiest.minute, orderCount: busiest.orderCount } : null,
        highestRevenuePeriod: highestRevenue ? { dayOfWeek: highestRevenue.dayOfWeek, hour: highestRevenue.hour, minute: highestRevenue.minute, amount: highestRevenue.netSalesAmount } : null,
        highestKnownContributionPeriod: highestContribution ? { dayOfWeek: highestContribution.dayOfWeek, hour: highestContribution.hour, minute: highestContribution.minute, amount: highestContribution.knownContributionAmount, costCoveragePercent: highestContribution.costCoveragePercent } : null,
        highestAverageOrderValuePeriod: highestAov ? { dayOfWeek: highestAov.dayOfWeek, hour: highestAov.hour, minute: highestAov.minute, amount: highestAov.averageOrderValueAmount! } : null,
        strongestCategoriesByWindow,
        contributionPerOperatingHourAmount: totalContributionPerOperatingHour,
        operatingHoursPerDay: OPERATING_HOURS_PER_DAY as 16,
        operatingHoursInRange,
      },
      timeSemantics: {
        timezone: "Asia/Tehran" as const,
        operatingSchedule: { opensAtHour: OPENING_HOUR as 8, closesAtHour: CLOSING_HOUR as 0, hoursPerDay: OPERATING_HOURS_PER_DAY as 16 },
        operationalTimeLabel: "ORDER_CREATED_OR_ITEM_FIRST_ENTERED" as const,
        financialTimeLabel: "RECOGNIZED_CONSUMPTION" as const,
        historicalItemEntryFallbackCount: fallbackLines.size,
        itemEntryDefinition: "زمان هر قلم، زمان نخستین ثبت خط سفارش است. تغییر تعداد همان خط زمان نخستین ثبت را نگه می‌دارد؛ برای قلم‌های قدیمیِ بدون این زمان، زمان ثبت سفارش به‌کار می‌رود.",
        categoryDefinition: "CURRENT_CATALOG" as const,
      },
    },
    range,
    intervalMinutes: interval,
  };
}
