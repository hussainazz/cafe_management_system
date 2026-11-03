import type { DailyReportQuery } from "@cafe/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { settlementIdsForPaymentWindow } from "./payment-history.service.js";

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

export function tehranReportRange(query: DailyReportQuery) {
  const [fromYear, fromMonth, fromDay] = query.fromDate.split("-").map(Number);
  const [toYear, toMonth, toDay] = query.toDate.split("-").map(Number);
  const from = utcStartOfTehranDay(fromYear!, fromMonth!, fromDay!);
  const next = new Date(Date.UTC(toYear!, toMonth! - 1, toDay! + 1));
  const to = utcStartOfTehranDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return { from, to };
}

export async function dailyAccountingReport(prisma: PrismaClient, query: DailyReportQuery) {
  const range = tehranReportRange(query);
  const withinRange = { gte: range.from, lt: range.to };
  const activeOrdersInRange = { createdAt: withinRange, state: { not: "DELETED" as const }, isStaffConsumption: false };
  const settlementIds = await settlementIdsForPaymentWindow(prisma, query);
  const [orders, itemDiscounts, settlements, paymentMethods, reversals, deletedOrders, priorPayments] = await Promise.all([
    prisma.order.aggregate({ where: activeOrdersInRange, _count: { _all: true }, _sum: { totalAmount: true, discountAmount: true } }),
    prisma.orderItem.aggregate({ where: { order: activeOrdersInRange }, _sum: { discountAmount: true } }),
    prisma.paymentSettlement.aggregate({ where: { id: { in: settlementIds }, reversal: null, order: { state: { not: "DELETED" } } }, _sum: { totalAmount: true } }),
    prisma.payment.groupBy({ by: ["method"], where: { settlement: { id: { in: settlementIds }, reversal: null, order: { state: { not: "DELETED" } } } }, _sum: { amount: true } }),
    prisma.settlementReversal.findMany({ where: { recordedAt: withinRange, settlement: { order: { state: { not: "DELETED" } } } }, select: { settlement: { select: { totalAmount: true } } } }),
    prisma.order.aggregate({ where: { createdAt: withinRange, state: "DELETED", isStaffConsumption: false }, _count: { _all: true }, _sum: { totalAmount: true, paidAmount: true } }),
    prisma.paymentSettlement.findMany({
      where: { id: { in: settlementIds }, reversal: null, order: { state: { not: "DELETED" } } },
      select: { totalAmount: true, recordedAt: true, order: { select: { id: true, orderNumber: true, dailyOrderNumber: true, createdAt: true } } },
    }),
  ]);
  const priorDayPayments = new Map<string, { orderId: string; orderNumber: string; dailyOrderNumber: number; createdAt: string; amount: number }>();
  for (const payment of priorPayments) {
    const created = tehranDateParts(payment.order.createdAt);
    const recorded = tehranDateParts(payment.recordedAt);
    const dayKey = (p: typeof created) => p.year * 10000 + p.month * 100 + p.day;
    if (dayKey(created) >= dayKey(recorded)) continue;
    const existing = priorDayPayments.get(payment.order.id);
    if (existing) existing.amount += payment.totalAmount;
    else priorDayPayments.set(payment.order.id, { orderId: payment.order.id, orderNumber: payment.order.orderNumber, dailyOrderNumber: payment.order.dailyOrderNumber, createdAt: payment.order.createdAt.toISOString(), amount: payment.totalAmount });
  }
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
      priorDayPayments: [...priorDayPayments.values()],
      paymentMethodTotals,
      discounts: { orderAmount: orders._sum.discountAmount ?? 0, itemAmount: itemDiscounts._sum.discountAmount ?? 0, totalAmount: (orders._sum.discountAmount ?? 0) + (itemDiscounts._sum.discountAmount ?? 0) },
      reversals: { count: reversals.length, amount: reversals.reduce((total, reversal) => total + reversal.settlement.totalAmount, 0) },
      deletedOrders: { count: deletedOrders._count._all, totalAmount: deletedOrders._sum.totalAmount ?? 0, paidAmount: deletedOrders._sum.paidAmount ?? 0 },
    },
    range,
  };
}
