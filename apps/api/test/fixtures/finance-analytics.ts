import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.js";

export type FinanceLine = {
  product: { id: string; name: string; priceAmount: number; systemKey?: string | null };
  revenue: number; cost: number | null; knownCost?: number; packagingCost?: number;
  quantity?: number; weightGrams?: number;
  options?: Array<{ id: string; name: string; price: number; quantity: number }>;
};

// Persist known historical snapshots, including settlement allocations, so the
// reporting tests exercise the real PostgreSQL query and response contracts.
export async function paidFinanceOrder(prisma: PrismaClient, input: {
  actorId: string; date: string; channel?: "TABLE" | "TAKEAWAY"; lines: FinanceLine[];
}) {
  const at = new Date(input.date.includes("T") ? input.date : `${input.date}T10:00:00+03:30`);
  const channel = input.channel ?? "TAKEAWAY";
  const total = input.lines.reduce((sum, line) => sum + line.revenue, 0);
  const order = await prisma.order.create({ data: {
    orderNumber: randomUUID(), createdById: input.actorId, channel, inventorySaleChannel: channel,
    state: "CLOSED", paymentStatus: "PAID", subtotalAmount: total, totalAmount: total,
    paidAmount: total, balanceAmount: 0, createdAt: at,
    items: { create: input.lines.map((line, index) => ({
      productId: line.product.id, productNameSnapshot: line.product.name, basePriceSnapshot: line.product.priceAmount,
      quantity: line.quantity ?? 1, pricingModeSnapshot: line.weightGrams ? "WEIGHTED_PER_KG" : "FIXED",
      weightGrams: line.weightGrams ?? null, lineTotalAmount: line.revenue, displayOrder: index, enteredAt: at,
      options: { create: (line.options ?? []).map((option) => ({ optionId: option.id, optionNameSnapshot: option.name, priceSnapshot: option.price, quantity: option.quantity })) },
    })) },
  }, include: { items: { orderBy: { displayOrder: "asc" } } } });
  const settlement = await prisma.paymentSettlement.create({ data: {
    orderId: order.id, recordedById: input.actorId, recordedAt: at, idempotencyKey: randomUUID(),
    totalAmount: total, allocationMode: "AMOUNT", payments: { create: { method: "CASH", amount: total } },
    allocations: { create: order.items.map((item, index) => ({ orderItemId: item.id, quantity: 0, amount: input.lines[index]!.revenue })) },
  } });
  const complete = input.lines.every((line) => line.cost !== null);
  const known = input.lines.reduce((sum, line) => sum + (line.cost ?? line.knownCost ?? 0), 0);
  await prisma.orderConsumption.create({ data: {
    orderId: order.id, cycleNumber: 1, paymentSettlementId: settlement.id, status: "UNTRACKED",
    recognizedById: input.actorId, recognizedAt: at, resolvedAt: at,
    theoreticalCogsAmount: complete ? known : null, knownCogsAmount: known, isCostComplete: complete,
    costSnapshot: {}, items: { create: order.items.map((item, index) => {
      const line = input.lines[index]!;
      const packingCost = line.packagingCost ?? 0;
      return {
        orderItemId: item.id, productNameSnapshot: item.productNameSnapshot, quantity: item.quantity, weightGrams: item.weightGrams,
        theoreticalCogsAmount: line.cost, knownCogsAmount: line.cost ?? line.knownCost ?? 0, isCostComplete: line.cost !== null,
        costSnapshot: { orderChannel: channel, packagingAttributionComplete: true, components: [{
          quantity: "1", packagingQuantity: packingCost ? "1" : "0", packagingKnownCostAmount: packingCost,
          nonPackagingKnownCostAmount: line.cost === null ? null : line.cost - packingCost,
        }] },
      };
    }) },
  } });
  return order;
}
