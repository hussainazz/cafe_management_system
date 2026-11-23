import { createHash, randomUUID } from "node:crypto";
import {
  OrderChannel,
  DiscountKind,
  PaymentStatus,
  OrderState,
  Prisma,
  type PrismaClient,
} from "../../../generated/prisma/client.js";
import {
  type CreateOrderRequest,
  type DeleteOrderRequest,
  type EditSettlementRequest,
  type RecordSettlementRequest,
  type ReverseSettlementRequest,
  type OrderListQuery,
  type TransferOrderTableRequest,
  type UpdateOrderRequest,
  type DiscountInput,
  type PackagingAssignmentInput,
  type OrderItemReference,
} from "@cafe/contracts";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import type { AuthenticatedUser } from "../auth/auth.service.js";
import { requireRole } from "../auth/permissions.js";

import { preparationItems, type PreparationItem } from "./bar-ticket.js";
import { assertNoTerminalReservation } from "./terminal-reservation.js";
import { allocationAmountForQuantity, calculatedDiscount, catalogSaleDiscountAmount, discountedFinalAmount, paymentStatusForBalance } from "./order-calculations.js";
import { cancelAndRestoreOrderInventory, recognizeOrderFullPayment, recognizeStaffConsumption, updateOrderCostingSnapshots } from "../inventory/inventory.service.js";

const CREATE_ORDER_OPERATION = "CREATE_ORDER";
const RECORD_SETTLEMENT_OPERATION = "RECORD_SETTLEMENT";
const EDIT_SETTLEMENT_OPERATION = "EDIT_SETTLEMENT";
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;

async function lockOperationalKeys(transaction: Prisma.TransactionClient, keys: string[]) {
  for (const key of [...new Set(keys)].sort()) {
    await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}::text))`);
  }
}

function requestItemReferenceIds(assignments: PackagingAssignmentInput[], requestItemIds: Map<string, string>) {
  const seen = new Set<string>();
  return assignments.map((assignment) => {
    const packagingItemId = resolveItemReference(assignment.packagingItem, requestItemIds);
    const productItemId = resolveItemReference(assignment.productItem, requestItemIds);
    if (!packagingItemId || !productItemId) {
      throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A packaging assignment must reference items in this order request.");
    }
    if (packagingItemId === productItemId) {
      throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A packaging item cannot be assigned to itself.");
    }
    const key = packagingAssignmentKey(packagingItemId, productItemId);
    if (seen.has(key)) {
      throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An order item can only be assigned once to each packaging item.");
    }
    seen.add(key);
    return { packagingItemId, productItemId, quantity: assignment.quantity };
  });
}

type PackagingAssignmentRow = { packagingItemId: string; productItemId: string; quantity: number };

function validatePackagingAssignmentQuantities(
  items: Array<{ id: string; quantity: number; systemKey: string | null }>,
  assignments: PackagingAssignmentRow[],
  unchangedQuantities = new Map<string, number>(),
) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const packagedUnitCounts = new Map<string, number>();
  const assignedUnitCounts = new Map<string, number>();

  for (const assignment of assignments) {
    const packagingItem = itemById.get(assignment.packagingItemId);
    const productItem = itemById.get(assignment.productItemId);
    if (!packagingItem || !productItem) {
      throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A packaging assignment must reference items in this order.");
    }
    if (packagingItem.systemKey !== "PACKING" || productItem.systemKey === "PACKING") {
      throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A packaging assignment must link a packaging product to a menu product.");
    }
    packagedUnitCounts.set(packagingItem.id, (packagedUnitCounts.get(packagingItem.id) ?? 0) + assignment.quantity);
    assignedUnitCounts.set(productItem.id, (assignedUnitCounts.get(productItem.id) ?? 0) + assignment.quantity);
  }

  for (const item of items) {
    if (unchangedQuantities.get(item.id) === item.quantity) continue;
    const assignedQuantity = item.systemKey === "PACKING"
      ? packagedUnitCounts.get(item.id) ?? 0
      : assignedUnitCounts.get(item.id) ?? 0;
    if (item.systemKey === "PACKING" && assignedQuantity !== item.quantity) {
      throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A packaging item's quantity must equal the total assigned product quantity.");
    }
    if (item.systemKey !== "PACKING" && assignedQuantity > item.quantity) {
      throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An order item cannot be assigned to more packaging units than its quantity.");
    }
  }
}

type ProductForOrder = {
  id: string;
  systemKey: string | null;
  name: string;
  priceAmount: number;
  pricingMode: "FIXED" | "WEIGHTED_PER_KG";
  saleDiscountKind: DiscountKind | null;
  saleDiscountValue: number | null;
  preparationDeadlineMinutes: number;
  isActive: boolean;
  isAvailable: boolean;
  archivedAt: Date | null;
  category: { kind: "SOURCE" | "PROMOTIONAL"; archivedAt: Date | null };
  productOptionGroups: Array<{
    minSelections: number;
    maxSelections: number;
    allowedOptions: Array<{ priceAmountOverride: number | null; option: {
      id: string; name: string; priceAmount: number; isActive: boolean; isAvailable: boolean; archivedAt: Date | null;
    } }>;
    optionGroup: {
      id: string;
      isActive: boolean;
      archivedAt: Date | null;
    };
  }>;
};

const DEFAULT_PACKAGING_PRICE_AMOUNT = 20_000;

async function currentPackagingPriceAmount(transaction: Prisma.TransactionClient) {
  const settings = await transaction.cafeSettings.findUnique({
    where: { singletonKey: true },
    select: { packagingPriceAmount: true },
  });
  return settings?.packagingPriceAmount ?? DEFAULT_PACKAGING_PRICE_AMOUNT;
}

function withPackagingPrice(product: ProductForOrder, amount: number): ProductForOrder {
  return product.systemKey === "PACKING"
    ? { ...product, priceAmount: amount, saleDiscountKind: null, saleDiscountValue: null }
    : product;
}

function catalogOptions(product: ProductForOrder) {
  return new Map(product.productOptionGroups
    .filter(({ optionGroup }) => optionGroup.isActive && !optionGroup.archivedAt)
    .flatMap((group) => group.allowedOptions.map(({ option, priceAmountOverride }) => [option.id, { ...option, priceAmount: priceAmountOverride ?? option.priceAmount, optionGroupId: group.optionGroup.id }] as const)));
}

function validateOptionSelections(product: ProductForOrder, selected: Array<{ optionId: string; quantity: number }>, itemQuantity: number) {
  const options = catalogOptions(product);
  const perGroup = new Map<string, number>();
  for (const choice of selected) {
    const option = options.get(choice.optionId);
    if (!option || !option.isActive || !option.isAvailable || option.archivedAt) throw new ApplicationError(422, ErrorCodes.UNAVAILABLE_PRODUCT, "One or more selected options are unavailable.");
    if (choice.quantity > itemQuantity) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An option quantity cannot exceed its order item quantity.");
    perGroup.set(option.optionGroupId, (perGroup.get(option.optionGroupId) ?? 0) + 1);
  }
  for (const group of product.productOptionGroups) {
    const count = perGroup.get(group.optionGroup.id) ?? 0;
    if (count < group.minSelections || count > group.maxSelections) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Selected options do not satisfy the product option group.");
  }
  return options;
}

type CreatedOrder = {
  id: string;
  orderNumber: string;
  dailyOrderNumber: number;
  channel: "TABLE" | "TAKEAWAY";
  tableId: string | null;
  state: "OPEN" | "CLOSED" | "DELETED";
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  version: number;
  discountAmount: number;
  discountKind: "FIXED" | "PERCENTAGE" | null;
  discountValue: number | null;
  discountReason: string | null;
  subtotalAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  createdAt: string;
  items: Array<{
    id: string;
    productId: string;
    systemKey: string | null;
    productNameSnapshot: string;
    basePriceSnapshot: number;
    pricingModeSnapshot: "FIXED" | "WEIGHTED_PER_KG";
    weightGrams: number | null;
    quantity: number;
    note: string | null;
    discountKind: "FIXED" | "PERCENTAGE" | null;
    discountValue: number | null;
    discountAmount: number;
    discountReason: string | null;
    lineTotalAmount: number;
    options: Array<{
      optionId: string;
      optionNameSnapshot: string;
      priceSnapshot: number;
      quantity: number;
    }>;
  }>;
  packagingAssignments: Array<{
    id: string;
    packagingOrderItemId: string;
    packagingProductId: string;
    packagingProductNameSnapshot: string;
    productOrderItemId: string;
    productId: string;
    productNameSnapshot: string;
    quantity: number;
  }>;
};

type OrderTraceTable = { id: string; name: string };
type OrderCreationResult = { order: CreatedOrder; replayed: boolean; resolvedTable: OrderTraceTable | null };

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function requestFingerprint(input: unknown): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function resolveItemReference(reference: OrderItemReference, requestItemIds: Map<string, string>): string | undefined {
  return reference.kind === "EXISTING" ? reference.orderItemId : requestItemIds.get(reference.clientRef);
}

function packagingAssignmentKey(packagingItemId: string, productItemId: string): string {
  return `${packagingItemId}:${productItemId}`;
}

async function savePackagingAssignmentChanges(
  transaction: Prisma.TransactionClient,
  orderId: string,
  resolved: PackagingAssignmentRow[],
  previous: Array<PackagingAssignmentRow & { id: string }>,
  immutablePackagingIds: Set<string>,
) {
  const key = (row: PackagingAssignmentRow) => packagingAssignmentKey(row.packagingItemId, row.productItemId);
  const oldByKey = new Map(previous.map((row) => [key(row), row]));
  const newByKey = new Map(resolved.map((row) => [key(row), row]));
  const isFrozen = (row: PackagingAssignmentRow) => immutablePackagingIds.has(row.packagingItemId);
  if (previous.some((row) => isFrozen(row) && newByKey.get(key(row))?.quantity !== row.quantity)
    || resolved.some((row) => isFrozen(row) && oldByKey.get(key(row))?.quantity !== row.quantity)) {
    throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Assignments on a settled or inventory-recognized packaging charge cannot be changed.");
  }

  const removedIds = previous.filter((row) => !newByKey.has(key(row))).map((row) => row.id);
  if (removedIds.length) await transaction.orderItemPackagingAssignment.deleteMany({ where: { orderId, id: { in: removedIds } } });
  const added = [];
  for (const row of resolved) {
    const old = oldByKey.get(key(row));
    if (!old) added.push({ orderId, ...row });
    else if (old.quantity !== row.quantity) {
      await transaction.orderItemPackagingAssignment.update({ where: { id: old.id }, data: { quantity: row.quantity } });
    }
  }
  if (added.length) await transaction.orderItemPackagingAssignment.createMany({ data: added });
}

const tehranBusinessDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function tehranBusinessDate(value: Date): string {
  const parts = Object.fromEntries(tehranBusinessDateFormatter.formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function nextDailyOrderNumber(transaction: Prisma.TransactionClient, createdAt: Date): Promise<{ businessDate: string; number: number }> {
  const businessDate = tehranBusinessDate(createdAt);
  await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`daily-order:${businessDate}`}::text))`);
  const sequence = await transaction.dailyOrderSequence.upsert({
    where: { businessDate },
    create: { businessDate, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return { businessDate, number: sequence.lastNumber };
}

function isAvailableProduct(product: ProductForOrder): boolean {
  return (
    product.isActive &&
    (product.systemKey !== "PACKING" || product.isAvailable) &&
    !product.archivedAt &&
    product.category.kind === "SOURCE" &&
    !product.category.archivedAt
  );
}

function catalogSaleDiscount(product: ProductForOrder): DiscountInput {
  if (!product.saleDiscountKind || !product.saleDiscountValue) return null;
  return { kind: product.saleDiscountKind, value: product.saleDiscountValue };
}

function checkedOrderAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount > 2_147_483_647) {
    throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The order amount exceeds the supported Toman range.");
  }
  return amount;
}

