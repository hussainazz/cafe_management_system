import { z } from "zod";

export const DEFAULT_TABLE_SEATING_LIMIT_MINUTES = 45;

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
  options: z.array(PosCatalogOptionSchema),
});

export const PosCatalogProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceAmount: z.number().int().nonnegative(),
  preparationDeadlineMinutes: ProductPreparationDeadlineMinutesSchema,
  isAvailable: z.boolean(),
  image: ProductImageSchema.nullable(),
  optionGroups: z.array(PosCatalogOptionGroupSchema),
});

export const PosCatalogCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  products: z.array(PosCatalogProductSchema),
});

export const PosCatalogResponseSchema = z.object({
  data: z.object({ categories: z.array(PosCatalogCategorySchema) }),
  meta: z.object({ requestId: z.string() }),
});

export const ActiveTableOrderSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]),
  estimatedPreparationMinutes: z.number().int().nonnegative(),
  estimatedTableReleaseAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const PosTableSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  seatingLimitMinutes: TableSeatingLimitMinutesSchema,
  activeOrders: z.array(ActiveTableOrderSchema),
});

export const PosTablesResponseSchema = z.object({
  data: z.object({ tables: z.array(PosTableSchema) }),
  meta: z.object({ requestId: z.string() }),
});

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
    z.object({ kind: z.literal("FIXED"), value: z.number().int().positive(), reason: z.string().trim().min(1).max(500) }).strict(),
    z.object({ kind: z.literal("PERCENTAGE"), value: z.number().int().min(1).max(100), reason: z.string().trim().min(1).max(500) }).strict(),
  ])
  .nullable();

const CreateOrderBaseSchema = z.object({
  items: z.array(CreateOrderItemSchema).min(1).max(100),
});

export const CreateOrderRequestSchema = z.discriminatedUnion("channel", [
  CreateOrderBaseSchema.extend({ channel: z.literal("TABLE"), tableId: z.uuid() }).strict(),
  CreateOrderBaseSchema.extend({ channel: z.literal("TAKEAWAY") }).strict(),
]);

export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

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
  preparationDeadlineSnapshotMinutes: ProductPreparationDeadlineMinutesSchema,
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
  estimatedPreparationMinutes: z.number().int().nonnegative(),
  tableSeatingLimitSnapshotMinutes: z.number().int().positive().nullable(),
  estimatedTableReleaseAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  items: z.array(CreatedOrderItemSchema),
});

export const CreateOrderResponseSchema = z.object({
  data: CreatedOrderSchema,
  meta: z.object({ requestId: z.string() }),
});

export const OrderIdPathSchema = z.object({ orderId: z.uuid() });

export const OrderStateSchema = z.enum(["OPEN", "DELETED"]);
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
      quantity: z.number().int().positive(),
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
  channel: OrderChannelSchema,
  tableId: z.uuid().nullable(),
  state: OrderStateSchema,
  paymentStatus: PaymentStatusSchema,
  version: z.number().int().positive(),
  totalAmount: z.number().int().nonnegative(),
  balanceAmount: z.number().int().nonnegative(),
  estimatedPreparationMinutes: z.number().int().nonnegative(),
  estimatedTableReleaseAt: z.iso.datetime().nullable(),
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

export const ExistingOrderItemUpdateSchema = z
  .object({
    orderItemId: z.uuid(),
    quantity: z.number().int().positive().optional(),
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

export const ProductSaleDiscountRequestSchema = z
  .object({ saleDiscount: DiscountInputSchema })
  .strict();

export type ProductSaleDiscountRequest = z.infer<typeof ProductSaleDiscountRequestSchema>;

export const ProductSaleDiscountResponseSchema = z.object({
  data: z.object({
    id: z.uuid(),
    saleDiscountKind: z.enum(["FIXED", "PERCENTAGE"]).nullable(),
    saleDiscountValue: z.number().int().positive().nullable(),
  }),
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
