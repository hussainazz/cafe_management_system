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

type PackagingOption = { optionId: string; optionName: string; quantity: number };
export function packagingOptions(item: any): PackagingOption[] {
  const row = item.orderItem ?? item;
  // Fixed-price option counts belong to the entire line. A variant describes
  // its per-unit selection, independent of how many units share that line.
  const divisor = row.pricingModeSnapshot === "WEIGHTED_PER_KG" ? 1 : row.quantity;
  return [...(row.options ?? [])]
    .map((option: any) => ({ optionId: option.optionId, optionName: option.optionNameSnapshot, quantity: option.quantity / divisor }))
    .sort((a, b) => a.optionId.localeCompare(b.optionId));
}
export function packagingVariantKey(productId: string, channel: "TABLE" | "TAKEAWAY", options: PackagingOption[]) {
  return `${productId}:${channel}:${options.map((option) => `${option.optionId}=${option.quantity}`).join(",")}`;
}
function allocateOrderCharge(charge: bigint, weights: Map<string, bigint>) {
  const positiveWeights = [...weights].filter(([, weight]) => weight > 0n).sort(([a], [b]) => a.localeCompare(b));
  const totalWeight = positiveWeights.reduce((sum, [, weight]) => sum + weight, 0n);
  if (charge <= 0n || totalWeight <= 0n) return null;
  const allocations = positiveWeights.map(([key, weight]) => {
    const weightedCharge = charge * weight;
    return { key, amount: weightedCharge / totalWeight, remainder: weightedCharge % totalWeight };
  });
  let leftover = charge - allocations.reduce((sum, item) => sum + item.amount, 0n);
  const remainderOrder = [...allocations].sort((a, b) => a.remainder === b.remainder ? a.key.localeCompare(b.key) : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; leftover > 0n; index += 1, leftover -= 1n) remainderOrder[index]!.amount += 1n;
  return new Map(allocations.map((item) => [item.key, item.amount]));
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
  const packagingEconomics = buildPackagingEconomics(consumptions, query.fromDate, query.toDate);

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
      packagingEconomics,
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

export function buildPackagingEconomics(consumptions: any[], fromDate: string, toDate: string) {
  type ProductTotals = {
    productId: string; productName: string; categoryId: string | null; categoryName: string | null; channel: "TABLE" | "TAKEAWAY"; options: PackagingOption[];
    soldQuantity: number; soldWeightGrams: number; productNetSalesAmount: bigint; packagingChargeRevenueAmount: bigint;
    nonPackagingKnownCostAmount: number; packagingKnownCostAmount: number; unclassifiedKnownCostAmount: number;
    isCostComplete: boolean; isPackagingAttributionComplete: boolean; relevant: boolean;
  };
  type Daily = { date: string; packagingChargeRevenueAmount: bigint; knownMaterialCostAmount: number; unclassifiedKnownCostAmount: number; incompleteOrderItemCount: number; isCostComplete: boolean };
  const products = new Map<string, ProductTotals>();
  const days = new Map<string, Daily>();
  for (let day = Date.parse(`${fromDate}T00:00:00Z`); day <= Date.parse(`${toDate}T00:00:00Z`); day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10);
    days.set(date, { date, packagingChargeRevenueAmount: 0n, knownMaterialCostAmount: 0, unclassifiedKnownCostAmount: 0, incompleteOrderItemCount: 0, isCostComplete: true });
  }
  let chargeRevenue = 0n;
  let knownMaterialCost = 0;
  let unclassifiedKnownCost = 0;
  let unattributedCharge = 0n;
  let relevantRevenue = 0n;
  let completeRevenue = 0n;
  let incompleteRevenue = 0n;
  let completeItemCount = 0;
  let incompleteItemCount = 0;
  let ambiguousItemCount = 0;
  let missingMaterialValuationCount = 0;
  let allCostsComplete = true;

  for (const consumption of consumptions) {
    const day = days.get(todayInTehran.format(consumption.recognizedAt))!;
    const menuItems = consumption.items.filter((item: any) => item.orderItem.product.systemKey !== "PACKING");
    const packingItems = consumption.items.filter((item: any) => item.orderItem.product.systemKey === "PACKING");
    const orderCharge = packingItems.reduce((sum: bigint, item: any) => sum + activeRevenue(item.orderItem.settlementAllocations), 0n);
    chargeRevenue += orderCharge;
    day.packagingChargeRevenueAmount += orderCharge;
    if (!menuItems.length && orderCharge > 0n) allCostsComplete = false;
    const distinctProductIds = [...new Set(menuItems.map((item: any) => item.orderItem.productId))] as string[];
    const allocatedProductId = distinctProductIds.length === 1 ? distinctProductIds[0]! : null;
    const variantWeights = new Map<string, bigint>();
    if (allocatedProductId) for (const item of menuItems) {
      const snapshot = item.costSnapshot as any;
      const channel = (snapshot?.orderChannel ?? consumption.order.channel) as "TABLE" | "TAKEAWAY";
      const variantKey = packagingVariantKey(item.orderItem.productId, channel, packagingOptions(item));
      variantWeights.set(variantKey, (variantWeights.get(variantKey) ?? 0n) + activeRevenue(item.orderItem.settlementAllocations));
    }
    const allocatedChargeByVariant = allocatedProductId ? allocateOrderCharge(orderCharge, variantWeights) : null;
    if (orderCharge > 0n && !allocatedChargeByVariant) unattributedCharge += orderCharge;
    const allocatedVariantsApplied = new Set<string>();

    for (const item of menuItems) {
      const snapshot = item.costSnapshot as any;
      const channel = (snapshot?.orderChannel ?? consumption.order.channel) as "TABLE" | "TAKEAWAY";
      const revenue = activeRevenue(item.orderItem.settlementAllocations);
      let packageCost = 0;
      let nonPackageCost = 0;
      let unclassifiedCost = 0;
      let hasPackageComponent = false;
      let itemHasMissingPackageValuation = false;
      const components = Array.isArray(snapshot?.components) ? snapshot.components : [];
      const hasStructuredAttribution = snapshot?.packagingAttributionComplete !== undefined && components.every((component: any) => component.packagingQuantity !== undefined || component.packagingKnownCostAmount !== undefined);
      if (hasStructuredAttribution) {
        for (const component of components) {
          const packageQuantity = Number(component.packagingQuantity ?? (component.isPackagingMaterial ? component.quantity : 0));
          if (packageQuantity > 0) hasPackageComponent = true;
          if (component.packagingKnownCostAmount === null && packageQuantity > 0) itemHasMissingPackageValuation = true;
          if (typeof component.packagingKnownCostAmount === "number") packageCost += component.packagingKnownCostAmount;
          if (typeof component.nonPackagingKnownCostAmount === "number") nonPackageCost += component.nonPackagingKnownCostAmount;
        }
      } else {
        // Older snapshots did not preserve component roles, so their known COGS stays visibly unclassified.
        unclassifiedCost = item.knownCogsAmount;
      }
      const attributionComplete = snapshot?.packagingAttributionComplete === true;
      const relevant = channel === "TAKEAWAY" || packingItems.length > 0 || hasPackageComponent;
      if (!relevant) continue;

      const productId = item.orderItem.productId;
      const options = packagingOptions(item);
      const categoryId = item.orderItem.product.categoryId ?? null;
      const categoryName = item.orderItem.product.category?.name ?? null;
      const key = packagingVariantKey(productId, channel, options);
      const product = products.get(key) ?? {
        productId, productName: item.productNameSnapshot, categoryId, categoryName, channel, options, soldQuantity: 0, soldWeightGrams: 0,
        productNetSalesAmount: 0n, packagingChargeRevenueAmount: 0n, nonPackagingKnownCostAmount: 0, packagingKnownCostAmount: 0,
        unclassifiedKnownCostAmount: 0, isCostComplete: true, isPackagingAttributionComplete: true, relevant: true,
      };
      product.soldQuantity += item.quantity;
      product.soldWeightGrams += (item.weightGrams ?? 0) * item.quantity;
      product.productNetSalesAmount += revenue;
      product.packagingKnownCostAmount += packageCost;
      product.nonPackagingKnownCostAmount += nonPackageCost;
      product.unclassifiedKnownCostAmount += unclassifiedCost;
      product.isCostComplete &&= item.isCostComplete;
      product.isPackagingAttributionComplete &&= attributionComplete && !itemHasMissingPackageValuation;
      if (allocatedChargeByVariant?.has(key) && !allocatedVariantsApplied.has(key)) {
        product.packagingChargeRevenueAmount += allocatedChargeByVariant.get(key)!;
        allocatedVariantsApplied.add(key);
      }
      products.set(key, product);

      packageCost && (knownMaterialCost += packageCost);
      unclassifiedCost && (unclassifiedKnownCost += unclassifiedCost);
      day.knownMaterialCostAmount += packageCost;
      day.unclassifiedKnownCostAmount += unclassifiedCost;
      const completeAttribution = attributionComplete && !itemHasMissingPackageValuation;
      relevantRevenue += revenue;
      if (completeAttribution) {
        completeRevenue += revenue;
        completeItemCount += 1;
      } else {
        incompleteRevenue += revenue;
        incompleteItemCount += 1;
        day.incompleteOrderItemCount += 1;
        day.isCostComplete = false;
        allCostsComplete = false;
      }
      if (!attributionComplete) ambiguousItemCount += 1;
      if (itemHasMissingPackageValuation) missingMaterialValuationCount += 1;
    }
  }

  const packageRecoveryAvailable = allCostsComplete;
  const productRows = [...products.values()].filter((row) => row.relevant).sort((a, b) => a.productName.localeCompare(b.productName, "fa") || a.channel.localeCompare(b.channel) || a.options.map((option) => option.optionName).join(",").localeCompare(b.options.map((option) => option.optionName).join(","), "fa"));
  const productRecovery = (row: ProductTotals) => row.isPackagingAttributionComplete
    ? signedAmountNumber(row.packagingChargeRevenueAmount - BigInt(row.packagingKnownCostAmount))
    : null;
  const categoryMap = new Map<string, { categoryId: string | null; categoryName: string; channel: "TABLE" | "TAKEAWAY"; productNetSalesAmount: bigint; packagingChargeRevenueAmount: bigint; knownMaterialCostAmount: number; unclassifiedKnownCostAmount: number; isCostComplete: boolean }>();
  for (const product of productRows) {
    const key = `${product.categoryId ?? "unclassified"}:${product.channel}`;
    const category = categoryMap.get(key) ?? { categoryId: product.categoryId, categoryName: product.categoryName ?? "دسته‌بندی نامشخص", channel: product.channel, productNetSalesAmount: 0n, packagingChargeRevenueAmount: 0n, knownMaterialCostAmount: 0, unclassifiedKnownCostAmount: 0, isCostComplete: true };
    category.productNetSalesAmount += product.productNetSalesAmount;
    category.packagingChargeRevenueAmount += product.packagingChargeRevenueAmount;
    category.knownMaterialCostAmount += product.packagingKnownCostAmount;
    category.unclassifiedKnownCostAmount += product.unclassifiedKnownCostAmount;
    category.isCostComplete &&= product.isPackagingAttributionComplete;
    categoryMap.set(key, category);
  }

  const totalNetRecovery = packageRecoveryAvailable ? signedAmountNumber(chargeRevenue - BigInt(knownMaterialCost)) : null;
  const amount = (value: bigint) => amountNumber(value);
  const dailyRows = [...days.values()].map((day) => ({
    date: day.date,
    packagingChargeRevenueAmount: amount(day.packagingChargeRevenueAmount),
    knownMaterialCostAmount: day.knownMaterialCostAmount,
    unclassifiedKnownCostAmount: day.unclassifiedKnownCostAmount,
    netRecoveryAmount: day.isCostComplete ? signedAmountNumber(day.packagingChargeRevenueAmount - BigInt(day.knownMaterialCostAmount)) : null,
    isCostComplete: day.isCostComplete,
    incompleteOrderItemCount: day.incompleteOrderItemCount,
  }));
  return {
    totals: {
      packagingChargeRevenueAmount: amount(chargeRevenue),
      knownMaterialCostAmount: knownMaterialCost,
      unclassifiedKnownCostAmount: unclassifiedKnownCost,
      netRecoveryAmount: totalNetRecovery,
      recoveryRatePercent: packageRecoveryAvailable && knownMaterialCost > 0 ? percentage(amount(chargeRevenue), knownMaterialCost) : null,
      unattributedOrderLevelChargeRevenueAmount: amount(unattributedCharge),
      packagingRelevantProductRevenueAmount: amount(relevantRevenue),
      completeAttributionRevenueAmount: amount(completeRevenue),
      incompleteAttributionRevenueAmount: amount(incompleteRevenue),
      attributionCoveragePercent: revenuePercentage(completeRevenue, relevantRevenue),
      completeOrderItemCount: completeItemCount,
      incompleteOrderItemCount: incompleteItemCount,
      ambiguousOrderItemCount: ambiguousItemCount,
      missingMaterialValuationCount,
      theoreticalPackagingCostAmount: packageRecoveryAvailable ? knownMaterialCost : null,
      postedPackagingMovementAmount: null,
      packagingMovementVarianceAmount: null,
      packagingMovementReconciliationAvailable: false,
      isCostComplete: packageRecoveryAvailable,
    },
    products: productRows.map((product) => {
      const contributionAvailable = product.isPackagingAttributionComplete && product.isCostComplete;
      const before = contributionAvailable ? signedAmountNumber(recognizedContribution(product.productNetSalesAmount, product.nonPackagingKnownCostAmount)) : null;
      const after = contributionAvailable ? signedAmountNumber(recognizedContribution(product.productNetSalesAmount + product.packagingChargeRevenueAmount, product.nonPackagingKnownCostAmount + product.packagingKnownCostAmount)) : null;
      return {
        productId: product.productId, productName: product.productName, categoryId: product.categoryId, categoryName: product.categoryName,
        channel: product.channel, options: product.options, soldQuantity: product.soldQuantity, soldWeightGrams: product.soldWeightGrams,
        productNetSalesAmount: amount(product.productNetSalesAmount), packagingChargeRevenueAmount: amount(product.packagingChargeRevenueAmount),
        nonPackagingKnownCostAmount: product.nonPackagingKnownCostAmount, packagingKnownCostAmount: product.packagingKnownCostAmount,
        unclassifiedKnownCostAmount: product.unclassifiedKnownCostAmount, netRecoveryAmount: productRecovery(product),
        packagingRecoveryRatePercent: product.packagingKnownCostAmount > 0 && product.isPackagingAttributionComplete ? percentage(amount(product.packagingChargeRevenueAmount), product.packagingKnownCostAmount) : null,
        productContributionBeforePackagingAmount: before, combinedContributionAfterPackagingAmount: after,
        isCostComplete: product.isCostComplete, isPackagingAttributionComplete: product.isPackagingAttributionComplete,
      };
    }),
    categories: [...categoryMap.values()].map((category) => ({
      categoryId: category.categoryId, categoryName: category.categoryName, channel: category.channel,
      productNetSalesAmount: amount(category.productNetSalesAmount), packagingChargeRevenueAmount: amount(category.packagingChargeRevenueAmount),
      knownMaterialCostAmount: category.knownMaterialCostAmount, unclassifiedKnownCostAmount: category.unclassifiedKnownCostAmount,
      netRecoveryAmount: category.isCostComplete ? signedAmountNumber(category.packagingChargeRevenueAmount - BigInt(category.knownMaterialCostAmount)) : null,
      recoveryRatePercent: category.isCostComplete && category.knownMaterialCostAmount > 0 ? percentage(amount(category.packagingChargeRevenueAmount), category.knownMaterialCostAmount) : null,
      isCostComplete: category.isCostComplete,
    })).sort((a, b) => a.categoryName.localeCompare(b.categoryName, "fa") || a.channel.localeCompare(b.channel)),
    daily: dailyRows,
  };
}

export function activeRevenue(allocations: Array<{ amount: number; settlement: { reversal: unknown } }>) {
  return allocations.filter((allocation) => allocation.settlement.reversal === null).reduce((sum, allocation) => sum + BigInt(allocation.amount), 0n);
}
