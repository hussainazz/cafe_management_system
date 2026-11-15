import { randomUUID } from "node:crypto";
import { Prisma } from "../../../generated/prisma/client.js";
import { roundDiscountedAmount } from "@cafe/contracts";

export type PriceDiscount = { kind: "FIXED" | "PERCENTAGE"; value: number } | null;
export type PriceEventInput = {
  productId?: string | null;
  productNameSnapshot?: string | null;
  optionId?: string | null;
  optionNameSnapshot?: string | null;
  dimension: "PRODUCT_BASE_PRICE" | "OPTION_PRICE" | "PRODUCT_OPTION_OVERRIDE" | "PRODUCT_DISCOUNT" | "PACKAGING_CHARGE";
  previousAmount?: number | null;
  newAmount?: number | null;
  previousEffectivePriceAmount?: number | null;
  newEffectivePriceAmount?: number | null;
  previousDiscount?: PriceDiscount;
  newDiscount?: PriceDiscount;
  effectiveAt?: Date | null;
};

export function effectiveProductPrice(priceAmount: number, discount: PriceDiscount) {
  if (!discount) return priceAmount;
  const discountAmount = discount.kind === "FIXED"
    ? discount.value
    : Math.floor((priceAmount * discount.value) / 100);
  return Math.min(priceAmount, roundDiscountedAmount(Math.max(0, priceAmount - discountAmount)));
}

export async function lockCatalogPriceHistory(tx: any) {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('catalog-price-history'))`);
}

export async function recordPriceEvents(tx: any, actorId: string, requestId: string, source: "POS_PRODUCT_CREATE" | "POS_PRODUCT_UPDATE" | "POS_OPTION_CREATE" | "POS_OPTION_UPDATE" | "POS_PRODUCT_DISCOUNT", events: PriceEventInput[]) {
  if (!events.length) return;
  const changeSetId = randomUUID();
  const latest = await tx.catalogPriceChange.aggregate({ _max: { recordedAt: true } });
  const now = Date.now();
  const effectiveAt = new Date(Math.max(now, (latest._max.recordedAt?.getTime() ?? 0) + 1));
  await tx.catalogPriceChange.createMany({ data: events.map((event) => ({
    changeSetId,
    productId: event.productId ?? null,
    productNameSnapshot: event.productNameSnapshot ?? null,
    optionId: event.optionId ?? null,
    optionNameSnapshot: event.optionNameSnapshot ?? null,
    dimension: event.dimension,
    previousAmount: event.previousAmount ?? null,
    newAmount: event.newAmount ?? null,
    previousEffectivePriceAmount: event.previousEffectivePriceAmount ?? null,
    newEffectivePriceAmount: event.newEffectivePriceAmount ?? null,
    previousDiscountKind: event.previousDiscount?.kind ?? null,
    previousDiscountValue: event.previousDiscount?.value ?? null,
    newDiscountKind: event.newDiscount?.kind ?? null,
    newDiscountValue: event.newDiscount?.value ?? null,
    source,
    effectiveAt: event.effectiveAt === undefined ? effectiveAt : event.effectiveAt,
    recordedAt: effectiveAt,
    actorId,
    requestId,
  })) });
}

