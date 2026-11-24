import { inventoryActivation, orderTurnoverEligible } from "./inventory-activation.js";
import { createHash } from "node:crypto";
import {
  InventoryCountKind,
  InventoryCountStatus,
  InventoryMovementKind,
  OrderConsumptionStatus,
  Prisma,
  PurchaseStatus,
  type InventoryBalance,
  type OrderConsumption,
  type PrismaClient,
} from "../../../generated/prisma/client.js";
import type {
  CreateInventoryCountRequestSchema,
  CreatePurchaseRequestSchema,
  CreateStockItemRequestSchema,
  CreateRecipeRequestSchema,
  UpdateInventoryCountRequestSchema,
  UpdatePurchaseRequestSchema,
  UpdateStockItemRequestSchema,
  UpdateRecipeRequestSchema,
  ProductCostingConfigurationInputSchema,
  InventoryCountListQuerySchema,
  PurchaseListQuerySchema,
  InventoryMovementQuerySchema,
  PendingConsumptionQuerySchema,
} from "@cafe/contracts";
import type { z } from "zod";
import { ApplicationError, ErrorCodes, type ErrorCode } from "../../errors/application-error.js";
import type { AuthenticatedUser } from "../auth/auth.service.js";

type Tx = Prisma.TransactionClient;
type StockInput = z.infer<typeof CreateStockItemRequestSchema>;
type StockUpdate = z.infer<typeof UpdateStockItemRequestSchema>;
type PurchaseInput = z.infer<typeof CreatePurchaseRequestSchema>;
type PurchaseUpdate = z.infer<typeof UpdatePurchaseRequestSchema>;
type RecipeInput = z.infer<typeof CreateRecipeRequestSchema>;
type RecipeUpdate = z.infer<typeof UpdateRecipeRequestSchema>;
type CountInput = z.infer<typeof CreateInventoryCountRequestSchema>;
type CountUpdate = z.infer<typeof UpdateInventoryCountRequestSchema>;
type CostingInput = z.infer<typeof ProductCostingConfigurationInputSchema>;
type InventoryCountListQuery = z.infer<typeof InventoryCountListQuerySchema>;
type PurchaseListQuery = z.infer<typeof PurchaseListQuerySchema>;
type MovementQuery = z.infer<typeof InventoryMovementQuerySchema>;
type PendingQuery = z.infer<typeof PendingConsumptionQuerySchema>;

const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const MAX_COGS_AMOUNT = Number.MAX_SAFE_INTEGER;
const POST_PURCHASE = "POST_INVENTORY_PURCHASE";
const POST_COUNT = "POST_INVENTORY_COUNT";
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000;

