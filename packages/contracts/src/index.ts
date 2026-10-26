import { z } from "zod";
export * from "./terminal-payments.js";


export const DEFAULT_TABLE_SEATING_LIMIT_MINUTES = 45;

export const DISCOUNT_PRICE_ROUNDING_UNIT = 1_000;

export function roundDiscountedAmount(amount: number) {
  return Math.floor((amount + DISCOUNT_PRICE_ROUNDING_UNIT / 2) / DISCOUNT_PRICE_ROUNDING_UNIT) * DISCOUNT_PRICE_ROUNDING_UNIT;
}

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadinessResponseSchema = HealthResponseSchema.extend({
  database: z.literal("connected"),
});

export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;

export const ReadinessUnavailableResponseSchema = z.object({
  status: z.literal("error"),
  service: z.string(),
  database: z.literal("unavailable"),
  timestamp: z.iso.datetime(),
});

export type ReadinessUnavailableResponse = z.infer<typeof ReadinessUnavailableResponseSchema>;

export const UserRoleSchema = z.enum(["MANAGER", "STAFF"]);

export const AuthenticatedUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  role: UserRoleSchema,
});

export const LoginRequestSchema = z
  .object({
    username: z.string().regex(/^[a-z0-9._-]{3,64}$/),
    password: z.string().min(1).max(128),
  })
  .strict();

export const AuthenticationResponseSchema = z.object({
  data: AuthenticatedUserSchema,
  meta: z.object({ requestId: z.string() }),
});

export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

export const RequestIdHeaderSchema = z.object({
  "x-request-id": z
    .string()
    .regex(/^[A-Za-z0-9._:-]{8,128}$/)
    .optional(),
});

export const AuthRequestHeadersSchema = RequestIdHeaderSchema.extend({
  cookie: z.string().optional(),
});

export const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/);

export const IdempotencyRequestHeadersSchema = AuthRequestHeadersSchema.extend({
  "idempotency-key": IdempotencyKeySchema,
});

export const CreateOrderRequestHeadersSchema = IdempotencyRequestHeadersSchema.extend({
  "x-pos-table-name": z.string().trim().min(1).max(120).optional(),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z
      .array(z.object({ path: z.string(), code: z.string(), message: z.string() }))
      .optional(),
    requestId: z.string(),
    timestamp: z.iso.datetime(),
  }),
});

export const ProductPreparationDeadlineMinutesSchema = z.number().int().min(1);

export const TableSeatingLimitMinutesSchema = z
  .number()
  .int()
  .min(1)
  .default(DEFAULT_TABLE_SEATING_LIMIT_MINUTES);

export const TableIdPathSchema = z.object({
  tableId: z.uuid(),
});

export const ProductImageSchema = z.object({
  storageKey: z.string(),
  altText: z.string(),
});

export const PosCatalogOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceAmount: z.number().int().nonnegative(),
  isAvailable: z.boolean(),
});

export const PosCatalogOptionGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  minSelections: z.number().int().nonnegative(),
  maxSelections: z.number().int().positive(),
  options: z.array(PosCatalogOptionSchema),
});

export const PosCatalogProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceAmount: z.number().int().nonnegative(),
  pricingMode: z.enum(["FIXED", "WEIGHTED_PER_KG"]),
  saleDiscountKind: z.enum(["FIXED", "PERCENTAGE"]).nullable(),
  saleDiscountValue: z.number().int().positive().nullable(),
  preparationDeadlineMinutes: ProductPreparationDeadlineMinutesSchema,
  isAvailable: z.boolean(),
  image: ProductImageSchema.nullable(),
  optionGroups: z.array(PosCatalogOptionGroupSchema),
});
export type PosCatalogProduct = z.infer<typeof PosCatalogProductSchema>;

export const PosCatalogCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  products: z.array(PosCatalogProductSchema),
});
export type PosCatalogCategory = z.infer<typeof PosCatalogCategorySchema>;

export const PosCatalogResponseSchema = z.object({
  data: z.object({ categories: z.array(PosCatalogCategorySchema) }),
  meta: z.object({ requestId: z.string() }),
});

export const ActiveTableOrderSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  dailyOrderNumber: z.number().int().positive(),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]),
  itemPreparationDeadlineMinutes: z.array(ProductPreparationDeadlineMinutesSchema),
  createdAt: z.iso.datetime(),
});

export const PosTableSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  waiterCallEnabled: z.boolean(),
  occupancyState: z.enum(["AVAILABLE", "OCCUPIED"]),
  occupiedAt: z.iso.datetime().nullable(),
  occupancyReminderAt: z.iso.datetime().nullable(),
  activeOrders: z.array(ActiveTableOrderSchema),
});

export const PosTablesResponseSchema = z.object({
  data: z.object({
    tableSeatingLimitMinutes: TableSeatingLimitMinutesSchema.nullable(),
    tables: z.array(PosTableSchema),
  }),
  meta: z.object({ requestId: z.string() }),
});
export type PosTable = z.infer<typeof PosTableSchema>;

export const PosTableResponseSchema = z.object({
  data: PosTableSchema,
  meta: z.object({ requestId: z.string() }),
});

export const OrderItemOptionInputSchema = z
  .object({
    optionId: z.uuid(),
    quantity: z.number().int().positive(),
  })
  .strict();

export const CreateOrderItemSchema = z
  .object({
    productId: z.uuid(),
    quantity: z.number().int().positive(),
    weightGrams: z.number().int().positive().optional(),
    note: z.string().trim().min(1).max(1_000).optional(),
    options: z.array(OrderItemOptionInputSchema).max(50),
  })
  .strict()
  .superRefine((item, context) => {
    const optionIds = new Set<string>();
    item.options.forEach((option, index) => {
      if (optionIds.has(option.optionId)) {
        context.addIssue({
          code: "custom",
          path: ["options", index, "optionId"],
          message: "An option can be selected only once per order item.",
        });
      }
      optionIds.add(option.optionId);
    });
  });

export const DiscountInputSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("FIXED"), value: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal("PERCENTAGE"), value: z.number().int().min(1).max(100) }).strict(),
  ])
  .nullable();

export type DiscountInput = z.infer<typeof DiscountInputSchema>;

export const ReasonedDiscountInputSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("FIXED"), value: z.number().int().positive(), reason: z.string().trim().min(1).max(500).optional() }).strict(),
    z.object({ kind: z.literal("PERCENTAGE"), value: z.number().int().min(1).max(100), reason: z.string().trim().min(1).max(500).optional() }).strict(),
  ])
  .nullable();

const CreateOrderBaseSchema = z.object({
  items: z.array(CreateOrderItemSchema).min(1).max(100),
});

export const CreateOrderRequestSchema = CreateOrderBaseSchema.extend({
  channel: z.enum(["TABLE", "TAKEAWAY"]),
  tableId: z.uuid().optional(),
})
  .strict()
  .superRefine((value, context) => {
    if (value.channel === "TABLE" && !value.tableId) {
      context.addIssue({ code: "custom", path: ["tableId"], message: "tableId is required for table orders." });
    }
    if (value.channel === "TAKEAWAY" && value.tableId) {
      context.addIssue({ code: "custom", path: ["tableId"], message: "tableId is not allowed for takeaway orders." });
    }
  });

export type CreateOrderRequest =
  | { channel: "TABLE"; tableId: string; items: z.infer<typeof CreateOrderBaseSchema>["items"] }
  | { channel: "TAKEAWAY"; items: z.infer<typeof CreateOrderBaseSchema>["items"] };

