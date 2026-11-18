import { inventoryActivation } from "./inventory-activation.js";
import type { GrossProfitReportQuery } from "@cafe/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import { tehranReportRange } from "../admin/daily-report.service.js";

const todayInTehran = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran",
  calendar: "gregory",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function percentage(grossProfit: number | null, netSales: number) {
  if (grossProfit === null || netSales === 0) return null;
  return ((grossProfit / netSales) * 100).toFixed(2);
}

function revenuePercentage(revenue: bigint, total: bigint) {
  if (total === 0n) return null;
  const hundredths = (revenue * 10_000n + total / 2n) / total;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}`;
}

function amountNumber(amount: bigint) {
  if (amount < 0n || amount > 2_147_483_647n) {
    throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A reported revenue amount exceeds the supported Toman range.");
  }
  return Number(amount);
}

function signedAmountNumber(amount: bigint) {
  if (amount < -2_147_483_647n || amount > 2_147_483_647n) {
    throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A reported amount exceeds the supported Toman range.");
  }
  return Number(amount);
}

export function hasCompleteCostSnapshot<T extends { isCostComplete: boolean; theoreticalCogsAmount: number | null }>(item: T): item is T & { theoreticalCogsAmount: number } {
  return item.isCostComplete && item.theoreticalCogsAmount !== null;
}

export function recognizedContribution(revenue: bigint, theoreticalCogsAmount: number | bigint) {
  return revenue - BigInt(theoreticalCogsAmount);
}

type SaleOption = { optionId: string; optionName: string; quantity: number };
export function saleOptions(item: any): SaleOption[] {
  const row = item.orderItem ?? item;
  // Fixed-price option counts belong to the entire line. A variant describes
  // its per-unit selection, independent of how many units share that line.
  const divisor = row.pricingModeSnapshot === "WEIGHTED_PER_KG" ? 1 : row.quantity;
  return [...(row.options ?? [])]
    .map((option: any) => ({ optionId: option.optionId, optionName: option.optionNameSnapshot, quantity: option.quantity / divisor }))
    .sort((a, b) => a.optionId.localeCompare(b.optionId));
}
export function salesVariantKey(productId: string, channel: "TABLE" | "TAKEAWAY", options: SaleOption[]) {
  return `${productId}:${channel}:${options.map((option) => `${option.optionId}=${option.quantity}`).join(",")}`;
}
export async function grossProfitReport(prisma: PrismaClient, query: GrossProfitReportQuery) {
  const activatedAt = await inventoryActivation(prisma);
  const now = new Date();
  const today = todayInTehran.format(now);
  if (query.toDate > today) {
    throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The report end date cannot be in the future.");
  }

  const range = tehranReportRange(query);
  const consumptions = await loadRecognizedConsumptions(prisma, range);

  // Sold quantities follow the date the order became fully paid, not inventory
  // recognition. Older orders may have no consumption row at all.
  const paidItems = await prisma.orderItem.findMany({
    where: { order: { paymentStatus: "PAID", state: { not: "DELETED" }, isStaffConsumption: false } },
    select: { id: true, productId: true, productNameSnapshot: true, quantity: true, weightGrams: true,
      product: { select: { name: true, systemKey: true } },
      order: { select: { channel: true, inventorySaleChannel: true, paymentSettlements: {
        where: { reversal: null }, orderBy: { recordedAt: "desc" }, select: { recordedAt: true,
          allocations: { select: { orderItemId: true, amount: true } } },
      } } },
    },
  });
  const soldByProduct = new Map<string, { productId: string; productName: string; channel: "TABLE" | "TAKEAWAY"; soldQuantity: number; soldWeightGrams: number; netSalesAmount: bigint }>();
  for (const item of paidItems) {
    const settlements = item.order.paymentSettlements;
    const finalSettlement = settlements[0];
    if (!finalSettlement || finalSettlement.recordedAt < range.from || finalSettlement.recordedAt >= range.to) continue;
    const channel = item.order.inventorySaleChannel ?? item.order.channel;
    const key = `${item.productId}:${channel}`;
    const row = soldByProduct.get(key) ?? { productId: item.productId, productName: item.product.name, channel, soldQuantity: 0, soldWeightGrams: 0, netSalesAmount: 0n };
    row.soldQuantity += item.quantity;
    row.soldWeightGrams += (item.weightGrams ?? 0) * item.quantity;
    row.netSalesAmount += settlements.reduce((sum, settlement) => sum + settlement.allocations.filter((allocation) => allocation.orderItemId === item.id).reduce((total, allocation) => total + BigInt(allocation.amount), 0n), 0n);
    soldByProduct.set(key, row);
  }

  const byProduct = new Map<string, {
    productId: string;
    channel: "TABLE" | "TAKEAWAY";
    productName: string;
    soldQuantity: number;
    soldWeightGrams: number;
    netSalesAmount: bigint;
    completeCostRevenueAmount: bigint;
    incompleteCostRevenueAmount: bigint;
    knownCogsAmount: number;
    theoreticalCogsAmount: number;
    completeOrderItemCount: number;
    incompleteOrderItemCount: number;
  }>();
  const daily = new Map<string, { date: string; netSalesAmount: bigint; knownCogsAmount: number; incompleteOrderItemCount: number }>();
  // Include quiet days without implying a margin where there were no sales.
  for (let day = Date.parse(`${query.fromDate}T00:00:00Z`); day <= Date.parse(`${query.toDate}T00:00:00Z`); day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10);
    daily.set(date, { date, netSalesAmount: 0n, knownCogsAmount: 0, incompleteOrderItemCount: 0 });
  }
  const byChannel = new Map(["TABLE", "TAKEAWAY"].map((channel) => [channel as "TABLE" | "TAKEAWAY", {
    channel: channel as "TABLE" | "TAKEAWAY",
    netSalesAmount: 0n,
    completeCostRevenueAmount: 0n,
    incompleteCostRevenueAmount: 0n,
    completeOrderItemCount: 0,
    incompleteOrderItemCount: 0,
  }]));
  let pendingConsumptionCount = 0;
  let untrackedConsumptionCount = 0;
  for (const consumption of consumptions) {
    if (consumption.status === "PENDING") pendingConsumptionCount += 1;
    if (consumption.status === "UNTRACKED") untrackedConsumptionCount += 1;
    const day = daily.get(todayInTehran.format(consumption.recognizedAt))!;
    for (const item of consumption.items) {
      const productId = item.orderItem.productId;
      const channel = (item.costSnapshot as { orderChannel?: "TABLE" | "TAKEAWAY" })?.orderChannel ?? consumption.order.channel;
      const key = `${productId}:${channel}`;
      const product = byProduct.get(key) ?? {
        channel,
        productId,
        productName: item.productNameSnapshot,
        soldQuantity: 0,
        soldWeightGrams: 0,
        netSalesAmount: 0n,
        completeCostRevenueAmount: 0n,
        incompleteCostRevenueAmount: 0n,
        knownCogsAmount: 0,
        theoreticalCogsAmount: 0,
        completeOrderItemCount: 0,
        incompleteOrderItemCount: 0,
      };
      const itemRevenue = item.orderItem.settlementAllocations
        .filter((allocation) => allocation.settlement.reversal === null)
        .reduce((sum, allocation) => sum + BigInt(allocation.amount), 0n);
      const channelTotals = byChannel.get(channel)!;
      product.soldQuantity += item.quantity;
      product.soldWeightGrams += (item.weightGrams ?? 0) * item.quantity;
      product.netSalesAmount += itemRevenue;
      day.netSalesAmount += itemRevenue;
      channelTotals.netSalesAmount += itemRevenue;
      day.knownCogsAmount += item.theoreticalCogsAmount ?? 0;
      product.knownCogsAmount += item.knownCogsAmount;
      if (hasCompleteCostSnapshot(item)) {
        product.completeCostRevenueAmount += itemRevenue;
        channelTotals.completeCostRevenueAmount += itemRevenue;
        channelTotals.completeOrderItemCount += 1;
        product.theoreticalCogsAmount += item.theoreticalCogsAmount;
        product.completeOrderItemCount += 1;
      } else {
        product.incompleteCostRevenueAmount += itemRevenue;
        channelTotals.incompleteCostRevenueAmount += itemRevenue;
        channelTotals.incompleteOrderItemCount += 1;
        day.incompleteOrderItemCount += 1;
        product.incompleteOrderItemCount += 1;
      }
      byProduct.set(key, product);
    }
  }

  const products = [...byProduct.values()].sort((left, right) => left.productName.localeCompare(right.productName, "fa"));
  const netSalesRevenue = products.reduce((sum, product) => sum + product.netSalesAmount, 0n);
  const completeCostRevenueAmount = products.reduce((sum, product) => sum + product.completeCostRevenueAmount, 0n);
  const incompleteCostRevenueAmount = products.reduce((sum, product) => sum + product.incompleteCostRevenueAmount, 0n);
  const netSalesAmount = amountNumber(netSalesRevenue);
  const knownCogsAmount = products.reduce((sum, product) => sum + product.knownCogsAmount, 0);
  const incompleteOrderItemCount = products.reduce((sum, product) => sum + product.incompleteOrderItemCount, 0);
  const completeOrderItemCount = products.reduce((sum, product) => sum + product.completeOrderItemCount, 0);
  const theoreticalCogsAmount = incompleteOrderItemCount === 0
    ? products.reduce((sum, product) => sum + product.theoreticalCogsAmount, 0)
    : null;
  const grossProfitAmount = theoreticalCogsAmount === null ? null : Number(recognizedContribution(netSalesRevenue, theoreticalCogsAmount));
  const stockItems = await prisma.stockItem.findMany({
    select: { id: true, createdAt: true, balance: { select: { carryingValueAmount: true, trackingStartedAt: true } } },
  });
  const eligibleStockItems = stockItems.filter((item) => item.createdAt < range.to);
  const trackedIds = eligibleStockItems.filter((item) => item.balance?.trackingStartedAt).map((item) => item.id);
  const movements = trackedIds.length
    ? await prisma.inventoryMovement.findMany({
        where: { stockItemId: { in: trackedIds }, occurredAt: { gte: range.from, lt: now } },
        select: { stockItemId: true, kind: true, valueDeltaAmount: true, occurredAt: true },
      })
    : [];
  const openingCountLines = trackedIds.length
    ? await prisma.inventoryCountLine.findMany({
        where: { stockItemId: { in: trackedIds }, count: { kind: "OPENING", status: "POSTED", postedAt: { gte: range.from, lt: range.to } } },
        select: { stockItemId: true },
      })
    : [];
  const openingCountStockIds = new Set(openingCountLines.map((line) => line.stockItemId));

  const calculableStockItems = eligibleStockItems.filter((item) => {
    const startedAt = item.balance?.trackingStartedAt;
    if (!startedAt || startedAt >= range.to) return false;
    if (startedAt <= range.from) return true;
    return openingCountStockIds.has(item.id);
  });
  const missingValuationCount = eligibleStockItems.length - calculableStockItems.length;

  let inventoryConsumptionAmount = 0;
  for (const stockItem of calculableStockItems) {
    const itemMovements = movements.filter((movement) => movement.stockItemId === stockItem.id);
    const openingValue = stockItem.balance!.carryingValueAmount - itemMovements
      .filter((movement) => movement.occurredAt >= range.from)
      .reduce((sum, movement) => sum + movement.valueDeltaAmount, 0);
    const closingValue = stockItem.balance!.carryingValueAmount - itemMovements
      .filter((movement) => movement.occurredAt >= range.to)
      .reduce((sum, movement) => sum + movement.valueDeltaAmount, 0);
    const receipts = itemMovements
      .filter((movement) => movement.kind === "PURCHASE_RECEIPT" && movement.occurredAt < range.to)
      .reduce((sum, movement) => sum + movement.valueDeltaAmount, 0);
    const openingStock = itemMovements
      .filter((movement) => movement.kind === "OPENING_COUNT" && movement.occurredAt >= range.from && movement.occurredAt < range.to)
      .reduce((sum, movement) => sum + movement.valueDeltaAmount, 0);
    const purchaseReturns = itemMovements
      .filter((movement) => movement.kind === "PURCHASE_RETURN" && movement.occurredAt < range.to)
      .reduce((sum, movement) => sum - movement.valueDeltaAmount, 0);
    inventoryConsumptionAmount += openingValue + openingStock + receipts - purchaseReturns - closingValue;
  }
  const inventoryConsumptionAvailable = !!activatedAt && range.from >= activatedAt && untrackedConsumptionCount === 0 && pendingConsumptionCount === 0 && calculableStockItems.length > 0;
  const inventoryConsumption = inventoryConsumptionAvailable ? inventoryConsumptionAmount : null;

  return {
    data: {
      soldProducts: [...soldByProduct.values()].map((product) => ({ ...product, netSalesAmount: amountNumber(product.netSalesAmount) })),
      totals: {
        netSalesAmount,
        theoreticalCogsAmount,
        knownCogsAmount,
        grossProfitAmount,
        grossMarginPercent: percentage(grossProfitAmount, netSalesAmount),
      },
      daily: [...daily.values()].map((day) => {
        const cogs = day.incompleteOrderItemCount ? null : day.knownCogsAmount;
        const dayNetSalesAmount = amountNumber(day.netSalesAmount);
        const gross = cogs === null ? null : Number(recognizedContribution(BigInt(dayNetSalesAmount), cogs));
        return { date: day.date, netSalesAmount: dayNetSalesAmount, theoreticalCogsAmount: cogs,
          grossProfitAmount: gross, grossMarginPercent: percentage(gross, dayNetSalesAmount),
          incompleteOrderItemCount: day.incompleteOrderItemCount };
      }),
      products: products.map((product) => {
        const complete = product.incompleteOrderItemCount === 0;
        const theoretical = complete ? product.theoreticalCogsAmount : null;
        const productNetSalesAmount = amountNumber(product.netSalesAmount);
        const gross = theoretical === null ? null : Number(recognizedContribution(product.netSalesAmount, theoretical));
        return {
          channel: product.channel,
          productId: product.productId,
          productName: product.productName,
          soldQuantity: product.soldQuantity,
          soldWeightGrams: product.soldWeightGrams,
          netSalesAmount: productNetSalesAmount,
          completeCostRevenueAmount: amountNumber(product.completeCostRevenueAmount),
          incompleteCostRevenueAmount: amountNumber(product.incompleteCostRevenueAmount),
          coveragePercent: revenuePercentage(product.completeCostRevenueAmount, product.netSalesAmount),
          incompleteCostRevenueOfTotalSalesPercent: revenuePercentage(product.incompleteCostRevenueAmount, netSalesRevenue),
          incompleteCostRevenueSharePercent: revenuePercentage(product.incompleteCostRevenueAmount, incompleteCostRevenueAmount),
          theoreticalCogsAmount: theoretical,
          knownCogsAmount: product.knownCogsAmount,
          grossProfitAmount: gross,
          grossMarginPercent: percentage(gross, productNetSalesAmount),
          completeOrderItemCount: product.completeOrderItemCount,
          incompleteOrderItemCount: product.incompleteOrderItemCount,
        };
      }),
      costCoverage: {
        totalEligibleNetSalesAmount: amountNumber(netSalesRevenue),
        completeCostRevenueAmount: amountNumber(completeCostRevenueAmount),
        incompleteCostRevenueAmount: amountNumber(incompleteCostRevenueAmount),
        coveragePercent: revenuePercentage(completeCostRevenueAmount, netSalesRevenue),
        incompleteCoveragePercent: revenuePercentage(incompleteCostRevenueAmount, netSalesRevenue),
        completeOrderItemCount,
        incompleteOrderItemCount,
        channels: [...byChannel.values()].map((channel) => ({
          ...channel,
          netSalesAmount: amountNumber(channel.netSalesAmount),
          completeCostRevenueAmount: amountNumber(channel.completeCostRevenueAmount),
          incompleteCostRevenueAmount: amountNumber(channel.incompleteCostRevenueAmount),
          coveragePercent: revenuePercentage(channel.completeCostRevenueAmount, channel.netSalesAmount),
        })),
      },
      pendingConsumptionCount,
      inventoryConsumption: {
        amount: inventoryConsumption,
        isEstimate: true,
        varianceAmount: inventoryConsumption !== null && missingValuationCount === 0 && theoreticalCogsAmount !== null && pendingConsumptionCount === 0
          ? theoreticalCogsAmount - inventoryConsumption
          : null,
        missingValuationCount,
      },
    },
    range,
  };
}

export async function loadRecognizedConsumptions(prisma: PrismaClient, range: { from: Date; to: Date }) {
  return prisma.orderConsumption.findMany({
    where: {
      recognizedAt: { gte: range.from, lt: range.to },
      status: { not: "CANCELLED" },
      order: { state: { not: "DELETED" }, paymentStatus: "PAID", isStaffConsumption: false },
    },
    orderBy: [{ recognizedAt: "asc" }, { id: "asc" }],
    include: {
      order: { select: {
        id: true, state: true, paymentStatus: true, isStaffConsumption: true, channel: true,
        inventorySaleChannel: true, totalAmount: true, discountAmount: true, deferredAt: true,
        paymentSettlements: { where: { reversal: null }, select: { totalAmount: true, reversal: { select: { id: true } } } },
      } },
      items: {
        include: {
          orderItem: {
            select: {
              id: true,
              productId: true,
              productNameSnapshot: true, basePriceSnapshot: true, pricingModeSnapshot: true,
              weightGrams: true, quantity: true, discountAmount: true,
              product: { select: { name: true, priceAmount: true, systemKey: true, categoryId: true, category: { select: { name: true } } } },
              options: { select: { optionId: true, optionNameSnapshot: true, priceSnapshot: true, quantity: true } },
              settlementAllocations: {
                select: {
                  amount: true,
                  settlement: { select: { reversal: { select: { id: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });
}

export function activeRevenue(allocations: Array<{ amount: number; settlement: { reversal: unknown } }>) {
  return allocations.filter((allocation) => allocation.settlement.reversal === null).reduce((sum, allocation) => sum + BigInt(allocation.amount), 0n);
}
