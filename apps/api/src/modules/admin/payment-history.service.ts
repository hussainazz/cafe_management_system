import type { PaymentHistoryQuery } from "@cafe/contracts";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";

export async function listPaymentHistory(prisma: PrismaClient, query: PaymentHistoryQuery) {
  // Dates and times are evaluated in the café's reporting timezone. A partial
  // time filter applies independently to every selected Tehran-local date;
  // `fromTime > toTime` is an overnight window for each such date.
  // Prisma persists UTC DateTime values in PostgreSQL `timestamp` columns, so
  // attach UTC before projecting the instant into the Tehran-local clock.
  const localRecordedAt = Prisma.sql`("recordedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran')`;
  const dateFilter = Prisma.sql`${localRecordedAt}::date >= ${query.fromDate}::date AND ${localRecordedAt}::date <= ${query.toDate}::date`;
  const timeFilter = query.fromTime && query.toTime
    ? query.fromTime <= query.toTime
      ? Prisma.sql`AND ${dateFilter} AND ${localRecordedAt}::time >= ${query.fromTime}::time AND ${localRecordedAt}::time < ${query.toTime}::time`
      : Prisma.sql`AND ((${dateFilter} AND ${localRecordedAt}::time >= ${query.fromTime}::time) OR (${localRecordedAt}::date > ${query.fromDate}::date AND ${localRecordedAt}::date <= (${query.toDate}::date + 1) AND ${localRecordedAt}::time < ${query.toTime}::time))`
    : query.fromTime
      ? Prisma.sql`AND ${dateFilter} AND ${localRecordedAt}::time >= ${query.fromTime}::time`
      : query.toTime
        ? Prisma.sql`AND ${dateFilter} AND ${localRecordedAt}::time < ${query.toTime}::time`
        : Prisma.sql`AND ${dateFilter}`;
  const ids = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM payment_settlements
    WHERE 1 = 1 ${timeFilter}
    ORDER BY "recordedAt" DESC, id DESC
  `);
  const records = await prisma.paymentSettlement.findMany({
    where: { id: { in: ids.map((row) => row.id) } },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    include: {
      order: { select: { id: true, orderNumber: true, dailyOrderNumber: true, state: true, channel: true, table: { select: { id: true, name: true } } } },
      recordedBy: { select: { id: true, username: true, role: true } },
      payments: { orderBy: { id: "asc" }, select: { method: true, amount: true, reference: true } },
      reversal: { select: { recordedAt: true } },
    },
  });
  return {
    payments: records.map((settlement) => ({
      id: settlement.id,
      orderId: settlement.order.id,
      orderNumber: settlement.order.orderNumber,
      dailyOrderNumber: settlement.order.dailyOrderNumber,
      orderState: settlement.order.state,
      channel: settlement.order.channel,
      table: settlement.order.table,
      totalAmount: settlement.totalAmount,
      recordedAt: settlement.recordedAt.toISOString(),
      recordedBy: settlement.recordedBy,
      reversedAt: settlement.reversal?.recordedAt.toISOString() ?? null,
      payments: settlement.payments,
      settlementReceiptPath: `/api/v1/orders/${settlement.order.id}/settlements/${settlement.id}/receipt`,
    })),
  };
}