export const CreatedOrderItemOptionSchema = z.object({
  optionId: z.uuid(),
  optionNameSnapshot: z.string(),
  priceSnapshot: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
});

export const CreatedOrderItemSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  productNameSnapshot: z.string(),
  basePriceSnapshot: z.number().int().nonnegative(),
  pricingModeSnapshot: z.enum(["FIXED", "WEIGHTED_PER_KG"]),
  weightGrams: z.number().int().positive().nullable(),
  quantity: z.number().int().positive(),
  note: z.string().nullable(),
  discountKind: z.enum(["FIXED", "PERCENTAGE"]).nullable(),
  discountValue: z.number().int().positive().nullable(),
  discountAmount: z.number().int().nonnegative(),
  discountReason: z.string().nullable(),
  lineTotalAmount: z.number().int().nonnegative(),
  options: z.array(CreatedOrderItemOptionSchema),
});

export const CreatedOrderSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  dailyOrderNumber: z.number().int().positive(),
  channel: z.enum(["TABLE", "TAKEAWAY"]),
  tableId: z.uuid().nullable(),
  state: z.literal("OPEN"),
  paymentStatus: z.literal("UNPAID"),
  version: z.literal(1),
  discountAmount: z.literal(0),
  discountKind: z.null(),
  discountValue: z.null(),
  discountReason: z.null(),
  subtotalAmount: z.number().int().nonnegative(),
  totalAmount: z.number().int().nonnegative(),
  paidAmount: z.literal(0),
  balanceAmount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  items: z.array(CreatedOrderItemSchema),
});
export type CreatedOrder = z.infer<typeof CreatedOrderSchema>;

export const CreateOrderResponseSchema = z.object({
  data: CreatedOrderSchema,
  meta: z.object({ requestId: z.string() }),
});

export const OrderIdPathSchema = z.object({ orderId: z.uuid() });
export const SettlementIdPathSchema = z.object({ orderId: z.uuid(), settlementId: z.uuid() });
export const SettlementPathSchema = z.object({ settlementId: z.uuid() });

export const OrderStateSchema = z.enum(["OPEN", "CLOSED", "DELETED"]);
export const PaymentStatusSchema = z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]);
export const OrderChannelSchema = z.enum(["TABLE", "TAKEAWAY"]);

export const SettlementSummarySchema = z.object({
  id: z.uuid(),
  totalAmount: z.number().int().nonnegative(),
  recordedAt: z.iso.datetime(),
  reversedAt: z.iso.datetime().nullable(),
  allocations: z.array(
    z.object({
      orderItemId: z.uuid(),
      quantity: z.number().int().nonnegative(),
      amount: z.number().int().nonnegative(),
    }),
  ),
  payments: z.array(
    z.object({
      method: z.enum(["CASH", "CARD_TERMINAL", "CARD_TRANSFER"]),
      amount: z.number().int().positive(),
      reference: z.string().nullable(),
    }),
  ),
});

export const OrderDetailSchema = CreatedOrderSchema.extend({
  tableName: z.string().nullable(),
  channel: OrderChannelSchema,
  state: OrderStateSchema,
  paymentStatus: PaymentStatusSchema,
  version: z.number().int().positive(),
  discountAmount: z.number().int().nonnegative(),
  discountKind: z.enum(["FIXED", "PERCENTAGE"]).nullable(),
  discountValue: z.number().int().positive().nullable(),
  discountReason: z.string().nullable(),
  paidAmount: z.number().int().nonnegative(),
  settlements: z.array(SettlementSummarySchema),
});

export const OrderDetailResponseSchema = z.object({
  data: OrderDetailSchema,
  meta: z.object({ requestId: z.string() }),
});

export const OrderSummarySchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  dailyOrderNumber: z.number().int().positive(),
  channel: OrderChannelSchema,
  tableId: z.uuid().nullable(),
  state: OrderStateSchema,
  paymentStatus: PaymentStatusSchema,
  version: z.number().int().positive(),
  totalAmount: z.number().int().nonnegative(),
  balanceAmount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export const OrderListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
    state: OrderStateSchema.optional(),
    paymentStatus: PaymentStatusSchema.optional(),
    channel: OrderChannelSchema.optional(),
    tableId: z.uuid().optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    q: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from must not be later than to.",
    path: ["to"],
  });

export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;

export const OrderListResponseSchema = z.object({
  data: z.object({ orders: z.array(OrderSummarySchema) }),
  meta: z.object({
    requestId: z.string(),
    page: z.object({ limit: z.number().int(), nextCursor: z.string().nullable(), hasMore: z.boolean() }),
  }),
});

const PaymentHistoryDateQuerySchema = z
  .object({
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    fromTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    toTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  })
  .strict()
  .refine((query) => query.fromDate <= query.toDate, {
    message: "fromDate must not be later than toDate.",
    path: ["toDate"],
  });
export const PaymentHistoryOrderFilterSchema = z.enum(["MULTIPLE_SETTLEMENTS", "DISCOUNTED"]);
export const PaymentHistoryQuerySchema = PaymentHistoryDateQuerySchema.extend({
  orderFilter: PaymentHistoryOrderFilterSchema.optional(),
}).strict();
export type PaymentHistoryQuery = z.infer<typeof PaymentHistoryQuerySchema>;

export const PaymentHistoryEntrySchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  dailyOrderNumber: z.number().int().positive(),
  orderState: OrderStateSchema,
  channel: OrderChannelSchema,
  table: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  totalAmount: z.number().int().nonnegative(),
  recordedAt: z.iso.datetime(),
  recordedBy: z.object({ id: z.uuid(), username: z.string(), role: UserRoleSchema }),
  reversedAt: z.iso.datetime().nullable(),
  payments: z.array(
    z.object({
      method: z.enum(["CASH", "CARD_TERMINAL", "CARD_TRANSFER"]),
      amount: z.number().int().positive(),
      reference: z.string().nullable(),
    }),
  ),
  settlementReceiptPath: z.string(),
});

export const PaymentHistoryResponseSchema = z.object({
  data: z.object({ payments: z.array(PaymentHistoryEntrySchema) }),
  meta: z.object({ requestId: z.string() }),
});

export const DailyReportQuerySchema = PaymentHistoryDateQuerySchema;
export type DailyReportQuery = z.infer<typeof DailyReportQuerySchema>;

export const DailyAccountingReportSchema = z.object({
  salesAmount: z.number().int().nonnegative(),
  paidAmount: z.number().int().nonnegative(),
  orderCount: z.number().int().nonnegative(),
  paymentMethodTotals: z.object({
    cashAmount: z.number().int().nonnegative(),
    cardTerminalAmount: z.number().int().nonnegative(),
    cardTransferAmount: z.number().int().nonnegative(),
  }),
  discounts: z.object({
    orderAmount: z.number().int().nonnegative(),
    itemAmount: z.number().int().nonnegative(),
    totalAmount: z.number().int().nonnegative(),
  }),
  reversals: z.object({ count: z.number().int().nonnegative(), amount: z.number().int().nonnegative() }),
  deletedOrders: z.object({ count: z.number().int().nonnegative(), totalAmount: z.number().int().nonnegative(), paidAmount: z.number().int().nonnegative() }),
});

export const DailyReportResponseSchema = z.object({
  data: DailyAccountingReportSchema,
  meta: z.object({
    requestId: z.string(),
    range: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  }),
});

