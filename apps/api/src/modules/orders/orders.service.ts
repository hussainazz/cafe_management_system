import { createHash, randomUUID } from "node:crypto";
import {
  OrderChannel,
  DiscountKind,
  OrderState,
  Prisma,
  type PrismaClient,
} from "../../../generated/prisma/client.js";
import {
  calculateTableEta,
  type CreateOrderRequest,
  type DeleteOrderRequest,
  type OrderListQuery,
  type TransferOrderTableRequest,
  type UpdateOrderRequest,
  type DiscountInput,
} from "@cafe/contracts";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import type { AuthenticatedUser } from "../auth/auth.service.js";
import { requireRole } from "../auth/permissions.js";

const CREATE_ORDER_OPERATION = "CREATE_ORDER";
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;

type ProductForOrder = {
  id: string;
  name: string;
  priceAmount: number;
  saleDiscountKind: DiscountKind | null;
  saleDiscountValue: number | null;
  preparationDeadlineMinutes: number;
  isActive: boolean;
  isAvailable: boolean;
  archivedAt: Date | null;
  category: { isActive: boolean; archivedAt: Date | null };
  productOptionGroups: Array<{
    optionGroup: {
      id: string;
      isActive: boolean;
      options: Array<{
        id: string;
        name: string;
        priceAmount: number;
        isActive: boolean;
        isAvailable: boolean;
        archivedAt: Date | null;
      }>;
    };
  }>;
};

type CreatedOrder = {
  id: string;
  orderNumber: string;
  channel: "TABLE" | "TAKEAWAY";
  tableId: string | null;
  state: "OPEN" | "DELETED";
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
  estimatedPreparationMinutes: number;
  tableSeatingLimitSnapshotMinutes: number | null;
  estimatedTableReleaseAt: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    productId: string;
    productNameSnapshot: string;
    basePriceSnapshot: number;
    preparationDeadlineSnapshotMinutes: number;
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
};

type OrderCreationResult = { order: CreatedOrder; replayed: boolean };

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

function requestFingerprint(input: CreateOrderRequest): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function orderNumber(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function isAvailableProduct(product: ProductForOrder): boolean {
  return (
    product.isActive &&
    product.isAvailable &&
    !product.archivedAt &&
    product.category.isActive &&
    !product.category.archivedAt
  );
}

function calculatedDiscount(amount: number, discount: DiscountInput): number {
  if (!discount) return 0;
  const requested = discount.kind === "PERCENTAGE" ? Math.floor((amount * discount.value) / 100) : discount.value;
  if (requested > amount) {
    throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "A discount cannot exceed the item or order amount.");
  }
  return requested;
}

function catalogSaleDiscount(product: ProductForOrder): DiscountInput {
  if (!product.saleDiscountKind || !product.saleDiscountValue) return null;
  return { kind: product.saleDiscountKind, value: product.saleDiscountValue };
}

function resultFromSnapshot(snapshot: Prisma.JsonValue): CreatedOrder {
  return snapshot as unknown as CreatedOrder;
}

