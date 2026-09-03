import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { readCookie } from "../../auth/session.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import {
  createTableContextCookieValue,
  hashTableQrToken,
  readTableContextCookieValue,
  tableContextCookieName,
} from "../../table-context/table-context.js";

const inactiveContext = {
  active: false,
  tableName: null,
  occupancyState: null,
  waiterCallStatus: null,
  canCallWaiter: false,
} as const;

async function credentialFromCookie(prisma: PrismaClient, cookieHeader: string | undefined) {
  const payload = readTableContextCookieValue(readCookie(cookieHeader, tableContextCookieName));
  if (!payload) return null;

  const credential = await prisma.tableQrCredential.findUnique({
    where: { id: payload.credentialId },
    include: {
      table: {
        include: {
          waiterCalls: {
            where: { status: "PENDING" },
            orderBy: { requestedAt: "asc" },
            take: 1,
          },
        },
      },
    },
  });
  if (
    !credential?.isActive ||
    !credential.table.isActive ||
    credential.table.archivedAt ||
    !credential.table.waiterCallEnabled ||
    credential.createdAt.getTime() > payload.issuedAt ||
    (credential.table.tableContextInvalidBefore?.getTime() ?? 0) >= payload.issuedAt
  ) {
    return null;
  }
  return { credential, payload };
}

function contextDto(credential: NonNullable<Awaited<ReturnType<typeof credentialFromCookie>>>) {
  const { table } = credential.credential;
  return {
    active: true,
    tableName: table.name,
    occupancyState: table.occupancyState,
    waiterCallStatus: table.waiterCalls.length > 0 ? ("PENDING" as const) : null,
    canCallWaiter: table.occupancyState === "OCCUPIED",
  };
}

export async function exchangeTableQrToken(prisma: PrismaClient, token: string) {
  const tokenHash = hashTableQrToken(token);
  const credential = await prisma.tableQrCredential.findUnique({
    where: { tokenHash },
    include: { table: true },
  });
  if (
    !credential?.isActive ||
    !credential.table.isActive ||
    credential.table.archivedAt ||
    !credential.table.waiterCallEnabled
  ) {
    throw new ApplicationError(
      401,
      ErrorCodes.TABLE_CONTEXT_INVALID,
      "This table QR is not valid.",
    );
  }

  const now = new Date();
  if (credential.table.occupancyState === "AVAILABLE") {
    await prisma.cafeTable.updateMany({
      where: {
        id: credential.tableId,
        isActive: true,
        archivedAt: null,
        waiterCallEnabled: true,
        occupancyState: "AVAILABLE",
      },
      data: { occupancyReminderAt: now },
    });
  }

  return {
    cookieValue: createTableContextCookieValue(credential.id, now),
    tableName: credential.table.name,
  };
}

export async function readPublicTableContext(
  prisma: PrismaClient,
  cookieHeader: string | undefined,
) {
  const credential = await credentialFromCookie(prisma, cookieHeader);
  return credential ? contextDto(credential) : inactiveContext;
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
  if (context.credential.table.occupancyState !== "OCCUPIED") {
    throw new ApplicationError(
      409,
      ErrorCodes.TABLE_NOT_OCCUPIED,
      "The table is not marked occupied yet.",
    );
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      const current = await transaction.tableQrCredential.findUnique({
        where: { id: context.credential.id },
        include: { table: true },
      });
      if (
        !current?.isActive ||
        !current.table.isActive ||
        current.table.archivedAt ||
        !current.table.waiterCallEnabled ||
        current.table.occupancyState !== "OCCUPIED" ||
        (current.table.tableContextInvalidBefore?.getTime() ?? 0) >= context.payload.issuedAt
      ) {
        throw new ApplicationError(
          409,
          ErrorCodes.TABLE_NOT_OCCUPIED,
          "The table cannot request a waiter.",
        );
      }
      const existing = await transaction.waiterCall.findFirst({
        where: { tableId: current.tableId, status: "PENDING" },
      });
      const call =
        existing ?? (await transaction.waiterCall.create({ data: { tableId: current.tableId } }));
      return {
        status: "PENDING" as const,
        tableName: current.table.name,
        requestedAt: call.requestedAt.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const call = await prisma.waiterCall.findFirstOrThrow({
        where: { tableId: context.credential.tableId, status: "PENDING" },
      });
      return {
        status: "PENDING" as const,
        tableName: context.credential.table.name,
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