export const AuditLogQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
    actorId: z.uuid().optional(),
    operation: z.string().trim().min(1).max(120).optional(),
    entityType: z.string().trim().min(1).max(120).optional(),
    entityId: z.uuid().optional(),
    orderId: z.uuid().optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    sortBy: z.enum(["occurredAt", "operation", "entityType", "actor"]).default("occurredAt"),
    sortDirection: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .refine((query) => !query.from || !query.to || query.from <= query.to, { message: "from must not be later than to.", path: ["to"] });
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export const AuditLogEntrySchema = z.object({
  id: z.uuid(),
  actor: z.object({ id: z.uuid(), username: z.string(), role: UserRoleSchema }).nullable(),
  requestId: z.string(),
  operation: z.string(),
  entityType: z.string(),
  entityId: z.uuid(),
  relatedOrder: z.object({ id: z.uuid() }).nullable(),
  relatedSettlementIds: z.array(z.uuid()),
  reason: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});

export const AuditLogResponseSchema = z.object({
  data: z.object({ entries: z.array(AuditLogEntrySchema) }),
  meta: z.object({ requestId: z.string(), page: z.object({ limit: z.number().int(), nextCursor: z.string().nullable(), hasMore: z.boolean() }) }),
});

export const ExistingOrderItemUpdateSchema = z
  .object({
    orderItemId: z.uuid(),
    quantity: z.number().int().positive().optional(),
    weightGrams: z.number().int().positive().optional(),
    note: z.string().trim().min(1).max(1_000).nullable().optional(),
    discount: ReasonedDiscountInputSchema.optional(),
  })
  .strict()
  .refine((item) => item.quantity !== undefined || item.note !== undefined || item.discount !== undefined, {
    message: "An item update needs a quantity or note.",
  });

export const UpdateOrderRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    items: z.array(CreateOrderItemSchema).min(1).max(100).optional(),
    addItems: z.array(CreateOrderItemSchema).min(1).max(100).optional(),
    itemUpdates: z.array(ExistingOrderItemUpdateSchema).min(1).max(100).optional(),
    orderDiscount: ReasonedDiscountInputSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.items && !input.addItems && !input.itemUpdates && input.orderDiscount === undefined) {
      context.addIssue({ code: "custom", message: "At least one order change is required." });
    }
    if (input.items && (input.addItems || input.itemUpdates)) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "items cannot be combined with addItems or itemUpdates.",
      });
    }
    const itemIds = new Set<string>();
    input.itemUpdates?.forEach((item, index) => {
      if (itemIds.has(item.orderItemId)) {
        context.addIssue({
          code: "custom",
          path: ["itemUpdates", index, "orderItemId"],
          message: "Each order item can be updated only once.",
        });
      }
      itemIds.add(item.orderItemId);
    });
  });

export type UpdateOrderRequest = z.infer<typeof UpdateOrderRequestSchema>;

export const TransferOrderTableRequestSchema = z
  .object({ expectedVersion: z.number().int().positive(), tableId: z.uuid() })
  .strict();

export type TransferOrderTableRequest = z.infer<typeof TransferOrderTableRequestSchema>;

export const DeleteOrderRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type DeleteOrderRequest = z.infer<typeof DeleteOrderRequestSchema>;

export const SettlementAllocationInputSchema = z.object({ orderItemId: z.uuid(), quantity: z.number().int().positive() }).strict();

export const SettlementPaymentInputSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("CASH"), amount: z.number().int().positive() }).strict(),
  z.object({ method: z.literal("CARD_TERMINAL"), amount: z.number().int().positive() }).strict(),
  z.object({ method: z.literal("CARD_TRANSFER"), amount: z.number().int().positive(), reference: z.string().trim().min(1).max(128).optional() }).strict(),
]);

const SettlementBaseSchema = z.object({
    expectedVersion: z.number().int().positive(),
    payments: z.array(SettlementPaymentInputSchema).min(1).max(10),
  }).strict();
export const RecordSettlementRequestSchema = z.union([
  SettlementBaseSchema.extend({ allocationMode: z.literal("ITEM_QUANTITY").optional(), allocations: z.array(SettlementAllocationInputSchema).min(1).max(100) }).superRefine((input, context) => {
    const itemIds = new Set<string>();
    input.allocations.forEach((allocation, index) => {
      if (itemIds.has(allocation.orderItemId)) {
        context.addIssue({ code: "custom", path: ["allocations", index, "orderItemId"], message: "Each order item can be allocated only once per settlement." });
      }
      itemIds.add(allocation.orderItemId);
    });
  }),
  SettlementBaseSchema.extend({ allocationMode: z.literal("AMOUNT"), amount: z.number().int().positive() }),
]);

export type RecordSettlementRequest = z.infer<typeof RecordSettlementRequestSchema>;

export const RecordSettlementResponseSchema = OrderDetailResponseSchema;

export const ReverseSettlementRequestSchema = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(500).optional() }).strict();
export type ReverseSettlementRequest = z.infer<typeof ReverseSettlementRequestSchema>;
export const ReverseSettlementResponseSchema = OrderDetailResponseSchema;

export const EditSettlementRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  payments: z.array(SettlementPaymentInputSchema).min(1).max(10),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();
export type EditSettlementRequest = z.infer<typeof EditSettlementRequestSchema>;
export const EditSettlementResponseSchema = OrderDetailResponseSchema;

const ReceiptItemSchema = z.object({
  productName: z.string(),
  quantity: z.number().int().positive(),
  basePriceSnapshot: z.number().int().nonnegative(),
  pricingModeSnapshot: z.enum(["FIXED", "WEIGHTED_PER_KG"]),
  weightGrams: z.number().int().positive().nullable(),
  options: z.array(z.object({ name: z.string(), quantity: z.number().int().positive() })),
  lineTotalAmount: z.number().int().nonnegative(),
  paidAmount: z.number().int().nonnegative(),
  isPaid: z.boolean(),
});
export const BarTicketResponseSchema = z.object({ data: z.object({ preparationId: z.string().uuid().optional(), dailyOrderNumber: z.number().int().positive(), context: z.string(), items: z.array(z.object({ productName: z.string(), quantity: z.number().int().positive(), pricingModeSnapshot: z.enum(["FIXED", "WEIGHTED_PER_KG"]), weightGrams: z.number().int().positive().nullable(), options: z.array(z.object({ name: z.string(), quantity: z.number().int().positive() })), note: z.string().nullable() })) }), meta: z.object({ requestId: z.string() }) });
export const OrderReceiptResponseSchema = z.object({ data: z.object({ displayTime: z.string(), items: z.array(ReceiptItemSchema), totalAmount: z.number().int().nonnegative() }), meta: z.object({ requestId: z.string() }) });
export const SettlementReceiptResponseSchema = z.object({ data: z.object({ displayTime: z.string(), items: z.array(ReceiptItemSchema), totalAmount: z.number().int().nonnegative() }), meta: z.object({ requestId: z.string() }) });

export const ProductSaleDiscountRequestSchema = z
  .object({ saleDiscount: DiscountInputSchema })
  .strict();

export type ProductSaleDiscountRequest = z.infer<typeof ProductSaleDiscountRequestSchema>;

