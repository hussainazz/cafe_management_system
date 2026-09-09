import type { PaymentHistoryQuery } from "@cafe/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";

type Cursor = { recordedAt: string; id: string };

function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    if (!parsed.id || !parsed.recordedAt || Number.isNaN(new Date(parsed.recordedAt).getTime())) {
      throw new Error("invalid cursor");
    }
    return parsed;
  } catch {
    throw new ApplicationError(400, ErrorCodes.BAD_REQUEST, "The cursor is invalid.");
  }
}

function encodeCursor(settlement: { recordedAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ recordedAt: settlement.recordedAt.toISOString(), id: settlement.id })).toString("base64url");
}

export async function listPaymentHistory(prisma: PrismaClient, query: PaymentHistoryQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const records = await prisma.paymentSettlement.findMany({
    ...(cursor
      ? {
          where: {
            OR: [
              { recordedAt: { lt: new Date(cursor.recordedAt) } },
              { recordedAt: new Date(cursor.recordedAt), id: { lt: cursor.id } },
            ],
          },
        }
      : {}),
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    include: {
      order: { select: { id: true, orderNumber: true, channel: true, table: { select: { id: true, name: true } } } },
      recordedBy: { select: { id: true, username: true, role: true } },
      payments: { orderBy: { id: "asc" }, select: { method: true, amount: true, reference: true } },
      reversal: { select: { recordedAt: true } },
    },
  });
  const hasMore = records.length > query.limit;
  const settlements = records.slice(0, query.limit);
  return {
    payments: settlements.map((settlement) => ({
      id: settlement.id,
      orderId: settlement.order.id,
      orderNumber: settlement.order.orderNumber,
      channel: settlement.order.channel,
      table: settlement.order.table,
      totalAmount: settlement.totalAmount,
      recordedAt: settlement.recordedAt.toISOString(),
      recordedBy: settlement.recordedBy,
      reversedAt: settlement.reversal?.recordedAt.toISOString() ?? null,
      payments: settlement.payments,
      settlementReceiptPath: `/api/v1/orders/${settlement.order.id}/settlements/${settlement.id}/receipt`,
    })),
    page: {
      limit: query.limit,
      nextCursor: hasMore ? encodeCursor(settlements[settlements.length - 1]!) : null,
      hasMore,
    },
  };
}
