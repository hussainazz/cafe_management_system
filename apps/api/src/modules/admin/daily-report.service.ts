import type { DailyReportQuery } from "@cafe/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.js";

const tehranFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function tehranDateParts(value: Date) {
  const parts = Object.fromEntries(tehranFormatter.formatToParts(value).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function tehranOffsetMilliseconds(value: Date) {
  const timeZoneName = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", timeZoneName: "shortOffset" })
    .formatToParts(value)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(timeZoneName ?? "");
  if (!match) throw new Error("Unable to resolve the Asia/Tehran UTC offset.");
  const offset = (Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60_000;
  return match[1] === "+" ? offset : -offset;
}

function utcStartOfTehranDay(year: number, month: number, day: number): Date {
  const localNoon = new Date(Date.UTC(year, month - 1, day, 12));
  return new Date(Date.UTC(year, month - 1, day) - tehranOffsetMilliseconds(localNoon));
}

export function tehranReportRange(period: DailyReportQuery["period"], now = new Date()) {
  const current = tehranDateParts(now);
  const date = new Date(Date.UTC(current.year, current.month - 1, current.day - (period === "yesterday" ? 1 : 0)));
  const from = utcStartOfTehranDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  const to = utcStartOfTehranDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return { from, to };
}

export async function dailyAccountingReport(prisma: PrismaClient, query: DailyReportQuery) {
  const range = tehranReportRange(query.period);
  const withinRange = { gte: range.from, lt: range.to };
  const [orders, itemDiscounts, settlements, paymentMethods, reversals, deletedOrders] = await Promise.all([
    prisma.order.aggregate({ where: { createdAt: withinRange }, _count: { _all: true }, _sum: { totalAmount: true, discountAmount: true } }),
    prisma.orderItem.aggregate({ where: { order: { createdAt: withinRange } }, _sum: { discountAmount: true } }),
    // Accounting is event-based: a tender belongs to the day it was recorded,
    // even when a later-day reversal changes the order's current balance.
    prisma.paymentSettlement.aggregate({ where: { recordedAt: withinRange }, _sum: { totalAmount: true } }),
    prisma.payment.groupBy({ by: ["method"], where: { settlement: { recordedAt: withinRange } }, _sum: { amount: true } }),
    prisma.settlementReversal.findMany({ where: { recordedAt: withinRange }, select: { settlement: { select: { totalAmount: true } } } }),
    prisma.order.aggregate({ where: { createdAt: withinRange, state: "DELETED" }, _count: { _all: true }, _sum: { totalAmount: true, paidAmount: true } }),
  ]);
  const paymentMethodTotals = { cashAmount: 0, cardTerminalAmount: 0, cardTransferAmount: 0 };
  for (const row of paymentMethods) {
    if (row.method === "CASH") paymentMethodTotals.cashAmount = row._sum.amount ?? 0;
    if (row.method === "CARD_TERMINAL") paymentMethodTotals.cardTerminalAmount = row._sum.amount ?? 0;
    if (row.method === "CARD_TRANSFER") paymentMethodTotals.cardTransferAmount = row._sum.amount ?? 0;
  }
  return {
    report: {
      salesAmount: orders._sum.totalAmount ?? 0,
      paidAmount: settlements._sum.totalAmount ?? 0,
      orderCount: orders._count._all,
      paymentMethodTotals,
      discounts: { orderAmount: orders._sum.discountAmount ?? 0, itemAmount: itemDiscounts._sum.discountAmount ?? 0, totalAmount: (orders._sum.discountAmount ?? 0) + (itemDiscounts._sum.discountAmount ?? 0) },
      reversals: { count: reversals.length, amount: reversals.reduce((total, reversal) => total + reversal.settlement.totalAmount, 0) },
      deletedOrders: { count: deletedOrders._count._all, totalAmount: deletedOrders._sum.totalAmount ?? 0, paidAmount: deletedOrders._sum.paidAmount ?? 0 },
    },
    range,
  };
}