// Manager administration contracts. These intentionally expose safe DTOs rather than Prisma models.
const AdminNameSchema = z.string().trim().min(1).max(120);
const AdminDisplayOrderSchema = z.number().int().min(0).max(10_000);
const AdminMoneySchema = z.number().int().nonnegative();
const ProductMenuNoteSchema = z.string().trim().max(1000).nullable().optional();
export const AdminCategoryInputSchema = z.object({ name: AdminNameSchema, kind: z.enum(["SOURCE", "PROMOTIONAL"]).optional(), displayOrder: AdminDisplayOrderSchema.optional(), isActive: z.boolean().optional(), isPosVisible: z.boolean().optional() }).strict();
export const AdminCategoryProductsInputSchema = z.object({ productIds: z.array(z.uuid()).max(2_000) }).strict();
const AdminProductOptionGroupInputSchema = z.object({ optionGroupId: z.uuid(), displayOrder: AdminDisplayOrderSchema, minSelections: z.number().int().nonnegative().default(1), maxSelections: z.number().int().positive().default(1), options: z.array(z.object({ optionId: z.uuid(), displayOrder: AdminDisplayOrderSchema, priceAmountOverride: AdminMoneySchema.nullable().optional() }).strict()).max(100) }).strict().refine((value) => value.minSelections <= value.maxSelections);
export const AdminProductInputSchema = z.object({ categoryId: z.uuid(), name: AdminNameSchema, menuNote: ProductMenuNoteSchema, priceAmount: AdminMoneySchema, pricingMode: z.enum(["FIXED", "WEIGHTED_PER_KG"]).optional(), preparationDeadlineMinutes: ProductPreparationDeadlineMinutesSchema, displayOrder: AdminDisplayOrderSchema.optional(), isPublic: z.boolean().optional(), isActive: z.boolean().optional(), isAvailable: z.boolean().optional(), optionGroups: z.array(AdminProductOptionGroupInputSchema).max(30).optional() }).strict();
export const AdminCategoryReorderInputSchema = z.object({ categoryIds: z.array(z.uuid()).min(1).max(500) }).strict();
export const AdminProductReorderInputSchema = z.object({ productIds: z.array(z.uuid()).min(1).max(2_000) }).strict();
export const AdminOptionGroupInputSchema = z.object({ name: AdminNameSchema, isActive: z.boolean().optional() }).strict();
export const AdminOptionInputSchema = z.object({ name: AdminNameSchema, priceAmount: AdminMoneySchema, displayOrder: AdminDisplayOrderSchema, isActive: z.boolean().optional(), isAvailable: z.boolean().optional() }).strict();
export const AdminTableInputSchema = z.object({ name: AdminNameSchema, displayOrder: AdminDisplayOrderSchema, isActive: z.boolean().optional(), waiterCallEnabled: z.boolean().optional() }).strict();
export const AdminStaffInputSchema = z.object({ username: z.string().regex(/^[a-z0-9._-]{3,64}$/), password: z.string().min(12).max(128) }).strict();
export const AdminStaffUpdateSchema = z.object({ username: z.string().regex(/^[a-z0-9._-]{3,64}$/).optional(), password: z.string().min(12).max(128).optional() }).strict().refine((input) => input.username !== undefined || input.password !== undefined);
export const AdminSettingsUpdateSchema = z.object({ tableSeatingLimitMinutes: TableSeatingLimitMinutesSchema.nullable(), settlementReversalReasonRequired: z.boolean().optional() }).strict();
export const AdminIdPathSchema = z.object({ id: z.uuid() });

const AdminMetaSchema = z.object({ requestId: z.string() });
export const AdminCategorySchema = z.object({ id: z.uuid(), name: z.string(), kind: z.enum(["SOURCE", "PROMOTIONAL"]), productIds: z.array(z.uuid()), displayOrder: AdminDisplayOrderSchema, isActive: z.boolean(), isPosVisible: z.boolean(), archivedAt: z.iso.datetime().nullable() });
export const AdminProductImageSchema = z.object({ storageKey: z.string(), altText: z.string() });
const AdminProductOptionGroupSchema = z.object({ optionGroupId: z.uuid(), displayOrder: AdminDisplayOrderSchema, minSelections: z.number().int().nonnegative(), maxSelections: z.number().int().positive(), options: z.array(z.object({ optionId: z.uuid(), displayOrder: AdminDisplayOrderSchema, priceAmountOverride: AdminMoneySchema.nullable() })) });
export const AdminProductSchema = z.object({ id: z.uuid(), categoryId: z.uuid(), name: z.string(), menuNote: z.string().nullable(), priceAmount: AdminMoneySchema, pricingMode: z.enum(["FIXED", "WEIGHTED_PER_KG"]), saleDiscountKind: z.enum(["FIXED", "PERCENTAGE"]).nullable(), saleDiscountValue: z.number().int().positive().nullable(), isPublic: z.boolean(), systemKey: z.string().nullable(), preparationDeadlineMinutes: ProductPreparationDeadlineMinutesSchema, displayOrder: AdminDisplayOrderSchema, isActive: z.boolean(), isAvailable: z.boolean(), archivedAt: z.iso.datetime().nullable(), image: AdminProductImageSchema.nullable(), optionGroups: z.array(AdminProductOptionGroupSchema) });
export const AdminOptionSchema = z.object({ id: z.uuid(), name: z.string(), priceAmount: AdminMoneySchema, displayOrder: AdminDisplayOrderSchema, isActive: z.boolean(), isAvailable: z.boolean(), archivedAt: z.iso.datetime().nullable() });
export const AdminOptionGroupSchema = z.object({ id: z.uuid(), name: z.string(), isActive: z.boolean(), options: z.array(AdminOptionSchema) });
export const AdminTableSchema = z.object({ id: z.uuid(), name: z.string(), displayOrder: AdminDisplayOrderSchema, isActive: z.boolean(), waiterCallEnabled: z.boolean(), archivedAt: z.iso.datetime().nullable() });
export const AdminStaffSchema = z.object({ id: z.uuid(), username: z.string(), role: z.literal("STAFF"), isActive: z.boolean(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const AdminSettingsSchema = z.object({ id: z.uuid(), tableSeatingLimitMinutes: TableSeatingLimitMinutesSchema.nullable(), settlementReversalReasonRequired: z.boolean(), inventoryActivatedAt: z.iso.datetime().nullable(), updatedAt: z.iso.datetime() });
export const AdminImageResponseSchema = z.object({ data: AdminProductImageSchema, meta: AdminMetaSchema });
export const AdminImageArchiveResponseSchema = z.object({ data: z.object({ productId: z.uuid() }), meta: AdminMetaSchema });
export const AdminCategoriesResponseSchema = z.object({ data: z.object({ categories: z.array(AdminCategorySchema) }), meta: AdminMetaSchema });
export const AdminProductsResponseSchema = z.object({ data: z.object({ products: z.array(AdminProductSchema) }), meta: AdminMetaSchema });
export const AdminOptionGroupsResponseSchema = z.object({ data: z.object({ optionGroups: z.array(AdminOptionGroupSchema) }), meta: AdminMetaSchema });
export const AdminTablesResponseSchema = z.object({ data: z.object({ tables: z.array(AdminTableSchema) }), meta: AdminMetaSchema });
export const AdminStaffResponseSchema = z.object({ data: z.object({ staff: z.array(AdminStaffSchema) }), meta: AdminMetaSchema });
export const AdminSettingsResponseSchema = z.object({ data: AdminSettingsSchema, meta: AdminMetaSchema });
export const AdminCategoryResponseSchema = z.object({ data: AdminCategorySchema, meta: AdminMetaSchema });
export const AdminProductResponseSchema = z.object({ data: AdminProductSchema, meta: AdminMetaSchema });
export const AdminOptionGroupResponseSchema = z.object({ data: AdminOptionGroupSchema, meta: AdminMetaSchema });
export const AdminOptionResponseSchema = z.object({ data: AdminOptionSchema, meta: AdminMetaSchema });
export const AdminTableResponseSchema = z.object({ data: AdminTableSchema, meta: AdminMetaSchema });
export const AdminStaffSingleResponseSchema = z.object({ data: AdminStaffSchema, meta: AdminMetaSchema });

export const ProductSaleDiscountResponseSchema = z.object({
  data: z.object({
    id: z.uuid(),
    saleDiscountKind: z.enum(["FIXED", "PERCENTAGE"]).nullable(),
    saleDiscountValue: z.number().int().positive().nullable(),
  }),
  meta: z.object({ requestId: z.string() }),
});

export const PublicMenuQuerySchema = z
  .object({
    categoryId: z.uuid().optional(),
    q: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type PublicMenuQuery = z.infer<typeof PublicMenuQuerySchema>;

export const PublicMenuOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceAmount: z.number().int().nonnegative(),
  isAvailable: z.boolean(),
});

export const PublicMenuOptionGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  minSelections: z.number().int().nonnegative(),
  maxSelections: z.number().int().positive(),
  options: z.array(PublicMenuOptionSchema),
});

export const PublicMenuProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  menuNote: z.string().nullable(),
  basePriceAmount: z.number().int().nonnegative(),
  priceAmount: z.number().int().nonnegative(),
  saleDiscount: z.object({ kind: z.enum(["FIXED", "PERCENTAGE"]), value: z.number().int().positive(), amount: z.number().int().nonnegative() }).nullable(),
  isAvailable: z.boolean(),
  image: ProductImageSchema.nullable(),
  optionGroups: z.array(PublicMenuOptionGroupSchema),
});