function calculateLinePricing(input: {
  pricingMode: "FIXED" | "WEIGHTED_PER_KG";
  basePrice: number;
  options: Array<{ price: number; quantity: number }>;
  quantity: number;
  weightGrams?: number | null | undefined;
}) {
  const optionAmount = input.options.reduce((sum, option) => sum + option.price * option.quantity, 0);
  if (input.pricingMode === "FIXED") {
    if (input.weightGrams !== undefined && input.weightGrams !== null) {
      throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Fixed-price products cannot include a weight.");
    }
    const baseAmount = input.basePrice * input.quantity;
    return { baseAmount, grossLineAmount: checkedOrderAmount(baseAmount + optionAmount) };
  }
  if (!input.weightGrams || !Number.isSafeInteger(input.weightGrams) || input.weightGrams <= 0) {
    throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A positive weight is required for this product.");
  }
  const baseAmount = Math.floor((input.basePrice * input.weightGrams * input.quantity) / 1000);
  const weightedOptionAmount = Math.floor((optionAmount * input.weightGrams * input.quantity) / 1000);
  return { baseAmount, grossLineAmount: checkedOrderAmount(baseAmount + weightedOptionAmount) };
}

function resultFromSnapshot<T>(snapshot: Prisma.JsonValue): T {
  return snapshot as unknown as T;
}

async function existingIdempotencyResult<T>(
  prisma: PrismaClient,
  actorId: string,
  key: string,
  fingerprint: string,
  operation: string,
): Promise<T | undefined> {
  const record = await prisma.idempotencyRecord.findUnique({
    where: { actorId_operation_key: { actorId, operation, key } },
  });

  if (!record) {
    return undefined;
  }
  if (record.requestFingerprint !== fingerprint) {
    throw new ApplicationError(
      409,
      ErrorCodes.IDEMPOTENCY_CONFLICT,
      "This idempotency key was already used for a different request.",
    );
  }
  return resultFromSnapshot<T>(record.resultSnapshot);
}

export async function listPersonnelProfiles(prisma: PrismaClient) {
  return prisma.personnelProfile.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, createdAt: true },
  });
}

export async function createPersonnelProfile(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  name: string,
  requestId: string,
) {
  const normalizedName = name.trim();
  try {
    return await prisma.$transaction(async (transaction) => {
      const profile = await transaction.personnelProfile.create({ data: { name: normalizedName } });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          requestId,
          operation: "CREATE_PERSONNEL_PROFILE",
          entityType: "PERSONNEL_PROFILE",
          entityId: profile.id,
          afterSnapshot: { name: profile.name },
        },
      });
      return profile;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApplicationError(409, ErrorCodes.CONFLICT, "پروفایلی با این نام از قبل ثبت شده است.");
    }
    throw error;
  }
}

export async function createStaffConsumption(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  input: CreateOrderRequest,
  idempotencyKey: string,
  requestId: string,
  personnelProfileId?: string,
  legacyStaffName?: string,
) {
  let staffName = legacyStaffName;
  if (personnelProfileId) {
    const profile = await prisma.personnelProfile.findUnique({ where: { id: personnelProfileId }, select: { name: true } });
    if (!profile) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "پروفایل پرسنل انتخاب‌شده پیدا نشد.");
    staffName = profile.name;
  }
  return createOrder(prisma, actor, input, idempotencyKey, requestId, undefined, true, staffName);
}

function toCreatedOrder(order: {
  id: string;
  orderNumber: string;
  channel: OrderChannel;
  tableId: string | null;
  state: string;
  paymentStatus: string;
  version: number;
  discountAmount: number;
  discountKind: DiscountKind | null;
  discountValue: number | null;
  discountReason: string | null;
  subtotalAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  createdAt: Date;
  items: Array<{
    id: string;
    productId: string;
    product: { systemKey: string | null };
    productNameSnapshot: string;
    basePriceSnapshot: number;
    pricingModeSnapshot: "FIXED" | "WEIGHTED_PER_KG";
    weightGrams: number | null;
    quantity: number;
    note: string | null;
    discountKind: DiscountKind | null;
    discountValue: number | null;
    discountAmount: number;
    discountReason: string | null;
    lineTotalAmount: number;
    options: Array<{
      optionId: string;
      optionNameSnapshot: string;
      priceSnapshot: number;
      quantity: number;
    }>;
  }>;
  packagingAssignments: Array<{
    id: string;
    packagingItemId: string;
    productItemId: string;
    quantity: number;
    packagingItem: { productId: string; productNameSnapshot: string };
    productItem: { productId: string; productNameSnapshot: string };
  }>;
}): CreatedOrder {
  return {
    ...order,
    channel: order.channel,
    version: order.version,
    discountAmount: order.discountAmount,
    discountKind: order.discountKind,
    discountValue: order.discountValue,
    discountReason: order.discountReason,
    paidAmount: order.paidAmount,
    state: order.state as "OPEN" | "CLOSED" | "DELETED",
    paymentStatus: order.paymentStatus as "UNPAID" | "PARTIALLY_PAID" | "PAID",
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      systemKey: item.product.systemKey,
      productNameSnapshot: item.productNameSnapshot,
      basePriceSnapshot: item.basePriceSnapshot,
      pricingModeSnapshot: item.pricingModeSnapshot,
      weightGrams: item.weightGrams,
      quantity: item.quantity,
      note: item.note,
      discountKind: item.discountKind,
      discountValue: item.discountValue,
      discountAmount: item.discountAmount,
      discountReason: item.discountReason,
      lineTotalAmount: item.lineTotalAmount,
      options: item.options.map((option) => ({
        optionId: option.optionId,
        optionNameSnapshot: option.optionNameSnapshot,
        priceSnapshot: option.priceSnapshot,
        quantity: option.quantity,
      })),
    })),
    packagingAssignments: order.packagingAssignments.map((assignment) => ({
      id: assignment.id,
      packagingOrderItemId: assignment.packagingItemId,
      packagingProductId: assignment.packagingItem.productId,
      packagingProductNameSnapshot: assignment.packagingItem.productNameSnapshot,
      productOrderItemId: assignment.productItemId,
      productId: assignment.productItem.productId,
      productNameSnapshot: assignment.productItem.productNameSnapshot,
      quantity: assignment.quantity,
    })),
  } as CreatedOrder;
}

