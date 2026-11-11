import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";

type Database = Prisma.TransactionClient | PrismaClient;

export async function inventoryActivation(db: Database): Promise<Date | null> {
  const settings = await db.cafeSettings.findUnique({ where: { singletonKey: true }, select: { inventoryActivatedAt: true } });
  return settings?.inventoryActivatedAt ?? null;
}

export async function orderTurnoverEligible(db: Database, orderId: string): Promise<boolean> {
  const activatedAt = await inventoryActivation(db);
  if (!activatedAt) return false;
  return (await db.order.count({ where: { id: orderId, createdAt: { gte: activatedAt } } })) > 0;
}
