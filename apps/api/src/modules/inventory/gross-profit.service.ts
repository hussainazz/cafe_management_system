import { requireInventoryActive } from "./inventory-activation.js";
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

export async function grossProfitReport(prisma: PrismaClient, query: GrossProfitReportQuery) {
  const activatedAt = await requireInventoryActive(prisma);
  const now = new Date();
  const today = todayInTehran.format(now);
  if (query.toDate > today) {
    throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The report end date cannot be in the future.");
  }

  const range = tehranReportRange(query);
  const consumptions = await prisma.orderConsumption.findMany({
    where: {
      recognizedAt: { gte: range.from, lt: range.to },
      status: { not: "CANCELLED" },
      order: { createdAt: { gte: activatedAt }, state: { not: "DELETED" }, paymentStatus: "PAID" },
    },
    orderBy: [{ recognizedAt: "asc" }, { id: "asc" }],
    include: {
      items: {
        include: {
          orderItem: {
            select: {
              productId: true,
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

  const byProduct = new Map<string, {
    productId: string;
    productName: string;
    netSalesAmount: number;
    knownCogsAmount: number;
    theoreticalCogsAmount: number;
    completeOrderItemCount: number;
    incompleteOrderItemCount: number;
  }>();
  let pendingConsumptionCount = 0;
  for (const consumption of consumptions) {
    if (consumption.status === "PENDING") pendingConsumptionCount += 1;
    for (const item of consumption.items) {
      const productId = item.orderItem.productId;
      const product = byProduct.get(productId) ?? {
        productId,
        productName: item.productNameSnapshot,
        netSalesAmount: 0,
        knownCogsAmount: 0,
        theoreticalCogsAmount: 0,
        completeOrderItemCount: 0,
        incompleteOrderItemCount: 0,
      };
      product.netSalesAmount += item.orderItem.settlementAllocations
        .filter((allocation) => allocation.settlement.reversal === null)
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      product.knownCogsAmount += item.knownCogsAmount;
      if (item.isCostComplete && item.theoreticalCogsAmount !== null) {
        product.theoreticalCogsAmount += item.theoreticalCogsAmount;
        product.completeOrderItemCount += 1;
      } else {
        product.incompleteOrderItemCount += 1;
      }
      byProduct.set(productId, product);
    }
  }

  const products = [...byProduct.values()].sort((left, right) => left.productName.localeCompare(right.productName, "fa"));
  const netSalesAmount = products.reduce((sum, product) => sum + product.netSalesAmount, 0);
  const knownCogsAmount = products.reduce((sum, product) => sum + product.knownCogsAmount, 0);
  const incompleteOrderItemCount = products.reduce((sum, product) => sum + product.incompleteOrderItemCount, 0);
  const completeOrderItemCount = products.reduce((sum, product) => sum + product.completeOrderItemCount, 0);
  const theoreticalCogsAmount = incompleteOrderItemCount === 0
    ? products.reduce((sum, product) => sum + product.theoreticalCogsAmount, 0)
    : null;
  const grossProfitAmount = theoreticalCogsAmount === null ? null : netSalesAmount - theoreticalCogsAmount;

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
  const inventoryConsumptionAvailable = calculableStockItems.length > 0;
  const inventoryConsumption = inventoryConsumptionAvailable ? inventoryConsumptionAmount : null;

  return {
    data: {
      totals: {
        netSalesAmount,
        theoreticalCogsAmount,
        knownCogsAmount,
        grossProfitAmount,
        grossMarginPercent: percentage(grossProfitAmount, netSalesAmount),
      },
      products: products.map((product) => {
        const complete = product.incompleteOrderItemCount === 0;
        const theoretical = complete ? product.theoreticalCogsAmount : null;
        const gross = theoretical === null ? null : product.netSalesAmount - theoretical;
        return {
          productId: product.productId,
          productName: product.productName,
          netSalesAmount: product.netSalesAmount,
          theoreticalCogsAmount: theoretical,
          knownCogsAmount: product.knownCogsAmount,
          grossProfitAmount: gross,
          grossMarginPercent: percentage(gross, product.netSalesAmount),
          completeOrderItemCount: product.completeOrderItemCount,
          incompleteOrderItemCount: product.incompleteOrderItemCount,
        };
      }),
      costCoverage: { completeOrderItemCount, incompleteOrderItemCount },
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
