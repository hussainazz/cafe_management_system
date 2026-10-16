import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";

type Database = Prisma.TransactionClient | PrismaClient;

export async function inventoryActivation(db: Database): Promise<Date | null> {
  const settings = await db.cafeSettings.findUnique({ where: { singletonKey: true }, select: { inventoryActivatedAt: true } });
  return settings?.inventoryActivatedAt ?? null;
}

export async function requireInventoryActive(db: Database): Promise<Date> {
  const activatedAt = await inventoryActivation(db);
  if (!activatedAt) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "انبار هنوز فعال نشده است. مدیر می‌تواند آن را از تنظیمات فعال کند.");
  return activatedAt;
}

export async function orderInventoryEligible(db: Database, orderId: string): Promise<boolean> {
  const activatedAt = await inventoryActivation(db);
  if (!activatedAt) return false;
  return (await db.order.count({ where: { id: orderId, createdAt: { gte: activatedAt } } })) > 0;
}
