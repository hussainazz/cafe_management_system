import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { readCookie } from "../../auth/session.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import {
  createTableContextCookieValue,
  hashTableQrToken,
  readTableContextCookieValue,
  tableContextCookieName,
} from "../../table-context/table-context.js";
import { readCustomerAuth } from "../../customer-auth/customer-auth.service.js";
import { createVisitForAuthenticatedCustomer } from "../../customer-auth/customer-auth.service.js";
import { WAITER_CALL_COOLDOWN_MS } from "@cafe/contracts";

const inactiveContext = {
  active: false,
  tableName: null,
  occupancyState: null,
  waiterCallStatus: null,
  canCallWaiter: false,
  waiterCallCooldownProgress: 0,
} as const;

export async function credentialFromCookie(prisma: PrismaClient, cookieHeader: string | undefined) {
  const payload = readTableContextCookieValue(readCookie(cookieHeader, tableContextCookieName));
  if (!payload) return null;

  const credential = await prisma.tableQrCredential.findUnique({
    where: { id: payload.credentialId },
    include: { table: true },
  });
  if (
    !credential?.isActive ||
    !credential.table.isActive ||
    credential.table.archivedAt ||
    !credential.table.customerQrEnabled ||
    !credential.table.waiterCallEnabled ||
    credential.createdAt.getTime() > payload.issuedAt
  ) {
    return null;
  }
  if (payload.tableId && payload.tableId !== credential.table.id) return null;
  const table = credential.table;
  if (
    !table.isActive ||
    table.archivedAt ||
    !table.waiterCallEnabled ||
    (table.tableContextInvalidBefore?.getTime() ?? 0) >= payload.issuedAt
  ) {
    return null;
  }
  return { credential, payload, table };
}

async function contextDto(prisma: PrismaClient, cookieHeader: string | undefined, credential: NonNullable<Awaited<ReturnType<typeof credentialFromCookie>>>) {
  const { table } = credential;
  const auth = await readCustomerAuth(prisma, cookieHeader);
  const visit = auth ? await prisma.customerTableVisit.findFirst({
    where: { customerId: auth.customerId, tableId: table.id, tableCredentialId: credential.credential.id, invalidatedAt: null, expiresAt: { gt: new Date() } },
  }) : null;
  const [pendingCall, latestResolvedCall] = await Promise.all([
    prisma.waiterCall.findFirst({ where: { tableId: table.id, status: "PENDING" }, select: { id: true } }),
    prisma.waiterCall.findFirst({ where: { tableId: table.id, status: "RESOLVED", resolvedAt: { not: null } }, orderBy: { resolvedAt: "desc" }, select: { resolvedAt: true } }),
  ]);
  const now = new Date();
  const cooldownEndsAt = latestResolvedCall?.resolvedAt
    ? new Date(latestResolvedCall.resolvedAt.getTime() + WAITER_CALL_COOLDOWN_MS)
    : null;
  const cooldownActive = Boolean(cooldownEndsAt && cooldownEndsAt > now);
  return {
    active: true,
    tableName: table.name,
    occupancyState: table.occupancyState,
    waiterCallStatus: pendingCall ? ("PENDING" as const) : null,
    canCallWaiter: !cooldownActive && (Boolean(visit) || (table.occupancyState === "OCCUPIED" && table.customerAuthBypassEnabled)),
    waiterCallCooldownProgress: cooldownActive ? Math.max(0, Math.min(1, (cooldownEndsAt!.getTime() - now.getTime()) / WAITER_CALL_COOLDOWN_MS)) : 0,
    authenticationRequired: !(table.occupancyState === "OCCUPIED" && table.customerAuthBypassEnabled) && !auth,
    customerAuthenticated: Boolean(auth),
    visitActive: Boolean(visit),
  };
}

export async function exchangeTableQrToken(prisma: PrismaClient, token: string, cookieHeader?: string) {
  const tokenHash = hashTableQrToken(token);
  const credential = await prisma.tableQrCredential.findUnique({
    where: { tokenHash },
    include: { table: true },
  });
  if (
    !credential?.isActive ||
    !credential.table.isActive ||
    credential.table.archivedAt ||
    !credential.table.customerQrEnabled ||
    !credential.table.waiterCallEnabled
  ) {
    throw new ApplicationError(
      401,
      ErrorCodes.TABLE_CONTEXT_INVALID,
      "This table QR is not valid.",
    );
  }

  const now = new Date();
  const resolved = await prisma.$transaction(async (transaction) => {
    const table = credential.table;
    if (table.occupancyState === "AVAILABLE") {
      await transaction.cafeTable.updateMany({
        where: { id: table.id, isActive: true, archivedAt: null, waiterCallEnabled: true, occupancyState: "AVAILABLE" },
        data: { occupancyReminderAt: now },
      });
    }
    return { tableId: table.id, tableName: table.name };
  });
  const auth = await readCustomerAuth(prisma, cookieHeader);
  if (auth) await createVisitForAuthenticatedCustomer(prisma, auth.customerId, credential.id, resolved.tableId);

  return {
    cookieValue: createTableContextCookieValue(credential.id, resolved.tableId, now),
    tableName: resolved.tableName,
  };
}

