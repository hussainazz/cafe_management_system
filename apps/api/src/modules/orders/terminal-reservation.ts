import type { Prisma } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";

export async function assertNoTerminalReservation(transaction: Prisma.TransactionClient, orderId: string, exceptId?: string) {
  const reserved = await transaction.terminalPaymentAttempt.findFirst({
    where: { orderId, status: { in: ["PENDING", "UNKNOWN"] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (reserved) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "This order has an unresolved terminal payment. Read its status or reconcile it first.");
}