function decimal(value: string | number | Prisma.Decimal) { return new Prisma.Decimal(value); }
function dstr(value: Prisma.Decimal | null | undefined) { return value?.toFixed(6).replace(/\.?0+$/, "") || "0"; }
function intMoney(value: Prisma.Decimal) { return value.toDecimalPlaces(0, ROUND_HALF_UP).toNumber(); }
function checkedCogsAmount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COGS_AMOUNT) {
    fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The order's total cost exceeds the safely representable Toman range.");
  }
  return value;
}
function sha(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fail(status: number, code: ErrorCode, message: string): never { throw new ApplicationError(status, code, message); }
function stale(message: string, version: number): never { throw new ApplicationError(409, ErrorCodes.STALE_VERSION, message, [{ path: "expectedVersion", code: "current_version", message: `Current version is ${version}.` }]); }
function audit(tx: Tx, actorId: string, requestId: string, operation: string, entityType: string, entityId: string, beforeSnapshot?: unknown, afterSnapshot?: unknown) {
  return tx.auditLog.create({ data: { actorId, requestId, operation, entityType, entityId, ...(beforeSnapshot === undefined ? {} : { beforeSnapshot: beforeSnapshot as Prisma.InputJsonValue }), ...(afterSnapshot === undefined ? {} : { afterSnapshot: afterSnapshot as Prisma.InputJsonValue }) } });
}
async function lock(tx: Tx, keys: string[]) {
  for (const key of [...new Set(keys)].sort()) await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}::text))`);
}
function dtoStock(row: any) {
  const balance = row.balance;
  const unitCost = balance?.trackingStartedAt && balance.quantityOnHand.gt(0)
    ? decimal(balance.carryingValueAmount).div(balance.quantityOnHand)
    : balance?.trackingStartedAt ? decimal(0) : null;
  const referencePurchase = row.referencePurchaseUnitLabel != null && row.referencePurchaseQuantity != null && row.referencePurchasePriceAmount != null
    ? { conversionId: row.referencePurchaseConversionId ?? null, conversionLabel: row.referencePurchaseUnitLabel, packageQuantity: dstr(row.referencePurchaseQuantity), baseQuantityPerPack: dstr(row.referencePurchaseConversion?.baseQuantityPerPack ?? decimal(1)), priceAmount: row.referencePurchasePriceAmount }
    : null;
  return {
    id: row.id, name: row.archivedName ?? row.name, category: row.category, baseUnit: row.baseUnit,
    isPackagingMaterial: row.isPackagingMaterial, isActive: row.isActive, archivedAt: row.archivedAt?.toISOString() ?? null, version: row.version,
    referencePurchase,
    conversions: row.conversions.map((conversion: any) => ({ id: conversion.id, label: conversion.label, baseQuantityPerPack: dstr(conversion.baseQuantityPerPack), isActive: conversion.isActive })),
    lowStockThreshold: row.lowStockThreshold == null ? null : row.lowStockThreshold.toFixed(6),
    balance: { quantityOnHand: balance?.trackingStartedAt ? dstr(balance.quantityOnHand) : null, carryingValueAmount: balance?.trackingStartedAt ? balance.carryingValueAmount : null, movingAverageCostPerBaseUnit: unitCost?.toFixed(6) ?? null, trackingStartedAt: balance?.trackingStartedAt?.toISOString() ?? null },
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listStockItems(prisma: PrismaClient) {
  return (await prisma.stockItem.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }], include: { conversions: { orderBy: [{ isActive: "desc" }, { label: "asc" }] }, referencePurchaseConversion: true, balance: true } })).map(dtoStock);
}

const MAX_STOCK_QUANTITY = decimal("100000000000000");
const STOCK_SCALE = BigInt(1_000_000);

function assertStockQuantity(quantity: Prisma.Decimal) {
  if (quantity.isNegative() || quantity.gte(MAX_STOCK_QUANTITY) || quantity.decimalPlaces() > 6) {
    fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The opening quantity exceeds the supported inventory range or precision.");
  }
}

function decimalMicros(value: Prisma.Decimal) {
  const [whole, fraction = ""] = value.toFixed(6).split(".");
  return BigInt(whole!) * STOCK_SCALE + BigInt(fraction);
}

function decimalFromMicros(micros: bigint) {
  const whole = micros / STOCK_SCALE;
  const fraction = (micros % STOCK_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return decimal(fraction ? `${whole}.${fraction}` : whole.toString());
}

function stockProductOrNull(left: Prisma.Decimal, right: Prisma.Decimal) {
  const numerator = decimalMicros(left) * decimalMicros(right);
  if (numerator % STOCK_SCALE !== BigInt(0)) return null;
  const product = decimalFromMicros(numerator / STOCK_SCALE);
  if (product.gte(MAX_STOCK_QUANTITY)) return null;
  return product;
}

function exactStockProduct(left: Prisma.Decimal, right: Prisma.Decimal) {
  const product = stockProductOrNull(left, right);
  if (!product) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The converted package quantity must fit the six-decimal stock precision.");
  return product;
}

function exactOpeningValue(quantity: Prisma.Decimal, priceAmount: number, packageBaseQuantity: Prisma.Decimal) {
  const denominator = decimalMicros(packageBaseQuantity);
  if (denominator <= BigInt(0)) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The reference package must contain a positive base-unit quantity.");
  const numerator = decimalMicros(quantity) * BigInt(priceAmount);
  const amount = (numerator + denominator / BigInt(2)) / denominator;
  if (amount > BigInt(2_147_483_647)) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The calculated opening value exceeds the supported Toman range.");
  return Number(amount);
}

function assertConversionLabels(baseUnit: string, conversions: StockInput["conversions"], existing: Array<{ id: string; label: string }> = []) {
  if (conversions.some((conversion) => conversion.label === baseUnit
    && !existing.some((saved) => saved.id === conversion.id && saved.label === baseUnit))) {
    fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A named conversion cannot use the stock item's base-unit label.");
  }
}

function referencePurchaseFromInputs(baseUnit: string, reference: StockInput["referencePurchase"], conversions: StockInput["conversions"]) {
  if (!reference) return null;
  if (reference.conversionLabel === baseUnit) {
    const resolved = { conversionId: null, conversionLabel: baseUnit, packageQuantity: decimal(reference.packageQuantity), baseQuantityPerPack: decimal(1), priceAmount: reference.priceAmount };
    exactStockProduct(resolved.packageQuantity, resolved.baseQuantityPerPack);
    return resolved;
  }
  const conversion = conversions.find((candidate) => candidate.label.toLocaleLowerCase() === reference.conversionLabel.toLocaleLowerCase() && candidate.isActive);
  if (!conversion) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The purchase package unit must be an active base unit or stock-item conversion.");
  const resolved = { conversionId: conversion.id ?? null, conversionLabel: conversion.label, packageQuantity: decimal(reference.packageQuantity), baseQuantityPerPack: decimal(conversion.baseQuantityPerPack), priceAmount: reference.priceAmount };
  exactStockProduct(resolved.packageQuantity, resolved.baseQuantityPerPack);
  return resolved;
}

async function resolveReferencePurchase(tx: Tx, stockItemId: string, baseUnit: string, reference: StockInput["referencePurchase"]) {
  if (!reference) return null;
  if (reference.conversionLabel === baseUnit) {
    const resolved = { conversionId: null, conversionLabel: baseUnit, packageQuantity: decimal(reference.packageQuantity), baseQuantityPerPack: decimal(1), priceAmount: reference.priceAmount };
    exactStockProduct(resolved.packageQuantity, resolved.baseQuantityPerPack);
    return resolved;
  }
  const conversion = await tx.stockUnitConversion.findFirst({ where: { stockItemId, label: reference.conversionLabel, isActive: true } });
  if (!conversion) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The purchase package unit must be an active conversion belonging to this stock item.");
  const resolved = { conversionId: conversion.id, conversionLabel: conversion.label, packageQuantity: decimal(reference.packageQuantity), baseQuantityPerPack: conversion.baseQuantityPerPack, priceAmount: reference.priceAmount };
  exactStockProduct(resolved.packageQuantity, resolved.baseQuantityPerPack);
  return resolved;
}

function openingStockValue(openingStock: StockInput["openingStock"], reference: ReturnType<typeof referencePurchaseFromInputs>, legacyQuantity: Prisma.Decimal, legacyValue: number) {
  if (!openingStock) {
    assertStockQuantity(legacyQuantity);
    return { quantity: legacyQuantity, valueAmount: legacyValue };
  }
  let quantity: Prisma.Decimal;
  if (openingStock.method === "TOTAL_QUANTITY") quantity = decimal(openingStock.totalQuantity);
  else {
    if (!reference && openingStock.packageCount > 0) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Configure a purchase package before entering a package count.");
    const packageBaseQuantity = reference ? exactStockProduct(reference.packageQuantity, reference.baseQuantityPerPack) : decimal(0);
    const totalMicros = decimalMicros(packageBaseQuantity) * BigInt(openingStock.packageCount) + decimalMicros(decimal(openingStock.looseQuantity));
    quantity = decimalFromMicros(totalMicros);
  }
  assertStockQuantity(quantity);
  if (!reference) {
    if (!quantity.isZero()) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Configure a purchase package and price before valuing a positive opening balance.");
    return { quantity, valueAmount: 0 };
  }
  const packageBaseQuantity = exactStockProduct(reference.packageQuantity, reference.baseQuantityPerPack);
  if (packageBaseQuantity.isZero()) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The converted package quantity must fit the six-decimal stock precision.");
  return { quantity, valueAmount: exactOpeningValue(quantity, reference.priceAmount, packageBaseQuantity) };
}

export async function createStockItem(prisma: PrismaClient, actor: AuthenticatedUser, input: StockInput, requestId: string) {
  assertConversionLabels(input.baseUnit, input.conversions);
  const ids = input.conversions.map(({ label }) => label.toLocaleLowerCase());
  if (new Set(ids).size !== ids.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Conversion labels must be unique for a stock item.");
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.stockItem.findFirst({ where: { name: input.name, isActive: true, archivedAt: null }, select: { id: true } });
    if (duplicate) fail(409, ErrorCodes.CONFLICT, "An active stock item with this name already exists.");
    const occurredAt = new Date();
    const referenceInput = referencePurchaseFromInputs(input.baseUnit, input.referencePurchase, input.conversions);
    const opening = openingStockValue(input.openingStock, referenceInput, decimal(input.openingQuantity ?? "0"), input.openingValueAmount ?? 0);
    const openingQuantity = opening.quantity;
    const row = await tx.stockItem.create({ data: { name: input.name, category: input.category, baseUnit: input.baseUnit, isPackagingMaterial: input.isPackagingMaterial, lowStockThreshold: input.lowStockThreshold == null ? null : decimal(input.lowStockThreshold), createdById: actor.id, conversions: { create: input.conversions.map((conversion) => ({ label: conversion.label, baseQuantityPerPack: decimal(conversion.baseQuantityPerPack), isActive: conversion.isActive })) }, balance: { create: { quantityOnHand: openingQuantity, carryingValueAmount: opening.valueAmount, trackingStartedAt: occurredAt } } }, include: { conversions: true, balance: true } });
    if (input.referencePurchase) {
      const conversion = referenceInput?.conversionLabel === input.baseUnit ? null : row.conversions.find((candidate) => candidate.label === referenceInput?.conversionLabel);
      if (referenceInput?.conversionId !== null && !conversion) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The reference purchase conversion could not be saved.");
      await tx.stockItem.update({ where: { id: row.id }, data: { referencePurchaseQuantity: referenceInput!.packageQuantity, referencePurchasePriceAmount: referenceInput!.priceAmount, referencePurchaseUnitLabel: referenceInput!.conversionLabel, referencePurchaseConversionId: conversion?.id ?? null } });
    }
    const openingCount = await tx.inventoryCount.create({ data: { kind: InventoryCountKind.OPENING, status: InventoryCountStatus.POSTED, createdById: actor.id, createdAt: occurredAt, postedAt: occurredAt, lines: { create: { stockItemId: row.id, observedQuantity: openingQuantity, observedValueAmount: opening.valueAmount } } }, include: { lines: true } });
    const openingLine = openingCount.lines[0]!;
    if (!openingQuantity.isZero() || opening.valueAmount !== 0) await tx.inventoryMovement.create({ data: { stockItemId: row.id, kind: InventoryMovementKind.OPENING_COUNT, quantityDelta: openingQuantity, valueDeltaAmount: opening.valueAmount, inventoryCountLineId: openingLine.id, createdById: actor.id, occurredAt } });
    await audit(tx, actor.id, requestId, "CREATE_STOCK_ITEM", "STOCK_ITEM", row.id, undefined, { name: row.name, baseUnit: row.baseUnit, isPackagingMaterial: row.isPackagingMaterial, lowStockThreshold: row.lowStockThreshold?.toFixed(6) ?? null, referencePurchase: input.referencePurchase ?? null, openingQuantity: dstr(openingQuantity), openingValueAmount: opening.valueAmount, openingCountId: openingCount.id });
    const completeRow = await tx.stockItem.findUniqueOrThrow({ where: { id: row.id }, include: { conversions: true, referencePurchaseConversion: true, balance: true } });
    return dtoStock(completeRow);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function updateStockItem(prisma: PrismaClient, actor: AuthenticatedUser, id: string, input: StockUpdate, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const hasOpening = input.openingStock !== undefined || input.openingQuantity !== undefined;
    if (hasOpening) await lock(tx, [`inventory:${id}`]);
    const current = await tx.stockItem.findUnique({ where: { id }, include: { conversions: true, referencePurchaseConversion: true, balance: true } });
    if (!current) fail(404, ErrorCodes.NOT_FOUND, "The stock item was not found.");
    if (current.archivedAt) fail(409, ErrorCodes.INVALID_STATE, "An archived stock item cannot be edited.");
    if (current.version !== input.expectedVersion) stale("The stock item has changed.", current.version);
    if (input.baseUnit && input.baseUnit !== current.baseUnit) {
      const referenced = current.balance?.trackingStartedAt || current.conversions.length > 0 || current.referencePurchaseUnitLabel !== null
        || await tx.inventoryMovement.count({ where: { stockItemId: id } }) > 0
        || await tx.recipeComponent.count({ where: { stockItemId: id } }) > 0
        || await tx.purchaseLine.count({ where: { stockItemId: id } }) > 0;
      if (referenced) fail(409, ErrorCodes.INVALID_STATE, "A stock item's base unit cannot change after it has conversions or is referenced by costing or inventory history.");
    }
    const conversions = input.conversions;
    if (conversions) assertConversionLabels(input.baseUnit ?? current.baseUnit, conversions, current.conversions);
    if (conversions && new Set(conversions.map((conversion) => conversion.label.toLocaleLowerCase())).size !== conversions.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Conversion labels must be unique for a stock item.");
    const updated = await tx.stockItem.updateMany({ where: { id, version: input.expectedVersion }, data: { ...(input.lowStockThreshold === undefined ? {} : { lowStockThreshold: input.lowStockThreshold === null ? null : decimal(input.lowStockThreshold) }), ...(input.isPackagingMaterial === undefined ? {} : { isPackagingMaterial: input.isPackagingMaterial }), ...(input.name === undefined ? {} : { name: input.name }), ...(input.category === undefined ? {} : { category: input.category }), ...(input.baseUnit === undefined ? {} : { baseUnit: input.baseUnit }), version: { increment: 1 } } });
    if (updated.count !== 1) fail(409, ErrorCodes.STALE_VERSION, "The stock item has changed.");
    if (conversions) {
      const retained = new Set(conversions.flatMap((conversion) => conversion.id ? [conversion.id] : []));
      await tx.stockUnitConversion.updateMany({ where: { stockItemId: id, id: { notIn: [...retained] } }, data: { isActive: false } });
      for (const conversion of conversions) {
        if (conversion.id) {
          const owned = current.conversions.some((candidate) => candidate.id === conversion.id);
          if (!owned) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A conversion does not belong to this stock item.");
          await tx.stockUnitConversion.update({ where: { id: conversion.id }, data: { label: conversion.label, baseQuantityPerPack: decimal(conversion.baseQuantityPerPack), isActive: conversion.isActive } });
        } else await tx.stockUnitConversion.create({ data: { stockItemId: id, label: conversion.label, baseQuantityPerPack: decimal(conversion.baseQuantityPerPack), isActive: conversion.isActive } });
      }
    }
    let row = await tx.stockItem.findUniqueOrThrow({ where: { id }, include: { conversions: true, referencePurchaseConversion: true, balance: true } });
    let reference = row.referencePurchaseUnitLabel != null && row.referencePurchaseQuantity != null && row.referencePurchasePriceAmount != null
      ? { conversionId: row.referencePurchaseConversionId, conversionLabel: row.referencePurchaseUnitLabel, packageQuantity: row.referencePurchaseQuantity, baseQuantityPerPack: row.referencePurchaseConversion?.baseQuantityPerPack ?? decimal(1), priceAmount: row.referencePurchasePriceAmount }
      : null;
    if (input.referencePurchase === null) {
      await tx.stockItem.update({ where: { id }, data: { referencePurchaseQuantity: null, referencePurchasePriceAmount: null, referencePurchaseUnitLabel: null, referencePurchaseConversionId: null } });
      reference = null;
    } else if (input.referencePurchase !== undefined) {
      reference = await resolveReferencePurchase(tx, id, input.baseUnit ?? current.baseUnit, input.referencePurchase);
      await tx.stockItem.update({ where: { id }, data: { referencePurchaseQuantity: reference!.packageQuantity, referencePurchasePriceAmount: reference!.priceAmount, referencePurchaseUnitLabel: reference!.conversionLabel, referencePurchaseConversionId: reference!.conversionId } });
    } else if (input.conversions !== undefined && row.referencePurchaseConversionId) {
      const conversion = row.referencePurchaseConversion;
      if (!conversion?.isActive) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Keep the configured purchase package unit active or choose a replacement unit.");
      exactStockProduct(reference!.packageQuantity, conversion.baseQuantityPerPack);
      if (conversion.label !== row.referencePurchaseUnitLabel) {
        await tx.stockItem.update({ where: { id }, data: { referencePurchaseUnitLabel: conversion.label } });
        reference = { ...reference!, conversionLabel: conversion.label, baseQuantityPerPack: conversion.baseQuantityPerPack };
      } else reference = { ...reference!, baseQuantityPerPack: conversion.baseQuantityPerPack };
    }
    if (hasOpening) {
      if (row.balance?.trackingStartedAt) fail(409, ErrorCodes.INVALID_STATE, "An opening balance can only be set once, before inventory tracking starts.");
      const priorMovements = await tx.inventoryMovement.count({ where: { stockItemId: id } });
      if (priorMovements > 0) fail(409, ErrorCodes.INVALID_STATE, "An item with inventory history cannot receive another opening balance.");
      const occurredAt = new Date();
      const opening = openingStockValue(input.openingStock, reference, decimal(input.openingQuantity ?? "0"), input.openingValueAmount ?? 0);
      await tx.inventoryBalance.upsert({ where: { stockItemId: id }, create: { stockItemId: id, quantityOnHand: opening.quantity, carryingValueAmount: opening.valueAmount, trackingStartedAt: occurredAt }, update: { quantityOnHand: opening.quantity, carryingValueAmount: opening.valueAmount, trackingStartedAt: occurredAt } });
      const openingCount = await tx.inventoryCount.create({ data: { kind: InventoryCountKind.OPENING, status: InventoryCountStatus.POSTED, createdById: actor.id, createdAt: occurredAt, postedAt: occurredAt, lines: { create: { stockItemId: id, observedQuantity: opening.quantity, observedValueAmount: opening.valueAmount } } }, include: { lines: true } });
      if (!opening.quantity.isZero() || opening.valueAmount !== 0) await tx.inventoryMovement.create({ data: { stockItemId: id, kind: InventoryMovementKind.OPENING_COUNT, quantityDelta: opening.quantity, valueDeltaAmount: opening.valueAmount, inventoryCountLineId: openingCount.lines[0]!.id, createdById: actor.id, occurredAt } });
    }
    row = await tx.stockItem.findUniqueOrThrow({ where: { id }, include: { conversions: true, referencePurchaseConversion: true, balance: true } });
    await audit(tx, actor.id, requestId, "UPDATE_STOCK_ITEM", "STOCK_ITEM", id, { version: current.version, lowStockThreshold: current.lowStockThreshold?.toFixed(6) ?? null, isPackagingMaterial: current.isPackagingMaterial, referencePurchase: dtoStock(current).referencePurchase }, { version: row.version, lowStockThreshold: row.lowStockThreshold?.toFixed(6) ?? null, isPackagingMaterial: row.isPackagingMaterial, referencePurchase: dtoStock(row).referencePurchase, ...(hasOpening ? { openingQuantity: dtoStock(row).balance.quantityOnHand, openingValueAmount: dtoStock(row).balance.carryingValueAmount } : {}) });
    return dtoStock(row);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function archiveStockItem(prisma: PrismaClient, actor: AuthenticatedUser, id: string, expectedVersion: number, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.stockItem.findUnique({ where: { id }, select: { id: true, name: true, archivedAt: true, version: true } });
    if (!current) fail(404, ErrorCodes.NOT_FOUND, "The stock item was not found.");
    if (current.version !== expectedVersion) stale("The stock item has changed.", current.version);
    if (current.archivedAt) fail(409, ErrorCodes.INVALID_STATE, "The stock item is already archived.");
    const result = await tx.stockItem.updateMany({ where: { id, version: expectedVersion, archivedAt: null }, data: { name: `__archived_stock_${id}`, archivedName: current.name, isActive: false, archivedAt: new Date(), version: { increment: 1 } } });
    if (result.count !== 1) {
      const exists = await tx.stockItem.findUnique({ where: { id }, select: { id: true } });
      if (!exists) fail(404, ErrorCodes.NOT_FOUND, "The stock item was not found.");
      fail(409, ErrorCodes.STALE_VERSION, "The stock item has changed.");
    }
    const row = await tx.stockItem.findUniqueOrThrow({ where: { id }, include: { conversions: true, referencePurchaseConversion: true, balance: true } });
    await audit(tx, actor.id, requestId, "ARCHIVE_STOCK_ITEM", "STOCK_ITEM", id, undefined, { version: row.version });
    return dtoStock(row);
  });
}

function purchaseDto(row: any) {
  return { id: row.id, status: row.status, receivedAt: row.receivedAt.toISOString(), supplier: row.supplier, version: row.version, postedAt: row.postedAt?.toISOString() ?? null,
    lines: row.lines.map((line: any) => ({ id: line.id, stockItemId: line.stockItemId, conversionId: line.conversionId, purchaseUnitLabel: line.purchaseUnitLabel, purchaseQuantity: dstr(line.purchaseQuantity), directCostAmount: line.directCostAmount, baseQuantityPerPack: dstr(line.baseQuantityPerPack), baseQuantityReceived: dstr(line.baseQuantityReceived) })) };
}
async function preparePurchaseLines(tx: Tx, lines: PurchaseInput["lines"], savedLines: Array<{
  id: string;
  stockItemId: string;
  conversionId: string | null;
  purchaseUnitLabel: string;
  purchaseQuantity: Prisma.Decimal;
  baseQuantityPerPack: Prisma.Decimal;
  baseQuantityReceived: Prisma.Decimal;
}> = []) {
  const prepared: any[] = [];
  const reusedSnapshots = new Set<number>();
  const allowLegacySnapshotInference = lines.every((line) => !line.id && line.useCurrentConversion === undefined);
  for (const line of lines) {
    let snapshotIndex = -1;
    if (line.id) {
      snapshotIndex = savedLines.findIndex((saved) => saved.id === line.id);
      if (snapshotIndex < 0 || reusedSnapshots.has(snapshotIndex)) {
        throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A purchase line does not belong to this draft or is repeated.", [{ path: "lines." + prepared.length + ".id", code: "invalid_purchase_line", message: "Use a unique line ID from this draft." }]);
      }
      reusedSnapshots.add(snapshotIndex);
    } else if (allowLegacySnapshotInference) {
      const candidates = savedLines.flatMap((saved, index) => !reusedSnapshots.has(index)
        && saved.stockItemId === line.stockItemId
        && saved.conversionId === line.conversionId
        && saved.purchaseUnitLabel === line.purchaseUnitLabel
        && saved.purchaseQuantity.eq(line.purchaseQuantity) ? [index] : []);
      const candidatesShareFactor = candidates.length > 1
        && candidates.every((index) => savedLines[index]!.baseQuantityPerPack.eq(savedLines[candidates[0]!]!.baseQuantityPerPack));
      if (candidates.length > 1 && !candidatesShareFactor) {
        throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A purchase draft with repeated equivalent lines must identify each line when it is edited.", [{ path: "lines." + prepared.length + ".id", code: "ambiguous_purchase_line", message: "Include each saved purchase line ID." }]);
      }
      if (candidates.length >= 1) {
        snapshotIndex = candidates[0]!;
        reusedSnapshots.add(snapshotIndex);
      }
    }
    if (snapshotIndex >= 0) {
      const saved = savedLines[snapshotIndex]!;
      const sameUnit = saved.stockItemId === line.stockItemId && saved.conversionId === line.conversionId && saved.purchaseUnitLabel === line.purchaseUnitLabel;
      const baseQuantityReceived = !line.useCurrentConversion && sameUnit
        ? stockProductOrNull(decimal(line.purchaseQuantity), saved.baseQuantityPerPack)
        : null;
      if (line.useCurrentConversion || !sameUnit) {
        snapshotIndex = -1;
      } else if (!baseQuantityReceived) {
        throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The converted purchase quantity must fit the supported range and be exact to six decimal places.", [{ path: "lines." + prepared.length + ".purchaseQuantity", code: "quantity_precision", message: "Use a quantity whose package conversion is exact to six decimal places." }]);
      }
      if (snapshotIndex >= 0) {
        prepared.push({
          stockItemId: line.stockItemId,
          conversionId: line.conversionId,
          purchaseUnitLabel: line.purchaseUnitLabel,
          purchaseQuantity: decimal(line.purchaseQuantity),
          baseQuantityPerPack: saved.baseQuantityPerPack,
          baseQuantityReceived: baseQuantityReceived!,
          directCostAmount: line.directCostAmount,
        });
        continue;
      }
    }
    const lineFail: (field: string, message: string) => never = (field, message) => { throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, message, [{ path: `lines.${prepared.length}.${field}`, code: "unavailable_reference", message }]); };
    const stock = await tx.stockItem.findFirst({ where: { id: line.stockItemId, isActive: true, archivedAt: null }, include: { conversions: { where: { isActive: true } } } });
    if (!stock) lineFail("stockItemId", "Every purchase line must reference an active stock item.");
    let pack: Prisma.Decimal;
    if (line.conversionId === null) {
      if (line.purchaseUnitLabel !== stock.baseUnit) lineFail("purchaseUnitLabel", "A base-unit purchase must use the stock item's base-unit label.");
      pack = decimal(1);
    } else {
      const conversion = stock.conversions.find((candidate) => candidate.id === line.conversionId);
      if (!conversion) lineFail("conversionId", "The purchase conversion is unavailable for this stock item.");
      if (line.purchaseUnitLabel !== conversion.label) lineFail("purchaseUnitLabel", "The purchase unit label must match the selected conversion.");
      pack = conversion.baseQuantityPerPack;
    }
    const baseQuantityReceived = stockProductOrNull(decimal(line.purchaseQuantity), pack);
    if (!baseQuantityReceived) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The converted purchase quantity must fit the supported range and be exact to six decimal places.", [{ path: "lines." + prepared.length + ".purchaseQuantity", code: "quantity_precision", message: "Use a quantity whose package conversion is exact to six decimal places." }]);
    if (baseQuantityReceived.decimalPlaces() > 6 || baseQuantityReceived.gte("100000000000000")) {
      throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The converted purchase quantity must fit the supported range and be exact to six decimal places.", [{ path: `lines.${prepared.length}.purchaseQuantity`, code: "quantity_precision", message: "Use a quantity whose package conversion is exact to six decimal places." }]);
    }
    prepared.push({ stockItemId: stock.id, conversionId: line.conversionId, purchaseUnitLabel: line.purchaseUnitLabel, purchaseQuantity: decimal(line.purchaseQuantity), baseQuantityPerPack: pack, baseQuantityReceived, directCostAmount: line.directCostAmount });
  }
  return prepared;
}
export async function listPurchases(prisma: PrismaClient, query: PurchaseListQuery) {
  const cursor = decodePageCursor(query.cursor);
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to ? { receivedAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    ...(query.search ? { OR: [{ supplier: { contains: query.search, mode: "insensitive" as const } }, { lines: { some: { stockItem: { name: { contains: query.search, mode: "insensitive" as const } } } } }] } : {}),
    ...(cursor ? { AND: [{ OR: [{ receivedAt: { lt: cursor.at } }, { receivedAt: cursor.at, id: { lt: cursor.id } }] }] } : {}),
  };
  const rows = await prisma.purchase.findMany({ where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: query.limit + 1, include: { lines: { orderBy: { createdAt: "asc" } } } });
  const hasMore = rows.length > query.limit; const page = rows.slice(0, query.limit);
  return { purchases: page.map(purchaseDto), page: { limit: query.limit, nextCursor: hasMore ? encodePageCursor({ id: page[page.length - 1]!.id, recordedAt: page[page.length - 1]!.receivedAt }) : null, hasMore } };
}
export async function createPurchase(prisma: PrismaClient, actor: AuthenticatedUser, input: PurchaseInput, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const lines = await preparePurchaseLines(tx, input.lines);
    const row = await tx.purchase.create({ data: { receivedAt: new Date(input.receivedAt), supplier: input.supplier ?? null, createdById: actor.id, lines: { create: lines } }, include: { lines: true } });
    await audit(tx, actor.id, requestId, "CREATE_INVENTORY_PURCHASE", "PURCHASE", row.id, undefined, { lineCount: row.lines.length });
    return purchaseDto(row);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function updatePurchase(prisma: PrismaClient, actor: AuthenticatedUser, id: string, input: PurchaseUpdate, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.purchase.findUnique({ where: { id }, include: { lines: true } });
    if (!current) fail(404, ErrorCodes.NOT_FOUND, "The purchase was not found.");
    if (current.status !== PurchaseStatus.DRAFT) fail(409, ErrorCodes.INVALID_STATE, "Only draft purchases can be edited.");
    if (current.version !== input.expectedVersion) stale("The purchase has changed.", current.version);
    const lines = input.lines ? await preparePurchaseLines(tx, input.lines, current.lines) : undefined;
    const result = await tx.purchase.updateMany({ where: { id, version: input.expectedVersion, status: PurchaseStatus.DRAFT }, data: { ...(input.receivedAt === undefined ? {} : { receivedAt: new Date(input.receivedAt) }), ...(input.supplier === undefined ? {} : { supplier: input.supplier }), version: { increment: 1 } } });
    if (result.count !== 1) fail(409, ErrorCodes.STALE_VERSION, "The purchase has changed.");
    if (lines) { await tx.purchaseLine.deleteMany({ where: { purchaseId: id } }); await tx.purchaseLine.createMany({ data: lines.map((line) => ({ ...line, purchaseId: id })) }); }
    const row = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    await audit(tx, actor.id, requestId, "UPDATE_INVENTORY_PURCHASE", "PURCHASE", id, { version: current.version }, { version: row.version });
    return purchaseDto(row);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

type FlatComponent = { stockItemId: string; stockItemName: string; baseUnit: string; quantity: Prisma.Decimal; isPackagingMaterial: boolean; sourceKey: string; takeawayPackagingQuantity?: Prisma.Decimal };
type EstimatedCostSnapshotEntry = { name: string; amount: number };
type CostSnapshot = { snapshotFormatVersion?: 2; components: Array<{ stockItemId: string; stockItemName: string; baseUnit: string; quantity: string; packagingQuantity: string; takeawayPackagingQuantity?: string; isPackagingMaterial: boolean; knownCostAmount: number | null; packagingKnownCostAmount: number | null; nonPackagingKnownCostAmount: number | null }>; estimatedCostAmount: number; estimatedCosts: EstimatedCostSnapshotEntry[]; isComplete: boolean; missingReasons: string[]; configurationVersion: number | null };

export function hasOnlyMissingPackagingConfiguration(systemKey: string | null, snapshot: unknown) {
  if (systemKey !== "PACKING" || !snapshot || typeof snapshot !== "object") return false;
  const { components, missingReasons } = snapshot as Partial<CostSnapshot>;
  return Array.isArray(components) && components.length === 0
    && Array.isArray(missingReasons) && missingReasons.length === 1
    && typeof missingReasons[0] === "string" && missingReasons[0].startsWith("missing-costing:");
}
async function flattenRecipe(tx: Tx, recipeId: string, amount: Prisma.Decimal, keyPrefix = "", seen = new Set<string>(), missingReasons: string[] = []): Promise<FlatComponent[]> {
  if (seen.has(recipeId)) { missingReasons.push(`recipe-cycle:${recipeId}`); return []; }
  const recipe = await tx.recipe.findUnique({ where: { id: recipeId }, include: { components: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }], include: { stockItem: true } } } });
  if (!recipe || !recipe.isActive || recipe.archivedAt) { missingReasons.push(`missing-recipe:${recipeId}`); return []; }
  const nextSeen = new Set(seen).add(recipeId);
  const ratio = amount.div(recipe.yieldQuantity);
  const result: FlatComponent[] = [];
  for (const component of recipe.components) {
    const path = keyPrefix ? `${keyPrefix}/${component.componentKey}` : component.componentKey;
    const quantity = component.quantity.mul(ratio);
    if (component.sourceKind === "STOCK_ITEM" && component.stockItem?.isActive && !component.stockItem.archivedAt) result.push({ stockItemId: component.stockItem.id, stockItemName: component.stockItem.name, baseUnit: component.stockItem.baseUnit, quantity, isPackagingMaterial: component.stockItem.isPackagingMaterial, sourceKey: path });
    else if (component.nestedRecipeId) result.push(...await flattenRecipe(tx, component.nestedRecipeId, quantity, path, nextSeen, missingReasons));
    else missingReasons.push(`missing-stock:${component.stockItemId}`);
  }
  return result;
}
function ruleDto(row: any) {
  return { action: row.action, componentKey: row.componentKey, ...(row.label === null || row.label === undefined ? {} : { label: row.label }), ...(row.quantity === null || row.quantity === undefined ? {} : { quantity: dstr(row.quantity) }),
    ...(row.action === "REPLACE_COMPONENT" ? { replacement: row.replacementStockItemId ? { sourceKind: "STOCK_ITEM", stockItemId: row.replacementStockItemId } : { sourceKind: "RECIPE", recipeId: row.replacementRecipeId } } : {}),
    ...(row.action === "ADD_COMPONENT" ? { component: row.replacementStockItemId ? { sourceKind: "STOCK_ITEM", stockItemId: row.replacementStockItemId } : { sourceKind: "RECIPE", recipeId: row.replacementRecipeId } } : {}) };
}
function applyCostingRule(components: Array<{ componentKey: string; label: string; sourceKind: "STOCK_ITEM" | "RECIPE"; sourceId: string; quantity: Prisma.Decimal }>, rule: any) {
  const index = components.findIndex((component) => component.componentKey === rule.componentKey);
  if (rule.action === "ADD_COMPONENT") {
    if (index !== -1 || components.some((component) => component.componentKey === rule.componentKey)) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An added component conflicts with an existing component key.");
    components.push({ componentKey: rule.componentKey, label: rule.label, sourceKind: rule.sourceKind, sourceId: rule.sourceId, quantity: decimal(rule.quantity) });
    return;
  }
  if (index < 0) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A costing rule references an unknown recipe component.");
  if (rule.action === "CHANGE_QUANTITY") components[index]!.quantity = decimal(rule.quantity);
  else components[index] = { ...components[index]!, label: rule.label ?? components[index]!.label, sourceKind: rule.sourceKind, sourceId: rule.sourceId, quantity: decimal(rule.quantity) };
}
async function resolveCosting(tx: Tx, productId: string, optionIds: string[], quantity: number, weightGrams: number | null, includeCosts: boolean, channel: "TABLE" | "TAKEAWAY" = "TABLE", orderQuantity = quantity, previousQuantity = 0): Promise<CostSnapshot> {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, name: true, pricingMode: true, systemKey: true } });
  if (!product) return { components: [], estimatedCostAmount: 0, estimatedCosts: [], isComplete: false, missingReasons: ["product-not-found"], configurationVersion: null };
  const config: any = await tx.productCostingConfiguration.findUnique({ where: { productId }, include: { product: { select: { optionRecipeCostings: { include: { recipe: { include: { components: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }] } } } } }, optionCostingRules: { include: { replacementStockItem: true, replacementRecipe: true } }, costingCombinations: { where: { isActive: true }, include: { options: true, rules: { include: { replacementStockItem: true, replacementRecipe: true } } } } } } } });
  if (!config) {
    // Packaging charges need no separate recipe. The menu item mappings
    // account for physical packaging, including when no charge is added.
    const missingReasons = product.systemKey === "PACKING" ? [] : [`missing-costing:${product.name}`];
    return { components: [], estimatedCostAmount: 0, estimatedCosts: [], isComplete: missingReasons.length === 0, missingReasons, configurationVersion: null };
  }
  const usesEstimatedCost = config.useEstimatedCost === true;
  const overrides = channel === "TAKEAWAY" ? config.takeawayOptionRecipes ?? [] : [];
  const overriddenIds = new Set(overrides.map((entry: any) => entry.optionId));
  const optionCostings = [...config.product.optionRecipeCostings.filter((entry: any) => !overriddenIds.has(entry.optionId))];
  for (const entry of overrides) optionCostings.push({ ...entry, recipe: await tx.recipe.findUnique({ where: { id: entry.recipeId }, include: { components: true } }) });
  const baseRecipeId = channel === "TAKEAWAY" && config.takeawayRecipeId ? config.takeawayRecipeId : config.recipeId;
  const sortedOptionIds = [...new Set(optionIds)].sort();
  const selectedOptionRecipes = usesEstimatedCost ? [] : optionCostings.filter((entry: any) => sortedOptionIds.includes(entry.optionId));
  if (selectedOptionRecipes.length > 1) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Select at most one menu option with a complete recipe.");
  const applicable = usesEstimatedCost || selectedOptionRecipes.length ? [] : config.product.costingCombinations.filter((combo: any) => {
    const ids = combo.options.map((entry: any) => entry.optionId).sort();
    return ids.length === sortedOptionIds.length && ids.every((id: string, i: number) => id === sortedOptionIds[i]);
  });
  if (applicable.length > 1) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "More than one costing combination matches the selected options.");
  const unitMultiplier = product.pricingMode === "WEIGHTED_PER_KG"
    ? decimal((weightGrams ?? 0) * quantity).div(1000)
    : decimal(quantity);
  const missingReasons: string[] = [];
  const estimatedCosts: EstimatedCostSnapshotEntry[] = [];
  const root: Array<{ componentKey: string; label: string; sourceKind: "STOCK_ITEM" | "RECIPE"; sourceId: string; quantity: Prisma.Decimal }> = [];
  if (usesEstimatedCost) {
    if (config.estimatedCostAmount === null || config.estimatedCostAmount === undefined) missingReasons.push(`missing-estimated-cost:${product.name}`);
    else estimatedCosts.push({ name: product.name, amount: intMoney(decimal(config.estimatedCostAmount).mul(unitMultiplier)) });
  } else if (selectedOptionRecipes.length) {
    const selected = selectedOptionRecipes[0];
    const recipe = selected.recipe;
    if (recipe && recipe.isActive && !recipe.archivedAt) for (const component of recipe.components) root.push({ componentKey: component.componentKey, label: component.label, sourceKind: component.sourceKind, sourceId: component.stockItemId ?? component.nestedRecipeId!, quantity: component.quantity.mul(decimal(selected.recipeQuantity).mul(unitMultiplier)).div(recipe.yieldQuantity) });
    else missingReasons.push(`missing-recipe:${selected.recipeId}`);
  } else if (config.mode === "RECIPE" || channel === "TAKEAWAY" && config.takeawayRecipeId) {
    const recipe = await tx.recipe.findUnique({ where: { id: baseRecipeId }, include: { components: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }] } } });
    if (recipe && recipe.isActive && !recipe.archivedAt) for (const component of recipe.components) root.push({ componentKey: component.componentKey, label: component.label, sourceKind: component.sourceKind, sourceId: component.stockItemId ?? component.nestedRecipeId!, quantity: component.quantity.mul(decimal(config.recipeQuantity ?? (product.pricingMode === "WEIGHTED_PER_KG" ? "1000" : "1")).mul(unitMultiplier)).div(recipe.yieldQuantity) });
    else missingReasons.push(`missing-recipe:${baseRecipeId}`);
  } else {
    const stock = await tx.stockItem.findFirst({ where: { id: config.purchasedStockItemId, isActive: true, archivedAt: null } });
    const units = product.pricingMode === "WEIGHTED_PER_KG" ? decimal((weightGrams ?? 0) * quantity) : decimal(config.purchasedQuantity ?? 1).mul(quantity);
    if (stock) root.push({ componentKey: "$purchased", label: stock.name, sourceKind: "STOCK_ITEM", sourceId: config.purchasedStockItemId, quantity: units });
    else missingReasons.push(`missing-stock:${config.purchasedStockItemId}`);
  }
  const optionRuleRows = usesEstimatedCost || selectedOptionRecipes.length ? [] : config.product.optionCostingRules.filter((rule: any) => sortedOptionIds.includes(rule.optionId));
  const selectedByKey = new Map<string, any>();
  for (const row of optionRuleRows) {
    if (selectedByKey.has(row.componentKey)) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Selected options have conflicting rules for the same component.");
    selectedByKey.set(row.componentKey, row);
  }
  const combinedRows = applicable[0]?.rules ?? [];
  const combinedByKey = new Map<string, any>();
  for (const row of combinedRows) {
    if (combinedByKey.has(row.componentKey)) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A costing combination has conflicting rules.");
    combinedByKey.set(row.componentKey, row);
  }
  for (const rule of selectedByKey.values()) {
    const sourceKind = rule.replacementStockItemId || rule.action === "ADD_COMPONENT" && rule.replacementStockItemId ? "STOCK_ITEM" : "RECIPE";
    const sourceId = rule.replacementStockItemId ?? rule.replacementRecipeId;
    applyCostingRule(root, { ...rule, sourceKind, sourceId, quantity: decimal(rule.quantity ?? 1).mul(unitMultiplier) });
  }
  for (const rule of combinedByKey.values()) {
    const sourceKind = rule.replacementStockItemId ? "STOCK_ITEM" : "RECIPE";
    const sourceId = rule.replacementStockItemId ?? rule.replacementRecipeId;
    applyCostingRule(root, { ...rule, sourceKind, sourceId, quantity: decimal(rule.quantity ?? 1).mul(unitMultiplier) });
  }
  const flattened: FlatComponent[] = [];
  for (const component of root) {
    if (component.sourceKind === "STOCK_ITEM") {
      const stock = await tx.stockItem.findFirst({ where: { id: component.sourceId, isActive: true, archivedAt: null } });
      if (!stock) { missingReasons.push(`missing-stock:${component.sourceId}`); continue; }
      flattened.push({ stockItemId: stock.id, stockItemName: stock.name, baseUnit: stock.baseUnit, quantity: component.quantity, isPackagingMaterial: stock.isPackagingMaterial, sourceKey: component.componentKey });
    } else flattened.push(...await flattenRecipe(tx, component.sourceId, component.quantity, component.componentKey, new Set(), missingReasons));
  }
  if (!usesEstimatedCost && config.extrasRecipeId && selectedOptionRecipes.length === 0) flattened.push(...await flattenRecipe(tx, config.extrasRecipeId, unitMultiplier, "", new Set(), missingReasons));
  for (const [index, entry] of ((config.servedAlongside ?? []) as NonNullable<CostingInput["servedAlongside"]>).entries()) {
    if (entry.sourceKind === "ESTIMATED_COST") {
      if (!entry.name.trim() || !Number.isSafeInteger(entry.estimatedCostAmount) || entry.estimatedCostAmount < 0) {
        missingReasons.push(`missing-estimated-cost:${index + 1}`);
        continue;
      }
      estimatedCosts.push({ name: entry.name, amount: intMoney(decimal(entry.estimatedCostAmount).mul(quantity)) });
      continue;
    }
    const amount = decimal(entry.quantity).mul(quantity);
    if (entry.sourceKind === "STOCK_ITEM") {
      const stock = await tx.stockItem.findFirst({ where: { id: entry.stockItemId, isActive: true, archivedAt: null } });
      if (!stock) { missingReasons.push(`missing-stock:${entry.stockItemId}`); continue; }
      flattened.push({ stockItemId: stock.id, stockItemName: stock.name, baseUnit: stock.baseUnit, quantity: amount, isPackagingMaterial: stock.isPackagingMaterial, sourceKey: `$served-alongside:${index}` });
    } else {
      flattened.push(...await flattenRecipe(tx, entry.recipeId, amount, `$served-alongside:${index}`, new Set(), missingReasons));
    }
  }
  if (channel === "TAKEAWAY") for (const packing of (config.takeawayPackaging ?? []) as NonNullable<CostingInput["takeawayPackaging"]>) {
    if (orderQuantity < (packing.minQuantity ?? 1) || orderQuantity > (packing.maxQuantity ?? Infinity)) continue;
    const multiplier = packing.mode === "PER_GROUP"
      ? Math.floor((previousQuantity + quantity) / packing.groupSize!) - Math.floor(previousQuantity / packing.groupSize!)
      : packing.mode === "PER_ORDER" ? (previousQuantity === 0 ? 1 : 0) : quantity;
    if (!multiplier) continue;
    const stock = await tx.stockItem.findFirst({ where: { id: packing.stockItemId, isActive: true, archivedAt: null } });
    if (!stock) { missingReasons.push(`missing-takeaway-packaging:${packing.stockItemId}`); continue; }
    flattened.push({ stockItemId: stock.id, stockItemName: stock.name, baseUnit: stock.baseUnit,
      quantity: decimal(packing.quantity).mul(multiplier), isPackagingMaterial: true, sourceKey: `$packaging:${stock.id}`, takeawayPackagingQuantity: decimal(packing.quantity).mul(multiplier) });
  }
  const merged = new Map<string, { stockItemId: string; stockItemName: string; baseUnit: string; quantity: Prisma.Decimal; packagingQuantity: Prisma.Decimal; takeawayPackagingQuantity: Prisma.Decimal }>();
  for (const component of flattened) {
    const key = `${component.stockItemId}:${component.baseUnit}`;
    const old = merged.get(key);
    if (old) {
      old.quantity = old.quantity.plus(component.quantity);
      if (component.isPackagingMaterial) old.packagingQuantity = old.packagingQuantity.plus(component.quantity);
      if (component.takeawayPackagingQuantity?.gt(0)) old.takeawayPackagingQuantity = old.takeawayPackagingQuantity.plus(component.takeawayPackagingQuantity);
    } else merged.set(key, { stockItemId: component.stockItemId, stockItemName: component.stockItemName, baseUnit: component.baseUnit, quantity: component.quantity, packagingQuantity: component.isPackagingMaterial ? component.quantity : decimal(0), takeawayPackagingQuantity: component.takeawayPackagingQuantity ?? decimal(0) });
  }
  const resolved = [];
  for (const component of merged.values()) {
    const balance = includeCosts ? await tx.inventoryBalance.findUnique({ where: { stockItemId: component.stockItemId } }) : null;
    const tracked = !!balance?.trackingStartedAt;
    const knownCostAmount = tracked ? intMoney(component.quantity.mul(balance!.quantityOnHand.gt(0) ? decimal(balance!.carryingValueAmount).div(balance!.quantityOnHand) : decimal(0))) : null;
    const packagingKnownCostAmount = tracked ? intMoney(component.packagingQuantity.mul(balance!.quantityOnHand.gt(0) ? decimal(balance!.carryingValueAmount).div(balance!.quantityOnHand) : decimal(0))) : null;
    if (!tracked && includeCosts) missingReasons.push(`missing-valuation:${component.stockItemId}`);
    resolved.push({ stockItemId: component.stockItemId, stockItemName: component.stockItemName, baseUnit: component.baseUnit, quantity: dstr(component.quantity), packagingQuantity: dstr(component.packagingQuantity), takeawayPackagingQuantity: dstr(component.takeawayPackagingQuantity), isPackagingMaterial: component.quantity.gt(0) && component.packagingQuantity.eq(component.quantity), knownCostAmount, packagingKnownCostAmount, nonPackagingKnownCostAmount: knownCostAmount === null || packagingKnownCostAmount === null ? null : knownCostAmount - packagingKnownCostAmount });
  }
  const estimatedCostAmount = checkedCogsAmount(estimatedCosts.reduce((sum, entry) => sum + entry.amount, 0));
  return { components: resolved, estimatedCostAmount, estimatedCosts, isComplete: missingReasons.length === 0 && resolved.every((component) => component.knownCostAmount !== null), missingReasons: [...new Set(missingReasons)], configurationVersion: config.version };
}

function serializeRules(rules: any[]) { return rules.map(ruleDto); }
function ruleFields(rule: any) {
  const component = rule.replacement ?? rule.component;
  return { action: rule.action, componentKey: rule.componentKey, label: rule.label ?? null, quantity: rule.quantity ? decimal(rule.quantity) : null, replacementStockItemId: component?.sourceKind === "STOCK_ITEM" ? component.stockItemId : null, replacementRecipeId: component?.sourceKind === "RECIPE" ? component.recipeId : null };
}
async function validateCostingInput(tx: Tx, productId: string, input: CostingInput) {
  const retainedConfiguration = input.servedAlongside === undefined
    ? await tx.productCostingConfiguration.findUnique({ where: { productId }, select: { servedAlongside: true } })
    : null;
  const effectiveServedAlongside = input.servedAlongside ?? (retainedConfiguration?.servedAlongside as unknown as CostingInput["servedAlongside"] | undefined) ?? [];
  const sideEstimatedCostAmount = effectiveServedAlongside.reduce((sum, entry) => sum + (entry.sourceKind === "ESTIMATED_COST" ? entry.estimatedCostAmount : 0), 0);
  checkedCogsAmount(sideEstimatedCostAmount + (input.useEstimatedCost ? input.estimatedCostAmount ?? 0 : 0));
  for (const entry of input.servedAlongside ?? []) {
    if (entry.sourceKind === "ESTIMATED_COST") continue;
    if (entry.sourceKind === "STOCK_ITEM" && !await tx.stockItem.findFirst({ where: { id: entry.stockItemId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A served-alongside item must reference an active stock item.");
    if (entry.sourceKind === "RECIPE" && !await tx.recipe.findFirst({ where: { id: entry.recipeId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A served-alongside item must reference an active recipe.");
  }
  for (const packing of input.takeawayPackaging ?? []) {
    if (!await tx.stockItem.findFirst({ where: { id: packing.stockItemId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active packaging stock item is required.");
  }
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, pricingMode: true, productOptionGroups: { select: { allowedOptions: { select: { optionId: true } } } } } });
  if (!product) fail(404, ErrorCodes.NOT_FOUND, "The product was not found.");
  const allowed = new Set(product.productOptionGroups.flatMap((group: any) => group.allowedOptions.map((option: any) => option.optionId)));
  const allOptions = input.useEstimatedCost ? [] : [
    ...(input.takeawayOptionRecipes ?? []).map((entry) => entry.optionId),
    ...input.optionRules.map((entry) => entry.optionId),
    ...(input.mode === "RECIPE" ? (input.optionRecipes ?? []).map((entry) => entry.optionId) : []),
    ...input.combinations.flatMap((entry) => entry.optionIds),
  ];
  if (input.mode === "RECIPE" && new Set((input.optionRecipes ?? []).map((entry) => entry.optionId)).size !== (input.optionRecipes ?? []).length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Each option can have only one complete recipe.");
  if (new Set(input.optionRules.map((entry) => entry.optionId)).size !== input.optionRules.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Each option can have only one costing-rule group.");
  for (const entry of input.optionRules) if (new Set(entry.rules.map((rule) => rule.componentKey)).size !== entry.rules.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An option cannot define multiple rules for the same component.");
  if (new Set(input.combinations.map((entry) => entry.name.toLocaleLowerCase())).size !== input.combinations.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Costing combination names must be unique.");
  const combinationKeys = input.combinations.map((entry) => [...entry.optionIds].sort().join("|"));
  if (new Set(combinationKeys).size !== combinationKeys.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Only one costing override can use a particular option combination.");
  for (const combination of input.combinations) if (new Set(combination.rules.map((rule) => rule.componentKey)).size !== combination.rules.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A costing combination cannot define multiple rules for the same component.");
  if (allOptions.some((id) => !allowed.has(id))) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Every costing option must belong to this product.");
  if (!input.useEstimatedCost && input.mode === "RECIPE") {
    const recipeId = input.recipeId;
    if (!recipeId || input.recipeQuantity === undefined) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active recipe and quantity are required.");
    const recipe = await tx.recipe.findFirst({ where: { id: recipeId, isActive: true, archivedAt: null } });
    if (!recipe) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active recipe is required.");
    if (product.pricingMode === "WEIGHTED_PER_KG" && recipe.outputUnit !== "GRAM") fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Weighted products require a recipe measured in grams.");
    for (const entry of input.optionRecipes ?? []) {
      const optionRecipe = await tx.recipe.findFirst({ where: { id: entry.recipeId, isActive: true, archivedAt: null } });
      if (!optionRecipe) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active recipe is required for each configured option.");
      if (product.pricingMode === "WEIGHTED_PER_KG" && optionRecipe.outputUnit !== "GRAM") fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Weighted products require option recipes measured in grams.");
    }
  } else if (!input.useEstimatedCost && input.mode === "PURCHASED_ITEM") {
    const stockItemId = input.purchasedStockItemId;
    if (!stockItemId) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active purchased stock item is required.");
    const stock = await tx.stockItem.findFirst({ where: { id: stockItemId, isActive: true, archivedAt: null } });
    if (!stock) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active purchased stock item is required.");
    if (product.pricingMode === "WEIGHTED_PER_KG" && stock.baseUnit !== "GRAM") fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Weighted products require purchased stock measured in grams.");
  }
  if (new Set((input.takeawayOptionRecipes ?? []).map((entry) => entry.optionId)).size !== (input.takeawayOptionRecipes ?? []).length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Each takeaway option can have only one recipe.");
  for (const recipeId of (input.useEstimatedCost ? [] : [input.takeawayRecipeId, ...(input.takeawayOptionRecipes ?? []).map((entry) => entry.recipeId)]).filter((id): id is string => !!id)) {
    const recipe = await tx.recipe.findFirst({ where: { id: recipeId, isActive: true, archivedAt: null } });
    if (!recipe) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active takeaway recipe is required.");
    if (recipe.outputUnit !== (product.pricingMode === "WEIGHTED_PER_KG" ? "GRAM" : "PIECE")) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Takeaway recipe units must match the product's selling unit.");
  }
  const ruleInputs = input.useEstimatedCost ? [] : [...input.optionRules.flatMap((entry) => entry.rules), ...input.combinations.flatMap((entry) => entry.rules)];
  for (const rule of ruleInputs) {
    if (rule.action !== "ADD_COMPONENT" && input.mode === "RECIPE") {
      const recipe = await tx.recipe.findUnique({ where: { id: input.recipeId! }, include: { components: { select: { componentKey: true } } } });
      if (!recipe?.components.some((component) => component.componentKey === rule.componentKey)) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A costing rule references an unknown base recipe component.");
    }
    const component = rule.action === "ADD_COMPONENT" ? rule.component : rule.action === "REPLACE_COMPONENT" ? rule.replacement : null;
    if (component?.sourceKind === "STOCK_ITEM" && !await tx.stockItem.findFirst({ where: { id: component.stockItemId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A costing rule references an unavailable stock item.");
    if (component?.sourceKind === "RECIPE" && !await tx.recipe.findFirst({ where: { id: component.recipeId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A costing rule references an unavailable recipe.");
  }
  if (!input.useEstimatedCost && input.extrasRecipeId && !await tx.recipe.findFirst({ where: { id: input.extrasRecipeId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active extras recipe is required.");
  for (const combination of input.combinations) if (new Set(combination.optionIds).size !== combination.optionIds.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Combination option IDs must be unique.");
}
function configurationDto(row: any) {
  if (!row) return null;
  const common = { takeawayRecipeId: row.takeawayRecipeId ?? null, takeawayOptionRecipes: row.takeawayOptionRecipes ?? [], takeawayPackaging: row.takeawayPackaging ?? [], servedAlongside: row.servedAlongside ?? [], productId: row.productId, useEstimatedCost: row.useEstimatedCost ?? false, estimatedCostAmount: row.estimatedCostAmount ?? null, extrasRecipeId: row.extrasRecipeId, optionRecipes: row.product.optionRecipeCostings.map((entry: any) => ({ optionId: entry.optionId, recipeId: entry.recipeId, recipeQuantity: dstr(entry.recipeQuantity) })), optionRules: row.product.optionCostingRules.reduce((result: any[], rule: any) => { let item = result.find((entry) => entry.optionId === rule.optionId); if (!item) { item = { optionId: rule.optionId, rules: [] }; result.push(item); } item.rules.push(ruleDto(rule)); return result; }, []), combinations: row.product.costingCombinations.map((combo: any) => ({ id: combo.id, name: combo.name, optionIds: combo.options.map((option: any) => option.optionId), rules: serializeRules(combo.rules), version: combo.version, isActive: combo.isActive })), version: row.version, updatedAt: row.updatedAt.toISOString() };
  return row.mode === "RECIPE" ? { ...common, mode: row.mode, recipeId: row.recipeId ?? null, recipeQuantity: row.recipeQuantity == null ? null : dstr(row.recipeQuantity) } : { ...common, mode: row.mode, purchasedStockItemId: row.purchasedStockItemId ?? null, purchasedQuantity: row.purchasedQuantity == null ? null : dstr(row.purchasedQuantity) };
}
const configInclude = { product: { select: { optionRecipeCostings: { orderBy: { optionId: "asc" as const } }, optionCostingRules: { include: { replacementStockItem: true, replacementRecipe: true }, orderBy: { componentKey: "asc" as const } }, costingCombinations: { orderBy: { name: "asc" as const }, include: { options: true, rules: { include: { replacementStockItem: true, replacementRecipe: true }, orderBy: { componentKey: "asc" as const } } } } } } };
async function replaceConfiguration(tx: Tx, actor: AuthenticatedUser, productId: string, input: CostingInput, requestId: string, existingVersion: number | null) {
  await validateCostingInput(tx, productId, input);
  const useEstimatedCost = input.useEstimatedCost === true;
  if (existingVersion === null) {
    await tx.productCostingConfiguration.create({ data: { productId, mode: input.mode, useEstimatedCost, estimatedCostAmount: input.estimatedCostAmount ?? null, recipeId: input.mode === "RECIPE" ? input.recipeId ?? null : null, recipeQuantity: input.mode === "RECIPE" && input.recipeQuantity !== undefined ? decimal(input.recipeQuantity) : null, purchasedStockItemId: input.mode === "PURCHASED_ITEM" ? input.purchasedStockItemId ?? null : null, purchasedQuantity: input.mode === "PURCHASED_ITEM" && input.purchasedQuantity !== undefined ? decimal(input.purchasedQuantity) : null, extrasRecipeId: input.extrasRecipeId ?? null, ...(input.servedAlongside !== undefined ? { servedAlongside: input.servedAlongside } : {}), ...(input.takeawayRecipeId !== undefined ? { takeawayRecipeId: input.takeawayRecipeId } : {}), ...(input.takeawayOptionRecipes !== undefined ? { takeawayOptionRecipes: input.takeawayOptionRecipes } : {}), ...(input.takeawayPackaging !== undefined ? { takeawayPackaging: input.takeawayPackaging } : {}), updatedById: actor.id } });
  } else {
    const updateData: Prisma.ProductCostingConfigurationUncheckedUpdateManyInput = {
      useEstimatedCost,
      ...(input.estimatedCostAmount === undefined ? {} : { estimatedCostAmount: input.estimatedCostAmount }),
      ...(input.servedAlongside === undefined ? {} : { servedAlongside: input.servedAlongside }),
      ...(input.takeawayPackaging === undefined ? {} : { takeawayPackaging: input.takeawayPackaging }),
      updatedById: actor.id,
      version: { increment: 1 },
    };
    if (!useEstimatedCost) Object.assign(updateData, {
      mode: input.mode,
      recipeId: input.mode === "RECIPE" ? input.recipeId ?? null : null,
      recipeQuantity: input.mode === "RECIPE" && input.recipeQuantity !== undefined ? decimal(input.recipeQuantity) : null,
      purchasedStockItemId: input.mode === "PURCHASED_ITEM" ? input.purchasedStockItemId ?? null : null,
      purchasedQuantity: input.mode === "PURCHASED_ITEM" && input.purchasedQuantity !== undefined ? decimal(input.purchasedQuantity) : null,
      extrasRecipeId: input.extrasRecipeId ?? null,
      ...(input.takeawayRecipeId === undefined ? {} : { takeawayRecipeId: input.takeawayRecipeId }),
      ...(input.takeawayOptionRecipes === undefined ? {} : { takeawayOptionRecipes: input.takeawayOptionRecipes }),
    });
    const changed = await tx.productCostingConfiguration.updateMany({ where: { productId, version: existingVersion }, data: updateData });
    if (changed.count !== 1) fail(409, ErrorCodes.STALE_VERSION, "The costing configuration has changed.");
    if (!useEstimatedCost) {
      await tx.productOptionCostingRule.deleteMany({ where: { productId } });
      await tx.productOptionRecipeCosting.deleteMany({ where: { productId } });
    }
  }
  if (!useEstimatedCost) {
    const oldCombos = await tx.productCostingCombination.findMany({ where: { productId }, select: { id: true } });
    await tx.productCombinationCostingRule.deleteMany({ where: { combinationId: { in: oldCombos.map((combo) => combo.id) } } });
    await tx.costingCombinationOption.deleteMany({ where: { combinationId: { in: oldCombos.map((combo) => combo.id) } } });
    await tx.productCostingCombination.deleteMany({ where: { productId } });
    for (const combo of input.combinations) await tx.productCostingCombination.create({ data: { productId, name: combo.name, options: { create: combo.optionIds.map((optionId) => ({ optionId })) }, rules: { create: combo.rules.map(ruleFields) } } });
    await tx.productOptionCostingRule.createMany({ data: input.optionRules.flatMap((entry) => entry.rules.map((rule) => ({ productId, optionId: entry.optionId, ...ruleFields(rule) }))) });
    if (input.mode === "RECIPE" && input.optionRecipes?.length) await tx.productOptionRecipeCosting.createMany({ data: input.optionRecipes.map((entry) => ({ productId, optionId: entry.optionId, recipeId: entry.recipeId, recipeQuantity: decimal(entry.recipeQuantity) })) });
  }
  const completeRow = await tx.productCostingConfiguration.findUniqueOrThrow({ where: { productId }, include: configInclude });
  const resolvedPending = await resolvePendingCostingForProduct(tx, productId, actor.id, new Date());
  await audit(tx, actor.id, requestId, existingVersion === null ? "CREATE_PRODUCT_COSTING" : "UPDATE_PRODUCT_COSTING", "PRODUCT_COSTING", productId, { version: existingVersion }, { version: completeRow.version, mode: completeRow.mode, useEstimatedCost: completeRow.useEstimatedCost, estimatedCostAmount: completeRow.estimatedCostAmount, servedAlongside: completeRow.servedAlongside, takeawayPackaging: completeRow.takeawayPackaging, takeawayRecipeId: completeRow.takeawayRecipeId, takeawayOptionRecipes: completeRow.takeawayOptionRecipes, pendingOrderItemsResolved: resolvedPending.orderItemsResolved, pendingOrdersPosted: resolvedPending.ordersPosted });
  return completeRow;
}
export async function getProductCosting(prisma: PrismaClient, productId: string) { return configurationDto(await prisma.productCostingConfiguration.findUnique({ where: { productId }, include: configInclude })); }
export async function setProductCosting(prisma: PrismaClient, actor: AuthenticatedUser, productId: string, input: CostingInput & { expectedVersion: number }, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.productCostingConfiguration.findUnique({ where: { productId }, select: { version: true } });
    if (existing ? existing.version !== input.expectedVersion : input.expectedVersion !== 1) stale("The costing configuration has changed.", existing?.version ?? 1);
    const row = await replaceConfiguration(tx, actor, productId, input, requestId, existing?.version ?? null);
    return configurationDto(row);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function createProductCosting(prisma: PrismaClient, actor: AuthenticatedUser, productId: string, input: CostingInput, requestId: string) {
  return prisma.$transaction(async (tx) => {
    if (await tx.productCostingConfiguration.findUnique({ where: { productId }, select: { id: true } })) fail(409, ErrorCodes.INVALID_STATE, "The product already has a costing configuration; update it with a version check.");
    return configurationDto(await replaceConfiguration(tx, actor, productId, input, requestId, null));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function previewProductCosting(prisma: PrismaClient, productId: string, optionIds: string[], quantity: number, weightGrams: number | null, channel: "TABLE" | "TAKEAWAY" = "TABLE") {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      pricingMode: true,
      productOptionGroups: {
        include: {
          optionGroup: { select: { id: true, isActive: true, archivedAt: true } },
          allowedOptions: { include: { option: { select: { id: true, isActive: true, isAvailable: true, archivedAt: true } } } },
        },
      },
    },
  });
  if (!product) fail(404, ErrorCodes.NOT_FOUND, "The product was not found.");
  if (product.pricingMode === "WEIGHTED_PER_KG" && weightGrams === null) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A weight is required to preview a weighted product's cost.");
  if (new Set(optionIds).size !== optionIds.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Selected option IDs must be unique.");
  const allowed = new Map<string, string>();
  for (const group of product.productOptionGroups) if (group.optionGroup.isActive && !group.optionGroup.archivedAt) for (const link of group.allowedOptions) if (link.option.isActive && link.option.isAvailable && !link.option.archivedAt) allowed.set(link.option.id, group.optionGroup.id);
  if (optionIds.some((id) => !allowed.has(id))) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Every selected option must be active and available for this product.");
  for (const group of product.productOptionGroups) {
    if (!group.optionGroup.isActive || group.optionGroup.archivedAt) continue;
    const selected = optionIds.filter((id) => allowed.get(id) === group.optionGroup.id).length;
    if (selected < group.minSelections || selected > group.maxSelections) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Selected options do not satisfy the product option groups.");
  }
  const snapshot = await resolveCosting(prisma as unknown as Tx, productId, optionIds, quantity, weightGrams, true, channel);
  return { isComplete: snapshot.isComplete, knownCostAmount: checkedCogsAmount(snapshot.estimatedCostAmount + snapshot.components.reduce((sum, component) => sum + (component.knownCostAmount ?? 0), 0)), components: snapshot.components, missingReasons: snapshot.missingReasons };
}

async function assertRecipeGraphAcyclic(tx: Tx, recipeId: string | null, components: RecipeInput["components"]) {
  const graph = new Map<string, string[]>();
  const recipes = await tx.recipe.findMany({ select: { id: true, components: { select: { nestedRecipeId: true } } } });
  for (const recipe of recipes) graph.set(recipe.id, recipes.find((entry) => entry.id === recipe.id)!.components.flatMap((component) => component.nestedRecipeId ? [component.nestedRecipeId] : []));
  graph.set(recipeId ?? "__new__", components.flatMap((component) => component.sourceKind === "RECIPE" ? [component.nestedRecipeId] : []));
  const active = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): boolean => { if (active.has(id)) return true; if (visited.has(id)) return false; active.add(id); for (const next of graph.get(id) ?? []) if (visit(next)) return true; active.delete(id); visited.add(id); return false; };
  for (const id of graph.keys()) if (visit(id)) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Recipe references cannot contain a cycle.");
}
async function recipeDto(prisma: PrismaClient, row: any) {
  const components = await Promise.all(row.components.map(async (component: any) => {
    const source = component.sourceKind === "STOCK_ITEM"
      ? await prisma.stockItem.findUnique({ where: { id: component.stockItemId }, select: { name: true, archivedName: true } })
      : await prisma.recipe.findUnique({ where: { id: component.nestedRecipeId }, select: { name: true, archivedName: true } });
    return { id: component.id, componentKey: component.componentKey, label: source?.archivedName ?? source?.name ?? component.label, sourceKind: component.sourceKind, ...(component.sourceKind === "STOCK_ITEM" ? { stockItemId: component.stockItemId } : { nestedRecipeId: component.nestedRecipeId }), quantity: dstr(component.quantity), displayOrder: component.displayOrder };
  }));
  return { id: row.id, name: row.archivedName ?? row.name, ingredientName: row.ingredientName, outputUnit: row.outputUnit, yieldQuantity: dstr(row.yieldQuantity), version: row.version, isActive: row.isActive, archivedAt: row.archivedAt?.toISOString() ?? null, components, updatedAt: row.updatedAt.toISOString() };
}
async function validateRecipe(tx: Tx, input: RecipeInput) {
  if (new Set(input.components.map((component) => component.componentKey)).size !== input.components.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Recipe component keys must be unique.");
  for (const component of input.components) {
    if (component.sourceKind === "STOCK_ITEM") {
      if (!await tx.stockItem.findFirst({ where: { id: component.stockItemId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A recipe references an unavailable stock item.");
    } else if (!await tx.recipe.findFirst({ where: { id: component.nestedRecipeId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A recipe references an unavailable nested recipe.");
  }
}
export async function listRecipes(prisma: PrismaClient) { return Promise.all((await prisma.recipe.findMany({ orderBy: { name: "asc" }, include: { components: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }] } } })).map((row) => recipeDto(prisma, row))); }
export async function createRecipe(prisma: PrismaClient, actor: AuthenticatedUser, input: RecipeInput, requestId: string) {
  return prisma.$transaction(async (tx) => {
    await validateRecipe(tx, input); await assertRecipeGraphAcyclic(tx, null, input.components);
    const row = await tx.recipe.create({
      data: {
        name: input.name,
        ingredientName: input.ingredientName ?? input.name,
        outputUnit: input.outputUnit,
        yieldQuantity: decimal(input.yieldQuantity),
        components: {
          create: await Promise.all(input.components.map(async (component) => ({
            componentKey: component.componentKey,
            label: component.sourceKind === "STOCK_ITEM"
              ? (await tx.stockItem.findUniqueOrThrow({ where: { id: component.stockItemId }, select: { name: true } })).name
              : (await tx.recipe.findUniqueOrThrow({ where: { id: component.nestedRecipeId }, select: { name: true } })).name,
            sourceKind: component.sourceKind,
            stockItemId: component.sourceKind === "STOCK_ITEM" ? component.stockItemId : null,
            nestedRecipeId: component.sourceKind === "RECIPE" ? component.nestedRecipeId : null,
            quantity: decimal(component.quantity),
            displayOrder: component.displayOrder,
          }))),
        },
      },
      include: { components: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }] } },
    });
    await audit(tx, actor.id, requestId, "CREATE_INVENTORY_RECIPE", "RECIPE", row.id, undefined, { name: row.name, ingredientName: row.ingredientName }); return recipeDto(prisma, row);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function updateRecipe(prisma: PrismaClient, actor: AuthenticatedUser, id: string, input: RecipeUpdate, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.recipe.findUnique({ where: { id }, include: { components: true } });
    if (!current) fail(404, ErrorCodes.NOT_FOUND, "The recipe was not found.");
    if (current.version !== input.expectedVersion) stale("The recipe has changed.", current.version);
    await validateRecipe(tx, input); await assertRecipeGraphAcyclic(tx, id, input.components);
    const changed = await tx.recipe.updateMany({ where: { id, version: input.expectedVersion }, data: { name: input.name, ingredientName: input.ingredientName ?? current.ingredientName, outputUnit: input.outputUnit, yieldQuantity: decimal(input.yieldQuantity), version: { increment: 1 } } });
    if (changed.count !== 1) fail(409, ErrorCodes.STALE_VERSION, "The recipe has changed.");
    await tx.recipeComponent.deleteMany({ where: { recipeId: id } });
    await tx.recipeComponent.createMany({ data: await Promise.all(input.components.map(async (component) => ({ recipeId: id, componentKey: component.componentKey, label: component.sourceKind === "STOCK_ITEM" ? (await tx.stockItem.findUniqueOrThrow({ where: { id: component.stockItemId }, select: { name: true } })).name : (await tx.recipe.findUniqueOrThrow({ where: { id: component.nestedRecipeId }, select: { name: true } })).name, sourceKind: component.sourceKind, stockItemId: component.sourceKind === "STOCK_ITEM" ? component.stockItemId : null, nestedRecipeId: component.sourceKind === "RECIPE" ? component.nestedRecipeId : null, quantity: decimal(component.quantity), displayOrder: component.displayOrder }))) });
    const row = await tx.recipe.findUniqueOrThrow({ where: { id }, include: { components: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }] } } });
    await audit(tx, actor.id, requestId, "UPDATE_INVENTORY_RECIPE", "RECIPE", id, { name: current.name, ingredientName: current.ingredientName, version: current.version }, { name: row.name, ingredientName: row.ingredientName, version: row.version }); return recipeDto(prisma, row);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function archiveRecipe(prisma: PrismaClient, actor: AuthenticatedUser, id: string, expectedVersion: number, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.recipe.findUnique({ where: { id } }); if (!row) fail(404, ErrorCodes.NOT_FOUND, "The recipe was not found.");
    if (row.version !== expectedVersion) stale("The recipe has changed.", row.version);
    const result = await tx.recipe.updateMany({ where: { id, version: expectedVersion, archivedAt: null }, data: { name: `__archived_recipe_${id}`, archivedName: row.name, isActive: false, archivedAt: new Date(), version: { increment: 1 } } });
    if (result.count !== 1) fail(409, ErrorCodes.STALE_VERSION, "The recipe has changed.");
    const updated = await tx.recipe.findUniqueOrThrow({ where: { id }, include: { components: true } });
    await audit(tx, actor.id, requestId, "ARCHIVE_INVENTORY_RECIPE", "RECIPE", id, undefined, { version: updated.version }); return recipeDto(prisma, updated);
  });
}

function countDto(row: any) { return { id: row.id, kind: row.kind, status: row.status, version: row.version, reason: row.reason ?? null, createdAt: row.createdAt.toISOString(), postedAt: row.postedAt?.toISOString() ?? null, lines: row.lines.map((line: any) => ({ stockItemId: line.stockItemId, observedQuantity: dstr(line.observedQuantity), observedValueAmount: line.observedValueAmount, expectedQuantity: line.expectedQuantity === null ? null : dstr(line.expectedQuantity), differenceQuantity: line.differenceQuantity === null ? null : dstr(line.differenceQuantity), expectedValueAmount: line.expectedValueAmount, differenceValueAmount: line.differenceValueAmount })) }; }
async function countInclude(tx: Tx) { return { lines: { orderBy: { stockItemId: "asc" as const } } }; }
export async function listCounts(prisma: PrismaClient, query: InventoryCountListQuery) {
  const cursor = decodePageCursor(query.cursor);
  const where = {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    ...(query.search ? { lines: { some: { stockItem: { name: { contains: query.search, mode: "insensitive" as const } } } } } : {}),
    ...(cursor ? { AND: [{ OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] }] } : {}),
  };
  const rows = await prisma.inventoryCount.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1, include: { lines: { orderBy: { stockItemId: "asc" } } } });
  const hasMore = rows.length > query.limit; const page = rows.slice(0, query.limit);
  return { counts: page.map(countDto), page: { limit: query.limit, nextCursor: hasMore ? encodePageCursor({ id: page[page.length - 1]!.id, recordedAt: page[page.length - 1]!.createdAt }) : null, hasMore } };
}
export async function createCount(prisma: PrismaClient, actor: AuthenticatedUser, input: CountInput, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const items = await tx.stockItem.findMany({ where: { id: { in: input.lines.map((line) => line.stockItemId) }, isActive: true, archivedAt: null }, select: { id: true } });
    if (items.length !== input.lines.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Every count line must reference a distinct active stock item.");
    const balances = await tx.inventoryBalance.findMany({ where: { stockItemId: { in: input.lines.map((line) => line.stockItemId) } } });
    const balanceById = new Map(balances.map((balance) => [balance.stockItemId, balance]));
    if (input.lines.some((line) => !balanceById.get(line.stockItemId)?.trackingStartedAt)) fail(409, ErrorCodes.INVALID_STATE, "A physical count can include only tracked stock items.");
    const hasQuantityDifference = input.lines.some((line) => !decimal(line.observedQuantity).eq(balanceById.get(line.stockItemId)!.quantityOnHand));
    if (hasQuantityDifference && !input.reason?.trim()) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A reason is required when a physical count changes any item's quantity.");
    const row = await tx.inventoryCount.create({ data: { kind: InventoryCountKind.PHYSICAL, reason: input.reason?.trim() || null, createdById: actor.id, lines: { create: input.lines.map((line) => { const expected = balanceById.get(line.stockItemId)!; const observed = decimal(line.observedQuantity); return { stockItemId: line.stockItemId, observedQuantity: observed, observedValueAmount: line.observedValueAmount, expectedQuantity: expected.quantityOnHand, differenceQuantity: observed.minus(expected.quantityOnHand), expectedValueAmount: expected.carryingValueAmount, differenceValueAmount: line.observedValueAmount - expected.carryingValueAmount }; }) } }, include: { lines: true } });
    await audit(tx, actor.id, requestId, "CREATE_INVENTORY_COUNT", "INVENTORY_COUNT", row.id, undefined, { kind: row.kind, lineCount: row.lines.length, reason: row.reason }); return countDto(row);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function updateCount(prisma: PrismaClient, actor: AuthenticatedUser, id: string, input: CountUpdate, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.inventoryCount.findUnique({ where: { id }, include: { lines: true } });
    if (!row) fail(404, ErrorCodes.NOT_FOUND, "The inventory count was not found.");
    if (row.status !== InventoryCountStatus.DRAFT) fail(409, ErrorCodes.INVALID_STATE, "Only draft counts can be edited.");
    if (row.version !== input.expectedVersion) stale("The inventory count has changed.", row.version);
    const items = await tx.stockItem.findMany({ where: { id: { in: input.lines.map((line) => line.stockItemId) }, isActive: true, archivedAt: null }, select: { id: true } });
    if (items.length !== input.lines.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Every count line must reference a distinct active stock item.");
    const balances = await tx.inventoryBalance.findMany({ where: { stockItemId: { in: input.lines.map((line) => line.stockItemId) } } });
    const balanceById = new Map(balances.map((balance) => [balance.stockItemId, balance]));
    if (row.kind !== InventoryCountKind.PHYSICAL) fail(409, ErrorCodes.INVALID_STATE, "Only physical-count drafts can be edited here.");
    if (input.lines.some((line) => !balanceById.get(line.stockItemId)?.trackingStartedAt)) fail(409, ErrorCodes.INVALID_STATE, "A physical count can include only tracked stock items.");
    const hasQuantityDifference = input.lines.some((line) => !decimal(line.observedQuantity).eq(balanceById.get(line.stockItemId)!.quantityOnHand));
    const reason = input.reason?.trim() || null;
    if (hasQuantityDifference && !reason) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A reason is required when a physical count changes any item's quantity.");
    await tx.inventoryCountLine.deleteMany({ where: { countId: id } });
    await tx.inventoryCountLine.createMany({ data: input.lines.map((line) => { const expected = balanceById.get(line.stockItemId); const observed = decimal(line.observedQuantity); return { countId: id, stockItemId: line.stockItemId, observedQuantity: observed, observedValueAmount: line.observedValueAmount, ...(row.kind === InventoryCountKind.PHYSICAL && expected ? { expectedQuantity: expected.quantityOnHand, differenceQuantity: observed.minus(expected.quantityOnHand), expectedValueAmount: expected.carryingValueAmount, differenceValueAmount: line.observedValueAmount - expected.carryingValueAmount } : {}) }; }) });
    const changed = await tx.inventoryCount.updateMany({ where: { id, version: input.expectedVersion, status: InventoryCountStatus.DRAFT }, data: { reason, version: { increment: 1 } } });
    if (changed.count !== 1) fail(409, ErrorCodes.STALE_VERSION, "The inventory count has changed.");
    const updated = await tx.inventoryCount.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    await audit(tx, actor.id, requestId, "UPDATE_INVENTORY_COUNT", "INVENTORY_COUNT", id, { version: row.version }, { version: updated.version }); return countDto(updated);
  });
}

function mergeTakeawayPackagingComponents(previous: CostSnapshot["components"], current: CostSnapshot["components"]) {
  const keyOf = (component: CostSnapshot["components"][number]) => `${component.stockItemId}:${component.baseUnit}`;
  const previousByKey = new Map(previous.map((component) => [keyOf(component), component]));
  const currentByKey = new Map(current.map((component) => [keyOf(component), component]));
  const allKeys = new Set([...previousByKey.keys(), ...currentByKey.keys()]);
  const merged = [];
  for (const key of allKeys) {
    const saved = previousByKey.get(key);
    const resolved = currentByKey.get(key);
    const base = saved ?? resolved!;
    const oldQuantity = saved ? decimal(saved.quantity) : decimal(0);
    const oldPackagingQuantity = saved
      ? decimal(saved.packagingQuantity ?? (saved.isPackagingMaterial ? saved.quantity : "0"))
      : decimal(0);
    const currentTakeawayQuantity = decimal(resolved?.takeawayPackagingQuantity ?? "0");
    const oldTakeawayQuantity = saved?.takeawayPackagingQuantity === undefined
      ? decimal(0)
      : decimal(saved.takeawayPackagingQuantity);
    const nonTakeawayQuantity = oldQuantity.minus(oldTakeawayQuantity);
    const otherPackagingQuantity = oldPackagingQuantity.minus(oldTakeawayQuantity);
    const takeawayPackagingQuantity = currentTakeawayQuantity;
    const quantity = nonTakeawayQuantity.plus(takeawayPackagingQuantity);
    if (!quantity.gt(0)) continue;
    const packagingQuantity = otherPackagingQuantity.plus(takeawayPackagingQuantity);
    merged.push({
      ...base,
      quantity: dstr(quantity),
      packagingQuantity: dstr(packagingQuantity),
      takeawayPackagingQuantity: dstr(takeawayPackagingQuantity),
      isPackagingMaterial: packagingQuantity.gt(0) && packagingQuantity.eq(quantity),
    });
  }
  return merged;
}

async function resolveTakeawayPackaging(tx: Tx, productId: string, quantity: number, orderQuantity: number, previousQuantity: number, orderChannel: "TABLE" | "TAKEAWAY") {
  const components: CostSnapshot["components"] = [];
  const missingReasons: string[] = [];
  if (orderChannel !== "TAKEAWAY") return { components, missingReasons };
  const config = await tx.productCostingConfiguration.findUnique({ where: { productId }, select: { takeawayPackaging: true } });
  for (const packing of (config?.takeawayPackaging ?? []) as NonNullable<CostingInput["takeawayPackaging"]>) {
    if (orderQuantity < (packing.minQuantity ?? 1) || orderQuantity > (packing.maxQuantity ?? Infinity)) continue;
    const multiplier = packing.mode === "PER_GROUP"
      ? Math.floor((previousQuantity + quantity) / packing.groupSize!) - Math.floor(previousQuantity / packing.groupSize!)
      : packing.mode === "PER_ORDER" ? (previousQuantity === 0 ? 1 : 0) : quantity;
    if (!multiplier) continue;
    const stock = await tx.stockItem.findFirst({ where: { id: packing.stockItemId, isActive: true, archivedAt: null } });
    if (!stock) {
      missingReasons.push(`missing-takeaway-packaging:${packing.stockItemId}`);
      continue;
    }
    const amount = decimal(packing.quantity).mul(multiplier);
    const serialized = dstr(amount);
    components.push({ stockItemId: stock.id, stockItemName: stock.name, baseUnit: stock.baseUnit, quantity: serialized, packagingQuantity: serialized, takeawayPackagingQuantity: serialized, isPackagingMaterial: true, knownCostAmount: null, packagingKnownCostAmount: null, nonPackagingKnownCostAmount: null });
  }
  return { components, missingReasons };
}

async function trackOrderItemSnapshots(tx: Tx, orderId: string, onlyMissing = false, refreshIncompleteProductId?: string, preserveExistingItemIds?: Set<string>, recalculatePackagingProductIds?: Set<string>) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { channel: true, inventorySaleChannel: true } });
  const items = await tx.orderItem.findMany({ where: { orderId }, orderBy: [{ displayOrder: "asc" }, { id: "asc" }], include: { options: true, costingSnapshot: true } });
  const quantities = new Map<string, number>();
  const previousQuantities = new Map<string, number>();
  for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  for (const item of items) {
    const previousQuantity = previousQuantities.get(item.productId) ?? 0;
    previousQuantities.set(item.productId, previousQuantity + item.quantity);
    const orderChannel = order.inventorySaleChannel ?? order.channel;
    const preserveExisting = preserveExistingItemIds?.has(item.id) && !!item.costingSnapshot;
    const refreshPackaging = preserveExisting && orderChannel === "TAKEAWAY" && recalculatePackagingProductIds?.has(item.productId);
    if (preserveExisting && !refreshPackaging) continue;
    if (refreshIncompleteProductId) {
      if (item.productId !== refreshIncompleteProductId || item.costingSnapshot?.isComplete) continue;
    } else if (onlyMissing && item.costingSnapshot) continue;
    const saved = item.costingSnapshot?.snapshot as unknown as (CostSnapshot & { orderChannel?: "TABLE" | "TAKEAWAY" }) | undefined;
    let snapshot: CostSnapshot & { orderChannel: "TABLE" | "TAKEAWAY" };
    if (refreshPackaging && saved?.snapshotFormatVersion === 2) {
      const packaging = await resolveTakeawayPackaging(tx, item.productId, item.quantity, quantities.get(item.productId)!, previousQuantity, orderChannel);
      const retainedMissingReasons = (saved.missingReasons ?? []).filter((reason) => !reason.startsWith("missing-takeaway-packaging:"));
      snapshot = {
        ...saved,
        components: mergeTakeawayPackagingComponents(saved.components ?? [], packaging.components),
        missingReasons: [...new Set([...retainedMissingReasons, ...packaging.missingReasons])],
        orderChannel: saved.orderChannel ?? orderChannel,
      };
    } else {
      const costing = await resolveCosting(tx, item.productId, item.options.map((option) => option.optionId), item.quantity, item.weightGrams, false, orderChannel, quantities.get(item.productId)!, previousQuantity);
      snapshot = { ...costing, snapshotFormatVersion: 2, orderChannel };
    }
    const data = { configurationVersion: snapshot.configurationVersion, snapshot: snapshot as unknown as Prisma.InputJsonValue, isComplete: snapshot.missingReasons.length === 0, missingReasons: snapshot.missingReasons as unknown as Prisma.InputJsonValue };
    if (onlyMissing) await tx.orderItemCostingSnapshot.create({ data: { orderItemId: item.id, ...data } });
    else await tx.orderItemCostingSnapshot.upsert({ where: { orderItemId: item.id }, create: { orderItemId: item.id, ...data }, update: data });
  }
  // Payment recognition and whole-order pending backfill calculate the
  // persisted consumption totals in their own valuation context. This bound
  // preflight is for new or edited order snapshots only.
  if (onlyMissing || refreshIncompleteProductId) return;
  const snapshots = await tx.orderItemCostingSnapshot.findMany({ where: { orderItem: { orderId } }, select: { snapshot: true } });
  const costingSnapshots = snapshots.map((row) => row.snapshot as { estimatedCostAmount?: unknown; components?: Array<{ stockItemId: string; quantity: string }> });
  const stockItemIds = [...new Set(costingSnapshots.flatMap((snapshot) => (snapshot.components ?? []).map((component) => component.stockItemId)))];
  const balances = await readStockBalances(tx, stockItemIds);
  const totalKnownCogsAmount = costingSnapshots.reduce((sum, snapshot) => {
    const estimatedAmount = typeof snapshot.estimatedCostAmount === "number" ? snapshot.estimatedCostAmount : 0;
    const knownRecipeAmount = (snapshot.components ?? []).reduce((componentSum, component) => {
      const balance = balances.get(component.stockItemId);
      if (!balance?.trackingStartedAt) return componentSum;
      const unitCost = balance.quantityOnHand.gt(0) ? decimal(balance.carryingValueAmount).div(balance.quantityOnHand) : decimal(0);
      return componentSum + intMoney(decimal(component.quantity).mul(unitCost));
    }, 0);
    return sum + estimatedAmount + knownRecipeAmount;
  }, 0);
  checkedCogsAmount(totalKnownCogsAmount);
}
async function readOrderItemSnapshots(tx: Tx, orderId: string): Promise<Array<{ itemId: string; productId: string; productName: string; quantity: number; weightGrams: number | null; orderChannel: "TABLE" | "TAKEAWAY" | undefined; components: CostSnapshot["components"]; estimatedCostAmount: number; estimatedCosts: EstimatedCostSnapshotEntry[]; missingReasons: string[] }>> {
  const items = await tx.orderItem.findMany({ where: { orderId }, include: { costingSnapshot: true, product: { select: { systemKey: true } } } });
  return items.map((item) => {
    const saved = (item.costingSnapshot?.snapshot ?? {}) as unknown as CostSnapshot & { orderChannel?: "TABLE" | "TAKEAWAY" };
    const missingReasons = hasOnlyMissingPackagingConfiguration(item.product.systemKey, saved) ? [] : saved.missingReasons ?? ["missing-costing-snapshot"];
    return { orderChannel: saved.orderChannel, itemId: item.id, productId: item.productId, productName: item.productNameSnapshot, quantity: item.quantity, weightGrams: item.weightGrams, components: saved.components ?? [], estimatedCostAmount: saved.estimatedCostAmount ?? 0, estimatedCosts: saved.estimatedCosts ?? [], missingReasons };
  });
}
type OrderItemCostingSnapshot = Awaited<ReturnType<typeof readOrderItemSnapshots>>[number];
type StockNeed = { stockItemId: string; quantity: Prisma.Decimal };
type StockBalances = Map<string, InventoryBalance>;

async function readStockBalances(tx: Tx, stockItemIds: string[]): Promise<StockBalances> {
  const balances = stockItemIds.length
    ? await tx.inventoryBalance.findMany({ where: { stockItemId: { in: stockItemIds } } })
    : [];
  return new Map(balances.map((balance) => [balance.stockItemId, balance]));
}

async function readLockedStockBalances(tx: Tx, needs: StockNeed[]) {
  await lock(tx, needs.map((need) => `inventory:${need.stockItemId}`));
  return readStockBalances(tx, needs.map((need) => need.stockItemId));
}

function hasStockForOrder(needs: StockNeed[], balances: StockBalances) {
  return needs.every(({ stockItemId, quantity }) => {
    const balance = balances.get(stockItemId);
    return !!balance?.trackingStartedAt && balance.quantityOnHand.gte(quantity);
  });
}

function valueOrderItemSnapshot(snapshot: OrderItemCostingSnapshot, balances: StockBalances) {
  const components: Array<any> = [];
  let known = snapshot.estimatedCostAmount;
  let complete = snapshot.missingReasons.length === 0;
  for (const component of snapshot.components) {
    const balance = balances.get(component.stockItemId);
    const tracked = !!balance?.trackingStartedAt;
    const unitValue = tracked ? decimal(balance!.quantityOnHand.gt(0) ? decimal(balance!.carryingValueAmount).div(balance!.quantityOnHand) : decimal(0)) : null;
    const cost = unitValue === null ? null : intMoney(decimal(component.quantity).mul(unitValue));
    if (!tracked) complete = false;
    if (cost !== null) known += cost;
    else complete = false;
    const packagingQuantity = (component as any).packagingQuantity ?? (component.isPackagingMaterial ? component.quantity : "0");
    const packagingCost = unitValue === null ? null : intMoney(decimal(packagingQuantity).mul(unitValue));
    components.push({ ...component, packagingQuantity, knownCostAmount: cost, packagingKnownCostAmount: packagingCost, nonPackagingKnownCostAmount: cost === null || packagingCost === null ? null : cost - packagingCost });
  }
  return { amount: complete ? checkedCogsAmount(known) : 0, known: checkedCogsAmount(known), complete, components };
}
async function recordFullPaymentConsumption(tx: Tx, order: any, settlementId: string | null, actorId: string, at: Date) {
  const existing = settlementId ? await tx.orderConsumption.findUnique({ where: { orderId_paymentSettlementId: { orderId: order.id, paymentSettlementId: settlementId } } }) : await tx.orderConsumption.findFirst({ where: { orderId: order.id, paymentSettlementId: null } });
  if (existing) return existing;
  const cycleNumber = (await tx.orderConsumption.aggregate({ where: { orderId: order.id }, _max: { cycleNumber: true } }))._max.cycleNumber ?? 0;
  const turnoverEligible = await orderTurnoverEligible(tx, order.id);
  const snapshots = await readOrderItemSnapshots(tx, order.id);
  const allNeeds = new Map<string, Prisma.Decimal>();
  for (const snapshot of snapshots) {
    for (const component of snapshot.components) allNeeds.set(component.stockItemId, (allNeeds.get(component.stockItemId) ?? decimal(0)).plus(component.quantity));
  }
  const movementRows = [...allNeeds].map(([stockItemId, quantity]) => ({ stockItemId, quantity }));
  const balances = await readLockedStockBalances(tx, movementRows);
  const itemAmounts = snapshots.map((snapshot) => ({ snapshot, ...valueOrderItemSnapshot(snapshot, balances) }));
  const canFulfill = turnoverEligible
    && snapshots.every((snapshot) => snapshot.missingReasons.length === 0)
    && hasStockForOrder(movementRows, balances);
  const knownCogsAmount = checkedCogsAmount(itemAmounts.reduce((sum, item) => sum + item.known, 0));
  const isCostComplete = itemAmounts.every((item) => item.complete) && snapshots.length > 0;
  const theoreticalCogsAmount = isCostComplete ? knownCogsAmount : null;
  const consumption = await tx.orderConsumption.create({ data: { orderId: order.id, cycleNumber: cycleNumber + 1, paymentSettlementId: settlementId, status: !turnoverEligible ? OrderConsumptionStatus.UNTRACKED : canFulfill ? OrderConsumptionStatus.POSTED : OrderConsumptionStatus.PENDING, recognizedById: actorId, recognizedAt: at, resolvedAt: !turnoverEligible || canFulfill ? at : null, theoreticalCogsAmount: theoreticalCogsAmount === null ? null : BigInt(theoreticalCogsAmount), knownCogsAmount: BigInt(knownCogsAmount), isCostComplete, costSnapshot: itemAmounts.map((item) => ({ orderItemId: item.snapshot.itemId, productId: item.snapshot.productId, productNameSnapshot: item.snapshot.productName, quantity: item.snapshot.quantity, weightGrams: item.snapshot.weightGrams, theoreticalCogsAmount: item.complete ? item.amount : null, knownCogsAmount: item.known, isCostComplete: item.complete, estimatedCostAmount: item.snapshot.estimatedCostAmount, estimatedCosts: item.snapshot.estimatedCosts, components: item.components })) as unknown as Prisma.InputJsonValue, items: { create: itemAmounts.map((item) => ({ orderItemId: item.snapshot.itemId, productNameSnapshot: item.snapshot.productName, quantity: item.snapshot.quantity, weightGrams: item.snapshot.weightGrams, theoreticalCogsAmount: item.complete ? BigInt(item.amount) : null, knownCogsAmount: BigInt(item.known), isCostComplete: item.complete, costSnapshot: { orderChannel: item.snapshot.orderChannel ?? order.channel, estimatedCostAmount: item.snapshot.estimatedCostAmount, estimatedCosts: item.snapshot.estimatedCosts, components: item.components, missingReasons: item.snapshot.missingReasons } })) } } });
  if (canFulfill) await deductStockForOrder(tx, consumption.id, movementRows, balances, actorId, at);
  return consumption;
}
async function deductStockForOrder(tx: Tx, consumptionId: string, needs: StockNeed[], balances: StockBalances, actorId: string, at: Date) {
  for (const need of needs) {
    const balance = balances.get(need.stockItemId)!;
    const nextQuantity = balance.quantityOnHand.minus(need.quantity);
    const value = nextQuantity.isZero() ? balance.carryingValueAmount : intMoney(need.quantity.mul(balance.quantityOnHand.gt(0) ? decimal(balance.carryingValueAmount).div(balance.quantityOnHand) : decimal(0)));
    const valueDeltaAmount = nextQuantity.isZero() ? -balance.carryingValueAmount : -Math.min(balance.carryingValueAmount, value);
    await tx.inventoryMovement.create({ data: { stockItemId: need.stockItemId, kind: InventoryMovementKind.ORDER_CONSUMPTION, quantityDelta: need.quantity.negated(), valueDeltaAmount, orderConsumptionId: consumptionId, createdById: actorId, occurredAt: at } });
    await tx.inventoryBalance.update({ where: { stockItemId: need.stockItemId }, data: { quantityOnHand: nextQuantity, carryingValueAmount: balance.carryingValueAmount + valueDeltaAmount } });
  }
}
async function needsFromConsumption(tx: Tx, consumptionId: string) {
  const items = await tx.orderConsumptionItem.findMany({ where: { orderConsumptionId: consumptionId } });
  const needs = new Map<string, Prisma.Decimal>();
  for (const item of items) {
    const snapshot = item.costSnapshot as any;
    for (const component of snapshot.components ?? []) needs.set(component.stockItemId, (needs.get(component.stockItemId) ?? decimal(0)).plus(component.quantity));
  }
  return [...needs].map(([stockItemId, quantity]) => ({ stockItemId, quantity }));
}
async function refreshPendingConsumptionSnapshots(tx: Tx, consumptionId: string, orderId: string, affectedItemIds: Set<string>) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { channel: true, inventorySaleChannel: true } });
  const snapshots = (await readOrderItemSnapshots(tx, orderId)).filter((snapshot) => affectedItemIds.has(snapshot.itemId));
  const balances = await readStockBalances(tx, [...new Set(snapshots.flatMap((snapshot) => snapshot.components.map((component) => component.stockItemId)))]);
  for (const snapshot of snapshots) {
    const valued = valueOrderItemSnapshot(snapshot, balances);
    await tx.orderConsumptionItem.update({
      where: { orderConsumptionId_orderItemId: { orderConsumptionId: consumptionId, orderItemId: snapshot.itemId } },
      data: {
        theoreticalCogsAmount: valued.complete ? BigInt(valued.known) : null,
        knownCogsAmount: BigInt(valued.known),
        isCostComplete: valued.complete,
        costSnapshot: {
          orderChannel: snapshot.orderChannel ?? order.inventorySaleChannel ?? order.channel,
          estimatedCostAmount: snapshot.estimatedCostAmount,
          estimatedCosts: snapshot.estimatedCosts,
          components: valued.components,
          missingReasons: snapshot.missingReasons,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  await updateConsumptionCostTotals(tx, consumptionId);
}

async function updateConsumptionCostTotals(tx: Tx, consumptionId: string) {
  const items = await tx.orderConsumptionItem.findMany({ where: { orderConsumptionId: consumptionId }, include: { orderItem: { select: { productId: true } } } });
  const knownCogsAmount = checkedCogsAmount(items.reduce((sum, item) => sum + Number(item.knownCogsAmount), 0));
  const isCostComplete = items.length > 0 && items.every((item) => item.isCostComplete);
  const costSnapshot = items.map((item) => {
    const saved = item.costSnapshot as any;
    return {
      orderItemId: item.orderItemId,
      productId: item.orderItem.productId,
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
      weightGrams: item.weightGrams,
      theoreticalCogsAmount: item.theoreticalCogsAmount === null ? null : Number(item.theoreticalCogsAmount),
      knownCogsAmount: Number(item.knownCogsAmount),
      isCostComplete: item.isCostComplete,
      estimatedCostAmount: saved.estimatedCostAmount ?? 0,
      estimatedCosts: saved.estimatedCosts ?? [],
      components: saved.components ?? [],
    };
  });
  await tx.orderConsumption.update({
    where: { id: consumptionId },
    data: { knownCogsAmount: BigInt(knownCogsAmount), isCostComplete, theoreticalCogsAmount: isCostComplete ? BigInt(knownCogsAmount) : null, costSnapshot: costSnapshot as unknown as Prisma.InputJsonValue },
  });
}
async function tryPostPendingConsumption(tx: Tx, consumptionId: string, actorId: string, at: Date) {
  const consumption = await tx.orderConsumption.findUnique({
    where: { id: consumptionId },
    include: { items: { include: { orderItem: { select: { product: { select: { systemKey: true } } } } } }, order: { select: { state: true, paymentStatus: true } } },
  });
  if (!consumption || consumption.status !== OrderConsumptionStatus.PENDING || consumption.order.state === "DELETED" || consumption.order.paymentStatus !== "PAID") return false;
  if (!await orderTurnoverEligible(tx, consumption.orderId) || consumption.items.length === 0) return false;
  const legacyChargeItems = consumption.items.filter((item) =>
    hasOnlyMissingPackagingConfiguration(item.orderItem.product.systemKey, item.costSnapshot));
  const legacyChargeItemIds = new Set(legacyChargeItems.map((item) => item.id));
  if (consumption.items.some((item) => {
    if (legacyChargeItemIds.has(item.id)) return false;
    const snapshot = item.costSnapshot as any;
    return !Array.isArray(snapshot?.missingReasons) || snapshot.missingReasons.length > 0;
  })) return false;

  const needs = await needsFromConsumption(tx, consumptionId);
  const balances = await readLockedStockBalances(tx, needs);
  if (!hasStockForOrder(needs, balances)) return false;
  const claimed = await tx.orderConsumption.updateMany({
    where: { id: consumptionId, status: OrderConsumptionStatus.PENDING },
    data: { status: OrderConsumptionStatus.POSTED, resolvedAt: at },
  });
  if (claimed.count !== 1) return false;
  if (legacyChargeItems.length) {
    for (const item of legacyChargeItems) {
      await tx.orderConsumptionItem.update({ where: { id: item.id }, data: {
        theoreticalCogsAmount: 0, isCostComplete: true,
        costSnapshot: { ...(item.costSnapshot as Prisma.JsonObject), missingReasons: [] },
      } });
    }
    await updateConsumptionCostTotals(tx, consumptionId);
  }
  await deductStockForOrder(tx, consumptionId, needs, balances, actorId, at);
  return true;
}
async function resolvePendingCostingForProduct(tx: Tx, productId: string, actorId: string, at: Date) {
  const activatedAt = await inventoryActivation(tx);
  if (!activatedAt) return { orderItemsResolved: 0, ordersPosted: 0 };
  const pending = await tx.orderConsumption.findMany({
    where: { status: OrderConsumptionStatus.PENDING, order: { createdAt: { gte: activatedAt }, state: { not: "DELETED" }, paymentStatus: "PAID" } },
    orderBy: [{ recognizedAt: "asc" }, { id: "asc" }],
    include: { items: { include: { orderItem: { select: { id: true, productId: true, costingSnapshot: { select: { isComplete: true } } } } } } },
  });
  let orderItemsResolved = 0;
  let ordersPosted = 0;
  for (const consumption of pending) {
    const affectedItemIds = new Set(consumption.items
      .filter((item) => item.orderItem.productId === productId && !item.orderItem.costingSnapshot?.isComplete)
      .map((item) => item.orderItemId));
    if (affectedItemIds.size === 0) continue;
    await trackOrderItemSnapshots(tx, consumption.orderId, false, productId);
    await refreshPendingConsumptionSnapshots(tx, consumption.id, consumption.orderId, affectedItemIds);
    orderItemsResolved += affectedItemIds.size;
    if (await tryPostPendingConsumption(tx, consumption.id, actorId, at)) ordersPosted++;
  }
  return { orderItemsResolved, ordersPosted };
}
export async function retryPendingConsumptions(tx: Tx, actorId: string, at = new Date()) {
  const activatedAt = await inventoryActivation(tx);
  if (!activatedAt) return 0;
  const pending = await tx.orderConsumption.findMany({ where: { status: OrderConsumptionStatus.PENDING, order: { createdAt: { gte: activatedAt }, state: { not: "DELETED" }, paymentStatus: "PAID" } }, orderBy: [{ recognizedAt: "asc" }, { id: "asc" }], select: { id: true } });
  let resolved = 0;
  for (const item of pending) if (await tryPostPendingConsumption(tx, item.id, actorId, at)) resolved++;
  return resolved;
}

export async function postPurchase(prisma: PrismaClient, actor: AuthenticatedUser, id: string, expectedVersion: number, key: string, requestId: string) {
  const fingerprint = sha({ id, expectedVersion });
  try {
    return await prisma.$transaction(async (tx) => {
      await lock(tx, [`purchase:${id}`]);
      const existing = await tx.idempotencyRecord.findUnique({ where: { actorId_operation_key: { actorId: actor.id, operation: POST_PURCHASE, key } } });
      if (existing) { if (existing.requestFingerprint !== fingerprint) fail(409, ErrorCodes.IDEMPOTENCY_CONFLICT, "This idempotency key was already used for a different request."); return existing.resultSnapshot as any; }
      const purchase = await tx.purchase.findUnique({ where: { id }, include: { lines: true } });
      if (!purchase) fail(404, ErrorCodes.NOT_FOUND, "The purchase was not found.");
      if (purchase.version !== expectedVersion) stale("The purchase has changed.", purchase.version);
      if (purchase.status !== PurchaseStatus.DRAFT) fail(409, ErrorCodes.INVALID_STATE, "The purchase is already posted.");
      await lock(tx, purchase.lines.map((line) => `inventory:${line.stockItemId}`));
      const occurredAt = new Date();
      const posted = await tx.purchase.updateMany({
        where: { id, version: expectedVersion, status: PurchaseStatus.DRAFT },
        data: { status: PurchaseStatus.POSTED, postedAt: occurredAt, version: { increment: 1 } },
      });
      if (posted.count !== 1) fail(409, ErrorCodes.STALE_VERSION, "The purchase has changed.");
      for (const line of purchase.lines) {
        const balance = await tx.inventoryBalance.findUnique({ where: { stockItemId: line.stockItemId } });
        if (!balance?.trackingStartedAt) fail(409, ErrorCodes.INVALID_STATE, "An opening count must be posted before received purchases can update tracked inventory.");
        const nextQty = balance.quantityOnHand.plus(line.baseQuantityReceived);
        const nextValue = balance.carryingValueAmount + line.directCostAmount;
        if (nextQty.gte("100000000000000") || nextValue > 2_147_483_647) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "This receipt would exceed the supported inventory quantity or value.");
        await tx.inventoryMovement.create({ data: { stockItemId: line.stockItemId, kind: InventoryMovementKind.PURCHASE_RECEIPT, quantityDelta: line.baseQuantityReceived, valueDeltaAmount: line.directCostAmount, purchaseLineId: line.id, createdById: actor.id, occurredAt: purchase.receivedAt } });
        await tx.inventoryBalance.update({ where: { stockItemId: line.stockItemId }, data: { quantityOnHand: nextQty, carryingValueAmount: nextValue } });
      }
      const updated = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      // See pending checkouts that committed while this receipt waited for stock locks.
      const retried = await retryPendingConsumptions(tx, actor.id, occurredAt);
      await audit(tx, actor.id, requestId, POST_PURCHASE, "PURCHASE", id, { status: purchase.status }, { status: updated.status, retriedPendingOrders: retried });
      const result = purchaseDto(updated);
      await tx.idempotencyRecord.create({ data: { actorId: actor.id, operation: POST_PURCHASE, key, requestFingerprint: fingerprint, responseStatus: 200, resultSnapshot: result, expiresAt: new Date(occurredAt.getTime() + IDEMPOTENCY_TTL) } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await prisma.idempotencyRecord.findUnique({ where: { actorId_operation_key: { actorId: actor.id, operation: POST_PURCHASE, key } } });
      if (replay?.requestFingerprint === fingerprint) return replay.resultSnapshot as any;
    }
    throw error;
  }
}

function movementDto(row: any) { return { id: row.id, stockItemId: row.stockItemId, orderNumber: row.orderConsumption?.order?.orderNumber ?? null, kind: row.kind, quantityDelta: dstr(row.quantityDelta), valueDeltaAmount: row.valueDeltaAmount, purchaseLineId: row.purchaseLineId, orderConsumptionId: row.orderConsumptionId, inventoryCountLineId: row.inventoryCountLineId, compensatesMovementId: row.compensatesMovementId, occurredAt: row.occurredAt.toISOString(), recordedAt: row.recordedAt.toISOString() }; }
function decodePageCursor(value: string | undefined): { id: string; at: Date } | null {
  if (!value) return null;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { id?: string; at?: string }; const at = new Date(parsed.at ?? ""); if (!parsed.id || Number.isNaN(at.getTime())) throw new Error("invalid cursor"); return { id: parsed.id, at }; }
  catch { fail(400, ErrorCodes.BAD_REQUEST, "The cursor is invalid."); }
}
function encodePageCursor(row: { id: string; recordedAt: Date }) { return Buffer.from(JSON.stringify({ id: row.id, at: row.recordedAt.toISOString() })).toString("base64url"); }
export async function listInventoryMovements(prisma: PrismaClient, query: MovementQuery) {
  const cursor = decodePageCursor(query.cursor);
  const where = {
    ...(query.stockItemId ? { stockItemId: query.stockItemId } : {}),
    ...(query.searchBy === "PRODUCT" && query.search ? { stockItem: { OR: [{ name: { contains: query.search, mode: "insensitive" as const } }, { archivedName: { contains: query.search, mode: "insensitive" as const } }] } } : {}),
    ...(query.searchBy === "ORDER_NUMBER" && query.search ? { orderConsumption: { order: { orderNumber: { contains: query.search, mode: "insensitive" as const } } } } : {}),
    ...(query.searchBy === "KIND" && query.kind ? { kind: query.kind } : {}),
    ...(query.from || query.to ? { occurredAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    ...(cursor ? { AND: [{ OR: [{ recordedAt: { lt: cursor.at } }, { recordedAt: cursor.at, id: { lt: cursor.id } }] }] } : {}),
  };
  const rows = await prisma.inventoryMovement.findMany({ where, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: query.limit + 1, include: { orderConsumption: { select: { order: { select: { orderNumber: true } } } } } });
  const hasMore = rows.length > query.limit; const page = rows.slice(0, query.limit);
  return { movements: page.map(movementDto), page: { limit: query.limit, nextCursor: hasMore ? encodePageCursor(page[page.length - 1]!) : null, hasMore } };
}
export async function listPendingConsumptions(prisma: PrismaClient, query: PendingQuery) {
  const cursor = decodePageCursor(query.cursor);
  const rows = await prisma.orderConsumption.findMany({ where: { status: OrderConsumptionStatus.PENDING, order: { state: { not: "DELETED" } }, ...(cursor ? { OR: [{ recognizedAt: { lt: cursor.at } }, { recognizedAt: cursor.at, id: { lt: cursor.id } }] } : {}) }, orderBy: [{ recognizedAt: "desc" }, { id: "desc" }], take: query.limit + 1, include: { order: { select: { id: true, orderNumber: true } }, items: true } });
  const hasMore = rows.length > query.limit; const page = rows.slice(0, query.limit);
  const consumptions = [];
  for (const row of page) {
    const needs = await needsFromConsumption(prisma as unknown as Tx, row.id);
    const balances = needs.length ? await prisma.inventoryBalance.findMany({ where: { stockItemId: { in: needs.map((need) => need.stockItemId) } } }) : [];
    const byId = new Map(balances.map((balance) => [balance.stockItemId, balance]));
    const missingStockItemIds = new Set(needs.filter((need) => { const balance = byId.get(need.stockItemId); return !balance?.trackingStartedAt || balance.quantityOnHand.lt(need.quantity); }).map((need) => need.stockItemId));
    for (const item of row.items) {
      const saved = item.costSnapshot as { missingReasons?: unknown };
      for (const reason of Array.isArray(saved.missingReasons) ? saved.missingReasons : []) {
        if (typeof reason === "string" && reason.startsWith("missing-takeaway-packaging:")) missingStockItemIds.add(reason.slice("missing-takeaway-packaging:".length));
      }
    }
    consumptions.push({ id: row.id, orderId: row.order.id, orderNumber: row.order.orderNumber, recognizedAt: row.recognizedAt.toISOString(), knownCogsAmount: checkedCogsAmount(Number(row.knownCogsAmount)), isCostComplete: row.isCostComplete, missingStockItemIds: [...missingStockItemIds] });
  }
  return { consumptions, page: { limit: query.limit, nextCursor: hasMore ? encodePageCursor({ id: page[page.length - 1]!.id, recordedAt: page[page.length - 1]!.recognizedAt }) : null, hasMore } };
}
export async function returnPurchaseStock(prisma: PrismaClient, actor: AuthenticatedUser, purchaseId: string, input: { purchaseLineId: string; baseQuantity: string; occurredAt: string; reason: string }, key: string, requestId: string) {
  const fingerprint = sha({ purchaseId, ...input });
  const previous = await prisma.idempotencyRecord.findUnique({ where: { actorId_operation_key: { actorId: actor.id, operation: "RETURN_INVENTORY_PURCHASE", key } } });
  if (previous) { if (previous.requestFingerprint !== fingerprint) fail(409, ErrorCodes.IDEMPOTENCY_CONFLICT, "This idempotency key was already used for a different request."); return previous.resultSnapshot as any; }
  try {
    return await prisma.$transaction(async (tx) => {
      await lock(tx, [`purchase:${purchaseId}`]);
      const purchase = await tx.purchase.findUnique({ where: { id: purchaseId }, include: { lines: true } });
      if (!purchase || purchase.status !== PurchaseStatus.POSTED) fail(409, ErrorCodes.INVALID_STATE, "Only a posted purchase can be returned.");
      const line = purchase.lines.find((candidate) => candidate.id === input.purchaseLineId);
      if (!line) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The purchase line does not belong to this purchase.");
      const quantity = decimal(input.baseQuantity);
      await lock(tx, [`inventory:${line.stockItemId}`]);
      const balance = await tx.inventoryBalance.findUnique({ where: { stockItemId: line.stockItemId } });
      if (!balance?.trackingStartedAt || balance.quantityOnHand.lt(quantity)) fail(409, ErrorCodes.INVALID_STATE, "The stock balance cannot cover this return.");
      const priorReturns = await tx.inventoryMovement.aggregate({ where: { purchaseLineId: line.id, kind: InventoryMovementKind.PURCHASE_RETURN }, _sum: { quantityDelta: true } });
      const returnedQuantity = decimal(priorReturns._sum.quantityDelta ?? 0).abs();
      if (returnedQuantity.plus(quantity).gt(line.baseQuantityReceived)) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Returned quantity cannot exceed the originally received quantity.");
      const nextQuantity = balance.quantityOnHand.minus(quantity);
      const value = nextQuantity.isZero() ? balance.carryingValueAmount : Math.min(balance.carryingValueAmount, intMoney(quantity.mul(balance.quantityOnHand.gt(0) ? decimal(balance.carryingValueAmount).div(balance.quantityOnHand) : decimal(0))));
      const row = await tx.inventoryMovement.create({ data: { stockItemId: line.stockItemId, kind: InventoryMovementKind.PURCHASE_RETURN, quantityDelta: quantity.negated(), valueDeltaAmount: -value, purchaseLineId: line.id, createdById: actor.id, occurredAt: new Date(input.occurredAt) } });
      await tx.inventoryBalance.update({ where: { stockItemId: line.stockItemId }, data: { quantityOnHand: nextQuantity, carryingValueAmount: balance.carryingValueAmount - value } });
      await audit(tx, actor.id, requestId, "RETURN_INVENTORY_PURCHASE", "PURCHASE", purchaseId, undefined, { movementId: row.id, reason: input.reason, quantity: input.baseQuantity, valueAmount: value });
      const result = movementDto(row);
      await tx.idempotencyRecord.create({ data: { actorId: actor.id, operation: "RETURN_INVENTORY_PURCHASE", key, requestFingerprint: fingerprint, responseStatus: 201, resultSnapshot: result, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL) } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await prisma.idempotencyRecord.findUnique({ where: { actorId_operation_key: { actorId: actor.id, operation: "RETURN_INVENTORY_PURCHASE", key } } });
      if (replay?.requestFingerprint === fingerprint) return replay.resultSnapshot as any;
    }
    throw error;
  }
}

export async function postInventoryCount(prisma: PrismaClient, actor: AuthenticatedUser, id: string, input: { expectedVersion: number; absorbedOrderConsumptionIds: string[] }, key: string, requestId: string) {
  const activatedAt = await inventoryActivation(prisma);
  const fingerprint = sha({ id, ...input });
  const previous = await prisma.idempotencyRecord.findUnique({ where: { actorId_operation_key: { actorId: actor.id, operation: POST_COUNT, key } } });
  if (previous) { if (previous.requestFingerprint !== fingerprint) fail(409, ErrorCodes.IDEMPOTENCY_CONFLICT, "This idempotency key was already used for a different request."); return previous.resultSnapshot as any; }
  try {
    return await prisma.$transaction(async (tx) => {
      await lock(tx, [`count:${id}`]);
      const count = await tx.inventoryCount.findUnique({ where: { id }, include: { lines: true } });
      if (!count) fail(404, ErrorCodes.NOT_FOUND, "The inventory count was not found.");
      if (count.status !== InventoryCountStatus.DRAFT) fail(409, ErrorCodes.INVALID_STATE, "The inventory count is already posted.");
      if (count.version !== input.expectedVersion) stale("The inventory count has changed.", count.version);
      await lock(tx, count.lines.map((line) => `inventory:${line.stockItemId}`));
      const pending = input.absorbedOrderConsumptionIds.length && activatedAt ? await tx.orderConsumption.findMany({ where: { id: { in: input.absorbedOrderConsumptionIds }, status: OrderConsumptionStatus.PENDING, order: { createdAt: { gte: activatedAt }, state: { not: "DELETED" }, paymentStatus: "PAID" } }, include: { items: true } }) : [];
      if (pending.length !== input.absorbedOrderConsumptionIds.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Every reconciled order must be an eligible pending consumption.");
      const countStockIds = new Set(count.lines.map((line) => line.stockItemId));
      for (const consumption of pending) for (const need of await needsFromConsumption(tx, consumption.id)) if (!countStockIds.has(need.stockItemId)) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The count must include every stock item for a pending order selected as already absorbed.");
      if (count.kind === InventoryCountKind.OPENING) {
        if (input.absorbedOrderConsumptionIds.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An opening count cannot reconcile previously recognized orders.");
      }
      const occurredAt = new Date();
      for (const line of count.lines) {
        const balance = await tx.inventoryBalance.findUnique({ where: { stockItemId: line.stockItemId } });
        if (count.kind === InventoryCountKind.OPENING) {
          if (balance?.trackingStartedAt) fail(409, ErrorCodes.INVALID_STATE, "An opening count cannot reset an already tracked item.");
          await tx.inventoryBalance.upsert({ where: { stockItemId: line.stockItemId }, create: { stockItemId: line.stockItemId, quantityOnHand: line.observedQuantity, carryingValueAmount: line.observedValueAmount, trackingStartedAt: occurredAt }, update: { quantityOnHand: line.observedQuantity, carryingValueAmount: line.observedValueAmount, trackingStartedAt: occurredAt } });
          if (!line.observedQuantity.isZero() || line.observedValueAmount !== 0) {
            await tx.inventoryMovement.create({ data: { stockItemId: line.stockItemId, kind: InventoryMovementKind.OPENING_COUNT, quantityDelta: line.observedQuantity, valueDeltaAmount: line.observedValueAmount, inventoryCountLineId: line.id, createdById: actor.id, occurredAt } });
          }
        } else {
          if (!balance?.trackingStartedAt) fail(409, ErrorCodes.INVALID_STATE, "A physical count cannot adjust an item before its opening count is posted.");
          const difference = line.observedQuantity.minus(balance.quantityOnHand);
          if (!difference.isZero() && !count.reason?.trim()) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A reason is required when a physical count changes any item's quantity.");
          const valueDifference = line.observedValueAmount - balance.carryingValueAmount;
          await tx.inventoryBalance.update({ where: { stockItemId: line.stockItemId }, data: { quantityOnHand: line.observedQuantity, carryingValueAmount: line.observedValueAmount } });
          if (!difference.isZero() || valueDifference !== 0) {
            await tx.inventoryMovement.create({ data: { stockItemId: line.stockItemId, kind: InventoryMovementKind.PHYSICAL_COUNT_ADJUSTMENT, quantityDelta: difference, valueDeltaAmount: valueDifference, inventoryCountLineId: line.id, createdById: actor.id, occurredAt } });
          }
          await tx.inventoryCountLine.update({ where: { id: line.id }, data: { expectedQuantity: balance.quantityOnHand, differenceQuantity: difference, expectedValueAmount: balance.carryingValueAmount, differenceValueAmount: valueDifference } });
        }
      }
      for (const consumption of pending) {
        await tx.inventoryCountPendingOrder.create({ data: { countId: id, orderConsumptionId: consumption.id } });
        await tx.orderConsumption.update({ where: { id: consumption.id }, data: { status: OrderConsumptionStatus.RECONCILED, resolvedAt: occurredAt } });
      }
      const updated = await tx.inventoryCount.update({ where: { id }, data: { status: InventoryCountStatus.POSTED, postedAt: occurredAt, version: { increment: 1 } }, include: { lines: true } });
      await audit(tx, actor.id, requestId, POST_COUNT, "INVENTORY_COUNT", id, { status: count.status }, { status: updated.status, reason: count.reason, reconciledOrders: pending.map((item) => item.id) });
      const result = countDto(updated);
      await tx.idempotencyRecord.create({ data: { actorId: actor.id, operation: POST_COUNT, key, requestFingerprint: fingerprint, responseStatus: 200, resultSnapshot: result, expiresAt: new Date(occurredAt.getTime() + IDEMPOTENCY_TTL) } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await prisma.idempotencyRecord.findUnique({ where: { actorId_operation_key: { actorId: actor.id, operation: POST_COUNT, key } } });
      if (replay?.requestFingerprint === fingerprint) return replay.resultSnapshot as any;
    }
    throw error;
  }
}

export async function updateOrderCostingSnapshots(tx: Tx, orderId: string, preserveExistingItemIds?: string[], recalculatePackagingProductIds?: string[]) {
  await trackOrderItemSnapshots(tx, orderId, false, undefined, preserveExistingItemIds ? new Set(preserveExistingItemIds) : undefined, recalculatePackagingProductIds ? new Set(recalculatePackagingProductIds) : undefined);
}
export async function recognizeOrderFullPayment(tx: Tx, orderId: string, settlementId: string, actorId: string, at = new Date()) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { paymentSettlements: { where: { reversal: null }, select: { totalAmount: true } } } });
  if (!order || order.state === "DELETED" || order.paymentStatus !== "PAID") return null;
  const paid = order.paymentSettlements.reduce((sum, entry) => sum + entry.totalAmount, 0);
  if (paid !== order.totalAmount) return null;
  await lock(tx, [`order:${orderId}`]);
  await trackOrderItemSnapshots(tx, orderId, true);
  return recordFullPaymentConsumption(tx, order, settlementId, actorId, at);
}

export async function recognizeStaffConsumption(tx: Tx, orderId: string, actorId: string, at = new Date()) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  return recordFullPaymentConsumption(tx, order, null, actorId, at);
}

async function restoreConsumption(tx: Tx, consumption: OrderConsumption, actorId: string, at: Date) {
  if (consumption.status === OrderConsumptionStatus.PENDING) {
    const cancelled = await tx.orderConsumption.updateMany({
      where: { id: consumption.id, status: OrderConsumptionStatus.PENDING },
      data: { status: OrderConsumptionStatus.CANCELLED, resolvedAt: at },
    });
    if (cancelled.count === 1) return;
    // A receipt or physical count changed the status while this cancellation waited.
    consumption = await tx.orderConsumption.findUniqueOrThrow({ where: { id: consumption.id } });
  }
  if (consumption.status === OrderConsumptionStatus.CANCELLED) return;
  if (consumption.status === OrderConsumptionStatus.POSTED) {
    const movements = await tx.inventoryMovement.findMany({ where: { orderConsumptionId: consumption.id, kind: InventoryMovementKind.ORDER_CONSUMPTION } });
    await lock(tx, movements.map((movement) => `inventory:${movement.stockItemId}`));
    for (const movement of movements) {
      if (await tx.inventoryMovement.findUnique({ where: { compensatesMovementId: movement.id }, select: { id: true } })) continue;
      const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: movement.stockItemId } });
      await tx.inventoryMovement.create({ data: { stockItemId: movement.stockItemId, kind: InventoryMovementKind.ORDER_RESTORATION, quantityDelta: movement.quantityDelta.abs(), valueDeltaAmount: Math.abs(movement.valueDeltaAmount), orderConsumptionId: consumption.id, compensatesMovementId: movement.id, createdById: actorId, occurredAt: at } });
      await tx.inventoryBalance.update({ where: { stockItemId: movement.stockItemId }, data: { quantityOnHand: balance.quantityOnHand.plus(movement.quantityDelta.abs()), carryingValueAmount: balance.carryingValueAmount + Math.abs(movement.valueDeltaAmount) } });
    }
  } else if (consumption.status === OrderConsumptionStatus.RECONCILED) {
    const needs = await needsFromConsumption(tx, consumption.id);
    await lock(tx, needs.map((need) => `inventory:${need.stockItemId}`));
    const reconciliation = await tx.inventoryCountPendingOrder.findFirst({ where: { orderConsumptionId: consumption.id }, include: { count: { include: { lines: true } } } });
    for (const need of needs) {
      const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { stockItemId: need.stockItemId } });
      const countedLine = reconciliation?.count.lines.find((line) => line.stockItemId === need.stockItemId);
      if (!countedLine) fail(409, ErrorCodes.INVALID_STATE, "The reconciled count does not contain a carrying value for restored stock.");
      // A zero count has no observed unit value. Use the pre-count value
      // captured at posting, which is independent of subsequent receipts.
      const observedStock = countedLine.observedQuantity.gt(0);
      const valuationQuantity = observedStock ? countedLine.observedQuantity : countedLine.expectedQuantity;
      const valuationAmount = observedStock ? countedLine.observedValueAmount : countedLine.expectedValueAmount;
      const restoredValue = valuationQuantity?.gt(0) && valuationAmount !== null
        ? intMoney(need.quantity.mul(decimal(valuationAmount).div(valuationQuantity)))
        : 0;
      await tx.inventoryMovement.create({ data: { stockItemId: need.stockItemId, kind: InventoryMovementKind.ORDER_RESTORATION, quantityDelta: need.quantity, valueDeltaAmount: restoredValue, orderConsumptionId: consumption.id, createdById: actorId, occurredAt: at } });
      await tx.inventoryBalance.update({ where: { stockItemId: need.stockItemId }, data: { quantityOnHand: balance.quantityOnHand.plus(need.quantity), carryingValueAmount: balance.carryingValueAmount + restoredValue } });
    }
  }
  await tx.orderConsumption.update({ where: { id: consumption.id }, data: { status: OrderConsumptionStatus.CANCELLED, resolvedAt: at } });
}
export async function cancelAndRestoreOrderInventory(tx: Tx, orderId: string, actorId: string, at = new Date()) {
  await lock(tx, [`order:${orderId}`]);
  const consumptions = await tx.orderConsumption.findMany({ where: { orderId }, orderBy: [{ cycleNumber: "asc" }] });
  for (const consumption of consumptions) await restoreConsumption(tx, consumption, actorId, at);
}