export const PublicMenuCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  products: z.array(PublicMenuProductSchema),
});

export const PublicMenuResponseSchema = z.object({
  data: z.object({ categories: z.array(PublicMenuCategorySchema) }),
  meta: z.object({ requestId: z.string() }),
});

export const PublicProductResponseSchema = z.object({
  data: PublicMenuProductSchema,
  meta: z.object({ requestId: z.string() }),
});

export const TableContextExchangeRequestSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export type TableContextExchangeRequest = z.infer<typeof TableContextExchangeRequestSchema>;

export const PublicTableContextSchema = z.object({
  active: z.boolean(),
  tableName: z.string().nullable(),
  occupancyState: z.enum(["AVAILABLE", "OCCUPIED"]).nullable(),
  waiterCallStatus: z.enum(["PENDING"]).nullable(),
  canCallWaiter: z.boolean(),
  authenticationRequired: z.boolean().optional(),
  customerAuthenticated: z.boolean().optional(),
  visitActive: z.boolean().optional(),
});

export const PublicTableContextResponseSchema = z.object({
  data: PublicTableContextSchema,
  meta: z.object({ requestId: z.string() }),
});

export const PublicWaiterCallResponseSchema = z.object({
  data: z.object({
    status: z.literal("PENDING"),
    tableName: z.string(),
    requestedAt: z.iso.datetime(),
  }),
  meta: z.object({ requestId: z.string() }),
});

export const CustomerOtpRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phoneNumber: z.string().min(1).max(32),
}).strict();
export const CustomerPhoneIdentifySchema = z.object({
  phoneNumber: z.string().min(1).max(32),
}).strict();
export const CustomerOtpVerifySchema = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  verificationToken: z.string().min(1),
}).strict();
export const CustomerOtpResponseSchema = z.object({
  data: z.object({ challengeId: z.uuid(), verificationToken: z.string().min(1), expiresAt: z.iso.datetime(), resendAvailableAt: z.iso.datetime() }),
  meta: z.object({ requestId: z.string() }),
});
export const CustomerAuthStateResponseSchema = z.object({
  data: z.object({ authenticated: z.boolean(), visitActive: z.boolean(), visitExpiresAt: z.iso.datetime().nullable() }),
  meta: z.object({ requestId: z.string() }),
});

export const TableOccupancyRequestSchema = z.object({}).strict();

export const AcknowledgeWaiterCallRequestSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export type AcknowledgeWaiterCallRequest = z.infer<
  typeof AcknowledgeWaiterCallRequestSchema
>;

export const ActiveWaiterCallSchema = z.object({
  id: z.uuid(),
  tableId: z.uuid(),
  tableName: z.string(),
  version: z.number().int().positive(),
  requestedAt: z.iso.datetime(),
});

export const ActiveWaiterCallsResponseSchema = z.object({
  data: z.object({ calls: z.array(ActiveWaiterCallSchema) }),
  meta: z.object({ requestId: z.string() }),
});

export type TableEtaInput = {
  seatedAt: Date;
  seatingLimitMinutes: number;
  itemPreparationDeadlineMinutes: readonly number[];
};

export type TableEta = {
  estimatedPreparationMinutes: number;
  estimatedTableMinutes: number;
  estimatedReleaseAt: Date;
};

export function calculateTableEta(input: TableEtaInput): TableEta {
  const estimatedPreparationMinutes = Math.max(0, ...input.itemPreparationDeadlineMinutes);
  const estimatedTableMinutes = input.seatingLimitMinutes + estimatedPreparationMinutes;

  return {
    estimatedPreparationMinutes,
    estimatedTableMinutes,
    estimatedReleaseAt: new Date(input.seatedAt.getTime() + estimatedTableMinutes * 60_000),
  };
}

export const AcknowledgeBarTicketRequestSchema = z.object({ preparationId: z.string().uuid() });
export const AcknowledgeBarTicketResponseSchema = z.object({ data: z.object({ acknowledged: z.literal(true) }), meta: z.object({ requestId: z.string() }) });

// Inventory quantities and fractional unit costs stay decimal strings across
// the API boundary. Integer Toman amounts remain JavaScript-safe integers.
export const InventoryUnitSchema = z.enum(["GRAM", "MILLILITER", "PIECE"]);
export const InventoryDecimalSchema = z
  .string()
  .max(21)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/)
  .refine((value) => value.split(".")[0]!.length <= 14, "Quantity exceeds the supported range.")
  .refine((value) => !/^0(?:\.0{1,6})?$/.test(value), "Quantity must be greater than zero.");
export const InventoryNonNegativeDecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/);
export const InventoryMoneySchema = z.number().int().min(0).max(2_147_483_647);
export const InventoryVersionSchema = z.number().int().positive();
export const InventoryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
}).strict();
export const PurchaseListQuerySchema = InventoryListQuerySchema.extend({
  search: z.string().trim().min(1).max(160).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  status: z.enum(["DRAFT", "POSTED"]).optional(),
}).strict().refine((query) => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to), {
  message: "The purchase date range is invalid.",
  path: ["to"],
});
export const InventoryCountListQuerySchema = InventoryListQuerySchema.extend({
  search: z.string().trim().min(1).max(160).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  kind: z.enum(["OPENING", "PHYSICAL"]).optional(),
  status: z.enum(["DRAFT", "POSTED"]).optional(),
}).strict().refine((query) => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to), {
  message: "The count date range is invalid.",
  path: ["to"],
});
export const StockItemPathSchema = z.object({ stockItemId: z.uuid() }).strict();
export const PurchasePathSchema = z.object({ purchaseId: z.uuid() }).strict();
export const RecipePathSchema = z.object({ recipeId: z.uuid() }).strict();
export const ProductCostingPathSchema = z.object({ productId: z.uuid() }).strict();
export const InventoryCountPathSchema = z.object({ countId: z.uuid() }).strict();
export const ArchiveInventoryEntityRequestSchema = z.object({ expectedVersion: InventoryVersionSchema }).strict();