export async function readPublicTableContext(
  prisma: PrismaClient,
  cookieHeader: string | undefined,
) {
  const credential = await credentialFromCookie(prisma, cookieHeader);
  return credential ? contextDto(prisma, cookieHeader, credential) : inactiveContext;
}

export async function createWaiterCall(prisma: PrismaClient, cookieHeader: string | undefined) {
  const context = await credentialFromCookie(prisma, cookieHeader);
  if (!context) {
    throw new ApplicationError(
      401,
      ErrorCodes.TABLE_CONTEXT_INVALID,
      "Table context is invalid or expired.",
    );
  }
  const auth = await readCustomerAuth(prisma, cookieHeader);
  const bypassEnabled = context.table.occupancyState === "OCCUPIED" && context.table.customerAuthBypassEnabled;
  const visit = auth
    ? await prisma.customerTableVisit.findFirst({
        where: { customerId: auth.customerId, tableId: context.table.id, tableCredentialId: context.credential.id, invalidatedAt: null, expiresAt: { gt: new Date() } },
      })
    : null;
  if (!visit && !bypassEnabled) throw new ApplicationError(401, ErrorCodes.CUSTOMER_AUTH_REQUIRED, "Customer authentication and a valid table visit are required.");

  try {
    return await prisma.$transaction(async (transaction) => {
      const current = await transaction.tableQrCredential.findUnique({
        where: { id: context.credential.id },
        include: { table: true },
      });
      const currentTable = await transaction.cafeTable.findUnique({ where: { id: context.table.id } });
      if (
        !current?.isActive ||
        !currentTable?.isActive ||
        currentTable.archivedAt ||
        !currentTable.waiterCallEnabled ||
        (!(currentTable.occupancyState === "OCCUPIED" && currentTable.customerAuthBypassEnabled) && !visit) ||
        (currentTable.tableContextInvalidBefore?.getTime() ?? 0) >= context.payload.issuedAt
      ) {
        throw new ApplicationError(
          409,
          ErrorCodes.TABLE_CONTEXT_INVALID,
          "The table cannot request a waiter.",
        );
      }
      const existing = await transaction.waiterCall.findFirst({
        where: { tableId: currentTable.id, status: "PENDING" },
      });
      const latestResolved = await transaction.waiterCall.findFirst({
        where: { tableId: currentTable.id, status: "RESOLVED", resolvedAt: { not: null } },
        orderBy: { resolvedAt: "desc" },
        select: { resolvedAt: true },
      });
      const cooldownEndsAt = latestResolved?.resolvedAt
        ? new Date(latestResolved.resolvedAt.getTime() + WAITER_CALL_COOLDOWN_MS)
        : null;
      if (!existing && cooldownEndsAt && cooldownEndsAt > new Date()) {
        throw new ApplicationError(429, ErrorCodes.RATE_LIMITED, "Waiter-call is available again after the cooldown.");
      }
      const call =
        existing ?? (await transaction.waiterCall.create({ data: { tableId: currentTable.id, customerTableVisitId: visit?.id ?? null } }));
      return {
        status: "PENDING" as const,
        tableName: currentTable.name,
        requestedAt: call.requestedAt.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const call = await prisma.waiterCall.findFirstOrThrow({
        where: { tableId: context.table.id, status: "PENDING" },
      });
      return {
        status: "PENDING" as const,
        tableName: context.table.name,
        requestedAt: call.requestedAt.toISOString(),
      };
    }
    throw error;
  }
}

export async function listPendingWaiterCalls(prisma: PrismaClient) {
  const calls = await prisma.waiterCall.findMany({
    where: { status: "PENDING" },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    include: { table: { select: { name: true } } },
  });
  return {
    calls: calls.map((call) => ({
      id: call.id,
      tableId: call.tableId,
      tableName: call.table.name,
      version: call.version,
      requestedAt: call.requestedAt.toISOString(),
    })),
  };
}
