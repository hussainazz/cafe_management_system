import { OrderState, type PrismaClient } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";

const activeOrders = {
  where: { state: OrderState.OPEN },
  orderBy: { createdAt: "asc" as const },
  select: {
    id: true,
    orderNumber: true,
    paymentStatus: true,
    estimatedPreparationMinutes: true,
    estimatedTableReleaseAt: true,
    createdAt: true,
  },
};

function tableDto(table: {
  id: string;
  name: string;
  seatingLimitMinutes: number;
  waiterCallEnabled: boolean;
  occupancyState: "AVAILABLE" | "OCCUPIED";
  occupiedAt: Date | null;
  occupancyReminderAt: Date | null;
  orders: Array<{
    id: string;
    orderNumber: string;
    paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    estimatedPreparationMinutes: number;
    estimatedTableReleaseAt: Date | null;
    createdAt: Date;
  }>;
}) {
  return {
    id: table.id,
    name: table.name,
    seatingLimitMinutes: table.seatingLimitMinutes,
    waiterCallEnabled: table.waiterCallEnabled,
    occupancyState: table.occupancyState,
    occupiedAt: table.occupiedAt?.toISOString() ?? null,
    occupancyReminderAt: table.occupancyReminderAt?.toISOString() ?? null,
    activeOrders: table.orders.map((order) => ({
      ...order,
      // The database constraint requires this timestamp for every table order.
      estimatedTableReleaseAt: order.estimatedTableReleaseAt!.toISOString(),
      createdAt: order.createdAt.toISOString(),
    })),
  };
}

export async function listPosTables(prisma: PrismaClient) {
  const tables = await prisma.cafeTable.findMany({
    where: { isActive: true, archivedAt: null },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { orders: activeOrders },
  });

  return { tables: tables.map(tableDto) };
}

export async function readPosTable(prisma: PrismaClient, tableId: string) {
  const table = await prisma.cafeTable.findFirst({
    where: { id: tableId, isActive: true, archivedAt: null },
    include: { orders: activeOrders },
  });

  if (!table) {
    throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested table was not found.");
  }

  return tableDto(table);
}