export async function createOrder(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  input: CreateOrderRequest,
  idempotencyKey: string,
  requestId: string,
  clientTableName?: string,
  staffConsumption = false,
  staffConsumptionName?: string,
): Promise<OrderCreationResult> {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);

  const { packagingAssignments, ...orderFields } = input;
  const canonicalInput = packagingAssignments?.length ? input : orderFields;
  const fingerprint = staffConsumption ? requestFingerprint({ input: canonicalInput, staffConsumptionName: staffConsumptionName?.trim() || null }) : requestFingerprint(canonicalInput);
  const operation = staffConsumption ? "CREATE_STAFF_CONSUMPTION" : CREATE_ORDER_OPERATION;
  const previous = await existingIdempotencyResult<CreatedOrder>(prisma, actor.id, idempotencyKey, fingerprint, operation);
  if (previous) {
    const resolvedTable = previous.tableId
      ? await prisma.cafeTable.findUnique({ where: { id: previous.tableId }, select: { id: true, name: true } })
      : null;
    return { order: { ...previous, items: previous.items.map((item) => ({ ...item, systemKey: item.systemKey ?? null })), packagingAssignments: previous.packagingAssignments ?? [] }, replayed: true, resolvedTable };
  }

  try {
    const creation = await prisma.$transaction(async (transaction) => {
      if (input.channel === "TABLE") {
        await lockOperationalKeys(transaction, [`table:${input.tableId}`]);
      }
      const productIds = [...new Set(input.items.map((item) => item.productId))];
      const products = await transaction.product.findMany({
        where: { id: { in: productIds } },
        include: {
          category: { select: { kind: true, archivedAt: true } },
          productOptionGroups: {
            include: {
              optionGroup: {
                select: { id: true, isActive: true, archivedAt: true },
              },
              allowedOptions: { include: { option: true } },
            },
          },
        },
      });
      const packagingPriceAmount = products.some((product) => product.systemKey === "PACKING")
        ? await currentPackagingPriceAmount(transaction)
        : DEFAULT_PACKAGING_PRICE_AMOUNT;
      const productById = new Map(products.map((product) => [
        product.id,
        withPackagingPrice(product as ProductForOrder, packagingPriceAmount),
      ]));

      for (const item of input.items) {
        const product = productById.get(item.productId);
        if (!product || !isAvailableProduct(product)) {
          throw new ApplicationError(
            422,
            ErrorCodes.UNAVAILABLE_PRODUCT,
            "One or more selected products are unavailable.",
          );
        }
        if (product.systemKey === "PACKING" && staffConsumption) {
          throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Packaging charges are unavailable for staff consumption.");
        }
        validateOptionSelections(product as ProductForOrder, item.options, item.quantity);
      }

      const table =
        input.channel === "TABLE"
          ? await transaction.cafeTable.findFirst({
              where: { id: input.tableId, isActive: true, archivedAt: null },
            select: { id: true, name: true },
            })
          : null;
      if (input.channel === "TABLE" && !table) {
        throw new ApplicationError(
          422,
          ErrorCodes.BUSINESS_RULE_VIOLATION,
          "The table is unavailable.",
        );
      }
      if (table) {
        const activeOrder = await transaction.order.findFirst({
          where: { tableId: table.id, channel: OrderChannel.TABLE, state: OrderState.OPEN },
          select: { id: true },
        });
        if (activeOrder) {
          throw new ApplicationError(
            409,
            ErrorCodes.INVALID_STATE,
            "This table already has an open order.",
          );
        }
      }
      const preparedItems = input.items.map((item, displayOrder) => {
        const product = productById.get(item.productId)!;
        const optionById = validateOptionSelections(product as ProductForOrder, item.options, item.quantity);
        const options = item.options.map((selectedOption) => {
          const option = optionById.get(selectedOption.optionId)!;
          return {
            optionId: option.id,
            optionNameSnapshot: option.name,
            priceSnapshot: option.priceAmount,
            quantity: selectedOption.quantity,
          };
        });
        const pricing = calculateLinePricing({ pricingMode: product.pricingMode, basePrice: product.priceAmount, options: options.map((option) => ({ price: option.priceSnapshot, quantity: option.quantity })), quantity: item.quantity, weightGrams: item.weightGrams });
        const productAmount = pricing.baseAmount;
        const grossLineAmount = pricing.grossLineAmount;
        const saleDiscount = catalogSaleDiscount(product);
        const requestedDiscount = catalogSaleDiscountAmount(productAmount, saleDiscount, product.pricingMode, item.weightGrams, item.quantity);
        const { discountAmount, finalAmount } = discountedFinalAmount(grossLineAmount, requestedDiscount ? { kind: "FIXED", value: requestedDiscount } : null);
        return {
          clientRef: item.clientRef,
          productId: product.id,
          productNameSnapshot: product.name,
          basePriceSnapshot: product.priceAmount,
          pricingModeSnapshot: product.pricingMode,
          weightGrams: item.weightGrams ?? null,
          quantity: item.quantity,
          note: item.note ?? null,
          discountKind: saleDiscount?.kind ?? null,
          discountValue: saleDiscount?.value ?? null,
          discountAmount,
          discountReason: null,
          lineTotalAmount: finalAmount,
          displayOrder,
          options,
        };
      });
      const preparedIds: string[] = preparedItems.map(() => randomUUID());
      const requestItemIds = new Map<string, string>();
      preparedItems.forEach((item, index) => {
        if (item.clientRef) requestItemIds.set(item.clientRef, preparedIds[index]!);
      });
      const assignmentRows = requestItemReferenceIds(input.packagingAssignments ?? [], requestItemIds);
      validatePackagingAssignmentQuantities(preparedItems.map((item, index) => ({
        id: preparedIds[index]!,
        quantity: item.quantity,
        systemKey: productById.get(item.productId)!.systemKey,
      })), assignmentRows);
      const subtotalAmount = checkedOrderAmount(preparedItems.reduce((total, item) => total + item.lineTotalAmount, 0));
      const createdAt = new Date();

      const dailySequence = await nextDailyOrderNumber(transaction, createdAt);
      const created = await transaction.order.create({
        data: {
          orderNumber: `${dailySequence.businessDate}-${dailySequence.number}`,
          dailyOrderNumber: dailySequence.number,
          createdById: actor.id,
          inventorySaleChannel: input.channel,
          channel: input.channel,
          tableId: table?.id ?? null,
          subtotalAmount,
          totalAmount: subtotalAmount,
          balanceAmount: subtotalAmount,
          createdAt,
          items: {
            create: preparedItems.map(({ clientRef: _clientRef, ...item }, index) => ({
              ...item,
              id: preparedIds[index]!,
              enteredAt: createdAt,
              options: { create: item.options },
            })),
          },
        },
        include: {
          items: {
            orderBy: { displayOrder: "asc" },
            include: { options: { orderBy: { id: "asc" } } },
          },
        },
      });
      if (assignmentRows.length) {
        await transaction.orderItemPackagingAssignment.createMany({
          data: assignmentRows.map((assignment) => ({ id: randomUUID(), orderId: created.id, ...assignment })),
        });
      }
      const createdWithItems = await transaction.order.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          items: {
            orderBy: { displayOrder: "asc" },
            include: { options: { orderBy: { id: "asc" } }, product: { select: { systemKey: true } } },
          },
          packagingAssignments: { include: { packagingItem: { select: { productId: true, productNameSnapshot: true } }, productItem: { select: { productId: true, productNameSnapshot: true } } }, orderBy: { id: "asc" } },
        },
      });
      await updateOrderCostingSnapshots(transaction, created.id);
      const result = toCreatedOrder(createdWithItems);
      if (staffConsumption) {
        if (input.channel !== "TAKEAWAY") throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Staff consumption must not occupy a table.");
        await transaction.order.update({ where: { id: created.id }, data: { isStaffConsumption: true, staffConsumptionName: staffConsumptionName?.trim() || null, state: OrderState.CLOSED, paymentStatus: PaymentStatus.PAID, paidAmount: subtotalAmount, balanceAmount: 0 } });
        await recognizeStaffConsumption(transaction, created.id, actor.id, createdAt);
      }
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          requestId,
          operation,
          entityType: "ORDER",
          entityId: created.id,
          afterSnapshot: {
            orderNumber: result.orderNumber,
            dailyOrderNumber: result.dailyOrderNumber,
            channel: result.channel,
            tableId: result.tableId,
            ...(input.channel === "TABLE"
              ? {
                  clientTableName: clientTableName ?? null,
                  resolvedTableName: table?.name ?? null,
                }
              : {}),
            subtotalAmount: result.subtotalAmount,
            totalAmount: result.totalAmount,
            itemCount: result.items.length,
          },
        },
      });
      await transaction.idempotencyRecord.create({
        data: {
          actorId: actor.id,
          operation,
          key: idempotencyKey,
          requestFingerprint: fingerprint,
          responseStatus: 201,
          resultSnapshot: result,
          expiresAt: new Date(createdAt.getTime() + IDEMPOTENCY_RETENTION_MS),
        },
      });
      return { order: result, resolvedTable: table ? { id: table.id, name: table.name } : null };
    });
    return { ...creation, replayed: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await existingIdempotencyResult<CreatedOrder>(prisma, actor.id, idempotencyKey, fingerprint, operation);
      if (replay) {
        const resolvedTable = replay.tableId
          ? await prisma.cafeTable.findUnique({ where: { id: replay.tableId }, select: { id: true, name: true } })
          : null;
        return { order: replay, replayed: true, resolvedTable };
      }
    }
    throw error;
  }
}

const orderDetailInclude = {
  table: { select: { name: true } },
  items: {
    orderBy: { displayOrder: "asc" },
    include: { options: { orderBy: { id: "asc" } }, product: { select: { systemKey: true } }, _count: { select: { consumptionItems: true } } },
  },
  packagingAssignments: { include: { packagingItem: { select: { productId: true, productNameSnapshot: true } }, productItem: { select: { productId: true, productNameSnapshot: true } } }, orderBy: { id: "asc" } },
  paymentSettlements: {
    orderBy: { recordedAt: "asc" },
    include: {
      reversal: { select: { recordedAt: true } },
      allocations: { select: { orderItemId: true, quantity: true, amount: true } },
      payments: { select: { method: true, amount: true, reference: true } },
    },
  },
} as const satisfies Prisma.OrderInclude;

type OrderDetailRecord = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

function orderDetailDto(order: OrderDetailRecord) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    dailyOrderNumber: order.dailyOrderNumber,
    channel: order.channel,
    tableId: order.tableId,
    tableName: order.table?.name ?? null,
    state: order.state,
    paymentStatus: order.paymentStatus,
    version: order.version,
    discountAmount: order.discountAmount,
    discountKind: order.discountKind,
    discountValue: order.discountValue,
    discountReason: order.discountReason,
    subtotalAmount: order.subtotalAmount,
    totalAmount: order.totalAmount,
    paidAmount: order.paidAmount,
    balanceAmount: order.balanceAmount,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      systemKey: item.product.systemKey,
      hasInventoryHistory: item._count.consumptionItems > 0,
      productNameSnapshot: item.productNameSnapshot,
      basePriceSnapshot: item.basePriceSnapshot,
      pricingModeSnapshot: item.pricingModeSnapshot,
      weightGrams: item.weightGrams,
      quantity: item.quantity,
      note: item.note,
      discountKind: item.discountKind,
      discountValue: item.discountValue,
      discountAmount: item.discountAmount,
      discountReason: item.discountReason,
      lineTotalAmount: item.lineTotalAmount,
      options: item.options.map((option) => ({
        optionId: option.optionId,
        optionNameSnapshot: option.optionNameSnapshot,
        priceSnapshot: option.priceSnapshot,
        quantity: option.quantity,
      })),
    })),
    packagingAssignments: order.packagingAssignments.map((assignment) => ({
      id: assignment.id,
      packagingOrderItemId: assignment.packagingItemId,
      packagingProductId: assignment.packagingItem.productId,
      packagingProductNameSnapshot: assignment.packagingItem.productNameSnapshot,
      productOrderItemId: assignment.productItemId,
      productId: assignment.productItem.productId,
      productNameSnapshot: assignment.productItem.productNameSnapshot,
      quantity: assignment.quantity,
    })),
    settlements: order.paymentSettlements.map((settlement) => ({
      id: settlement.id,
      totalAmount: settlement.totalAmount,
      allocationMode: settlement.allocationMode,
      recordedAt: settlement.recordedAt.toISOString(),
      reversedAt: settlement.reversal?.recordedAt.toISOString() ?? null,
      allocations: settlement.allocations,
      payments: settlement.payments,
    })),
  };
}

export async function readOrder(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderDetailInclude });
  if (!order) {
    throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
  }
  return orderDetailDto(order);
}

type Cursor = { createdAt: string; id: string };

function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    if (!parsed.id || !parsed.createdAt || Number.isNaN(new Date(parsed.createdAt).getTime())) {
      throw new Error("invalid cursor");
    }
    return parsed;
  } catch {
    throw new ApplicationError(400, ErrorCodes.BAD_REQUEST, "The cursor is invalid.");
  }
}

function encodeCursor(order: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: order.createdAt.toISOString(), id: order.id })).toString(
    "base64url",
  );
}

