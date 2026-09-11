import { OrderState, type PrismaClient } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";

const activeOrders = {
  where: { state: OrderState.OPEN },
  orderBy: { createdAt: "asc" as const },
  select: {
    id: true,
    orderNumber: true,
    paymentStatus: true,
    createdAt: true,
    items: { select: { product: { select: { preparationDeadlineMinutes: true } } } },
  },
};

function tableDto(table: {
  id: string;
  name: string;
  waiterCallEnabled: boolean;
  occupancyState: "AVAILABLE" | "OCCUPIED";
  occupiedAt: Date | null;
  occupancyReminderAt: Date | null;
  orders: Array<{
    id: string;
    orderNumber: string;
    paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    createdAt: Date;
    items: Array<{ product: { preparationDeadlineMinutes: number } }>;
  }>;
}) {
  return {
    id: table.id,
    name: table.name,
    waiterCallEnabled: table.waiterCallEnabled,
    occupancyState: table.occupancyState,
    occupiedAt: table.occupiedAt?.toISOString() ?? null,
    occupancyReminderAt: table.occupancyReminderAt?.toISOString() ?? null,
    activeOrders: table.orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt.toISOString(),
      itemPreparationDeadlineMinutes: order.items.map((item) => item.product.preparationDeadlineMinutes),
    })),
  };
}

export async function listPosTables(prisma: PrismaClient) {
  const tables = await prisma.cafeTable.findMany({
    where: { isActive: true, archivedAt: null },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { orders: activeOrders },
  });

  const settings = await prisma.cafeSettings.upsert({ where: { singletonKey: true }, create: { tableSeatingLimitMinutes: null }, update: {}, select: { tableSeatingLimitMinutes: true } });
  return { tableSeatingLimitMinutes: settings.tableSeatingLimitMinutes, tables: tables.map(tableDto) };
}

export async function readPosTable(prisma: PrismaClient, tableId: string) {
  const table = await prisma.cafeTable.findFirst({
    where: { id: tableId, isActive: true, archivedAt: null },
    include: { orders: activeOrders },
  });

  if (!table) {
    throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested table was not found.");
  }

  const settings = await prisma.cafeSettings.upsert({ where: { singletonKey: true }, create: { tableSeatingLimitMinutes: null }, update: {}, select: { tableSeatingLimitMinutes: true } });
  return { tableSeatingLimitMinutes: settings.tableSeatingLimitMinutes, ...tableDto(table) };
}

export async function occupyTable(prisma: PrismaClient, tableId: string) {
  const updated = await prisma.cafeTable.updateMany({
    where: { id: tableId, isActive: true, archivedAt: null },
    data: { occupancyState: "OCCUPIED", occupiedAt: new Date(), occupancyReminderAt: null },
  });
  if (updated.count !== 1) {
    throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested table was not found.");
  }
  return readPosTable(prisma, tableId);
}

export async function makeTableAvailable(prisma: PrismaClient, tableId: string) {
  const now = new Date();
  await prisma.$transaction(async (transaction) => {
    const activeOrder = await transaction.order.findFirst({
      where: { tableId, channel: "TABLE", state: OrderState.OPEN },
      select: { id: true },
    });
    if (activeOrder) {
      throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "A table with an open order cannot be made available.");
    }
    const updated = await transaction.cafeTable.updateMany({
      where: { id: tableId, isActive: true, archivedAt: null },
      data: {
        occupancyState: "AVAILABLE",
        occupiedAt: null,
        occupancyReminderAt: null,
        tableContextInvalidBefore: now,
      },
    });
    if (updated.count !== 1) {
      throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested table was not found.");
    }
    await transaction.waiterCall.updateMany({
      where: { tableId, status: "PENDING" },
      data: { status: "RESOLVED", acknowledgedAt: now, resolvedAt: now, version: { increment: 1 } },
    });
    await transaction.customerTableVisit.updateMany({
      where: { tableId, invalidatedAt: null },
      data: { invalidatedAt: now },
    });
  });
  return readPosTable(prisma, tableId);
}

export async function acknowledgeTableWaiterCall(
  prisma: PrismaClient,
  tableId: string,
  expectedVersion: number,
) {
  const now = new Date();
  await prisma.$transaction(async (transaction) => {
    const call = await transaction.waiterCall.findFirst({
      where: { tableId, status: "PENDING" },
      orderBy: { requestedAt: "asc" },
    });
    if (!call) {
      throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "No pending waiter-call exists for this table.");
    }
    const updated = await transaction.waiterCall.updateMany({
      where: { id: call.id, status: "PENDING", version: expectedVersion },
      data: { status: "RESOLVED", acknowledgedAt: now, resolvedAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The waiter-call has changed.");
    }
  });
  return readPosTable(prisma, tableId);
}
