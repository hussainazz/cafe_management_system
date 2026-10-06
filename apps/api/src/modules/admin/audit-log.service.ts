import type { AuditLogQuery } from "@cafe/contracts";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";

type SortBy = AuditLogQuery["sortBy"];
type Cursor = {
  sortBy: SortBy;
  sortDirection: AuditLogQuery["sortDirection"];
  value: string;
  id: string;
  actorIsNull?: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function linkedSettlementIds(entry: { entityType: string; entityId: string; beforeSnapshot: Prisma.JsonValue | null; afterSnapshot: Prisma.JsonValue | null }) {
  if (entry.entityType !== "PAYMENT_SETTLEMENT") return [];
  const ids = new Set<string>();
  for (const snapshot of [entry.beforeSnapshot, entry.afterSnapshot]) {
    if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") continue;
    for (const key of ["correctedBySettlementId", "replacedSettlementId"]) {
      const value = snapshot[key];
      if (typeof value === "string" && uuidPattern.test(value) && value !== entry.entityId) ids.add(value);
    }
  }
  return [...ids];
}

function decodeCursor(cursor: string, sortBy: SortBy, sortDirection: AuditLogQuery["sortDirection"]): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    if (!parsed.id || typeof parsed.value !== "string" || parsed.sortBy !== sortBy || parsed.sortDirection !== sortDirection) throw new Error("invalid cursor");
    return parsed;
  } catch {
    throw new ApplicationError(400, ErrorCodes.BAD_REQUEST, "The cursor is invalid for this audit sort.");
  }
}

function encodeCursor(entry: { id: string; occurredAt: Date; operation: string; entityType: string; actor: { username: string } | null }, sortBy: SortBy, sortDirection: AuditLogQuery["sortDirection"]): string {
  const value = sortBy === "occurredAt" ? entry.occurredAt.toISOString() : sortBy === "operation" ? entry.operation : sortBy === "entityType" ? entry.entityType : entry.actor?.username ?? "";
  return Buffer.from(JSON.stringify({ sortBy, sortDirection, value, id: entry.id, ...(sortBy === "actor" ? { actorIsNull: entry.actor === null } : {}) })).toString("base64url");
}

function sortOrder(sortBy: SortBy, sortDirection: AuditLogQuery["sortDirection"]): Prisma.AuditLogOrderByWithRelationInput[] {
  if (sortBy === "actor") {
    return [{ actor: { username: sortDirection } }, { id: sortDirection }];
  }
  return [{ [sortBy]: sortDirection }, { id: sortDirection }];
}

function cursorWhere(cursor: Cursor | undefined, sortBy: SortBy, sortDirection: AuditLogQuery["sortDirection"]): Prisma.AuditLogWhereInput {
  if (!cursor) return {};
  const comparison = sortDirection === "asc" ? "gt" : "lt";
  if (sortBy === "actor") {
    // PostgreSQL sorts relation NULLs last for ASC and first for DESC.
    if (cursor.actorIsNull) {
      return sortDirection === "asc"
        ? { actor: { is: null }, id: { gt: cursor.id } }
        : { OR: [{ actor: { is: null }, id: { lt: cursor.id } }, { actor: { isNot: null } }] };
    }
    return {
      OR: [
        { actor: { is: { username: { [comparison]: cursor.value } } } },
        { actor: { is: { username: cursor.value } }, id: { [comparison]: cursor.id } },
        ...(sortDirection === "asc" ? [{ actor: { is: null } }] : []),
      ],
    };
  }
  const value = sortBy === "occurredAt" ? new Date(cursor.value) : cursor.value;
  return { OR: [{ [sortBy]: { [comparison]: value } }, { [sortBy]: value, id: { [comparison]: cursor.id } }] } as Prisma.AuditLogWhereInput;
}

export async function listAuditLog(prisma: PrismaClient, query: AuditLogQuery) {
  if (query.from && query.to && query.from > query.to) throw new ApplicationError(400, ErrorCodes.BAD_REQUEST, "from must not be later than to.");
  const cursor = query.cursor ? decodeCursor(query.cursor, query.sortBy, query.sortDirection) : undefined;
  const additionalFilters: Prisma.AuditLogWhereInput[] = [];
  if (query.orderId) {
    const settlements = await prisma.paymentSettlement.findMany({ where: { orderId: query.orderId }, select: { id: true } });
    additionalFilters.push({
      OR: [
        { entityType: "ORDER", entityId: query.orderId },
        { entityType: "PAYMENT_SETTLEMENT", entityId: { in: settlements.map(({ id }) => id) } },
      ],
    });
  }
  const cursorFilter = cursorWhere(cursor, query.sortBy, query.sortDirection);
  if (Object.keys(cursorFilter).length) additionalFilters.push(cursorFilter);

  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.operation ? { operation: query.operation } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.from || query.to ? { occurredAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    ...(additionalFilters.length ? { AND: additionalFilters } : {}),
  };
  const records = await prisma.auditLog.findMany({
    where,
    orderBy: sortOrder(query.sortBy, query.sortDirection),
    take: query.limit + 1,
    select: { id: true, requestId: true, operation: true, entityType: true, entityId: true, reason: true, occurredAt: true, actor: { select: { id: true, username: true, role: true } } },
  });
  const hasMore = records.length > query.limit;
  const entries = records.slice(0, query.limit);
  const settlementEntries = entries.filter((entry) => entry.entityType === "PAYMENT_SETTLEMENT");
  const settlementEntityIds = [...new Set(settlementEntries.map(({ entityId }) => entityId))];
  const settlementOrders = settlementEntityIds.length
    ? await prisma.paymentSettlement.findMany({ where: { id: { in: settlementEntityIds } }, select: { id: true, orderId: true } })
    : [];
  const settlementOrderById = new Map(settlementOrders.map(({ id, orderId }) => [id, orderId]));
  const settlementAuditSnapshots = settlementEntries.length
    ? await prisma.auditLog.findMany({
      where: { id: { in: settlementEntries.map(({ id }) => id) } },
      select: { id: true, entityType: true, entityId: true, beforeSnapshot: true, afterSnapshot: true },
    })
    : [];
  const settlementReferencesByAuditId = new Map(settlementAuditSnapshots.map((entry) => [entry.id, linkedSettlementIds(entry)]));
  return {
    entries: entries.map((entry) => {
      const orderId = entry.entityType === "ORDER" ? entry.entityId : settlementOrderById.get(entry.entityId);
      return {
        id: entry.id,
        requestId: entry.requestId,
        operation: entry.operation,
        entityType: entry.entityType,
        entityId: entry.entityId,
        relatedOrder: orderId ? { id: orderId } : null,
        relatedSettlementIds: settlementReferencesByAuditId.get(entry.id) ?? [],
        reason: entry.reason,
        occurredAt: entry.occurredAt.toISOString(),
        actor: entry.actor,
      };
    }),
    page: { limit: query.limit, nextCursor: hasMore ? encodeCursor(entries[entries.length - 1]!, query.sortBy, query.sortDirection) : null, hasMore },
  };
}