export async function listOrders(prisma: PrismaClient, actor: AuthenticatedUser, query: OrderListQuery) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const where: Prisma.OrderWhereInput = {
    ...(query.state ? { state: query.state } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.tableId ? { tableId: query.tableId } : {}),
    ...(query.deferred ? { deferredAt: query.deferred === "true" ? { not: null } : null } : {}),
    ...(query.q ? { orderNumber: { contains: query.q, mode: "insensitive" } } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
      : {}),
    ...(cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
          ],
        }
      : {}),
  };
  const records = await prisma.order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });
  const hasMore = records.length > query.limit;
  const orders = records.slice(0, query.limit);
  return {
    orders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      dailyOrderNumber: order.dailyOrderNumber,
      channel: order.channel,
      tableId: order.tableId,
      state: order.state,
      paymentStatus: order.paymentStatus,
      version: order.version,
      totalAmount: order.totalAmount,
      balanceAmount: order.balanceAmount,
      createdAt: order.createdAt.toISOString(),
      deferredAt: order.deferredAt?.toISOString() ?? null,
      deferredCustomerName: order.deferredCustomerName,
    })),
    page: {
      limit: query.limit,
      nextCursor: hasMore ? encodeCursor(orders[orders.length - 1]!) : null,
      hasMore,
    },
  };
}