export const StockUnitConversionInputSchema = z.object({
  id: z.uuid().optional(),
  label: z.string().trim().min(1).max(120),
  baseQuantityPerPack: InventoryDecimalSchema,
  isActive: z.boolean().default(true),
}).strict();

export const CreateStockItemRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(120),
  baseUnit: InventoryUnitSchema,
  openingQuantity: InventoryNonNegativeDecimalSchema.default("0"),
  openingValueAmount: InventoryMoneySchema.default(0),
  conversions: z.array(StockUnitConversionInputSchema).max(50),
}).strict();

export const UpdateStockItemRequestSchema = CreateStockItemRequestSchema.omit({ openingQuantity: true, openingValueAmount: true }).partial().extend({
  expectedVersion: InventoryVersionSchema,
  openingQuantity: InventoryNonNegativeDecimalSchema.optional(),
  openingValueAmount: InventoryMoneySchema.optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "expectedVersion"), {
  message: "At least one stock-item field must be updated.",
}).superRefine((input, context) => {
  if ((input.openingQuantity === undefined) !== (input.openingValueAmount === undefined)) context.addIssue({ code: "custom", path: [input.openingQuantity === undefined ? "openingQuantity" : "openingValueAmount"], message: "Opening quantity and value must be provided together." });
});

export const InventoryBalanceSchema = z.object({
  quantityOnHand: InventoryNonNegativeDecimalSchema.nullable(),
  carryingValueAmount: InventoryMoneySchema.nullable(),
  movingAverageCostPerBaseUnit: InventoryNonNegativeDecimalSchema.nullable(),
  trackingStartedAt: z.iso.datetime().nullable(),
});

export const StockItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string(),
  baseUnit: InventoryUnitSchema,
  isActive: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  version: InventoryVersionSchema,
  conversions: z.array(StockUnitConversionInputSchema.extend({ id: z.uuid() })),
  balance: InventoryBalanceSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const StockItemsResponseSchema = z.object({
  data: z.object({ stockItems: z.array(StockItemSchema) }),
  meta: z.object({ requestId: z.string() }),
});
export const StockItemResponseSchema = z.object({ data: StockItemSchema, meta: z.object({ requestId: z.string() }) });
export type StockItemInput = z.infer<typeof CreateStockItemRequestSchema>;
export type StockItemUpdate = z.infer<typeof UpdateStockItemRequestSchema>;

export const PurchaseLineInputSchema = z.object({
  stockItemId: z.uuid(),
  conversionId: z.uuid().nullable(),
  purchaseUnitLabel: z.string().trim().min(1).max(120),
  purchaseQuantity: InventoryDecimalSchema,
  directCostAmount: InventoryMoneySchema,
}).strict();

export const CreatePurchaseRequestSchema = z.object({
  receivedAt: z.iso.datetime(),
  supplier: z.string().trim().min(1).max(240).nullable().optional(),
  lines: z.array(PurchaseLineInputSchema).min(1).max(200),
}).strict();

export const UpdatePurchaseRequestSchema = CreatePurchaseRequestSchema.partial().extend({
  expectedVersion: InventoryVersionSchema,
}).strict().refine((input) => Object.keys(input).some((key) => key !== "expectedVersion"), {
  message: "At least one purchase field must be updated.",
});

export const PostPurchaseRequestSchema = z.object({ expectedVersion: InventoryVersionSchema }).strict();
export const PurchaseReturnRequestSchema = z.object({
  purchaseLineId: z.uuid(),
  baseQuantity: InventoryDecimalSchema,
  occurredAt: z.iso.datetime(),
  reason: z.string().trim().min(1).max(500),
}).strict();

export const PurchaseLineSchema = PurchaseLineInputSchema.extend({
  id: z.uuid(),
  baseQuantityPerPack: InventoryNonNegativeDecimalSchema,
  baseQuantityReceived: InventoryNonNegativeDecimalSchema,
});

export const PurchaseSchema = z.object({
  id: z.uuid(),
  status: z.enum(["DRAFT", "POSTED"]),
  receivedAt: z.iso.datetime(),
  supplier: z.string().nullable(),
  version: InventoryVersionSchema,
  postedAt: z.iso.datetime().nullable(),
  lines: z.array(PurchaseLineSchema),
});

export const PurchaseResponseSchema = z.object({ data: PurchaseSchema, meta: z.object({ requestId: z.string() }) });
export const PurchasesResponseSchema = z.object({ data: z.object({ purchases: z.array(PurchaseSchema), page: z.object({ limit: z.number().int(), nextCursor: z.string().nullable(), hasMore: z.boolean() }) }), meta: z.object({ requestId: z.string() }) });
export type PurchaseListQuery = z.infer<typeof PurchaseListQuerySchema>;
export type InventoryCountListQuery = z.infer<typeof InventoryCountListQuerySchema>;
export type PurchaseInput = z.infer<typeof CreatePurchaseRequestSchema>;
export type PurchaseUpdate = z.infer<typeof UpdatePurchaseRequestSchema>;

const RecipeComponentInputSchema = z.discriminatedUnion("sourceKind", [
  z.object({
    componentKey: z.string().trim().min(1).max(120),
    sourceKind: z.literal("STOCK_ITEM"),
    stockItemId: z.uuid(),
    quantity: InventoryDecimalSchema,
    displayOrder: z.number().int().min(0),
  }).strict(),
  z.object({
    componentKey: z.string().trim().min(1).max(120),
    sourceKind: z.literal("RECIPE"),
    nestedRecipeId: z.uuid(),
    quantity: InventoryDecimalSchema,
    displayOrder: z.number().int().min(0),
  }).strict(),
]);

export const RecipeInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ingredientName: z.string().trim().min(1).max(160).optional(),
  outputUnit: InventoryUnitSchema,
  yieldQuantity: InventoryDecimalSchema,
  components: z.array(RecipeComponentInputSchema).min(1).max(200),
}).strict();

export const UpdateRecipeRequestSchema = RecipeInputSchema.extend({ expectedVersion: InventoryVersionSchema }).strict();
export const CreateRecipeRequestSchema = RecipeInputSchema;
export const RecipeComponentSchema = z.discriminatedUnion("sourceKind", [
  z.object({
    id: z.uuid(),
    componentKey: z.string(),
    label: z.string(),
    sourceKind: z.literal("STOCK_ITEM"),
    stockItemId: z.uuid(),
    quantity: InventoryNonNegativeDecimalSchema,
    displayOrder: z.number().int().nonnegative(),
  }),
  z.object({
    id: z.uuid(),
    componentKey: z.string(),
    label: z.string(),
    sourceKind: z.literal("RECIPE"),
    nestedRecipeId: z.uuid(),
    quantity: InventoryNonNegativeDecimalSchema,
    displayOrder: z.number().int().nonnegative(),
  }),
]);
export const RecipeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  ingredientName: z.string(),
  outputUnit: InventoryUnitSchema,
  yieldQuantity: InventoryNonNegativeDecimalSchema,
  version: InventoryVersionSchema,
  isActive: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  components: z.array(RecipeComponentSchema),
  updatedAt: z.iso.datetime(),
});
export const RecipeResponseSchema = z.object({ data: RecipeSchema, meta: z.object({ requestId: z.string() }) });
export const RecipesResponseSchema = z.object({ data: z.object({ recipes: z.array(RecipeSchema) }), meta: z.object({ requestId: z.string() }) });
export type RecipeInput = z.infer<typeof RecipeInputSchema>;
export type RecipeUpdate = z.infer<typeof UpdateRecipeRequestSchema>;

const CostingRuleInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("REPLACE_COMPONENT"),
    componentKey: z.string().trim().min(1).max(120),
    replacement: z.discriminatedUnion("sourceKind", [
      z.object({ sourceKind: z.literal("STOCK_ITEM"), stockItemId: z.uuid() }).strict(),
      z.object({ sourceKind: z.literal("RECIPE"), recipeId: z.uuid() }).strict(),
    ]),
    quantity: InventoryDecimalSchema,
    label: z.string().trim().min(1).max(160).optional(),
  }).strict(),
  z.object({
    action: z.literal("CHANGE_QUANTITY"),
    componentKey: z.string().trim().min(1).max(120),
    quantity: InventoryDecimalSchema,
  }).strict(),
  z.object({
    action: z.literal("ADD_COMPONENT"),
    componentKey: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(160),
    component: z.discriminatedUnion("sourceKind", [
      z.object({ sourceKind: z.literal("STOCK_ITEM"), stockItemId: z.uuid() }).strict(),
      z.object({ sourceKind: z.literal("RECIPE"), recipeId: z.uuid() }).strict(),
    ]),
    quantity: InventoryDecimalSchema,
  }).strict(),
]);

const ProductCostingCombinationInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  optionIds: z.array(z.uuid()).min(1).max(50),
  rules: z.array(CostingRuleInputSchema).min(1).max(200),
}).strict().superRefine((combination, context) => {
  if (new Set(combination.optionIds).size !== combination.optionIds.length) {
    context.addIssue({ code: "custom", path: ["optionIds"], message: "An option can appear only once in a combination." });
  }
});

const ProductOptionCostingInputSchema = z.array(z.object({ optionId: z.uuid(), rules: z.array(CostingRuleInputSchema).min(1).max(100) }).strict()).max(100);
const ProductOptionRecipeCostingInputSchema = z.array(z.object({ optionId: z.uuid(), recipeId: z.uuid(), recipeQuantity: InventoryDecimalSchema }).strict()).max(100);
const RecipeCostingConfigurationInputSchema = z.object({
  mode: z.literal("RECIPE"),
  recipeId: z.uuid(),
  recipeQuantity: InventoryDecimalSchema,
  extrasRecipeId: z.uuid().nullable().optional(),
  optionRules: ProductOptionCostingInputSchema,
  optionRecipes: ProductOptionRecipeCostingInputSchema.optional(),
  combinations: z.array(ProductCostingCombinationInputSchema).max(200),
}).strict();
const PurchasedCostingConfigurationInputSchema = z.object({
  mode: z.literal("PURCHASED_ITEM"),
  purchasedStockItemId: z.uuid(),
  purchasedQuantity: InventoryDecimalSchema.optional(),
  extrasRecipeId: z.uuid().nullable().optional(),
  optionRules: ProductOptionCostingInputSchema,
  combinations: z.array(ProductCostingCombinationInputSchema).max(200),
}).strict();

export const ProductCostingConfigurationInputSchema = z.discriminatedUnion("mode", [
  RecipeCostingConfigurationInputSchema,
  PurchasedCostingConfigurationInputSchema,
]);

export const ProductCostingConfigurationResponseDataSchema = z.discriminatedUnion("mode", [
  z.object({
    productId: z.uuid(),
    mode: z.literal("RECIPE"),
    recipeId: z.uuid(),
    recipeQuantity: InventoryNonNegativeDecimalSchema,
    extrasRecipeId: z.uuid().nullable(),
    optionRules: z.array(z.object({ optionId: z.uuid(), rules: z.array(CostingRuleInputSchema) })),
    optionRecipes: ProductOptionRecipeCostingInputSchema.optional(),
    combinations: z.array(ProductCostingCombinationInputSchema.extend({ id: z.uuid(), version: InventoryVersionSchema, isActive: z.boolean() })),
    version: InventoryVersionSchema,
    updatedAt: z.iso.datetime(),
  }),
  z.object({
    productId: z.uuid(),
    mode: z.literal("PURCHASED_ITEM"),
    purchasedStockItemId: z.uuid(),
    purchasedQuantity: InventoryNonNegativeDecimalSchema.nullable(),
    extrasRecipeId: z.uuid().nullable(),
    optionRules: z.array(z.object({ optionId: z.uuid(), rules: z.array(CostingRuleInputSchema) })),
    optionRecipes: ProductOptionRecipeCostingInputSchema.optional(),
    combinations: z.array(ProductCostingCombinationInputSchema.extend({ id: z.uuid(), version: InventoryVersionSchema, isActive: z.boolean() })),
    version: InventoryVersionSchema,
    updatedAt: z.iso.datetime(),
  }),
]);

export const ProductCostingConfigurationResponseSchema = z.object({
  data: ProductCostingConfigurationResponseDataSchema.nullable(),
  meta: z.object({ requestId: z.string() }),
});
export type ProductCostingConfigurationInput = z.infer<typeof ProductCostingConfigurationInputSchema>;
export type ProductCostingPreviewRequest = z.infer<typeof ProductCostingPreviewRequestSchema>;

export const UpdateProductCostingRequestSchema = z.discriminatedUnion("mode", [
  RecipeCostingConfigurationInputSchema.extend({ expectedVersion: InventoryVersionSchema }).strict(),
  PurchasedCostingConfigurationInputSchema.extend({ expectedVersion: InventoryVersionSchema }).strict(),
]);
export const ProductCostingPreviewRequestSchema = z.object({
  optionIds: z.array(z.uuid()).max(50),
  quantity: z.number().int().positive(),
  weightGrams: z.number().int().positive().optional(),
}).strict();

export const ResolvedCostComponentSchema = z.object({
  stockItemId: z.uuid(),
  stockItemName: z.string(),
  baseUnit: InventoryUnitSchema,
  quantity: InventoryNonNegativeDecimalSchema,
  knownCostAmount: InventoryMoneySchema.nullable(),
});

export const ProductCostingPreviewResponseSchema = z.object({
  data: z.object({
    isComplete: z.boolean(),
    knownCostAmount: InventoryMoneySchema,
    components: z.array(ResolvedCostComponentSchema),
    missingReasons: z.array(z.string()),
  }),
  meta: z.object({ requestId: z.string() }),
});

export const InventoryCountLineInputSchema = z.object({
  stockItemId: z.uuid(),
  observedQuantity: InventoryNonNegativeDecimalSchema.max(21).refine((value) => value.split(".")[0]!.length <= 14, "Quantity exceeds the supported range."),
  observedValueAmount: InventoryMoneySchema,
}).strict();

export const CreateInventoryCountRequestSchema = z.object({
  kind: z.literal("PHYSICAL"),
  reason: z.string().trim().min(1).max(500).optional(),
  lines: z.array(InventoryCountLineInputSchema).min(1).max(500),
}).strict().superRefine((input, context) => {
  const ids = input.lines.map((line) => line.stockItemId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["lines"], message: "A stock item can appear only once in a count." });
});

