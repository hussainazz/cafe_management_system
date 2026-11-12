import type { SalesChannelReportQuery } from "@cafe/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { tehranReportRange } from "../admin/daily-report.service.js";

function money(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError("The sales report amount exceeds the supported Toman range.");
  }
  return amount;
}

function percent(numerator: bigint, denominator: bigint): string | null {
  if (denominator === 0n) return null;
  const hundredths = (numerator * 10_000n + denominator / 2n) / denominator;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}`;
}

function average(amount: bigint, count: number): bigint | null {
  if (count === 0) return null;
  const divisor = BigInt(count);
  return (amount + divisor / 2n) / divisor;
}

export async function salesChannelReport(prisma: PrismaClient, query: SalesChannelReportQuery) {
  const range = tehranReportRange(query);
  const orders = await prisma.order.findMany({
    where: {
      state: "CLOSED",
      paymentStatus: "PAID",
      isStaffConsumption: false,
      paymentSettlements: {
        some: {
          recordedAt: { gte: range.from, lt: range.to },
          reversal: null,
        },
      },
    },
    select: {
      channel: true,
      inventorySaleChannel: true,
      deferredAt: true,
      totalAmount: true,
      items: {
        select: {
          quantity: true,
          product: { select: { systemKey: true } },
        },
      },
      paymentSettlements: {
        where: { reversal: null },
        select: { totalAmount: true, recordedAt: true },
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      },
    },
  });

  let totalCount = 0;
  let takeawayCount = 0;
  let dineInCount = 0;
  let directTakeawayCount = 0;
  let tableOriginatedTakeawayCount = 0;
  let takeawayRevenue = 0n;
  let dineInRevenue = 0n;
  let directTakeawayRevenue = 0n;
  let tableOriginatedTakeawayRevenue = 0n;
  let unclassifiedHistoricalOriginCount = 0;
  let unclassifiedHistoricalOriginRevenue = 0n;

  for (const order of orders) {
    const activeSettlements = order.paymentSettlements;
    if (activeSettlements.length === 0) continue;

    const settledAmount = activeSettlements.reduce((sum, settlement) => sum + BigInt(settlement.totalAmount), 0n);
    if (settledAmount !== BigInt(order.totalAmount)) continue;
    const paidAt = activeSettlements[activeSettlements.length - 1]!.recordedAt;
    if (paidAt < range.from || paidAt >= range.to) continue;

    const orderAmount = BigInt(order.totalAmount);
    if (order.deferredAt !== null && order.inventorySaleChannel === null && order.channel === "TAKEAWAY") {
      unclassifiedHistoricalOriginCount += 1;
      unclassifiedHistoricalOriginRevenue += orderAmount;
      continue;
    }
    const containsPackaging = order.items.some((item) => item.quantity > 0 && item.product.systemKey === "PACKING");
    totalCount += 1;

    const originalChannel = order.inventorySaleChannel ?? order.channel;
    if (originalChannel === "TAKEAWAY") {
      takeawayCount += 1;
      directTakeawayCount += 1;
      takeawayRevenue += orderAmount;
      directTakeawayRevenue += orderAmount;
    } else if (containsPackaging) {
      takeawayCount += 1;
      tableOriginatedTakeawayCount += 1;
      takeawayRevenue += orderAmount;
      tableOriginatedTakeawayRevenue += orderAmount;
    } else {
      dineInCount += 1;
      dineInRevenue += orderAmount;
    }
  }

  const totalRevenue = takeawayRevenue + dineInRevenue;
  const takeawayAverage = average(takeawayRevenue, takeawayCount);
  const dineInAverage = average(dineInRevenue, dineInCount);
  const absoluteDifference = takeawayAverage === null || dineInAverage === null
    ? null
    : takeawayAverage > dineInAverage ? takeawayAverage - dineInAverage : dineInAverage - takeawayAverage;

  return {
    data: {
      orderDistribution: {
        totalCount,
        takeawayCount,
        dineInCount,
        takeawayPercent: percent(BigInt(takeawayCount), BigInt(totalCount)),
        dineInPercent: percent(BigInt(dineInCount), BigInt(totalCount)),
      },
      averageOrderValue: {
        takeawayAmount: takeawayAverage === null ? null : money(takeawayAverage),
        dineInAmount: dineInAverage === null ? null : money(dineInAverage),
        absoluteDifferenceAmount: absoluteDifference === null ? null : money(absoluteDifference),
        differencePercent: absoluteDifference === null || dineInAverage === null
          ? null
          : percent(absoluteDifference, dineInAverage),
      },
      revenue: {
        totalAmount: money(totalRevenue),
        takeawayAmount: money(takeawayRevenue),
        dineInAmount: money(dineInRevenue),
        takeawayPercent: percent(takeawayRevenue, totalRevenue),
        dineInPercent: percent(dineInRevenue, totalRevenue),
      },
      takeawayOrigin: {
        directTakeawayCount,
        tableOriginatedTakeawayCount,
        directTakeawayRevenueAmount: money(directTakeawayRevenue),
        tableOriginatedTakeawayRevenueAmount: money(tableOriginatedTakeawayRevenue),
      },
      unclassifiedHistoricalOrigin: {
        count: unclassifiedHistoricalOriginCount,
        revenueAmount: money(unclassifiedHistoricalOriginRevenue),
      },
    },
    range,
  };
}