export async function deferOrder(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string, input: { expectedVersion: number; customerName?: string }, requestId: string) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  return prisma.$transaction(async (tx) => {
    const initial = await tx.order.findUnique({ where: { id: orderId }, select: { tableId: true } });
    await lockOperationalKeys(tx, [`order:${orderId}`, ...(initial?.tableId ? [`table:${initial.tableId}`] : [])]);
    await assertNoTerminalReservation(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
    if (order.isStaffConsumption && actor.role !== "CASHIER" && actor.role !== "MANAGER" && actor.role !== "DEVELOPER") throw new ApplicationError(403, ErrorCodes.FORBIDDEN, "Only a manager or developer may remove staff consumption.");
    if (order.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    if (order.state !== OrderState.OPEN || order.balanceAmount <= 0 || order.deferredAt) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Only an open order with an outstanding balance can be set aside.");
    const now = new Date();
    const updated = await tx.order.updateMany({ where: { id: orderId, version: input.expectedVersion, state: OrderState.OPEN }, data: { inventorySaleChannel: order.inventorySaleChannel ?? order.channel, channel: OrderChannel.TAKEAWAY, tableId: null, deferredAt: now, deferredCustomerName: input.customerName?.trim() || null, version: { increment: 1 } } });
    if (updated.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    if (order.tableId) {
      const other = await tx.order.count({ where: { tableId: order.tableId, state: OrderState.OPEN } });
      if (!other) {
        await tx.cafeTable.update({ where: { id: order.tableId }, data: { occupancyState: "AVAILABLE", occupiedAt: null, occupancyReminderAt: null, customerAuthBypassEnabled: false, tableContextInvalidBefore: now } });
        await tx.waiterCall.updateMany({ where: { tableId: order.tableId, status: "PENDING" }, data: { status: "RESOLVED", acknowledgedAt: now, resolvedAt: now, version: { increment: 1 } } });
      }
    }
    await tx.auditLog.create({ data: { actorId: actor.id, requestId, operation: "DEFER_ORDER", entityType: "ORDER", entityId: orderId, afterSnapshot: { version: input.expectedVersion + 1, tableId: order.tableId, deferredAt: now.toISOString() } } });
    return orderDetailDto(await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDetailInclude }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function discountStaffConsumption(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string, expectedVersion: number, discount: DiscountInput, requestId: string) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  if (!discount) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A discount is required.");
  return prisma.$transaction(async (tx) => {
    await lockOperationalKeys(tx, [`order:${orderId}`]);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || !order.isStaffConsumption) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The staff consumption entry was not found.");
    if (order.version !== expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    if (order.state !== OrderState.CLOSED) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "The staff consumption entry is unavailable.");
    const { discountAmount, finalAmount } = discountedFinalAmount(order.subtotalAmount, discount);
    const updated = await tx.order.updateMany({ where: { id: orderId, version: expectedVersion, state: OrderState.CLOSED }, data: { discountKind: discount?.kind ?? null, discountValue: discount?.value ?? null, discountReason: null, discountAmount, totalAmount: finalAmount, paidAmount: finalAmount, balanceAmount: 0, version: { increment: 1 } } });
    if (updated.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    await tx.auditLog.create({ data: { actorId: actor.id, requestId, operation: "DISCOUNT_STAFF_CONSUMPTION", entityType: "ORDER", entityId: orderId, afterSnapshot: { discountAmount, totalAmount: finalAmount, version: expectedVersion + 1 } } });
    return orderDetailDto(await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDetailInclude }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateOrder(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  orderId: string,
  input: UpdateOrderRequest,
  requestId: string,
) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  return prisma.$transaction(async (transaction) => {
    await assertNoTerminalReservation(transaction, orderId);
    await lockOperationalKeys(transaction, [`order:${orderId}`]);
    const order = await transaction.order.findUnique({ where: { id: orderId }, include: orderDetailInclude });
    if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
    if (order.state !== OrderState.OPEN) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Only open orders can be edited.");
    if (order.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    if (input.items && order.packagingAssignments.length > 0 && input.packagingAssignments === undefined) {
      throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Packaging assignments must be retained when replacing order contents.");
    }
    const activeAllocations = new Map<string, number>();
    const activeAllocatedAmounts = new Map<string, number>();
    order.paymentSettlements.filter((settlement) => !settlement.reversal).forEach((settlement) => settlement.allocations.forEach((allocation) => {
      activeAllocations.set(allocation.orderItemId, (activeAllocations.get(allocation.orderItemId) ?? 0) + allocation.quantity);
      activeAllocatedAmounts.set(allocation.orderItemId, (activeAllocatedAmounts.get(allocation.orderItemId) ?? 0) + allocation.amount);
    }));
    const hasActiveAllocations = activeAllocations.size > 0 || activeAllocatedAmounts.size > 0;
    const activeSettlements = order.paymentSettlements.filter((settlement) => !settlement.reversal);
    const isUnpaid = order.paymentStatus === PaymentStatus.UNPAID;
    const allowsUnpaidItemEdits = order.paymentStatus === PaymentStatus.PARTIALLY_PAID
      && activeSettlements.length > 0
      && activeSettlements.every((settlement) => settlement.allocationMode === "ITEM_QUANTITY");
    const removedItems: OrderDetailRecord["items"] = [];
    const requestItemIds = new Map<string, string>();
    let editsUnpaidItem = false;
    if (input.items && (order.paymentSettlements.length > 0 || order.items.some((item) => item._count.consumptionItems > 0))) {
      throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Order contents cannot be replaced after settlement.");
    }
    const catalogItems = input.items ?? input.addItems;
    if (catalogItems) {
      const productIds = [...new Set(catalogItems.map((item) => item.productId))];
      const products = await transaction.product.findMany({
        where: { id: { in: productIds } },
        include: {
          category: { select: { kind: true, archivedAt: true } },
          productOptionGroups: { include: { optionGroup: true, allowedOptions: { include: { option: true } } } },
        },
      });
      const packagingPriceAmount = products.some((product) => product.systemKey === "PACKING")
        ? await currentPackagingPriceAmount(transaction)
        : DEFAULT_PACKAGING_PRICE_AMOUNT;
      const productById = new Map(products.map((product) => [
        product.id,
        withPackagingPrice(product as ProductForOrder, packagingPriceAmount),
      ]));
      const nextDisplayOrder = order.items.reduce((highest, item) => Math.max(highest, item.displayOrder), -1) + 1;
      const prepared = catalogItems.map((requested, index) => {
        const product = productById.get(requested.productId);
        if (!product || !isAvailableProduct(product)) throw new ApplicationError(422, ErrorCodes.UNAVAILABLE_PRODUCT, "One or more selected products are unavailable.");
        const allowedOptions = validateOptionSelections(product as ProductForOrder, requested.options, requested.quantity);
        const options = requested.options.map((selected) => {
          const option = allowedOptions.get(selected.optionId);
          if (!option || !option.isActive || !option.isAvailable || option.archivedAt) throw new ApplicationError(422, ErrorCodes.UNAVAILABLE_PRODUCT, "One or more selected options are unavailable.");
          if (selected.quantity > requested.quantity) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An option quantity cannot exceed its order item quantity.");
          return { optionId: option.id, optionNameSnapshot: option.name, priceSnapshot: option.priceAmount, quantity: selected.quantity };
        });
        const pricing = calculateLinePricing({ pricingMode: product.pricingMode, basePrice: product.priceAmount, options: options.map((option) => ({ price: option.priceSnapshot, quantity: option.quantity })), quantity: requested.quantity, weightGrams: requested.weightGrams });
        const productAmount = pricing.baseAmount;
        const grossLineAmount = pricing.grossLineAmount;
        const saleDiscount = catalogSaleDiscount(product);
        const requestedDiscount = catalogSaleDiscountAmount(productAmount, saleDiscount, product.pricingMode, requested.weightGrams, requested.quantity);
        const { discountAmount, finalAmount } = discountedFinalAmount(grossLineAmount, requestedDiscount ? { kind: "FIXED", value: requestedDiscount } : null);
        return {
          clientRef: requested.clientRef,
          productId: product.id, productNameSnapshot: product.name, basePriceSnapshot: product.priceAmount,
          pricingModeSnapshot: product.pricingMode, weightGrams: requested.weightGrams ?? null,
          quantity: requested.quantity,
          note: requested.note ?? null, discountKind: saleDiscount?.kind ?? null, discountValue: saleDiscount?.value ?? null,
          discountAmount, discountReason: null, lineTotalAmount: finalAmount,
          displayOrder: input.items ? index : nextDisplayOrder + index, options,
        };
      });
      // A full unpaid replacement must retain preparation identities for equivalent
      // content, even if quantity or current catalog prices change. Match duplicates
      // one-to-one so distinct lines can never share an ID.
      const preparationKey = (item: { productId: string; pricingModeSnapshot: string; weightGrams: number | null; note: string | null; quantity: number; options: Array<{ optionId: string; quantity: number }> }) =>
        JSON.stringify({ productId: item.productId, pricingMode: item.pricingModeSnapshot, weightGrams: item.weightGrams, note: item.note,
          options: item.options.map((option) => ({ id: option.optionId, quantity: item.pricingModeSnapshot === "FIXED" ? option.quantity / item.quantity : option.quantity })).sort((a, b) => a.id.localeCompare(b.id) || a.quantity - b.quantity) });
      const existingIds = new Map<string, string[]>();
      if (input.items) for (const item of order.items) {
        const key = preparationKey(item);
        existingIds.set(key, [...(existingIds.get(key) ?? []), item.id]);
      }
      const previousEnteredAt = new Map(order.items.map((item) => [item.id, item.enteredAt]));
      const preparedIds = prepared.map((item) => existingIds.get(preparationKey(item))?.shift() ?? randomUUID());
      prepared.forEach((item, index) => {
        const existing = order.items.find((candidate) => candidate.id === preparedIds[index]);
        if (existing?.product.systemKey !== "PACKING" || productById.get(item.productId)?.systemKey !== "PACKING") return;
        item.productNameSnapshot = existing.productNameSnapshot;
        item.basePriceSnapshot = existing.basePriceSnapshot;
        item.pricingModeSnapshot = existing.pricingModeSnapshot;
        item.discountKind = existing.discountKind;
        item.discountValue = existing.discountValue;
        Object.assign(item, { discountReason: existing.discountReason });
        item.options = item.options.map((option) => {
          const savedOption = existing.options.find((candidate) => candidate.optionId === option.optionId);
          return savedOption
            ? { ...option, optionNameSnapshot: savedOption.optionNameSnapshot, priceSnapshot: savedOption.priceSnapshot }
            : option;
        });
        const pricing = calculateLinePricing({
          pricingMode: existing.pricingModeSnapshot,
          basePrice: existing.basePriceSnapshot,
          options: item.options.map((option) => ({ price: option.priceSnapshot, quantity: option.quantity })),
          quantity: item.quantity,
          weightGrams: item.weightGrams,
        });
        const savedDiscount = existing.discountKind && existing.discountValue
          ? { kind: existing.discountKind, value: existing.discountValue }
          : null;
        const { discountAmount, finalAmount } = discountedFinalAmount(pricing.grossLineAmount, savedDiscount);
        item.discountAmount = discountAmount;
        item.lineTotalAmount = finalAmount;
      });
      prepared.forEach((item, index) => { if (item.clientRef) requestItemIds.set(item.clientRef, preparedIds[index]!); });
      const newItemsEnteredAt = new Date();
      const enteredAtById = new Map(preparedIds.map((id) => [id, previousEnteredAt.has(id) ? previousEnteredAt.get(id)! : newItemsEnteredAt]));
      if (input.items) {
        // Option snapshots are dependent rows with a restrictive foreign key.
        // Remove them before replacing unpaid order items as one transaction.
        await transaction.orderItemPackagingAssignment.deleteMany({ where: { orderId } });
        await transaction.orderItemOption.deleteMany({
          where: { orderItem: { orderId } },
        });
        await transaction.orderItemCostingSnapshot.deleteMany({ where: { orderItem: { orderId } } });
        await transaction.orderItem.deleteMany({ where: { orderId } });
      }
      await transaction.orderItem.createMany({ data: prepared.map(({ options: _options, clientRef: _clientRef, ...item }, index) => ({ ...item, id: preparedIds[index]!, orderId, enteredAt: enteredAtById.get(preparedIds[index]!)! })) });
      for (const [index, item] of prepared.entries()) {
        await transaction.orderItemOption.createMany({ data: item.options.map((option) => ({ ...option, orderItemId: preparedIds[index]! })) });
      }
    }
    for (const change of input.itemUpdates ?? []) {
      const item = order.items.find((candidate) => candidate.id === change.orderItemId);
      if (!item) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An order item does not belong to this order.");
      const allocated = activeAllocations.get(item.id) ?? 0;
      const allocatedAmount = activeAllocatedAmounts.get(item.id) ?? 0;
      const hasActiveAllocation = allocated > 0 || allocatedAmount > 0;
      const reducesQuantity = change.quantity !== undefined && change.quantity < item.quantity;
      const editsPackagingQuantity = item.product.systemKey === "PACKING"
        && change.quantity !== undefined && input.packagingAssignments !== undefined;
      const allowsUnpaidLineEdit = allowsUnpaidItemEdits || editsPackagingQuantity;
      if (order.paymentStatus === PaymentStatus.PARTIALLY_PAID && !hasActiveAllocation
        && (reducesQuantity || change.note !== undefined || change.weightGrams !== undefined)) {
        if (!allowsUnpaidLineEdit) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Unpaid items can be edited only after item-quantity payments.");
      }
      if (order.paymentStatus === PaymentStatus.PARTIALLY_PAID && !hasActiveAllocation
        && (allowsUnpaidItemEdits || (editsPackagingQuantity && reducesQuantity))) editsUnpaidItem = true;
      if (change.quantity === 0) {
        if ((!isUnpaid && !allowsUnpaidLineEdit) || hasActiveAllocation) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Only entirely unpaid items can be removed.");
        if (change.note !== undefined || change.discount !== undefined || change.weightGrams !== undefined) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An item removal cannot include other item changes.");
        if (input.packagingAssignments === undefined && order.packagingAssignments.some((assignment) => assignment.packagingItemId === item.id || assignment.productItemId === item.id)) {
          throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Packaging assignments must be updated when removing an assigned order item.");
        }
        const hasSettlementHistory = order.paymentSettlements.some((settlement) => settlement.allocations.some((allocation) => allocation.orderItemId === item.id));
        if (hasSettlementHistory || item._count.consumptionItems > 0) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "An item referenced by payment or inventory history cannot be removed.");
        await transaction.orderItemOption.deleteMany({ where: { orderItemId: item.id } });
        await transaction.orderItemCostingSnapshot.deleteMany({ where: { orderItemId: item.id } });
        await transaction.orderItem.delete({ where: { id: item.id } });
        removedItems.push(item);
        continue;
      }
      if (change.quantity !== undefined && change.quantity < allocated) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "An item quantity cannot be reduced below settled quantity.");
      if (change.quantity !== undefined && change.quantity < item.quantity && allocatedAmount > 0) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "An item with an amount-based settlement cannot be reduced.");
      if (change.note !== undefined && hasActiveAllocation) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "A settled item note cannot be changed.");
      if (change.discount !== undefined && hasActiveAllocation) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "A settled item discount cannot be changed.");
      if (change.weightGrams !== undefined && hasActiveAllocation) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "A settled item weight cannot be changed.");
      if (item.pricingModeSnapshot === "FIXED" && change.weightGrams !== undefined) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Fixed-price products cannot include a weight.");
      if (item.pricingModeSnapshot === "WEIGHTED_PER_KG" && change.weightGrams === undefined && item.weightGrams === null) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A weighted item is missing its weight.");
      const quantity = change.quantity ?? item.quantity;
      // Entirely unpaid lines retain their selected options per unit. Never
      // rescale an option snapshot belonging to an active settlement.
      const options = (isUnpaid || allowsUnpaidLineEdit) && !hasActiveAllocation && item.pricingModeSnapshot === "FIXED"
        ? item.options.map((option) => ({ ...option, quantity: option.quantity * quantity / item.quantity }))
        : item.options;
      if (options.some((option) => !Number.isSafeInteger(option.quantity) || option.quantity <= 0 || option.quantity > quantity)) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The selected options cannot be preserved at this item quantity.");
      const weightGrams = change.weightGrams ?? item.weightGrams;
      const pricing = calculateLinePricing({ pricingMode: item.pricingModeSnapshot, basePrice: item.basePriceSnapshot, options: options.map((option) => ({ price: option.priceSnapshot, quantity: option.quantity })), quantity, weightGrams });
      const grossLineAmount = pricing.grossLineAmount;
      const discount = change.discount;
      const existingDiscount = item.discountKind && item.discountValue ? { kind: item.discountKind, value: item.discountValue } : null;
      const appliedDiscount = discount === undefined ? existingDiscount : discount;
      const { discountAmount, finalAmount: lineTotalAmount } = discountedFinalAmount(grossLineAmount, appliedDiscount);
      for (const option of options) {
        if (option.quantity !== item.options.find((original) => original.id === option.id)!.quantity) await transaction.orderItemOption.update({ where: { id: option.id }, data: { quantity: option.quantity } });
      }
      const changesPricing = change.quantity !== undefined || change.weightGrams !== undefined || discount !== undefined;
      await transaction.orderItem.update({ where: { id: item.id }, data: {
        quantity, weightGrams, ...(change.note !== undefined ? { note: change.note } : {}),
        ...(discount === undefined ? {} : { discountKind: discount?.kind ?? null, discountValue: discount?.value ?? null, discountReason: discount?.reason ?? null }),
        ...(changesPricing ? { discountAmount, lineTotalAmount } : {}),
      } });
    }
    const previousAssignments = order.packagingAssignments.map(({ id, packagingItemId, productItemId, quantity }) => ({ id, packagingItemId, productItemId, quantity }));
    const resolvedPackagingAssignments = input.packagingAssignments === undefined
      ? previousAssignments.map(({ packagingItemId, productItemId, quantity }) => ({ packagingItemId, productItemId, quantity }))
      : requestItemReferenceIds(input.packagingAssignments, requestItemIds);
    const items = await transaction.orderItem.findMany({ where: { orderId }, include: { product: { select: { systemKey: true } } } });
    if (!items.length) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An order must contain at least one item.");
    if (input.items || input.addItems || input.itemUpdates?.some((change) => change.quantity !== undefined) || input.packagingAssignments !== undefined) {
      // Older orders allowed a package to cover multiple units or had no
      // assignment rows. Apply the new counts only to lines that changed.
      const unchangedQuantities = new Map(order.items.map((item) => [item.id, item.quantity]));
      const assignmentSignature = (row: PackagingAssignmentRow) => `${packagingAssignmentKey(row.packagingItemId, row.productItemId)}:${row.quantity}`;
      const oldKeys = new Set(previousAssignments.map(assignmentSignature));
      const newKeys = new Set(resolvedPackagingAssignments.map(assignmentSignature));
      for (const changed of [
        ...previousAssignments.filter((row) => !newKeys.has(assignmentSignature(row))),
        ...resolvedPackagingAssignments.filter((row) => !oldKeys.has(assignmentSignature(row))),
      ]) {
        unchangedQuantities.delete(changed.packagingItemId);
        unchangedQuantities.delete(changed.productItemId);
      }
      validatePackagingAssignmentQuantities(items.map((item) => ({ id: item.id, quantity: item.quantity, systemKey: item.product.systemKey })), resolvedPackagingAssignments, unchangedQuantities);
    }
    if (input.packagingAssignments !== undefined) {
      const immutablePackagingIds = new Set([
        ...activeAllocations.keys(),
        ...activeAllocatedAmounts.keys(),
        ...order.items.filter((item) => item._count.consumptionItems > 0).map((item) => item.id),
      ]);
      await savePackagingAssignmentChanges(transaction, orderId, resolvedPackagingAssignments, input.items ? [] : previousAssignments, immutablePackagingIds);
    }
    const subtotalAmount = checkedOrderAmount(items.reduce((total, item) => total + item.lineTotalAmount, 0));
    if (input.orderDiscount !== undefined && hasActiveAllocations) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "The order discount cannot change after settlement.");
    const activeOrderDiscount = input.orderDiscount === undefined
      ? order.discountKind && order.discountValue ? { kind: order.discountKind, value: order.discountValue } as DiscountInput : null
      : input.orderDiscount;
    const { discountAmount: orderDiscountAmount, finalAmount: totalAmount } = discountedFinalAmount(subtotalAmount, activeOrderDiscount);
    if (orderDiscountAmount > subtotalAmount) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The existing order discount exceeds the updated order amount.");
    const balanceAmount = totalAmount - order.paidAmount;
    if (balanceAmount < 0) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "The edited order total cannot be less than its recorded payments.");
    if (editsUnpaidItem) {
      const amounts = (lines: Array<{ id: string; lineTotalAmount: number }>, subtotal: number, discount: number) => {
        let running = 0;
        return new Map(lines.map((line) => {
          const before = subtotal > 0 ? Math.floor(discount * running / subtotal) : 0;
          running += line.lineTotalAmount;
          const after = subtotal > 0 ? Math.floor(discount * running / subtotal) : 0;
          return [line.id, line.lineTotalAmount - (after - before)];
        }));
      };
      const before = amounts(order.items, order.subtotalAmount, order.discountAmount);
      const after = amounts([...items].sort((a, b) => a.displayOrder - b.displayOrder), subtotalAmount, orderDiscountAmount);
      for (const [itemId, amount] of activeAllocatedAmounts) {
        if (amount > 0 && before.get(itemId) !== after.get(itemId)) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "This edit would change an item's settled amount.");
      }
    }
    const paymentStatus = paymentStatusForBalance(order.paidAmount, balanceAmount);
    const closesOrder = editsUnpaidItem && balanceAmount === 0;
    if (closesOrder && order.channel === OrderChannel.TABLE && order.tableId) await lockOperationalKeys(transaction, [`table:${order.tableId}`]);
    const updated = await transaction.order.updateMany({ where: { id: orderId, version: input.expectedVersion, state: OrderState.OPEN }, data: { subtotalAmount, discountAmount: orderDiscountAmount, ...(input.orderDiscount === undefined ? {} : { discountKind: input.orderDiscount?.kind ?? null, discountValue: input.orderDiscount?.value ?? null, discountReason: input.orderDiscount?.reason ?? null }), totalAmount, balanceAmount, paymentStatus, ...(closesOrder ? { state: OrderState.CLOSED } : {}), version: { increment: 1 } } });
    if (updated.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    if (input.items || input.addItems || input.itemUpdates?.some((change) => change.quantity !== undefined || change.weightGrams !== undefined)) {
      await updateOrderCostingSnapshots(transaction, orderId);
    }
    if (closesOrder) {
      const closedAt = new Date();
      await recognizeOrderFullPayment(transaction, orderId, activeSettlements[activeSettlements.length - 1]!.id, actor.id, closedAt);
      if (order.channel === OrderChannel.TABLE && order.tableId) {
        await transaction.cafeTable.update({ where: { id: order.tableId }, data: { occupancyState: "AVAILABLE", occupiedAt: null, occupancyReminderAt: null, customerAuthBypassEnabled: false, tableContextInvalidBefore: closedAt } });
        await transaction.waiterCall.updateMany({ where: { tableId: order.tableId, status: "PENDING" }, data: { status: "RESOLVED", acknowledgedAt: closedAt, resolvedAt: closedAt, version: { increment: 1 } } });
      }
    }
    await transaction.auditLog.create({ data: { actorId: actor.id, requestId, operation: "UPDATE_ORDER", entityType: "ORDER", entityId: orderId, ...(removedItems.length || input.packagingAssignments !== undefined ? { beforeSnapshot: { ...(removedItems.length ? { removedItems } : {}), ...(input.packagingAssignments !== undefined ? { packagingAssignments: order.packagingAssignments.map((assignment) => ({ packagingItemId: assignment.packagingItemId, productItemId: assignment.productItemId, quantity: assignment.quantity })) } : {}) } } : {}), afterSnapshot: { version: input.expectedVersion + 1, ...(removedItems.length ? { removedItemIds: removedItems.map((item) => item.id) } : {}), ...(input.packagingAssignments !== undefined ? { packagingAssignments: resolvedPackagingAssignments } : {}) } } });
    return orderDetailDto(await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDetailInclude }));
  });
}