export const UpdateInventoryCountRequestSchema = z.object({
  expectedVersion: InventoryVersionSchema,
  reason: z.string().trim().min(1).max(500).optional(),
  lines: z.array(InventoryCountLineInputSchema).min(1).max(500),
}).strict().superRefine((input, context) => {
  const ids = input.lines.map((line) => line.stockItemId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["lines"], message: "A stock item can appear only once in a count." });
});

export const PostInventoryCountRequestSchema = z.object({
  expectedVersion: InventoryVersionSchema,
  absorbedOrderConsumptionIds: z.array(z.uuid()).max(500),
}).strict();

export const InventoryCountSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["OPENING", "PHYSICAL"]),
  status: z.enum(["DRAFT", "POSTED"]),
  version: InventoryVersionSchema,
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  postedAt: z.iso.datetime().nullable(),
  lines: z.array(InventoryCountLineInputSchema.extend({
    expectedQuantity: InventoryNonNegativeDecimalSchema.nullable(),
    differenceQuantity: z.string().nullable(),
    expectedValueAmount: InventoryMoneySchema.nullable(),
    differenceValueAmount: z.number().int().nullable(),
  })),
});

export const InventoryCountResponseSchema = z.object({ data: InventoryCountSchema, meta: z.object({ requestId: z.string() }) });
export const InventoryCountsResponseSchema = z.object({ data: z.object({ counts: z.array(InventoryCountSchema), page: z.object({ limit: z.number().int(), nextCursor: z.string().nullable(), hasMore: z.boolean() }) }), meta: z.object({ requestId: z.string() }) });
export type InventoryCountInput = z.infer<typeof CreateInventoryCountRequestSchema>;
export type InventoryCountUpdate = z.infer<typeof UpdateInventoryCountRequestSchema>;
export type InventoryCountPosting = z.infer<typeof PostInventoryCountRequestSchema>;

export const InventoryMovementQuerySchema = z.object({
  stockItemId: z.uuid().optional(),
  searchBy: z.enum(["PRODUCT", "ORDER_NUMBER", "KIND"]).optional(),
  search: z.string().trim().min(1).max(160).optional(),
  kind: z.enum(["OPENING_COUNT", "PURCHASE_RECEIPT", "ORDER_CONSUMPTION", "ORDER_RESTORATION", "PHYSICAL_COUNT_ADJUSTMENT", "PURCHASE_RETURN"]).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
}).strict().refine((query) => !query.from || !query.to || query.from <= query.to, { message: "from must not be later than to.", path: ["to"] })
  .refine((query) => query.searchBy !== "KIND" || !!query.kind, { message: "kind is required when searching by movement type.", path: ["kind"] })
  .refine((query) => query.searchBy === "KIND" || !query.kind || !query.searchBy, { message: "kind can only be used with movement-type search.", path: ["kind"] })
  .refine((query) => !query.searchBy || query.searchBy === "KIND" || !!query.search, { message: "search text is required for this search method.", path: ["search"] })
  .refine((query) => query.searchBy !== "KIND" || !query.search, { message: "search text is not used for movement-type search.", path: ["search"] })
  .refine((query) => !!query.searchBy || !query.search, { message: "searchBy is required when search text is provided.", path: ["searchBy"] });
export type InventoryMovementQuery = z.infer<typeof InventoryMovementQuerySchema>;

export const InventoryMovementSchema = z.object({
  id: z.uuid(),
  stockItemId: z.uuid(),
  orderNumber: z.string().nullable(),
  kind: z.enum(["OPENING_COUNT", "PURCHASE_RECEIPT", "ORDER_CONSUMPTION", "ORDER_RESTORATION", "PHYSICAL_COUNT_ADJUSTMENT", "PURCHASE_RETURN"]),
  quantityDelta: z.string(),
  valueDeltaAmount: z.number().int(),
  purchaseLineId: z.uuid().nullable(),
  orderConsumptionId: z.uuid().nullable(),
  inventoryCountLineId: z.uuid().nullable(),
  compensatesMovementId: z.uuid().nullable(),
  occurredAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
});
export const InventoryMovementResponseSchema = z.object({
  data: InventoryMovementSchema,
  meta: z.object({ requestId: z.string() }),
});

export const InventoryMovementsResponseSchema = z.object({
  data: z.object({ movements: z.array(InventoryMovementSchema) }),
  meta: z.object({ requestId: z.string(), page: z.object({ limit: z.number().int(), nextCursor: z.string().nullable(), hasMore: z.boolean() }) }),
});

export const PendingConsumptionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
}).strict();
export type PendingConsumptionQuery = z.infer<typeof PendingConsumptionQuerySchema>;

export const PendingConsumptionSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  recognizedAt: z.iso.datetime(),
  knownCogsAmount: InventoryMoneySchema,
  isCostComplete: z.boolean(),
  missingStockItemIds: z.array(z.uuid()),
});

export const PendingConsumptionsResponseSchema = z.object({
  data: z.object({ consumptions: z.array(PendingConsumptionSchema) }),
  meta: z.object({ requestId: z.string(), page: z.object({ limit: z.number().int(), nextCursor: z.string().nullable(), hasMore: z.boolean() }) }),
});

export const GrossProfitReportQuerySchema = z.object({
  fromDate: z.iso.date(),
  toDate: z.iso.date(),
}).strict().refine((query) => query.fromDate <= query.toDate, {
  message: "fromDate must not be later than toDate.",
  path: ["toDate"],
}).refine((query) => {
  const from = Date.parse(`${query.fromDate}T00:00:00.000Z`);
  const to = Date.parse(`${query.toDate}T00:00:00.000Z`);
  return (to - from) / (24 * 60 * 60 * 1_000) <= 365;
}, {
  message: "The report range cannot exceed 366 calendar days.",
  path: ["toDate"],
});
export type GrossProfitReportQuery = z.infer<typeof GrossProfitReportQuerySchema>;

export const GrossProfitProductSchema = z.object({
  productId: z.uuid(),
  productName: z.string(),
  netSalesAmount: InventoryMoneySchema,
  theoreticalCogsAmount: InventoryMoneySchema.nullable(),
  knownCogsAmount: InventoryMoneySchema,
  grossProfitAmount: z.number().int().nullable(),
  grossMarginPercent: z.string().nullable(),
  completeOrderItemCount: z.number().int().nonnegative(),
  incompleteOrderItemCount: z.number().int().nonnegative(),
});

export const GrossProfitReportResponseSchema = z.object({
  data: z.object({
    totals: z.object({
      netSalesAmount: InventoryMoneySchema,
      theoreticalCogsAmount: InventoryMoneySchema.nullable(),
      knownCogsAmount: InventoryMoneySchema,
      grossProfitAmount: z.number().int().nullable(),
      grossMarginPercent: z.string().nullable(),
    }),
    products: z.array(GrossProfitProductSchema),
    costCoverage: z.object({ completeOrderItemCount: z.number().int().nonnegative(), incompleteOrderItemCount: z.number().int().nonnegative() }),
    pendingConsumptionCount: z.number().int().nonnegative(),
    inventoryConsumption: z.object({
      amount: z.number().int().nullable(),
      isEstimate: z.boolean(),
      varianceAmount: z.number().int().nullable(),
      missingValuationCount: z.number().int().nonnegative(),
    }),
  }),
  meta: z.object({ requestId: z.string(), range: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }) }),
});
