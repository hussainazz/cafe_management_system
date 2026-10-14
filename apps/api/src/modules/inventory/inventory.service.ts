import { createHash } from "node:crypto";
import {
  InventoryCountKind,
  InventoryCountStatus,
  InventoryMovementKind,
  OrderConsumptionStatus,
  Prisma,
  PurchaseStatus,
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
  InventoryListQuerySchema,
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
type InventoryListQuery = z.infer<typeof InventoryListQuerySchema>;
type MovementQuery = z.infer<typeof InventoryMovementQuerySchema>;
type PendingQuery = z.infer<typeof PendingConsumptionQuerySchema>;

const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const POST_PURCHASE = "POST_INVENTORY_PURCHASE";
const POST_COUNT = "POST_INVENTORY_COUNT";
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000;

function decimal(value: string | number | Prisma.Decimal) { return new Prisma.Decimal(value); }
function dstr(value: Prisma.Decimal | null | undefined) { return value?.toFixed(6).replace(/\.?0+$/, "") || "0"; }
function intMoney(value: Prisma.Decimal) { return value.toDecimalPlaces(0, ROUND_HALF_UP).toNumber(); }
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
  return {
    id: row.id, name: row.archivedName ?? row.name, category: row.category, baseUnit: row.baseUnit,
    isActive: row.isActive, archivedAt: row.archivedAt?.toISOString() ?? null, version: row.version,
    conversions: row.conversions.map((conversion: any) => ({ id: conversion.id, label: conversion.label, baseQuantityPerPack: dstr(conversion.baseQuantityPerPack), isActive: conversion.isActive })),
    balance: { quantityOnHand: balance?.trackingStartedAt ? dstr(balance.quantityOnHand) : null, carryingValueAmount: balance?.trackingStartedAt ? balance.carryingValueAmount : null, movingAverageCostPerBaseUnit: unitCost?.toFixed(6) ?? null, trackingStartedAt: balance?.trackingStartedAt?.toISOString() ?? null },
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listStockItems(prisma: PrismaClient) {
  return (await prisma.stockItem.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }], include: { conversions: { orderBy: [{ isActive: "desc" }, { label: "asc" }] }, balance: true } })).map(dtoStock);
}
export async function createStockItem(prisma: PrismaClient, actor: AuthenticatedUser, input: StockInput, requestId: string) {
  const ids = input.conversions.map(({ label }) => label.toLocaleLowerCase());
  if (new Set(ids).size !== ids.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Conversion labels must be unique for a stock item.");
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.stockItem.findFirst({ where: { name: input.name, isActive: true, archivedAt: null }, select: { id: true } });
    if (duplicate) fail(409, ErrorCodes.CONFLICT, "An active stock item with this name already exists.");
    const row = await tx.stockItem.create({ data: { name: input.name, category: input.category, baseUnit: input.baseUnit, createdById: actor.id, conversions: { create: input.conversions.map((conversion) => ({ label: conversion.label, baseQuantityPerPack: decimal(conversion.baseQuantityPerPack), isActive: conversion.isActive })) }, balance: { create: {} } }, include: { conversions: true, balance: true } });
    await audit(tx, actor.id, requestId, "CREATE_STOCK_ITEM", "STOCK_ITEM", row.id, undefined, { name: row.name, baseUnit: row.baseUnit });
    return dtoStock(row);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function updateStockItem(prisma: PrismaClient, actor: AuthenticatedUser, id: string, input: StockUpdate, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.stockItem.findUnique({ where: { id }, include: { conversions: true, balance: true } });
    if (!current) fail(404, ErrorCodes.NOT_FOUND, "The stock item was not found.");
    if (current.archivedAt) fail(409, ErrorCodes.INVALID_STATE, "An archived stock item cannot be edited.");
    if (current.version !== input.expectedVersion) stale("The stock item has changed.", current.version);
    if (input.baseUnit && input.baseUnit !== current.baseUnit) {
      const referenced = current.balance?.trackingStartedAt || current.conversions.length > 0
        || await tx.inventoryMovement.count({ where: { stockItemId: id } }) > 0
        || await tx.recipeComponent.count({ where: { stockItemId: id } }) > 0
        || await tx.purchaseLine.count({ where: { stockItemId: id } }) > 0;
      if (referenced) fail(409, ErrorCodes.INVALID_STATE, "A stock item's base unit cannot change after it has conversions or is referenced by costing or inventory history.");
    }
    const conversions = input.conversions;
    if (conversions && new Set(conversions.map((conversion) => conversion.label.toLocaleLowerCase())).size !== conversions.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Conversion labels must be unique for a stock item.");
    const updated = await tx.stockItem.updateMany({ where: { id, version: input.expectedVersion }, data: { ...(input.name === undefined ? {} : { name: input.name }), ...(input.category === undefined ? {} : { category: input.category }), ...(input.baseUnit === undefined ? {} : { baseUnit: input.baseUnit }), version: { increment: 1 } } });
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
    const row = await tx.stockItem.findUniqueOrThrow({ where: { id }, include: { conversions: true, balance: true } });
    await audit(tx, actor.id, requestId, "UPDATE_STOCK_ITEM", "STOCK_ITEM", id, { version: current.version }, { version: row.version });
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
    const row = await tx.stockItem.findUniqueOrThrow({ where: { id }, include: { conversions: true, balance: true } });
    await audit(tx, actor.id, requestId, "ARCHIVE_STOCK_ITEM", "STOCK_ITEM", id, undefined, { version: row.version });
    return dtoStock(row);
  });
}

function purchaseDto(row: any) {
  return { id: row.id, status: row.status, receivedAt: row.receivedAt.toISOString(), supplier: row.supplier, version: row.version, postedAt: row.postedAt?.toISOString() ?? null,
    lines: row.lines.map((line: any) => ({ id: line.id, stockItemId: line.stockItemId, conversionId: line.conversionId, purchaseUnitLabel: line.purchaseUnitLabel, purchaseQuantity: dstr(line.purchaseQuantity), directCostAmount: line.directCostAmount, baseQuantityPerPack: dstr(line.baseQuantityPerPack), baseQuantityReceived: dstr(line.baseQuantityReceived) })) };
}
async function preparePurchaseLines(tx: Tx, lines: PurchaseInput["lines"]) {
  const prepared: any[] = [];
  for (const line of lines) {
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
    const baseQuantityReceived = decimal(line.purchaseQuantity).mul(pack);
    if (baseQuantityReceived.decimalPlaces() > 6 || baseQuantityReceived.gte("100000000000000")) {
      throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The converted purchase quantity must fit the supported range and be exact to six decimal places.", [{ path: `lines.${prepared.length}.purchaseQuantity`, code: "quantity_precision", message: "Use a quantity whose package conversion is exact to six decimal places." }]);
    }
    prepared.push({ stockItemId: stock.id, conversionId: line.conversionId, purchaseUnitLabel: line.purchaseUnitLabel, purchaseQuantity: decimal(line.purchaseQuantity), baseQuantityPerPack: pack, baseQuantityReceived, directCostAmount: line.directCostAmount });
  }
  return prepared;
}
export async function listPurchases(prisma: PrismaClient, query: InventoryListQuery) {
  const cursor = decodePageCursor(query.cursor);
  const rows = await prisma.purchase.findMany({ where: cursor ? { OR: [{ receivedAt: { lt: cursor.at } }, { receivedAt: cursor.at, id: { lt: cursor.id } }] } : {}, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: query.limit + 1, include: { lines: { orderBy: { createdAt: "asc" } } } });
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
    const lines = input.lines ? await preparePurchaseLines(tx, input.lines) : undefined;
    const result = await tx.purchase.updateMany({ where: { id, version: input.expectedVersion, status: PurchaseStatus.DRAFT }, data: { ...(input.receivedAt === undefined ? {} : { receivedAt: new Date(input.receivedAt) }), ...(input.supplier === undefined ? {} : { supplier: input.supplier }), version: { increment: 1 } } });
    if (result.count !== 1) fail(409, ErrorCodes.STALE_VERSION, "The purchase has changed.");
    if (lines) { await tx.purchaseLine.deleteMany({ where: { purchaseId: id } }); await tx.purchaseLine.createMany({ data: lines.map((line) => ({ ...line, purchaseId: id })) }); }
    const row = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    await audit(tx, actor.id, requestId, "UPDATE_INVENTORY_PURCHASE", "PURCHASE", id, { version: current.version }, { version: row.version });
    return purchaseDto(row);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

type FlatComponent = { stockItemId: string; stockItemName: string; baseUnit: string; quantity: Prisma.Decimal; sourceKey: string };
type CostSnapshot = { components: Array<{ stockItemId: string; stockItemName: string; baseUnit: string; quantity: string; knownCostAmount: number | null }>; isComplete: boolean; missingReasons: string[]; configurationVersion: number | null };
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
    if (component.sourceKind === "STOCK_ITEM" && component.stockItem) result.push({ stockItemId: component.stockItem.id, stockItemName: component.stockItem.name, baseUnit: component.stockItem.baseUnit, quantity, sourceKey: path });
    else if (component.nestedRecipeId) result.push(...await flattenRecipe(tx, component.nestedRecipeId, quantity, path, nextSeen, missingReasons));
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
async function resolveCosting(tx: Tx, productId: string, optionIds: string[], quantity: number, weightGrams: number | null, includeCosts: boolean): Promise<CostSnapshot> {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, name: true, pricingMode: true } });
  if (!product) return { components: [], isComplete: false, missingReasons: ["product-not-found"], configurationVersion: null };
  const config: any = await tx.productCostingConfiguration.findUnique({ where: { productId }, include: { product: { select: { optionCostingRules: { include: { replacementStockItem: true, replacementRecipe: true } }, costingCombinations: { where: { isActive: true }, include: { options: true, rules: { include: { replacementStockItem: true, replacementRecipe: true } } } } } } } });
  if (!config) return { components: [], isComplete: false, missingReasons: [`missing-costing:${product.name}`], configurationVersion: null };
  const sortedOptionIds = [...new Set(optionIds)].sort();
  const applicable = config.product.costingCombinations.filter((combo: any) => {
    const ids = combo.options.map((entry: any) => entry.optionId).sort();
    return ids.length === sortedOptionIds.length && ids.every((id: string, i: number) => id === sortedOptionIds[i]);
  });
  if (applicable.length > 1) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "More than one costing combination matches the selected options.");
  const unitMultiplier = product.pricingMode === "WEIGHTED_PER_KG"
    ? decimal((weightGrams ?? 0) * quantity).div(1000)
    : decimal(quantity);
  const missingReasons: string[] = [];
  const root: Array<{ componentKey: string; label: string; sourceKind: "STOCK_ITEM" | "RECIPE"; sourceId: string; quantity: Prisma.Decimal }> = [];
  if (config.mode === "RECIPE") {
    const recipe = await tx.recipe.findUnique({ where: { id: config.recipeId }, include: { components: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }] } } });
    if (recipe && recipe.isActive && !recipe.archivedAt) for (const component of recipe.components) root.push({ componentKey: component.componentKey, label: component.label, sourceKind: component.sourceKind, sourceId: component.stockItemId ?? component.nestedRecipeId!, quantity: component.quantity.mul(decimal(config.recipeQuantity).mul(unitMultiplier)).div(recipe.yieldQuantity) });
    else missingReasons.push(`missing-recipe:${config.recipeId}`);
  } else {
    const stock = await tx.stockItem.findFirst({ where: { id: config.purchasedStockItemId, isActive: true, archivedAt: null } });
    const units = product.pricingMode === "WEIGHTED_PER_KG" ? decimal((weightGrams ?? 0) * quantity) : decimal(config.purchasedQuantity ?? 1).mul(quantity);
    if (stock) root.push({ componentKey: "$purchased", label: stock.name, sourceKind: "STOCK_ITEM", sourceId: config.purchasedStockItemId, quantity: units });
    else missingReasons.push(`missing-stock:${config.purchasedStockItemId}`);
  }
  const optionRuleRows = config.product.optionCostingRules.filter((rule: any) => sortedOptionIds.includes(rule.optionId));
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
      flattened.push({ stockItemId: stock.id, stockItemName: stock.name, baseUnit: stock.baseUnit, quantity: component.quantity, sourceKey: component.componentKey });
    } else flattened.push(...await flattenRecipe(tx, component.sourceId, component.quantity, component.componentKey, new Set(), missingReasons));
  }
  if (config.extrasRecipeId) flattened.push(...await flattenRecipe(tx, config.extrasRecipeId, unitMultiplier, "", new Set(), missingReasons));
  const merged = new Map<string, FlatComponent>();
  for (const component of flattened) {
    const key = `${component.stockItemId}:${component.baseUnit}`;
    const old = merged.get(key);
    if (old) old.quantity = old.quantity.plus(component.quantity);
    else merged.set(key, { ...component });
  }
  const resolved = [];
  for (const component of merged.values()) {
    const balance = includeCosts ? await tx.inventoryBalance.findUnique({ where: { stockItemId: component.stockItemId } }) : null;
    const tracked = !!balance?.trackingStartedAt;
    const knownCostAmount = tracked ? intMoney(component.quantity.mul(balance!.quantityOnHand.gt(0) ? decimal(balance!.carryingValueAmount).div(balance!.quantityOnHand) : decimal(0))) : null;
    if (!tracked && includeCosts) missingReasons.push(`missing-valuation:${component.stockItemId}`);
    resolved.push({ stockItemId: component.stockItemId, stockItemName: component.stockItemName, baseUnit: component.baseUnit, quantity: dstr(component.quantity), knownCostAmount });
  }
  return { components: resolved, isComplete: missingReasons.length === 0 && resolved.every((component) => component.knownCostAmount !== null), missingReasons: [...new Set(missingReasons)], configurationVersion: config.version };
}