export async function transferOrderTable(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string, input: TransferOrderTableRequest, requestId: string) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  return prisma.$transaction(async (transaction) => {
    const lockKeys = [`order:${orderId}`];
    const orderForLock = await transaction.order.findUnique({ where: { id: orderId }, select: { tableId: true, channel: true } });
    if (orderForLock?.channel === OrderChannel.TABLE && orderForLock.tableId) lockKeys.push(`table:${orderForLock.tableId}`);
    await lockOperationalKeys(transaction, lockKeys);
    await assertNoTerminalReservation(transaction, orderId);
    const order = await transaction.order.findUnique({ where: { id: orderId }, include: orderDetailInclude });
    if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
    if (order.state !== OrderState.OPEN || order.channel !== OrderChannel.TABLE) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Only open table orders can be transferred.");
    if (!order.tableId) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "The order does not have a table assignment.");
    if (order.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    if (order.tableId === input.tableId) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Choose a different destination table.");
    await lockOperationalKeys(transaction, [`table:${order.tableId}`, `table:${input.tableId}`]);
    const [sourceTable, destinationTable] = await Promise.all([
      transaction.cafeTable.findFirst({ where: { id: order.tableId, isActive: true, archivedAt: null } }),
      transaction.cafeTable.findFirst({ where: { id: input.tableId, isActive: true, archivedAt: null } }),
    ]);
    if (!sourceTable || !destinationTable) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The table is unavailable.");
    const pendingDestinationCall = await transaction.waiterCall.findFirst({ where: { tableId: destinationTable.id, status: "PENDING" }, select: { id: true } });
    if (pendingDestinationCall) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Resolve the destination table waiter-call before transferring.");
    const destinationOrder = await transaction.order.findFirst({
      where: { tableId: destinationTable.id, channel: OrderChannel.TABLE, state: OrderState.OPEN },
      include: orderDetailInclude,
    });
    const now = new Date();
    // PostgreSQL checks partial unique indexes per row, so briefly remove the
    // displaced order from the TABLE predicate inside this transaction.
    if (destinationOrder) await assertNoTerminalReservation(transaction, destinationOrder.id);
    if (destinationOrder) await transaction.order.update({ where: { id: destinationOrder.id }, data: { channel: OrderChannel.TAKEAWAY, tableId: null } });
    const updated = await transaction.order.updateMany({ where: { id: orderId, version: input.expectedVersion, state: OrderState.OPEN }, data: { tableId: destinationTable.id, version: { increment: 1 } } });
    if (updated.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    if (destinationOrder) {
      await transaction.order.update({ where: { id: destinationOrder.id }, data: { channel: OrderChannel.TABLE, tableId: sourceTable.id, version: { increment: 1 } } });
      await transaction.cafeTable.update({ where: { id: sourceTable.id }, data: { occupancyState: "OCCUPIED", occupiedAt: sourceTable.occupiedAt ?? now, occupancyReminderAt: null } });
      await transaction.cafeTable.update({ where: { id: destinationTable.id }, data: { occupancyState: "OCCUPIED", occupiedAt: destinationTable.occupiedAt ?? now, occupancyReminderAt: null } });
      await transaction.auditLog.createMany({ data: [
        { actorId: actor.id, requestId, operation: "TRANSFER_ORDER_TABLE", entityType: "ORDER", entityId: orderId, afterSnapshot: { tableId: destinationTable.id, version: input.expectedVersion + 1, swappedWithOrderId: destinationOrder.id } },
        { actorId: actor.id, requestId, operation: "TRANSFER_ORDER_TABLE", entityType: "ORDER", entityId: destinationOrder.id, afterSnapshot: { tableId: sourceTable.id, version: destinationOrder.version + 1, swappedWithOrderId: orderId } },
      ] });
    } else {
      await transaction.cafeTable.update({ where: { id: destinationTable.id }, data: { occupancyState: "OCCUPIED", occupiedAt: destinationTable.occupiedAt ?? now, occupancyReminderAt: null } });
      await transaction.cafeTable.update({ where: { id: sourceTable.id }, data: { occupancyState: "AVAILABLE", occupiedAt: null, occupancyReminderAt: null, customerAuthBypassEnabled: false, tableContextInvalidBefore: now } });
      await transaction.waiterCall.updateMany({ where: { tableId: sourceTable.id, status: "PENDING" }, data: { status: "RESOLVED", acknowledgedAt: now, resolvedAt: now, version: { increment: 1 } } });
      await transaction.auditLog.create({ data: { actorId: actor.id, requestId, operation: "TRANSFER_ORDER_TABLE", entityType: "ORDER", entityId: orderId, afterSnapshot: { tableId: destinationTable.id, version: input.expectedVersion + 1 } } });
    }
    return orderDetailDto(await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDetailInclude }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteOrder(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  orderId: string,
  input: DeleteOrderRequest,
  requestId: string,
) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  return prisma.$transaction(async (transaction) => {
    await assertNoTerminalReservation(transaction, orderId);
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
    if (order.isStaffConsumption && actor.role !== "CASHIER" && actor.role !== "MANAGER" && actor.role !== "DEVELOPER") throw new ApplicationError(403, ErrorCodes.FORBIDDEN, "Only a manager or developer may remove staff consumption.");
    if (order.state !== OrderState.OPEN && order.state !== OrderState.CLOSED) {
      throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Only open or closed orders can be deleted.");
    }
    if (order.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");

    const deletedAt = new Date();
    await cancelAndRestoreOrderInventory(transaction, orderId, actor.id, deletedAt);
    const updated = await transaction.order.updateMany({
      where: { id: orderId, state: { in: [OrderState.OPEN, OrderState.CLOSED] }, version: input.expectedVersion },
      data: {
        state: OrderState.DELETED,
        deletedById: actor.id,
        deletedAt,
        deletionReason: input.reason ?? null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    await transaction.auditLog.create({
      data: {
        actorId: actor.id,
        requestId,
        operation: "DELETE_ORDER",
        entityType: "ORDER",
        entityId: orderId,
        afterSnapshot: { state: OrderState.DELETED, deletedAt: deletedAt.toISOString(), version: input.expectedVersion + 1 },
      },
    });
    return orderDetailDto(await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDetailInclude }));
  });
}

export async function planSettlementInTransaction(
  transaction: Prisma.TransactionClient, orderId: string, input: RecordSettlementRequest, exceptAttemptId?: string,
) {
  const current = await transaction.order.findUnique({ where: { id: orderId }, include: orderDetailInclude });
  if (!current) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
  if (current.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
  if (current.state !== OrderState.OPEN) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Only open orders can be settled.");
  await assertNoTerminalReservation(transaction, orderId, exceptAttemptId);

  const activeAllocatedQuantity = new Map<string, number>();
  const activeAllocatedAmount = new Map<string, number>();
  let hasAmountPartialAllocation = false;
  current.paymentSettlements
    .filter((settlement) => !settlement.reversal)
    .forEach((settlement) => settlement.allocations.forEach((allocation) => {
      activeAllocatedQuantity.set(
        allocation.orderItemId,
        (activeAllocatedQuantity.get(allocation.orderItemId) ?? 0) + allocation.quantity,
      );
      activeAllocatedAmount.set(allocation.orderItemId, (activeAllocatedAmount.get(allocation.orderItemId) ?? 0) + allocation.amount);
      if (allocation.quantity === 0) hasAmountPartialAllocation = true;
    }));

  const finalLineAmount = new Map<string, number>();
  let runningSubtotal = 0;
  for (const item of current.items) {
    const orderDiscountBefore = Math.floor((current.discountAmount * runningSubtotal) / current.subtotalAmount);
    runningSubtotal += item.lineTotalAmount;
    const orderDiscountAfter = Math.floor((current.discountAmount * runningSubtotal) / current.subtotalAmount);
    finalLineAmount.set(item.id, item.lineTotalAmount - (orderDiscountAfter - orderDiscountBefore));
  }

  const requestedQuantities = new Map<string, number>();
  if (input.allocationMode !== "AMOUNT") {
    for (const requested of input.allocations) {
      requestedQuantities.set(requested.orderItemId, (requestedQuantities.get(requested.orderItemId) ?? 0) + requested.quantity);
    }
  }
  const allocations = input.allocationMode !== "AMOUNT" ? Array.from(requestedQuantities, ([orderItemId, quantity]) => ({ orderItemId, quantity })).map((requested) => {
    if (hasAmountPartialAllocation) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Complete an amount-based partial payment by amount.");
    const item = current.items.find((candidate) => candidate.id === requested.orderItemId);
    if (!item) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An allocated item does not belong to this order.");
    const alreadyAllocated = activeAllocatedQuantity.get(item.id) ?? 0;
    if (alreadyAllocated + requested.quantity > item.quantity) {
      throw new ApplicationError(409, ErrorCodes.SETTLEMENT_ALLOCATION_CONFLICT, "The selected item quantity has already been settled.");
    }
    const amount = allocationAmountForQuantity({
      finalLineAmount: finalLineAmount.get(item.id)!,
      itemQuantity: item.quantity,
      alreadyAllocatedQuantity: alreadyAllocated,
      quantity: requested.quantity,
    });
    if (amount <= 0) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The selected quantity has no payable amount.");
    return { orderItemId: item.id, quantity: requested.quantity, amount };
  }) : (() => {
    if (input.amount > current.balanceAmount) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The entered amount exceeds the remaining balance.");
    let remaining = input.amount;
    return current.items.flatMap((item) => {
      const availableAmount = finalLineAmount.get(item.id)! - (activeAllocatedAmount.get(item.id) ?? 0);
      if (availableAmount <= 0 || remaining <= 0) return [];
      const amount = Math.min(remaining, availableAmount);
      remaining -= amount;
      const alreadyQuantity = activeAllocatedQuantity.get(item.id) ?? 0;
      // A zero quantity records an amount that pays only part of this item.
      // Fully covered later items still retain their immutable quantity snapshot.
      const quantity = amount === availableAmount ? item.quantity - alreadyQuantity : 0;
      return [{ orderItemId: item.id, quantity, amount }];
    });
  })();
  const totalAmount = allocations.reduce((total, allocation) => total + allocation.amount, 0);
  const tenderAmount = input.payments.reduce((total, payment) => total + payment.amount, 0);
  if (tenderAmount !== totalAmount) {
    throw new ApplicationError(422, ErrorCodes.PAYMENT_RECONCILIATION_FAILED, "Tender amounts must equal the selected item total.");
  }

  return { current, allocations, totalAmount };
}

export async function postSettlementInTransaction(
  transaction: Prisma.TransactionClient, actor: AuthenticatedUser, orderId: string,
  input: RecordSettlementRequest, idempotencyKey: string, requestId: string, exceptAttemptId?: string,
) {
  const { current, allocations, totalAmount } = await planSettlementInTransaction(transaction, orderId, input, exceptAttemptId);
  const fingerprint = requestFingerprint({ orderId, ...input });
  const recordedAt = new Date();
  const settlement = await transaction.paymentSettlement.create({
    data: {
      orderId,
      recordedById: actor.id,
      idempotencyKey,
      totalAmount,
      allocationMode: input.allocationMode ?? "ITEM_QUANTITY",
      recordedAt,
      allocations: { create: allocations },
      payments: { create: input.payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        reference: payment.method === "CARD_TRANSFER" ? payment.reference ?? null : null,
      })) },
    },
  });
  const paidAmount = current.paidAmount + totalAmount;
  const balanceAmount = current.totalAmount - paidAmount;
  const paymentStatus = paymentStatusForBalance(paidAmount, balanceAmount);
  const closesOrder = balanceAmount === 0;
  const updated = await transaction.order.updateMany({
    where: { id: orderId, state: OrderState.OPEN, version: input.expectedVersion },
    data: { paidAmount, balanceAmount, paymentStatus, ...(closesOrder ? { state: OrderState.CLOSED } : {}), version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
  if (closesOrder) await recognizeOrderFullPayment(transaction, orderId, settlement.id, actor.id, recordedAt);
  if (closesOrder && current.channel === OrderChannel.TABLE && current.tableId) {
    await transaction.cafeTable.update({
      where: { id: current.tableId },
      data: { occupancyState: "AVAILABLE", occupiedAt: null, occupancyReminderAt: null, customerAuthBypassEnabled: false, tableContextInvalidBefore: recordedAt },
    });
    await transaction.waiterCall.updateMany({
      where: { tableId: current.tableId, status: "PENDING" },
      data: { status: "RESOLVED", acknowledgedAt: recordedAt, resolvedAt: recordedAt, version: { increment: 1 } },
    });
  }
  const result = orderDetailDto(await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDetailInclude }));
  await transaction.auditLog.create({
    data: {
      actorId: actor.id,
      requestId,
      operation: RECORD_SETTLEMENT_OPERATION,
      entityType: "PAYMENT_SETTLEMENT",
      entityId: settlement.id,
      afterSnapshot: { orderId, totalAmount, paymentStatus, version: result.version },
    },
  });
  await transaction.idempotencyRecord.create({
    data: {
      actorId: actor.id,
      operation: RECORD_SETTLEMENT_OPERATION,
      key: idempotencyKey,
      requestFingerprint: fingerprint,
      responseStatus: 201,
      resultSnapshot: result,
      expiresAt: new Date(recordedAt.getTime() + IDEMPOTENCY_RETENTION_MS),
    },
  });
  return { order: result, settlementId: settlement.id };
}

export async function recordSettlement(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  orderId: string,
  input: RecordSettlementRequest,
  idempotencyKey: string,
  requestId: string,
) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  const fingerprint = requestFingerprint({ orderId, ...input });
  const previous = await existingIdempotencyResult<ReturnType<typeof orderDetailDto>>(
    prisma,
    actor.id,
    idempotencyKey,
    fingerprint,
    RECORD_SETTLEMENT_OPERATION,
  );
  if (previous) return { order: previous, replayed: true };

  try {
    const order = await prisma.$transaction(async (transaction) => {
      await lockOperationalKeys(transaction, [`order:${orderId}`]);
      return (await postSettlementInTransaction(transaction, actor, orderId, input, idempotencyKey, requestId)).order;
    });
    return { order, replayed: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await existingIdempotencyResult<ReturnType<typeof orderDetailDto>>(
        prisma,
        actor.id,
        idempotencyKey,
        fingerprint,
        RECORD_SETTLEMENT_OPERATION,
      );
      if (replay) return { order: replay, replayed: true };
    }
    throw error;
  }
}

export async function reverseSettlement(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string, settlementId: string, input: ReverseSettlementRequest, requestId: string) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  return prisma.$transaction(async (transaction) => {
    const tableAssignment = await transaction.order.findUnique({ where: { id: orderId }, select: { tableId: true, channel: true } });
    await lockOperationalKeys(transaction, ["order:" + orderId, ...(tableAssignment?.channel === OrderChannel.TABLE && tableAssignment.tableId ? ["table:" + tableAssignment.tableId] : [])]);
    await assertNoTerminalReservation(transaction, orderId);
    const order = await transaction.order.findUnique({ where: { id: orderId }, include: orderDetailInclude });
    if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
    if (order.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    const settlement = order.paymentSettlements.find((candidate) => candidate.id === settlementId);
    if (!settlement) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested settlement was not found.");
    if (settlement.reversal) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "The settlement has already been reversed.");
    const settings = await transaction.cafeSettings.findUnique({ where: { singletonKey: true }, select: { settlementReversalReasonRequired: true } });
    const reason = input.reason?.trim() || null;
    if (settings?.settlementReversalReasonRequired && !reason) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A reason is required to reverse this settlement.");
    await transaction.settlementReversal.create({ data: { settlementId, recordedById: actor.id, reason } });
    const paidAmount = order.paidAmount - settlement.totalAmount;
    const balanceAmount = order.totalAmount - paidAmount;
    const paymentStatus = paymentStatusForBalance(paidAmount, balanceAmount);
    const reopensOrder = order.state === OrderState.CLOSED;
    if (reopensOrder && order.channel === OrderChannel.TABLE && order.tableId) {
      const conflict = await transaction.order.findFirst({ where: { tableId: order.tableId, channel: OrderChannel.TABLE, state: OrderState.OPEN, id: { not: orderId } }, select: { id: true } });
      if (conflict) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "The table has another open order; reassign it before reversing this settlement.");
    }
    const updated = await transaction.order.updateMany({ where: { id: orderId, version: input.expectedVersion }, data: { paidAmount, balanceAmount, paymentStatus, ...(reopensOrder ? { state: OrderState.OPEN } : {}), version: { increment: 1 } } });
    if (updated.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    if (paymentStatus !== PaymentStatus.PAID) await cancelAndRestoreOrderInventory(transaction, orderId, actor.id, new Date());
    if (reopensOrder && order.channel === OrderChannel.TABLE && order.tableId) {
      await transaction.cafeTable.update({
        where: { id: order.tableId },
        data: { occupancyState: "OCCUPIED", occupiedAt: new Date(), occupancyReminderAt: null },
      });
    }
    await transaction.auditLog.create({ data: { actorId: actor.id, requestId, operation: "REVERSE_SETTLEMENT", entityType: "PAYMENT_SETTLEMENT", entityId: settlementId, reason, afterSnapshot: { orderId, paidAmount, balanceAmount, version: input.expectedVersion + 1 } } });
    return orderDetailDto(await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDetailInclude }));
  });
}

