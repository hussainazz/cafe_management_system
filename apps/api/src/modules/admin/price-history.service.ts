import type { PriceHistoryQuery } from "@cafe/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import { tehranReportRange } from "./daily-report.service.js";

export async function listPriceHistory(prisma: PrismaClient, query: PriceHistoryQuery) {
  const range = tehranReportRange({ fromDate: query.fromDate, toDate: query.toDate });
  const where: any = {
    AND: [
      { OR: [
        { effectiveAt: { gte: range.from, lt: range.to } },
        { source: "BASELINE", recordedAt: { gte: range.from, lt: range.to } },
      ] },
      ...(query.productId ? [{ productId: query.productId }] : []),
      ...(query.optionId ? [{ optionId: query.optionId }] : []),
      ...(query.dimension ? [{ dimension: query.dimension }] : []),
    ],
  };
  if (query.cursor) {
    const cursor = await prisma.catalogPriceChange.findUnique({ where: { id: query.cursor }, select: { id: true, recordedAt: true } });
    if (!cursor) throw new ApplicationError(400, ErrorCodes.VALIDATION_ERROR, "The price-history cursor is invalid.");
    where.AND.push({ OR: [
      { recordedAt: { lt: cursor.recordedAt } },
      { recordedAt: cursor.recordedAt, id: { lt: cursor.id } },
    ] });
  }
  const rows = await prisma.catalogPriceChange.findMany({
    where,
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    include: { actor: { select: { id: true, username: true, role: true } } },
  });
  const hasMore = rows.length > query.limit;
  const changes = rows.slice(0, query.limit).map((row) => ({
    id: row.id,
    changeSetId: row.changeSetId,
    productId: row.productId,
    productNameSnapshot: row.productNameSnapshot,
    optionId: row.optionId,
    optionNameSnapshot: row.optionNameSnapshot,
    dimension: row.dimension,
    previousAmount: row.previousAmount,
    newAmount: row.newAmount,
    previousEffectivePriceAmount: row.previousEffectivePriceAmount,
    newEffectivePriceAmount: row.newEffectivePriceAmount,
    previousDiscount: row.previousDiscountKind && row.previousDiscountValue !== null ? { kind: row.previousDiscountKind, value: row.previousDiscountValue } : null,
    newDiscount: row.newDiscountKind && row.newDiscountValue !== null ? { kind: row.newDiscountKind, value: row.newDiscountValue } : null,
    source: row.source,
    effectiveAt: row.effectiveAt?.toISOString() ?? null,
    effectiveTimeKnown: row.effectiveAt !== null,
    recordedAt: row.recordedAt.toISOString(),
    actor: row.actor,
    requestId: row.requestId,
  }));
  return {
    changes,
    range,
    page: { limit: query.limit, nextCursor: hasMore ? changes.at(-1)?.id ?? null : null, hasMore },
  };
}