function serializeRules(rules: any[]) { return rules.map(ruleDto); }
function ruleFields(rule: any) {
  const component = rule.replacement ?? rule.component;
  return { action: rule.action, componentKey: rule.componentKey, label: rule.label ?? null, quantity: rule.quantity ? decimal(rule.quantity) : null, replacementStockItemId: component?.sourceKind === "STOCK_ITEM" ? component.stockItemId : null, replacementRecipeId: component?.sourceKind === "RECIPE" ? component.recipeId : null };
}
async function validateCostingInput(tx: Tx, productId: string, input: CostingInput) {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, pricingMode: true, productOptionGroups: { select: { allowedOptions: { select: { optionId: true } } } } } });
  if (!product) fail(404, ErrorCodes.NOT_FOUND, "The product was not found.");
  const allowed = new Set(product.productOptionGroups.flatMap((group: any) => group.allowedOptions.map((option: any) => option.optionId)));
  const allOptions = [
    ...input.optionRules.map((entry) => entry.optionId),
    ...input.combinations.flatMap((entry) => entry.optionIds),
  ];
  if (new Set(input.optionRules.map((entry) => entry.optionId)).size !== input.optionRules.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Each option can have only one costing-rule group.");
  for (const entry of input.optionRules) if (new Set(entry.rules.map((rule) => rule.componentKey)).size !== entry.rules.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An option cannot define multiple rules for the same component.");
  if (new Set(input.combinations.map((entry) => entry.name.toLocaleLowerCase())).size !== input.combinations.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Costing combination names must be unique.");
  const combinationKeys = input.combinations.map((entry) => [...entry.optionIds].sort().join("|"));
  if (new Set(combinationKeys).size !== combinationKeys.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Only one costing override can use a particular option combination.");
  for (const combination of input.combinations) if (new Set(combination.rules.map((rule) => rule.componentKey)).size !== combination.rules.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A costing combination cannot define multiple rules for the same component.");
  if (allOptions.some((id) => !allowed.has(id))) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Every costing option must belong to this product.");
  if (input.mode === "RECIPE") {
    const recipe = await tx.recipe.findFirst({ where: { id: input.recipeId, isActive: true, archivedAt: null } });
    if (!recipe) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active recipe is required.");
    if (product.pricingMode === "WEIGHTED_PER_KG" && recipe.outputUnit !== "GRAM") fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Weighted products require a recipe measured in grams.");
  } else {
    const stock = await tx.stockItem.findFirst({ where: { id: input.purchasedStockItemId, isActive: true, archivedAt: null } });
    if (!stock) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active purchased stock item is required.");
    if (product.pricingMode === "WEIGHTED_PER_KG" && stock.baseUnit !== "GRAM") fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Weighted products require purchased stock measured in grams.");
  }
  const ruleInputs = [...input.optionRules.flatMap((entry) => entry.rules), ...input.combinations.flatMap((entry) => entry.rules)];
  for (const rule of ruleInputs) {
    if (rule.action !== "ADD_COMPONENT" && input.mode === "RECIPE") {
      const recipe = await tx.recipe.findUnique({ where: { id: input.recipeId }, include: { components: { select: { componentKey: true } } } });
      if (!recipe?.components.some((component) => component.componentKey === rule.componentKey)) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A costing rule references an unknown base recipe component.");
    }
    const component = rule.action === "ADD_COMPONENT" ? rule.component : rule.action === "REPLACE_COMPONENT" ? rule.replacement : null;
    if (component?.sourceKind === "STOCK_ITEM" && !await tx.stockItem.findFirst({ where: { id: component.stockItemId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A costing rule references an unavailable stock item.");
    if (component?.sourceKind === "RECIPE" && !await tx.recipe.findFirst({ where: { id: component.recipeId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A costing rule references an unavailable recipe.");
  }
  if (input.extrasRecipeId && !await tx.recipe.findFirst({ where: { id: input.extrasRecipeId, isActive: true, archivedAt: null } })) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An active extras recipe is required.");
  for (const combination of input.combinations) if (new Set(combination.optionIds).size !== combination.optionIds.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Combination option IDs must be unique.");
}
function configurationDto(row: any) {
  if (!row) return null;
  const common = { productId: row.productId, extrasRecipeId: row.extrasRecipeId, optionRules: row.product.optionCostingRules.reduce((result: any[], rule: any) => { let item = result.find((entry) => entry.optionId === rule.optionId); if (!item) { item = { optionId: rule.optionId, rules: [] }; result.push(item); } item.rules.push(ruleDto(rule)); return result; }, []), combinations: row.product.costingCombinations.map((combo: any) => ({ id: combo.id, name: combo.name, optionIds: combo.options.map((option: any) => option.optionId), rules: serializeRules(combo.rules), version: combo.version, isActive: combo.isActive })), version: row.version, updatedAt: row.updatedAt.toISOString() };
  return row.mode === "RECIPE" ? { ...common, mode: row.mode, recipeId: row.recipeId, recipeQuantity: dstr(row.recipeQuantity) } : { ...common, mode: row.mode, purchasedStockItemId: row.purchasedStockItemId, purchasedQuantity: row.purchasedQuantity ? dstr(row.purchasedQuantity) : null };
}
const configInclude = { product: { select: { optionCostingRules: { include: { replacementStockItem: true, replacementRecipe: true }, orderBy: { componentKey: "asc" as const } }, costingCombinations: { orderBy: { name: "asc" as const }, include: { options: true, rules: { include: { replacementStockItem: true, replacementRecipe: true }, orderBy: { componentKey: "asc" as const } } } } } } };
async function replaceConfiguration(tx: Tx, actor: AuthenticatedUser, productId: string, input: CostingInput, requestId: string, existingVersion: number | null) {
  await validateCostingInput(tx, productId, input);
  if (existingVersion === null) {
    await tx.productCostingConfiguration.create({ data: { productId, mode: input.mode, recipeId: input.mode === "RECIPE" ? input.recipeId : null, recipeQuantity: input.mode === "RECIPE" ? decimal(input.recipeQuantity) : null, purchasedStockItemId: input.mode === "PURCHASED_ITEM" ? input.purchasedStockItemId : null, purchasedQuantity: input.mode === "PURCHASED_ITEM" ? decimal(input.purchasedQuantity ?? "1") : null, extrasRecipeId: input.extrasRecipeId ?? null, updatedById: actor.id } });
  } else {
    const changed = await tx.productCostingConfiguration.updateMany({ where: { productId, version: existingVersion }, data: { mode: input.mode, recipeId: input.mode === "RECIPE" ? input.recipeId : null, recipeQuantity: input.mode === "RECIPE" ? decimal(input.recipeQuantity) : null, purchasedStockItemId: input.mode === "PURCHASED_ITEM" ? input.purchasedStockItemId : null, purchasedQuantity: input.mode === "PURCHASED_ITEM" ? decimal(input.purchasedQuantity ?? "1") : null, extrasRecipeId: input.extrasRecipeId ?? null, updatedById: actor.id, version: { increment: 1 } } });
    if (changed.count !== 1) fail(409, ErrorCodes.STALE_VERSION, "The costing configuration has changed.");
    await tx.productOptionCostingRule.deleteMany({ where: { productId } });
  }
  const oldCombos = await tx.productCostingCombination.findMany({ where: { productId }, select: { id: true } });
  await tx.productCombinationCostingRule.deleteMany({ where: { combinationId: { in: oldCombos.map((combo) => combo.id) } } });
  await tx.costingCombinationOption.deleteMany({ where: { combinationId: { in: oldCombos.map((combo) => combo.id) } } });
  await tx.productCostingCombination.deleteMany({ where: { productId } });
  for (const combo of input.combinations) await tx.productCostingCombination.create({ data: { productId, name: combo.name, options: { create: combo.optionIds.map((optionId) => ({ optionId })) }, rules: { create: combo.rules.map(ruleFields) } } });
  await tx.productOptionCostingRule.createMany({ data: input.optionRules.flatMap((entry) => entry.rules.map((rule) => ({ productId, optionId: entry.optionId, ...ruleFields(rule) }))) });
  const completeRow = await tx.productCostingConfiguration.findUniqueOrThrow({ where: { productId }, include: configInclude });
  await audit(tx, actor.id, requestId, existingVersion === null ? "CREATE_PRODUCT_COSTING" : "UPDATE_PRODUCT_COSTING", "PRODUCT_COSTING", productId, { version: existingVersion }, { version: completeRow.version });
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
export async function previewProductCosting(prisma: PrismaClient, productId: string, optionIds: string[], quantity: number, weightGrams: number | null) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      productOptionGroups: {
        include: {
          optionGroup: { select: { id: true, isActive: true, archivedAt: true } },
          allowedOptions: { include: { option: { select: { id: true, isActive: true, isAvailable: true, archivedAt: true } } } },
        },
      },
    },
  });
  if (!product) fail(404, ErrorCodes.NOT_FOUND, "The product was not found.");
  if (new Set(optionIds).size !== optionIds.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Selected option IDs must be unique.");
  const allowed = new Map<string, string>();
  for (const group of product.productOptionGroups) if (group.optionGroup.isActive && !group.optionGroup.archivedAt) for (const link of group.allowedOptions) if (link.option.isActive && link.option.isAvailable && !link.option.archivedAt) allowed.set(link.option.id, group.optionGroup.id);
  if (optionIds.some((id) => !allowed.has(id))) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Every selected option must be active and available for this product.");
  for (const group of product.productOptionGroups) {
    if (!group.optionGroup.isActive || group.optionGroup.archivedAt) continue;
    const selected = optionIds.filter((id) => allowed.get(id) === group.optionGroup.id).length;
    if (selected < group.minSelections || selected > group.maxSelections) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Selected options do not satisfy the product option groups.");
  }
  const snapshot = await resolveCosting(prisma as unknown as Tx, productId, optionIds, quantity, weightGrams, true);
  return { isComplete: snapshot.isComplete, knownCostAmount: snapshot.components.reduce((sum, component) => sum + (component.knownCostAmount ?? 0), 0), components: snapshot.components, missingReasons: snapshot.missingReasons };
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

function countDto(row: any) { return { id: row.id, kind: row.kind, status: row.status, version: row.version, postedAt: row.postedAt?.toISOString() ?? null, lines: row.lines.map((line: any) => ({ stockItemId: line.stockItemId, observedQuantity: dstr(line.observedQuantity), observedValueAmount: line.observedValueAmount, expectedQuantity: line.expectedQuantity === null ? null : dstr(line.expectedQuantity), differenceQuantity: line.differenceQuantity === null ? null : dstr(line.differenceQuantity), expectedValueAmount: line.expectedValueAmount, differenceValueAmount: line.differenceValueAmount })) }; }
async function countInclude(tx: Tx) { return { lines: { orderBy: { stockItemId: "asc" as const } } }; }
export async function listCounts(prisma: PrismaClient, query: InventoryListQuery) {
  const cursor = decodePageCursor(query.cursor);
  const rows = await prisma.inventoryCount.findMany({ where: cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {}, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1, include: { lines: { orderBy: { stockItemId: "asc" } } } });
  const hasMore = rows.length > query.limit; const page = rows.slice(0, query.limit);
  return { counts: page.map(countDto), page: { limit: query.limit, nextCursor: hasMore ? encodePageCursor({ id: page[page.length - 1]!.id, recordedAt: page[page.length - 1]!.createdAt }) : null, hasMore } };
}
export async function createCount(prisma: PrismaClient, actor: AuthenticatedUser, input: CountInput, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const items = await tx.stockItem.findMany({ where: { id: { in: input.lines.map((line) => line.stockItemId) }, isActive: true, archivedAt: null }, select: { id: true } });
    if (items.length !== input.lines.length) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Every count line must reference a distinct active stock item.");
    const balances = await tx.inventoryBalance.findMany({ where: { stockItemId: { in: input.lines.map((line) => line.stockItemId) } } });
    const balanceById = new Map(balances.map((balance) => [balance.stockItemId, balance]));
    if (input.kind === InventoryCountKind.PHYSICAL && input.lines.some((line) => !balanceById.get(line.stockItemId)?.trackingStartedAt)) fail(409, ErrorCodes.INVALID_STATE, "A physical count can include only items whose opening count has been posted.");
    if (input.kind === InventoryCountKind.OPENING && input.lines.some((line) => balanceById.get(line.stockItemId)?.trackingStartedAt)) fail(409, ErrorCodes.INVALID_STATE, "An opening count cannot reset an already tracked item.");
    const row = await tx.inventoryCount.create({ data: { kind: input.kind, createdById: actor.id, lines: { create: input.lines.map((line) => { const expected = balanceById.get(line.stockItemId); const observed = decimal(line.observedQuantity); return { stockItemId: line.stockItemId, observedQuantity: observed, observedValueAmount: line.observedValueAmount, ...(input.kind === InventoryCountKind.PHYSICAL && expected ? { expectedQuantity: expected.quantityOnHand, differenceQuantity: observed.minus(expected.quantityOnHand), expectedValueAmount: expected.carryingValueAmount, differenceValueAmount: line.observedValueAmount - expected.carryingValueAmount } : {}) }; }) } }, include: { lines: true } });
    await audit(tx, actor.id, requestId, "CREATE_INVENTORY_COUNT", "INVENTORY_COUNT", row.id, undefined, { kind: row.kind, lineCount: row.lines.length }); return countDto(row);
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
    if (row.kind === InventoryCountKind.PHYSICAL && input.lines.some((line) => !balanceById.get(line.stockItemId)?.trackingStartedAt)) fail(409, ErrorCodes.INVALID_STATE, "A physical count can include only items whose opening count has been posted.");
    if (row.kind === InventoryCountKind.OPENING && input.lines.some((line) => balanceById.get(line.stockItemId)?.trackingStartedAt)) fail(409, ErrorCodes.INVALID_STATE, "An opening count cannot reset an already tracked item.");
    await tx.inventoryCountLine.deleteMany({ where: { countId: id } });
    await tx.inventoryCountLine.createMany({ data: input.lines.map((line) => { const expected = balanceById.get(line.stockItemId); const observed = decimal(line.observedQuantity); return { countId: id, stockItemId: line.stockItemId, observedQuantity: observed, observedValueAmount: line.observedValueAmount, ...(row.kind === InventoryCountKind.PHYSICAL && expected ? { expectedQuantity: expected.quantityOnHand, differenceQuantity: observed.minus(expected.quantityOnHand), expectedValueAmount: expected.carryingValueAmount, differenceValueAmount: line.observedValueAmount - expected.carryingValueAmount } : {}) }; }) });
    const changed = await tx.inventoryCount.updateMany({ where: { id, version: input.expectedVersion, status: InventoryCountStatus.DRAFT }, data: { version: { increment: 1 } } });
    if (changed.count !== 1) fail(409, ErrorCodes.STALE_VERSION, "The inventory count has changed.");
    const updated = await tx.inventoryCount.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    await audit(tx, actor.id, requestId, "UPDATE_INVENTORY_COUNT", "INVENTORY_COUNT", id, { version: row.version }, { version: updated.version }); return countDto(updated);
  });
}

async function trackOrderItemSnapshots(tx: Tx, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, include: { options: true } });
  for (const item of items) {
    const snapshot = await resolveCosting(tx, item.productId, item.options.map((option) => option.optionId), item.quantity, item.weightGrams, false);
    await tx.orderItemCostingSnapshot.upsert({ where: { orderItemId: item.id }, create: { orderItemId: item.id, configurationVersion: snapshot.configurationVersion, snapshot: snapshot as unknown as Prisma.InputJsonValue, isComplete: snapshot.missingReasons.length === 0, missingReasons: snapshot.missingReasons as unknown as Prisma.InputJsonValue }, update: { configurationVersion: snapshot.configurationVersion, snapshot: snapshot as unknown as Prisma.InputJsonValue, isComplete: snapshot.missingReasons.length === 0, missingReasons: snapshot.missingReasons as unknown as Prisma.InputJsonValue } });
  }
}
async function readOrderItemSnapshots(tx: Tx, orderId: string): Promise<Array<{ itemId: string; productName: string; quantity: number; weightGrams: number | null; components: CostSnapshot["components"]; missingReasons: string[] }>> {
  const items = await tx.orderItem.findMany({ where: { orderId }, include: { costingSnapshot: true } });
  return items.map((item) => {
    const saved = (item.costingSnapshot?.snapshot ?? {}) as unknown as CostSnapshot;
    return { itemId: item.id, productName: item.productNameSnapshot, quantity: item.quantity, weightGrams: item.weightGrams, components: saved.components ?? [], missingReasons: saved.missingReasons ?? ["missing-costing-snapshot"] };
  });
}
async function recordFullPaymentConsumption(tx: Tx, order: any, settlementId: string, actorId: string, at: Date) {
  const existing = await tx.orderConsumption.findUnique({ where: { orderId_paymentSettlementId: { orderId: order.id, paymentSettlementId: settlementId } } });
  if (existing) return existing;
  const cycleNumber = (await tx.orderConsumption.aggregate({ where: { orderId: order.id }, _max: { cycleNumber: true } }))._max.cycleNumber ?? 0;
  const snapshots = await readOrderItemSnapshots(tx, order.id);
  const missing = new Set<string>();
  const itemAmounts: Array<{ snapshot: typeof snapshots[number]; amount: number; known: number; complete: boolean; components: Array<any> }> = [];
  const allNeeds = new Map<string, Prisma.Decimal>();
  for (const snapshot of snapshots) {
    for (const reason of snapshot.missingReasons) missing.add(reason);
    const components = [];
    let known = 0; let complete = snapshot.missingReasons.length === 0;
    for (const component of snapshot.components) {
      const balance = await tx.inventoryBalance.findUnique({ where: { stockItemId: component.stockItemId } });
      const tracked = !!balance?.trackingStartedAt;
      const cost = tracked ? intMoney(decimal(component.quantity).mul(balance!.quantityOnHand.gt(0) ? decimal(balance!.carryingValueAmount).div(balance!.quantityOnHand) : decimal(0))) : null;
      if (!tracked) { complete = false; missing.add(`missing-valuation:${component.stockItemId}`); }
      if (cost !== null) known += cost;
      else complete = false;
      allNeeds.set(component.stockItemId, (allNeeds.get(component.stockItemId) ?? decimal(0)).plus(component.quantity));
      components.push({ ...component, knownCostAmount: cost });
    }
    itemAmounts.push({ snapshot, amount: complete ? known : 0, known, complete, components });
  }
  const movementRows = [...allNeeds].map(([stockItemId, quantity]) => ({ stockItemId, quantity }));
  await lock(tx, movementRows.map((need) => `inventory:${need.stockItemId}`));
  const stockRows = movementRows.length ? await tx.inventoryBalance.findMany({ where: { stockItemId: { in: movementRows.map((row) => row.stockItemId) } } }) : [];
  const balanceById = new Map(stockRows.map((row) => [row.stockItemId, row]));
  let canFulfill = movementRows.length > 0 && !snapshots.some((snapshot) => snapshot.missingReasons.length > 0);
  for (const { stockItemId, quantity } of movementRows) {
    const balance = balanceById.get(stockItemId);
    if (!balance?.trackingStartedAt || balance.quantityOnHand.lt(quantity)) canFulfill = false;
  }
  const knownCogsAmount = itemAmounts.reduce((sum, item) => sum + item.known, 0);
  const isCostComplete = itemAmounts.every((item) => item.complete) && snapshots.length > 0;
  const theoreticalCogsAmount = isCostComplete ? knownCogsAmount : null;
  const consumption = await tx.orderConsumption.create({ data: { orderId: order.id, cycleNumber: cycleNumber + 1, paymentSettlementId: settlementId, status: canFulfill ? OrderConsumptionStatus.POSTED : OrderConsumptionStatus.PENDING, recognizedById: actorId, recognizedAt: at, resolvedAt: canFulfill ? at : null, theoreticalCogsAmount, knownCogsAmount, isCostComplete, costSnapshot: itemAmounts.map((item) => ({ orderItemId: item.snapshot.itemId, productNameSnapshot: item.snapshot.productName, quantity: item.snapshot.quantity, weightGrams: item.snapshot.weightGrams, theoreticalCogsAmount: item.complete ? item.amount : null, knownCogsAmount: item.known, isCostComplete: item.complete, components: item.components })) as unknown as Prisma.InputJsonValue, items: { create: itemAmounts.map((item) => ({ orderItemId: item.snapshot.itemId, productNameSnapshot: item.snapshot.productName, quantity: item.snapshot.quantity, weightGrams: item.snapshot.weightGrams, theoreticalCogsAmount: item.complete ? item.amount : null, knownCogsAmount: item.known, isCostComplete: item.complete, costSnapshot: { components: item.components, missingReasons: item.snapshot.missingReasons } })) } } });
  if (canFulfill && !await consumeStockForOrder(tx, consumption.id, movementRows, actorId, at)) await tx.orderConsumption.update({ where: { id: consumption.id }, data: { status: OrderConsumptionStatus.PENDING, resolvedAt: null } });
  return consumption;
}
async function consumeStockForOrder(tx: Tx, consumptionId: string, needs: Array<{ stockItemId: string; quantity: Prisma.Decimal }>, actorId: string, at: Date) {
  await lock(tx, needs.map((need) => `inventory:${need.stockItemId}`));
  const balances = await tx.inventoryBalance.findMany({ where: { stockItemId: { in: needs.map((need) => need.stockItemId) } } });
  const byId = new Map(balances.map((balance) => [balance.stockItemId, balance]));
  if (needs.some((need) => { const balance = byId.get(need.stockItemId); return !balance?.trackingStartedAt || balance.quantityOnHand.lt(need.quantity); })) return false;
  for (const need of needs) {
    const balance = byId.get(need.stockItemId)!;
    const nextQuantity = balance.quantityOnHand.minus(need.quantity);
    const value = nextQuantity.isZero() ? balance.carryingValueAmount : intMoney(need.quantity.mul(balance.quantityOnHand.gt(0) ? decimal(balance.carryingValueAmount).div(balance.quantityOnHand) : decimal(0)));
    const valueDeltaAmount = nextQuantity.isZero() ? -balance.carryingValueAmount : -Math.min(balance.carryingValueAmount, value);
    await tx.inventoryMovement.create({ data: { stockItemId: need.stockItemId, kind: InventoryMovementKind.ORDER_CONSUMPTION, quantityDelta: need.quantity.negated(), valueDeltaAmount, orderConsumptionId: consumptionId, createdById: actorId, occurredAt: at } });
    await tx.inventoryBalance.update({ where: { stockItemId: need.stockItemId }, data: { quantityOnHand: nextQuantity, carryingValueAmount: balance.carryingValueAmount + valueDeltaAmount } });
  }
  return true;
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
export async function retryPendingConsumptions(tx: Tx, actorId: string, at = new Date()) {
  const pending = await tx.orderConsumption.findMany({ where: { status: OrderConsumptionStatus.PENDING, order: { state: { not: "DELETED" }, paymentStatus: "PAID" } }, orderBy: [{ recognizedAt: "asc" }, { id: "asc" }], include: { items: true } });
  let resolved = 0;
  for (const item of pending) {
    const needs = await needsFromConsumption(tx, item.id);
    if (needs.length === 0) continue;
    await lock(tx, needs.map((need) => `inventory:${need.stockItemId}`));
    const balances = await tx.inventoryBalance.findMany({ where: { stockItemId: { in: needs.map((need) => need.stockItemId) } } });
    const byId = new Map(balances.map((balance) => [balance.stockItemId, balance]));
    if (needs.some((need) => { const balance = byId.get(need.stockItemId); return !balance?.trackingStartedAt || balance.quantityOnHand.lt(need.quantity); })) continue;
    await consumeStockForOrder(tx, item.id, needs, actorId, at);
    await tx.orderConsumption.update({ where: { id: item.id }, data: { status: OrderConsumptionStatus.POSTED, resolvedAt: at } });
    resolved++;
  }
  return resolved;
}

export async function postPurchase(prisma: PrismaClient, actor: AuthenticatedUser, id: string, expectedVersion: number, key: string, requestId: string) {
  const fingerprint = sha({ id, expectedVersion });
  const existing = await prisma.idempotencyRecord.findUnique({ where: { actorId_operation_key: { actorId: actor.id, operation: POST_PURCHASE, key } } });
  if (existing) { if (existing.requestFingerprint !== fingerprint) fail(409, ErrorCodes.IDEMPOTENCY_CONFLICT, "This idempotency key was already used for a different request."); return existing.resultSnapshot as any; }
  try {
    return await prisma.$transaction(async (tx) => {
      await lock(tx, [`purchase:${id}`]);
      const purchase = await tx.purchase.findUnique({ where: { id }, include: { lines: true } });
      if (!purchase) fail(404, ErrorCodes.NOT_FOUND, "The purchase was not found.");
      if (purchase.version !== expectedVersion) stale("The purchase has changed.", purchase.version);
      if (purchase.status !== PurchaseStatus.DRAFT) fail(409, ErrorCodes.INVALID_STATE, "The purchase is already posted.");
      await lock(tx, purchase.lines.map((line) => `inventory:${line.stockItemId}`));
      const occurredAt = new Date();
      for (const line of purchase.lines) {
        const balance = await tx.inventoryBalance.findUnique({ where: { stockItemId: line.stockItemId } });
        if (!balance?.trackingStartedAt) fail(409, ErrorCodes.INVALID_STATE, "An opening count must be posted before received purchases can update tracked inventory.");
        const nextQty = balance.quantityOnHand.plus(line.baseQuantityReceived);
        const nextValue = balance.carryingValueAmount + line.directCostAmount;
        if (nextQty.gte("100000000000000") || nextValue > 2_147_483_647) fail(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "This receipt would exceed the supported inventory quantity or value.");
        await tx.inventoryMovement.create({ data: { stockItemId: line.stockItemId, kind: InventoryMovementKind.PURCHASE_RECEIPT, quantityDelta: line.baseQuantityReceived, valueDeltaAmount: line.directCostAmount, purchaseLineId: line.id, createdById: actor.id, occurredAt: purchase.receivedAt } });
        await tx.inventoryBalance.update({ where: { stockItemId: line.stockItemId }, data: { quantityOnHand: nextQty, carryingValueAmount: nextValue } });
      }
      const updated = await tx.purchase.update({ where: { id }, data: { status: PurchaseStatus.POSTED, postedAt: occurredAt, version: { increment: 1 } }, include: { lines: true } });
      const retried = await retryPendingConsumptions(tx, actor.id, occurredAt);
      await audit(tx, actor.id, requestId, POST_PURCHASE, "PURCHASE", id, { status: purchase.status }, { status: updated.status, retriedPendingOrders: retried });
      const result = purchaseDto(updated);
      await tx.idempotencyRecord.create({ data: { actorId: actor.id, operation: POST_PURCHASE, key, requestFingerprint: fingerprint, responseStatus: 200, resultSnapshot: result, expiresAt: new Date(occurredAt.getTime() + IDEMPOTENCY_TTL) } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await prisma.idempotencyRecord.findUnique({ where: { actorId_operation_key: { actorId: actor.id, operation: POST_PURCHASE, key } } });
      if (replay?.requestFingerprint === fingerprint) return replay.resultSnapshot as any;
    }
    throw error;
  }
}

function movementDto(row: any) { return { id: row.id, stockItemId: row.stockItemId, kind: row.kind, quantityDelta: dstr(row.quantityDelta), valueDeltaAmount: row.valueDeltaAmount, purchaseLineId: row.purchaseLineId, orderConsumptionId: row.orderConsumptionId, inventoryCountLineId: row.inventoryCountLineId, compensatesMovementId: row.compensatesMovementId, occurredAt: row.occurredAt.toISOString(), recordedAt: row.recordedAt.toISOString() }; }
function decodePageCursor(value: string | undefined): { id: string; at: Date } | null {
  if (!value) return null;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { id?: string; at?: string }; const at = new Date(parsed.at ?? ""); if (!parsed.id || Number.isNaN(at.getTime())) throw new Error("invalid cursor"); return { id: parsed.id, at }; }
  catch { fail(400, ErrorCodes.BAD_REQUEST, "The cursor is invalid."); }
}
function encodePageCursor(row: { id: string; recordedAt: Date }) { return Buffer.from(JSON.stringify({ id: row.id, at: row.recordedAt.toISOString() })).toString("base64url"); }
export async function listInventoryMovements(prisma: PrismaClient, query: MovementQuery) {
  const cursor = decodePageCursor(query.cursor);
  const rows = await prisma.inventoryMovement.findMany({ where: { ...(query.stockItemId ? { stockItemId: query.stockItemId } : {}), ...(query.kind ? { kind: query.kind } : {}), ...(query.from || query.to ? { occurredAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}), ...(cursor ? { OR: [{ recordedAt: { lt: cursor.at } }, { recordedAt: cursor.at, id: { lt: cursor.id } }] } : {}) }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: query.limit + 1 });
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
    const missingStockItemIds = needs.filter((need) => { const balance = byId.get(need.stockItemId); return !balance?.trackingStartedAt || balance.quantityOnHand.lt(need.quantity); }).map((need) => need.stockItemId);
    consumptions.push({ id: row.id, orderId: row.order.id, orderNumber: row.order.orderNumber, recognizedAt: row.recognizedAt.toISOString(), knownCogsAmount: row.knownCogsAmount, isCostComplete: row.isCostComplete, missingStockItemIds });
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
      const pending = input.absorbedOrderConsumptionIds.length ? await tx.orderConsumption.findMany({ where: { id: { in: input.absorbedOrderConsumptionIds }, status: OrderConsumptionStatus.PENDING, order: { state: { not: "DELETED" }, paymentStatus: "PAID" } }, include: { items: true } }) : [];
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
      await audit(tx, actor.id, requestId, POST_COUNT, "INVENTORY_COUNT", id, { status: count.status }, { status: updated.status, reconciledOrders: pending.map((item) => item.id) });
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

export async function updateOrderCostingSnapshots(tx: Tx, orderId: string) { await trackOrderItemSnapshots(tx, orderId); }
export async function recognizeOrderFullPayment(tx: Tx, orderId: string, settlementId: string, actorId: string, at = new Date()) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { paymentSettlements: { where: { reversal: null }, select: { totalAmount: true } } } });
  if (!order || order.state === "DELETED" || order.paymentStatus !== "PAID") return null;
  const paid = order.paymentSettlements.reduce((sum, entry) => sum + entry.totalAmount, 0);
  if (paid !== order.totalAmount) return null;
  await lock(tx, [`order:${orderId}`]);
  return recordFullPaymentConsumption(tx, order, settlementId, actorId, at);
}

async function restoreConsumption(tx: Tx, consumption: any, actorId: string, at: Date) {
  if (consumption.status === OrderConsumptionStatus.PENDING || consumption.status === OrderConsumptionStatus.CANCELLED) {
    await tx.orderConsumption.update({ where: { id: consumption.id }, data: { status: OrderConsumptionStatus.CANCELLED, resolvedAt: at } });
    return;
  }
  const movements = await tx.inventoryMovement.findMany({ where: { orderConsumptionId: consumption.id, kind: InventoryMovementKind.ORDER_CONSUMPTION } });
  if (consumption.status === OrderConsumptionStatus.POSTED) {
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
      if (!countedLine || countedLine.observedQuantity.isZero()) fail(409, ErrorCodes.INVALID_STATE, "The reconciled count does not contain a carrying value for restored stock.");
      const restoredValue = intMoney(need.quantity.mul(decimal(countedLine.observedValueAmount).div(countedLine.observedQuantity)));
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