async function existingIdempotencyResult(
  prisma: PrismaClient,
  actorId: string,
  key: string,
  fingerprint: string,
): Promise<CreatedOrder | undefined> {
  const record = await prisma.idempotencyRecord.findUnique({
    where: { actorId_operation_key: { actorId, operation: CREATE_ORDER_OPERATION, key } },
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
  return resultFromSnapshot(record.resultSnapshot);
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
  estimatedPreparationMinutes: number;
  tableSeatingLimitSnapshotMinutes: number | null;
  estimatedTableReleaseAt: Date | null;
  createdAt: Date;
  items: Array<{
    id: string;
    productId: string;
    productNameSnapshot: string;
    basePriceSnapshot: number;
    preparationDeadlineSnapshotMinutes: number;
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
    state: order.state as "OPEN" | "DELETED",
    paymentStatus: order.paymentStatus as "UNPAID" | "PARTIALLY_PAID" | "PAID",
    tableSeatingLimitSnapshotMinutes: order.tableSeatingLimitSnapshotMinutes,
    estimatedTableReleaseAt: order.estimatedTableReleaseAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({ ...item, options: item.options })),
  };
}

export async function createOrder(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  input: CreateOrderRequest,
  idempotencyKey: string,
  requestId: string,
): Promise<OrderCreationResult> {
  requireRole(actor, ["STAFF", "MANAGER"]);

  const fingerprint = requestFingerprint(input);
  const previous = await existingIdempotencyResult(prisma, actor.id, idempotencyKey, fingerprint);
  if (previous) {
    return { order: previous, replayed: true };
  }

  try {
    const order = await prisma.$transaction(async (transaction) => {
      const productIds = [...new Set(input.items.map((item) => item.productId))];
      const products = await transaction.product.findMany({
        where: { id: { in: productIds } },
        include: {
          category: { select: { isActive: true, archivedAt: true } },
          productOptionGroups: {
            include: {
              optionGroup: {
                include: {
                  options: {
                    select: {
                      id: true,
                      name: true,
                      priceAmount: true,
                      isActive: true,
                      isAvailable: true,
                      archivedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      const productById = new Map(products.map((product) => [product.id, product]));

      for (const item of input.items) {
        const product = productById.get(item.productId);
        if (!product || !isAvailableProduct(product)) {
          throw new ApplicationError(
            422,
            ErrorCodes.UNAVAILABLE_PRODUCT,
            "One or more selected products are unavailable.",
          );
        }
        const allowedOptions = new Map(
          product.productOptionGroups
            .filter(({ optionGroup }) => optionGroup.isActive)
            .flatMap(({ optionGroup }) => optionGroup.options)
            .map((option) => [option.id, option]),
        );
        for (const selectedOption of item.options) {
          const option = allowedOptions.get(selectedOption.optionId);
          if (!option || !option.isActive || !option.isAvailable || option.archivedAt) {
            throw new ApplicationError(
              422,
              ErrorCodes.UNAVAILABLE_PRODUCT,
              "One or more selected options are unavailable.",
            );
          }
          if (selectedOption.quantity > item.quantity) {
            throw new ApplicationError(
              422,
              ErrorCodes.BUSINESS_RULE_VIOLATION,
              "An option quantity cannot exceed its order item quantity.",
            );
          }
        }
      }

      const table =
        input.channel === "TABLE"
          ? await transaction.cafeTable.findFirst({
              where: { id: input.tableId, isActive: true, archivedAt: null },
              select: { id: true, seatingLimitMinutes: true },
            })
          : null;
      if (input.channel === "TABLE" && !table) {
        throw new ApplicationError(
          422,
          ErrorCodes.BUSINESS_RULE_VIOLATION,
          "The table is unavailable.",
        );
      }

      const preparedItems = input.items.map((item, displayOrder) => {
        const product = productById.get(item.productId)!;
        const optionById = new Map(
          product.productOptionGroups
            .filter(({ optionGroup }) => optionGroup.isActive)
            .flatMap(({ optionGroup }) => optionGroup.options)
            .map((option) => [option.id, option]),
        );
        const options = item.options.map((selectedOption) => {
          const option = optionById.get(selectedOption.optionId)!;
          return {
            optionId: option.id,
            optionNameSnapshot: option.name,
            priceSnapshot: option.priceAmount,
            quantity: selectedOption.quantity,
          };
        });
        const productAmount = product.priceAmount * item.quantity;
        const grossLineAmount = productAmount + options.reduce((total, option) => total + option.priceSnapshot * option.quantity, 0);
        const saleDiscount = catalogSaleDiscount(product);
        const discountAmount = saleDiscount ? calculatedDiscount(productAmount, saleDiscount) : 0;
        return {
          productId: product.id,
          productNameSnapshot: product.name,
          basePriceSnapshot: product.priceAmount,
          preparationDeadlineSnapshotMinutes: product.preparationDeadlineMinutes,
          quantity: item.quantity,
          note: item.note ?? null,
          discountKind: saleDiscount?.kind ?? null,
          discountValue: saleDiscount?.value ?? null,
          discountAmount,
          discountReason: null,
          lineTotalAmount: grossLineAmount - discountAmount,
          displayOrder,
          options,
        };
      });
      const subtotalAmount = preparedItems.reduce((total, item) => total + item.lineTotalAmount, 0);
      const createdAt = new Date();
      const timing = table
        ? calculateTableEta({
            seatedAt: createdAt,
            seatingLimitMinutes: table.seatingLimitMinutes,
            itemPreparationDeadlineMinutes: preparedItems.map(
              (item) => item.preparationDeadlineSnapshotMinutes,
            ),
          })
        : null;

      const created = await transaction.order.create({
        data: {
          orderNumber: orderNumber(),
          createdById: actor.id,
          channel: input.channel,
          tableId: table?.id ?? null,
          subtotalAmount,
          totalAmount: subtotalAmount,
          balanceAmount: subtotalAmount,
          estimatedPreparationMinutes:
            timing?.estimatedPreparationMinutes ??
            Math.max(...preparedItems.map((item) => item.preparationDeadlineSnapshotMinutes)),
          tableSeatingLimitSnapshotMinutes: table?.seatingLimitMinutes ?? null,
          estimatedTableReleaseAt: timing?.estimatedReleaseAt ?? null,
          createdAt,
          items: {
            create: preparedItems.map((item) => ({
              ...item,
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
      const createdWithItems = await transaction.order.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          items: {
            orderBy: { displayOrder: "asc" },
            include: { options: { orderBy: { id: "asc" } } },
          },
        },
      });
      const result = toCreatedOrder(createdWithItems);
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          requestId,
          operation: CREATE_ORDER_OPERATION,
          entityType: "ORDER",
          entityId: created.id,
          afterSnapshot: {
            orderNumber: result.orderNumber,
            channel: result.channel,
            tableId: result.tableId,
            subtotalAmount: result.subtotalAmount,
            totalAmount: result.totalAmount,
            itemCount: result.items.length,
          },
        },
      });
      await transaction.idempotencyRecord.create({
        data: {
          actorId: actor.id,
          operation: CREATE_ORDER_OPERATION,
          key: idempotencyKey,
          requestFingerprint: fingerprint,
          responseStatus: 201,
          resultSnapshot: result,
          expiresAt: new Date(createdAt.getTime() + IDEMPOTENCY_RETENTION_MS),
        },
      });
      return result;
    });
    return { order, replayed: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await existingIdempotencyResult(prisma, actor.id, idempotencyKey, fingerprint);
      if (replay) {
        return { order: replay, replayed: true };
      }
    }
    throw error;
  }
}

const orderDetailInclude = {
  items: {
    orderBy: { displayOrder: "asc" },
    include: { options: { orderBy: { id: "asc" } } },
  },
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
    channel: order.channel,
    tableId: order.tableId,
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
    estimatedPreparationMinutes: order.estimatedPreparationMinutes,
    tableSeatingLimitSnapshotMinutes: order.tableSeatingLimitSnapshotMinutes,
    estimatedTableReleaseAt: order.estimatedTableReleaseAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot,
      basePriceSnapshot: item.basePriceSnapshot,
      preparationDeadlineSnapshotMinutes: item.preparationDeadlineSnapshotMinutes,
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
    settlements: order.paymentSettlements.map((settlement) => ({
      id: settlement.id,
      totalAmount: settlement.totalAmount,
      recordedAt: settlement.recordedAt.toISOString(),
      reversedAt: settlement.reversal?.recordedAt.toISOString() ?? null,
      allocations: settlement.allocations,
      payments: settlement.payments,
    })),
  };
}

export async function readOrder(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string) {
  requireRole(actor, ["STAFF", "MANAGER"]);
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
  requireRole(actor, ["STAFF", "MANAGER"]);
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const where: Prisma.OrderWhereInput = {
    ...(query.state ? { state: query.state } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.tableId ? { tableId: query.tableId } : {}),
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
      channel: order.channel,
      tableId: order.tableId,
      state: order.state,
      paymentStatus: order.paymentStatus,
      version: order.version,
      totalAmount: order.totalAmount,
      balanceAmount: order.balanceAmount,
      estimatedPreparationMinutes: order.estimatedPreparationMinutes,
      estimatedTableReleaseAt: order.estimatedTableReleaseAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    })),
    page: {
      limit: query.limit,
      nextCursor: hasMore ? encodeCursor(orders[orders.length - 1]!) : null,
      hasMore,
    },
  };
}

export async function updateOrder(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  orderId: string,
  input: UpdateOrderRequest,
  requestId: string,
) {
  requireRole(actor, ["STAFF", "MANAGER"]);
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({ where: { id: orderId }, include: orderDetailInclude });
    if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
    if (order.state !== OrderState.OPEN) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Only open orders can be edited.");
    if (order.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    const activeAllocations = new Map<string, number>();
    order.paymentSettlements.filter((settlement) => !settlement.reversal).forEach((settlement) => settlement.allocations.forEach((allocation) => activeAllocations.set(allocation.orderItemId, (activeAllocations.get(allocation.orderItemId) ?? 0) + allocation.quantity)));
    if (input.items && activeAllocations.size > 0) {
      throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Order contents cannot be replaced after settlement.");
    }
    const catalogItems = input.items ?? input.addItems;
    if (catalogItems) {
      const productIds = [...new Set(catalogItems.map((item) => item.productId))];
      const products = await transaction.product.findMany({
        where: { id: { in: productIds } },
        include: {
          category: { select: { isActive: true, archivedAt: true } },
          productOptionGroups: { include: { optionGroup: { include: { options: true } } } },
        },
      });
      const productById = new Map(products.map((product) => [product.id, product as ProductForOrder]));
      const prepared = catalogItems.map((requested, index) => {
        const product = productById.get(requested.productId);
        if (!product || !isAvailableProduct(product)) throw new ApplicationError(422, ErrorCodes.UNAVAILABLE_PRODUCT, "One or more selected products are unavailable.");
        const allowedOptions = new Map(product.productOptionGroups.filter(({ optionGroup }) => optionGroup.isActive).flatMap(({ optionGroup }) => optionGroup.options).map((option) => [option.id, option]));
        const options = requested.options.map((selected) => {
          const option = allowedOptions.get(selected.optionId);
          if (!option || !option.isActive || !option.isAvailable || option.archivedAt) throw new ApplicationError(422, ErrorCodes.UNAVAILABLE_PRODUCT, "One or more selected options are unavailable.");
          if (selected.quantity > requested.quantity) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An option quantity cannot exceed its order item quantity.");
          return { optionId: option.id, optionNameSnapshot: option.name, priceSnapshot: option.priceAmount, quantity: selected.quantity };
        });
        const productAmount = product.priceAmount * requested.quantity;
        const grossLineAmount = productAmount + options.reduce((sum, option) => sum + option.priceSnapshot * option.quantity, 0);
        const saleDiscount = catalogSaleDiscount(product);
        const discountAmount = saleDiscount ? calculatedDiscount(productAmount, saleDiscount) : 0;
        return {
          productId: product.id, productNameSnapshot: product.name, basePriceSnapshot: product.priceAmount,
          preparationDeadlineSnapshotMinutes: product.preparationDeadlineMinutes, quantity: requested.quantity,
          note: requested.note ?? null, discountKind: saleDiscount?.kind ?? null, discountValue: saleDiscount?.value ?? null,
          discountAmount, discountReason: null, lineTotalAmount: grossLineAmount - discountAmount,
          displayOrder: input.items ? index : order.items.length + index, options,
        };
      });
      if (input.items) {
        await transaction.orderItem.deleteMany({ where: { orderId } });
      }
      await transaction.orderItem.createMany({ data: prepared.map(({ options, ...item }) => ({ ...item, orderId })) });
      for (const item of prepared) {
        const created = await transaction.orderItem.findFirstOrThrow({ where: { orderId, displayOrder: item.displayOrder }, select: { id: true } });
        await transaction.orderItemOption.createMany({ data: item.options.map((option) => ({ ...option, orderItemId: created.id })) });
      }
    }
    for (const change of input.itemUpdates ?? []) {
      const item = order.items.find((candidate) => candidate.id === change.orderItemId);
      if (!item) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An order item does not belong to this order.");
      const allocated = activeAllocations.get(item.id) ?? 0;
      if (change.quantity !== undefined && change.quantity < allocated) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "An item quantity cannot be reduced below settled quantity.");
      if (change.note !== undefined && allocated > 0) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "A settled item note cannot be changed.");
      if (change.discount !== undefined && allocated > 0) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "A settled item discount cannot be changed.");
      const quantity = change.quantity ?? item.quantity;
      const optionTotal = item.options.reduce((total, option) => total + option.priceSnapshot * option.quantity, 0);
      if (item.options.some((option) => option.quantity > quantity)) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "An option quantity cannot exceed its order item quantity.");
      const grossLineAmount = item.basePriceSnapshot * quantity + optionTotal;
      const discount = change.discount;
      const existingDiscount = item.discountKind && item.discountValue ? { kind: item.discountKind, value: item.discountValue } : null;
      const appliedDiscount = discount === undefined ? existingDiscount : discount;
      const discountBaseAmount = discount === undefined && item.discountReason === null ? item.basePriceSnapshot * quantity : grossLineAmount;
      const discountAmount = calculatedDiscount(discountBaseAmount, appliedDiscount);
      await transaction.orderItem.update({ where: { id: item.id }, data: {
        quantity, ...(change.note !== undefined ? { note: change.note } : {}),
        ...(discount === undefined ? {} : { discountKind: discount?.kind ?? null, discountValue: discount?.value ?? null, discountAmount, discountReason: discount?.reason ?? null }),
        lineTotalAmount: grossLineAmount - discountAmount,
      } });
    }
    const items = await transaction.orderItem.findMany({ where: { orderId }, include: { options: true } });
    const subtotalAmount = items.reduce((total, item) => total + item.lineTotalAmount, 0);
    if (input.orderDiscount !== undefined && activeAllocations.size > 0) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "The order discount cannot change after settlement.");
    const orderDiscountAmount = input.orderDiscount === undefined ? order.discountAmount : input.orderDiscount === null ? 0 : calculatedDiscount(subtotalAmount, input.orderDiscount);
    if (orderDiscountAmount > subtotalAmount) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The existing order discount exceeds the updated order amount.");
    const estimatedPreparationMinutes = Math.max(...items.map((item) => item.preparationDeadlineSnapshotMinutes));
    const updated = await transaction.order.updateMany({ where: { id: orderId, version: input.expectedVersion, state: OrderState.OPEN }, data: { subtotalAmount, discountAmount: orderDiscountAmount, ...(input.orderDiscount === undefined ? {} : { discountKind: input.orderDiscount?.kind ?? null, discountValue: input.orderDiscount?.value ?? null, discountReason: input.orderDiscount?.reason ?? null }), totalAmount: subtotalAmount - orderDiscountAmount, balanceAmount: subtotalAmount - orderDiscountAmount - order.paidAmount, estimatedPreparationMinutes, version: { increment: 1 } } });
    if (updated.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    await transaction.auditLog.create({ data: { actorId: actor.id, requestId, operation: "UPDATE_ORDER", entityType: "ORDER", entityId: orderId, afterSnapshot: { version: input.expectedVersion + 1 } } });
    return orderDetailDto(await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDetailInclude }));
  });
}