export async function reverseSettlementById(prisma: PrismaClient, actor: AuthenticatedUser, settlementId: string, input: ReverseSettlementRequest, requestId: string) {
  const settlement = await prisma.paymentSettlement.findUnique({ where: { id: settlementId }, select: { orderId: true } });
  if (!settlement) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested settlement was not found.");
  return reverseSettlement(prisma, actor, settlement.orderId, settlementId, input, requestId);
}

export async function editSettlement(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  settlementId: string,
  input: EditSettlementRequest,
  idempotencyKey: string,
  requestId: string,
) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  const fingerprint = requestFingerprint({ settlementId, ...input });
  const previous = await existingIdempotencyResult<ReturnType<typeof orderDetailDto>>(
    prisma,
    actor.id,
    idempotencyKey,
    fingerprint,
    EDIT_SETTLEMENT_OPERATION,
  );
  if (previous) return { order: previous, replayed: true };

  try {
    const order = await prisma.$transaction(async (transaction) => {
      const original = await transaction.paymentSettlement.findUnique({
        where: { id: settlementId },
        include: { order: { include: orderDetailInclude }, allocations: true, payments: true, reversal: true },
      });
      if (!original) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested settlement was not found.");
      await lockOperationalKeys(transaction, ["order:" + original.orderId]);
      await assertNoTerminalReservation(transaction, original.orderId);
      const current = await transaction.order.findUnique({ where: { id: original.orderId }, include: orderDetailInclude });
      if (!current) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
      if (current.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
      const activeOriginal = current.paymentSettlements.find((candidate) => candidate.id === settlementId);
      if (!activeOriginal || original.reversal) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "The settlement has already been corrected.");
      const tenderAmount = input.payments.reduce((total, payment) => total + payment.amount, 0);
      if (tenderAmount !== original.totalAmount) throw new ApplicationError(422, ErrorCodes.PAYMENT_RECONCILIATION_FAILED, "Tender amounts must equal the original settlement total.");

      const recordedAt = new Date();
      const replacement = await transaction.paymentSettlement.create({
        data: {
          orderId: original.orderId,
          recordedById: actor.id,
          idempotencyKey: `edit:${settlementId}:${idempotencyKey}`,
          totalAmount: original.totalAmount,
          allocationMode: original.allocationMode,
          recordedAt,
          allocations: { create: original.allocations.map(({ orderItemId, quantity, amount }) => ({ orderItemId, quantity, amount })) },
          payments: { create: input.payments.map((payment) => ({ method: payment.method, amount: payment.amount, reference: payment.method === "CARD_TRANSFER" ? payment.reference ?? null : null })) },
        },
      });
      await transaction.settlementReversal.create({ data: { settlementId, recordedById: actor.id, reason: input.reason ?? null, recordedAt } });
      const updated = await transaction.order.updateMany({
        where: { id: original.orderId, version: input.expectedVersion },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
      const result = orderDetailDto(await transaction.order.findUniqueOrThrow({ where: { id: original.orderId }, include: orderDetailInclude }));
      await transaction.auditLog.createMany({ data: [
        { actorId: actor.id, requestId, operation: "REVERSE_SETTLEMENT", entityType: "PAYMENT_SETTLEMENT", entityId: settlementId, reason: input.reason ?? null, beforeSnapshot: { orderId: original.orderId, totalAmount: original.totalAmount, payments: original.payments }, afterSnapshot: { correctedBySettlementId: replacement.id, orderVersion: result.version } },
        { actorId: actor.id, requestId, operation: EDIT_SETTLEMENT_OPERATION, entityType: "PAYMENT_SETTLEMENT", entityId: replacement.id, reason: input.reason ?? null, beforeSnapshot: { replacedSettlementId: settlementId, totalAmount: original.totalAmount, payments: original.payments }, afterSnapshot: { totalAmount: original.totalAmount, payments: input.payments, orderVersion: result.version } },
      ] });
      await transaction.idempotencyRecord.create({ data: { actorId: actor.id, operation: EDIT_SETTLEMENT_OPERATION, key: idempotencyKey, requestFingerprint: fingerprint, responseStatus: 200, resultSnapshot: result, expiresAt: new Date(recordedAt.getTime() + IDEMPOTENCY_RETENTION_MS) } });
      return result;
    });
    return { order, replayed: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await existingIdempotencyResult<ReturnType<typeof orderDetailDto>>(prisma, actor.id, idempotencyKey, fingerprint, EDIT_SETTLEMENT_OPERATION);
      if (replay) return { order: replay, replayed: true };
    }
    throw error;
  }
}

function tehranDisplayTime(value: Date): string {
  const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  const localize = (value: string) => new Intl.NumberFormat("fa-IR-u-nu-arabext", { useGrouping: false }).format(Number(value));
  const year = localize(part("year"));
  const month = localize(part("month").padStart(2, "0"));
  const day = localize(part("day").padStart(2, "0"));
  const hour = localize(part("hour").padStart(2, "0"));
  const minute = localize(part("minute").padStart(2, "0"));
  return `${year}/${month}/${day}  •  ${hour}:${minute}`;
}

const receiptInclude = {
  table: { select: { name: true } },
  items: { orderBy: { displayOrder: "asc" }, include: { options: { orderBy: { id: "asc" } } } },
  paymentSettlements: {
    orderBy: { recordedAt: "asc" },
    include: {
      reversal: true,
      payments: true,
      allocations: { include: { orderItem: { include: { options: { orderBy: { id: "asc" } } } } } },
    },
  },
} as const satisfies Prisma.OrderInclude;

function tehranClockTime(value: Date): string {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-arabext", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

export async function barTicket(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: receiptInclude });
  if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
  return { dailyOrderNumber: order.dailyOrderNumber, context: order.channel === OrderChannel.TABLE ? `میز ${order.table!.name}` : "بیرون‌بر", displayTime: tehranClockTime(new Date()), items: order.items.map((item) => ({ productName: item.productNameSnapshot, quantity: item.quantity, pricingModeSnapshot: item.pricingModeSnapshot, weightGrams: item.weightGrams, options: item.options.map((option) => ({ name: option.optionNameSnapshot, quantity: option.quantity })), note: item.note })) };
}

