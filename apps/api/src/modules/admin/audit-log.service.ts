import type { AuditLogQuery } from "@cafe/contracts";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";

type Cursor = { occurredAt: string; id: string };

function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    if (!parsed.id || !parsed.occurredAt || Number.isNaN(new Date(parsed.occurredAt).getTime())) throw new Error("invalid cursor");
    return parsed;
  } catch {
    throw new ApplicationError(400, ErrorCodes.BAD_REQUEST, "The cursor is invalid.");
  }
}

function encodeCursor(entry: { occurredAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ occurredAt: entry.occurredAt.toISOString(), id: entry.id })).toString("base64url");
}

export async function listAuditLog(prisma: PrismaClient, query: AuditLogQuery) {
  if (query.from && query.to && query.from > query.to) {
    throw new ApplicationError(400, ErrorCodes.BAD_REQUEST, "from must not be later than to.");
  }
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.operation ? { operation: query.operation } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.from || query.to ? { occurredAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    ...(cursor ? { OR: [{ occurredAt: { lt: new Date(cursor.occurredAt) } }, { occurredAt: new Date(cursor.occurredAt), id: { lt: cursor.id } }] } : {}),
  };
  const records = await prisma.auditLog.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: { id: true, requestId: true, operation: true, entityType: true, entityId: true, reason: true, occurredAt: true, actor: { select: { id: true, username: true, role: true } } },
  });
  const hasMore = records.length > query.limit;
  const entries = records.slice(0, query.limit);
  return {
    entries: entries.map((entry) => ({ ...entry, occurredAt: entry.occurredAt.toISOString() })),
    page: { limit: query.limit, nextCursor: hasMore ? encodeCursor(entries[entries.length - 1]!) : null, hasMore },
  };
}