export async function transferOrderTable(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string, input: TransferOrderTableRequest, requestId: string) {
  requireRole(actor, ["STAFF", "MANAGER"]);
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({ where: { id: orderId }, include: orderDetailInclude });
    if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
    if (order.state !== OrderState.OPEN || order.channel !== OrderChannel.TABLE) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Only open table orders can be transferred.");
    if (order.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    const table = await transaction.cafeTable.findFirst({ where: { id: input.tableId, isActive: true, archivedAt: null } });
    if (!table) throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "The table is unavailable.");
    const timing = calculateTableEta({ seatedAt: order.createdAt, seatingLimitMinutes: table.seatingLimitMinutes, itemPreparationDeadlineMinutes: [order.estimatedPreparationMinutes] });
    const updated = await transaction.order.updateMany({ where: { id: orderId, version: input.expectedVersion, state: OrderState.OPEN }, data: { tableId: table.id, tableSeatingLimitSnapshotMinutes: table.seatingLimitMinutes, estimatedTableReleaseAt: timing.estimatedReleaseAt, version: { increment: 1 } } });
    if (updated.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
    await transaction.auditLog.create({ data: { actorId: actor.id, requestId, operation: "TRANSFER_ORDER_TABLE", entityType: "ORDER", entityId: orderId, afterSnapshot: { tableId: table.id, version: input.expectedVersion + 1 } } });
    return orderDetailDto(await transaction.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDetailInclude }));
  });
}

export async function deleteOrder(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  orderId: string,
  input: DeleteOrderRequest,
  requestId: string,
) {
  requireRole(actor, ["STAFF", "MANAGER"]);
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested order was not found.");
    if (order.state !== OrderState.OPEN) throw new ApplicationError(409, ErrorCodes.INVALID_STATE, "Only open orders can be deleted.");
    if (order.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");

    const deletedAt = new Date();
    const updated = await transaction.order.updateMany({
      where: { id: orderId, state: OrderState.OPEN, version: input.expectedVersion },
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
