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
