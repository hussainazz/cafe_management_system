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

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export async function dailyAccountingReport(prisma: PrismaClient, query: DailyReportQuery) {
  const range = tehranReportRange(query.period);
  const withinRange = { gte: range.from, lt: range.to };
  const [orders, settlements, reversals] = await Promise.all([
    prisma.order.findMany({
      where: { createdAt: withinRange },
      select: { state: true, totalAmount: true, paidAmount: true, discountAmount: true, items: { select: { discountAmount: true } } },
    }),
    prisma.paymentSettlement.findMany({
      where: { recordedAt: withinRange },
      include: { payments: { select: { method: true, amount: true } }, reversal: { select: { id: true } } },
    }),
    prisma.settlementReversal.findMany({ where: { recordedAt: withinRange }, select: { settlement: { select: { totalAmount: true } } } }),
  ]);
  const activeSettlements = settlements.filter((settlement) => !settlement.reversal);
  const paymentMethodTotals = activeSettlements.flatMap((settlement) => settlement.payments).reduce(
    (totals, payment) => {
      if (payment.method === "CASH") totals.cashAmount += payment.amount;
      if (payment.method === "CARD_TERMINAL") totals.cardTerminalAmount += payment.amount;
      if (payment.method === "CARD_TRANSFER") totals.cardTransferAmount += payment.amount;
      return totals;
    },
    { cashAmount: 0, cardTerminalAmount: 0, cardTransferAmount: 0 },
  );
  const orderDiscountAmount = sum(orders.map((order) => order.discountAmount));
  const itemDiscountAmount = sum(orders.flatMap((order) => order.items.map((item) => item.discountAmount)));
  const deletedOrders = orders.filter((order) => order.state === "DELETED");
  return {
    report: {
      salesAmount: sum(orders.map((order) => order.totalAmount)),
      paidAmount: sum(activeSettlements.map((settlement) => settlement.totalAmount)),
      orderCount: orders.length,
      paymentMethodTotals,
      discounts: { orderAmount: orderDiscountAmount, itemAmount: itemDiscountAmount, totalAmount: orderDiscountAmount + itemDiscountAmount },
      reversals: { count: reversals.length, amount: sum(reversals.map((reversal) => reversal.settlement.totalAmount)) },
      deletedOrders: { count: deletedOrders.length, totalAmount: sum(deletedOrders.map((order) => order.totalAmount)), paidAmount: sum(deletedOrders.map((order) => order.paidAmount)) },
    },
    range,
  };
}
