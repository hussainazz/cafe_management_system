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
  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.operation ? { operation: query.operation } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.from || query.to ? { occurredAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    ...cursorWhere(cursor, query.sortBy, query.sortDirection),
  };
  const records = await prisma.auditLog.findMany({
    where,
    orderBy: sortOrder(query.sortBy, query.sortDirection),
    take: query.limit + 1,
    select: { id: true, requestId: true, operation: true, entityType: true, entityId: true, reason: true, occurredAt: true, actor: { select: { id: true, username: true, role: true } } },
  });
  const hasMore = records.length > query.limit;
  const entries = records.slice(0, query.limit);
  return {
    entries: entries.map((entry) => ({ ...entry, occurredAt: entry.occurredAt.toISOString() })),
    page: { limit: query.limit, nextCursor: hasMore ? encodeCursor(entries[entries.length - 1]!, query.sortBy, query.sortDirection) : null, hasMore },
  };
}
