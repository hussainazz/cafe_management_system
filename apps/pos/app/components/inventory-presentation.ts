import type { InventoryStockItem } from "../lib/api-client";

export const inventoryUnitLabels: Record<"GRAM" | "MILLILITER" | "PIECE", string> = {
  GRAM: "گرم",
  MILLILITER: "میلی‌لیتر",
  PIECE: "عدد",
};
export const inventoryMovementLabels: Record<string, string> = {
  OPENING_COUNT: "موجودی آغازین",
  PURCHASE_RECEIPT: "رسید خرید",
  ORDER_CONSUMPTION: "مصرف سفارش",
  ORDER_RESTORATION: "برگشت مصرف سفارش",
  PHYSICAL_COUNT_ADJUSTMENT: "اصلاح موجودی پس از شمارش",
  PURCHASE_RETURN: "مرجوعی خرید",
};
export const inventoryNumber = (value: number | string) =>
  String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!);
export const inventoryAmountTotal = (amounts: Array<number | string>) => {
  if (amounts.some((amount) => !/^\d+$/.test(String(amount)))) return null;
  const total = amounts.reduce<bigint>((sum, amount) => sum + BigInt(amount), BigInt(0));
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
};
export const inventoryQuantity = (value: string) => {
  const [whole, decimal] = value.split(".");
  const fraction = decimal?.replace(/0+$/, "");
  return inventoryNumber(
    `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, "٬")}${fraction ? `٫${fraction}` : ""}`,
  );
};
export const emptyInventoryItem = (item: InventoryStockItem) =>
  item.balance.trackingStartedAt !== null &&
  item.balance.quantityOnHand !== null &&
  /^0(?:\.0+)?$/.test(item.balance.quantityOnHand);

// Compare base-unit quantities exactly, including the six supported decimal places.
export const lowInventoryItem = (item: InventoryStockItem) => {
  const fixed = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole!) * BigInt(1000000) + BigInt(fraction.padEnd(6, "0")); };
  return item.lowStockThreshold != null && item.balance.trackingStartedAt !== null && item.balance.quantityOnHand !== null && fixed(item.balance.quantityOnHand) <= fixed(item.lowStockThreshold);
};