// Serialize snapshot capture with edits and acknowledgments on the order row.
export async function prepareBarTicket(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: receiptInclude });
    if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
    const snapshot: PreparationItem[] = order.items.map((item) => ({ id: item.id, productName: item.productNameSnapshot,
      quantity: item.quantity, pricingModeSnapshot: item.pricingModeSnapshot, weightGrams: item.weightGrams,
      options: item.options.map((option) => ({ optionId: option.optionId, name: option.optionNameSnapshot, quantity: option.quantity })), note: item.note }));
    const prepared = await tx.barTicketPreparation.create({ data: { orderId, snapshot: snapshot as Prisma.InputJsonValue } });
    return { preparationId: prepared.id, dailyOrderNumber: order.dailyOrderNumber, displayTime: tehranClockTime(prepared.createdAt),
      context: order.channel === OrderChannel.TABLE ? `میز ${order.table!.name}` : "بیرون‌بر",
      items: preparationItems(snapshot, order.barTicketSnapshot as PreparationItem[] | null) };
  });
}

export async function acknowledgeBarTicket(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string, preparationId: string) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  const prepared = await prisma.barTicketPreparation.findFirst({ where: { id: preparationId, orderId } });
  if (!prepared) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested preparation was not found.");
  // A newer snapshot can never be replaced by an older or retried acknowledgment.
  await prisma.order.updateMany({ where: { id: orderId, barTicketSequence: { lt: prepared.sequence } },
    data: { barTicketSequence: prepared.sequence, barTicketSnapshot: prepared.snapshot as Prisma.InputJsonValue } });
  return { acknowledged: true as const };
}

export async function orderReceipt(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: receiptInclude });
  if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
  let runningSubtotal = 0;
  const paidByItem = new Map<string, number>();
  order.paymentSettlements
    .filter((settlement) => !settlement.reversal)
    .forEach((settlement) => settlement.allocations.forEach((allocation) => {
      paidByItem.set(allocation.orderItemId, (paidByItem.get(allocation.orderItemId) ?? 0) + allocation.amount);
    }));
  return {
    displayTime: tehranDisplayTime(order.createdAt),
    items: order.items.map((item) => {
      const discountBefore = Math.floor((order.discountAmount * runningSubtotal) / order.subtotalAmount);
      runningSubtotal += item.lineTotalAmount;
      const discountAfter = Math.floor((order.discountAmount * runningSubtotal) / order.subtotalAmount);
      const lineTotalAmount = item.lineTotalAmount - (discountAfter - discountBefore);
      const paidAmount = paidByItem.get(item.id) ?? 0;
      return {
        productName: item.productNameSnapshot,
        quantity: item.quantity,
        basePriceSnapshot: item.basePriceSnapshot,
        pricingModeSnapshot: item.pricingModeSnapshot,
        weightGrams: item.weightGrams,
        options: item.options.map((option) => ({ name: option.optionNameSnapshot, quantity: option.quantity })),
        lineTotalAmount,
        paidAmount,
        isPaid: paidAmount === lineTotalAmount,
      };
    }),
    totalAmount: order.totalAmount,
  };
}

export async function settlementReceipt(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string, settlementId: string) {
  requireRole(actor, ["STAFF", "CASHIER", "MANAGER", "DEVELOPER"]);
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: receiptInclude });
  if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
  const settlement = order.paymentSettlements.find((candidate) => candidate.id === settlementId);
  if (!settlement) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested settlement was not found.");
  return {
    displayTime: tehranDisplayTime(settlement.recordedAt),
    items: settlement.allocations.map((allocation) => ({
      productName: allocation.orderItem.productNameSnapshot,
      quantity: allocation.quantity || allocation.orderItem.quantity,
      basePriceSnapshot: allocation.orderItem.basePriceSnapshot,
      pricingModeSnapshot: allocation.orderItem.pricingModeSnapshot,
      weightGrams: allocation.orderItem.weightGrams,
      options: allocation.orderItem.options.map((option) => ({ name: option.optionNameSnapshot, quantity: option.quantity })),
      lineTotalAmount: allocation.amount,
      paidAmount: allocation.amount,
      isPaid: true,
    })),
    totalAmount: settlement.totalAmount,
  };
}
