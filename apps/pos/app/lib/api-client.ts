import { beginRecoveryActivity } from "./automatic-recovery";
import {
  AuthenticationResponseSchema,
  BarTicketResponseSchema,
  AcknowledgeBarTicketResponseSchema,
  CreateOrderResponseSchema,
  OrderDetailResponseSchema,
  ErrorResponseSchema,
  OrderListResponseSchema,
  PosCatalogResponseSchema,
  PosTableResponseSchema,
  PosTablesResponseSchema,
  OrderReceiptResponseSchema,
  SettlementReceiptResponseSchema,
  ActiveWaiterCallsResponseSchema,
  AdminCategoriesResponseSchema,
  AdminCategoryResponseSchema,
  AdminOptionGroupsResponseSchema,
  AdminOptionGroupResponseSchema,
  AdminOptionResponseSchema,
  AdminProductsResponseSchema,
  AdminProductResponseSchema,
  AdminTablesResponseSchema,
  AdminTableResponseSchema,
  AdminStaffResponseSchema,
  AdminStaffSingleResponseSchema,
  AdminSettingsResponseSchema,
  AdminImageResponseSchema,
  AdminImageArchiveResponseSchema,
  PaymentHistoryResponseSchema,
  DailyReportResponseSchema,
  AuditLogResponseSchema,
  ReverseSettlementResponseSchema,
  EditSettlementResponseSchema,
  ProductSaleDiscountResponseSchema,
  StockItemsResponseSchema,
  StockItemResponseSchema,
  PurchasesResponseSchema,
  PurchaseResponseSchema,
  RecipesResponseSchema,
  RecipeResponseSchema,
  ProductCostingConfigurationResponseSchema,
  ProductCostingPreviewResponseSchema,
  InventoryCountResponseSchema,
  InventoryCountsResponseSchema,
  InventoryMovementResponseSchema,
  InventoryMovementsResponseSchema,
  PendingConsumptionsResponseSchema,
  GrossProfitReportResponseSchema,
  type ProductSaleDiscountRequest,
  type RecordSettlementRequest,
  type UpdateOrderRequest,
  type DeleteOrderRequest,
  type TransferOrderTableRequest,
  type AuthenticatedUser,
  type CreateOrderRequest,
  type CreatedOrder,
  type PosCatalogCategory,
  type PosTable,
  type PaymentHistoryQuery,
  type OrderListQuery,
  type PurchaseListQuery,
  type InventoryCountListQuery,
  PaymentHistoryOrderFilterSchema,
} from "@cafe/contracts";
import type { z } from "zod";

export type PosOrderDetail = z.infer<typeof OrderDetailResponseSchema>["data"];
export type BarTicket = z.infer<typeof BarTicketResponseSchema>["data"];
export type OrderReceipt = z.infer<typeof OrderReceiptResponseSchema>["data"];
export type SettlementReceipt = z.infer<typeof SettlementReceiptResponseSchema>["data"];
export type PosActiveWaiterCall = z.infer<
  typeof ActiveWaiterCallsResponseSchema
>["data"]["calls"][number];
export type ManagerCatalog = {
  categories: z.infer<typeof AdminCategoriesResponseSchema>["data"]["categories"];
  products: z.infer<typeof AdminProductsResponseSchema>["data"]["products"];
  optionGroups: z.infer<typeof AdminOptionGroupsResponseSchema>["data"]["optionGroups"];
  tables: z.infer<typeof AdminTablesResponseSchema>["data"]["tables"];
};
export type ManagerStaff = z.infer<typeof AdminStaffResponseSchema>["data"]["staff"];
export type ManagerSettings = z.infer<typeof AdminSettingsResponseSchema>["data"];
export type PaymentHistory = z.infer<typeof PaymentHistoryResponseSchema>["data"]["payments"];
export type PaymentHistoryFilters = PaymentHistoryQuery;
export type PaymentHistoryOrderFilter = z.infer<typeof PaymentHistoryOrderFilterSchema>;
export type OrderSummary = z.infer<typeof OrderListResponseSchema>["data"]["orders"][number];
export type DailyReport = z.infer<typeof DailyReportResponseSchema>;
export type AuditLog = z.infer<typeof AuditLogResponseSchema>;
export type InventoryStockItem = z.infer<typeof StockItemResponseSchema>["data"];
export type InventoryPurchase = z.infer<typeof PurchaseResponseSchema>["data"];
export type InventoryRecipe = z.infer<typeof RecipeResponseSchema>["data"];
export type InventoryCount = z.infer<typeof InventoryCountResponseSchema>["data"];
export type InventoryMovement = z.infer<typeof InventoryMovementsResponseSchema>["data"]["movements"][number];
export type PendingInventoryConsumption = z.infer<typeof PendingConsumptionsResponseSchema>["data"]["consumptions"][number];
export type ProductCostingConfiguration = z.infer<typeof ProductCostingConfigurationResponseSchema>["data"];
export type ProductCostingPreview = z.infer<typeof ProductCostingPreviewResponseSchema>["data"];
export type GrossProfitReport = z.infer<typeof GrossProfitReportResponseSchema>;

export type ApiFailure = {
  kind: "network" | "response" | "invalid-response";
  status?: number;
  code?: string;
  message: string;
  requestId?: string;
  details?: Array<{ path: string; code: string; message: string }>;
};
export type ApiResult<T> =
  { ok: true; data: T; replayed: boolean } | { ok: false; error: ApiFailure };

export const posApiFailureEvent = "run-cafe:api-failure";
const posBasePath = "/pos";

function reportFailure(error: ApiFailure) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ApiFailure>(posApiFailureEvent, { detail: error }));
  }
  return error;
}

async function requestOnce<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const endActivity = beginRecoveryActivity();
  try {
    const headers = new Headers(init?.headers);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    const response = await fetch(`${posBasePath}/api/v1${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload: unknown =
      response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ErrorResponseSchema.safeParse(payload);
      return {
        ok: false,
        error: parsed.success
          ? {
              kind: "response",
              status: response.status,
              code: parsed.data.error.code,
              message: parsed.data.error.message,
              requestId: parsed.data.error.requestId,
              ...(parsed.data.error.details ? { details: parsed.data.error.details } : {}),
            }
          : { kind: "response", status: response.status, message: "پاسخ سرویس خوانا نیست.", ...(response.headers.get("x-request-id") ? { requestId: response.headers.get("x-request-id")! } : {}) },
      };
    }
    return {
      ok: true,
      data: payload as T,
      replayed: response.headers.get("idempotency-replayed") === "true",
    };
  } catch {
    const error = { kind: "network" as const, message: "اتصال به سرویس برقرار نشد." };
    return { ok: false, error };
  } finally { endActivity(); }
}

function isAuthenticationFailure(error: ApiFailure): boolean {
  return error.status === 401 ||
    error.code === "AUTHENTICATION_REQUIRED" ||
    error.code === "SESSION_EXPIRED";
}

let sessionRefreshInFlight: Promise<ApiResult<AuthenticatedUser>> | null = null;

function refreshSessionOnce(): Promise<ApiResult<AuthenticatedUser>> {
  if (sessionRefreshInFlight) return sessionRefreshInFlight;

  const refresh = requestOnce<unknown>("/auth/refresh", { method: "POST" }).then((result) =>
    parseAuthentication(result, "پاسخ تمدید نشست معتبر نیست."),
  );
  sessionRefreshInFlight = refresh;
  const clear = () => {
    if (sessionRefreshInFlight === refresh) sessionRefreshInFlight = null;
  };
  void refresh.then(clear, clear);
  return refresh;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  report = true,
  recoverSession = true,
): Promise<ApiResult<T>> {
  let result = await requestOnce<T>(path, init);
  if (!result.ok && recoverSession && isAuthenticationFailure(result.error)) {
    const refreshed = await refreshSessionOnce();
    if (refreshed.ok) result = await requestOnce<T>(path, init);
    else result = { ok: false, error: refreshed.error };
  }
  if (!result.ok && report) return { ok: false, error: reportFailure(result.error) };
  return result;
}

function parseAuthentication(
  result: ApiResult<unknown>,
  invalidMessage: string,
): ApiResult<AuthenticatedUser> {
  if (!result.ok) return result;
  const parsed = AuthenticationResponseSchema.safeParse(result.data);
  return parsed.success
    ? { ok: true, data: parsed.data.data, replayed: result.replayed }
    : { ok: false, error: { kind: "invalid-response", message: invalidMessage } };
}

export async function currentSession() {
  return parseAuthentication(await request<unknown>("/auth/me", undefined, false, false), "اطلاعات نشست معتبر نیست.");
}
export async function signIn(input: { username: string; password: string }) {
  return parseAuthentication(
    await request<unknown>("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }, true, false),
    "اطلاعات ورود معتبر نیست.",
  );
}
export async function refreshSession() {
  const result = await refreshSessionOnce();
  return result.ok ? result : { ok: false as const, error: reportFailure(result.error) };
}
export async function endSession() {
  const result = await request<null>("/auth/logout", { method: "POST" });
  return result.ok ? { ok: true as const, data: null } : result;
}

function parseResponse<T>(
  result: ApiResult<unknown>,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  invalidMessage: string,
): ApiResult<T> {
  if (!result.ok) return result;
  const parsed = schema.safeParse(result.data);
  return parsed.success
    ? { ok: true, data: parsed.data, replayed: result.replayed }
    : { ok: false, error: { kind: "invalid-response", message: invalidMessage } };
}

export async function readPosCatalog(): Promise<ApiResult<PosCatalogCategory[]>> {
  const parsed = parseResponse(
    await request<unknown>("/pos/catalog", undefined, false),
    PosCatalogResponseSchema,
    "فهرست محصولات معتبر نیست.",
  );
  return parsed.ok
    ? { ok: true, data: parsed.data.data.categories, replayed: parsed.replayed }
    : parsed;
}

export async function readPosTables(): Promise<ApiResult<{ tableSeatingLimitMinutes: number | null; tables: PosTable[] }>> {
  const parsed = parseResponse(
    await request<unknown>("/tables", undefined, false),
    PosTablesResponseSchema,
    "فهرست میزها معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function readOpenOrders() {
  const parsed = parseResponse(
    await request<unknown>("/orders?state=OPEN&limit=100", undefined, false),
    OrderListResponseSchema,
    "فهرست سفارش‌های باز معتبر نیست.",
  );
  return parsed.ok
    ? { ok: true as const, data: parsed.data.data.orders, replayed: parsed.replayed }
    : parsed;
}

export async function readOrderList(filters: OrderListQuery) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined) as [string, string][]);
  return managerResponse(`/orders?${query}`, OrderListResponseSchema, "فهرست سفارش‌ها معتبر نیست.");
}

export async function markTableOccupied(tableId: string): Promise<ApiResult<PosTable>> {
  const parsed = parseResponse(
    await request<unknown>(`/tables/${encodeURIComponent(tableId)}/occupy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    PosTableResponseSchema,
    "پاسخ تغییر وضعیت میز معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function createOpenOrder(
  input: CreateOrderRequest,
  idempotencyKey: string,
  trace: { requestId: string; tableName?: string },
): Promise<ApiResult<CreatedOrder>> {
  console.info("POS order create submitted", {
    requestId: trace.requestId,
    channel: input.channel,
    tableId: input.channel === "TABLE" ? input.tableId : null,
    tableName: trace.tableName ?? null,
    itemCount: input.items.length,
  });
  const parsed = parseResponse(
    await request<unknown>("/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "x-request-id": trace.requestId,
        ...(trace.tableName ? { "x-pos-table-name": trace.tableName } : {}),
      },
      body: JSON.stringify(input),
    }),
    CreateOrderResponseSchema,
    "پاسخ ثبت سفارش معتبر نیست.",
  );
  const result = parsed.ok ? { ok: true as const, data: parsed.data.data, replayed: parsed.replayed } : parsed;
  console.info(result.ok ? "POS order create completed" : "POS order create failed", {
    requestId: trace.requestId,
    channel: input.channel,
    tableId: input.channel === "TABLE" ? input.tableId : null,
    tableName: trace.tableName ?? null,
    ...(result.ok
      ? { orderId: result.data.id, replayed: result.replayed }
      : { errorCode: result.error.code ?? null, status: result.error.status ?? null }),
  });
  return result;
}

export async function readOrder(orderId: string): Promise<ApiResult<PosOrderDetail>> {
  const parsed = parseResponse(
    await request<unknown>(`/orders/${encodeURIComponent(orderId)}`, undefined, false),
    OrderDetailResponseSchema,
    "جزئیات سفارش معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function readBarTicket(orderId: string): Promise<ApiResult<BarTicket>> {
  const parsed = parseResponse(
    await request<unknown>(`/orders/${encodeURIComponent(orderId)}/bar-ticket`, undefined, false),
    BarTicketResponseSchema,
    "اطلاعات فیش بار معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function prepareBarTicket(orderId: string): Promise<ApiResult<BarTicket>> {
  const parsed = parseResponse(await request<unknown>(`/orders/${encodeURIComponent(orderId)}/bar-ticket/prepare`, { method: "POST" }, false), BarTicketResponseSchema, "اطلاعات فیش بار معتبر نیست.");
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}
export async function acknowledgeBarTicket(orderId: string, preparationId: string): Promise<ApiResult<{ acknowledged: true }>> {
  const parsed = parseResponse(await request<unknown>(`/orders/${encodeURIComponent(orderId)}/bar-ticket/acknowledge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preparationId }) }, false), AcknowledgeBarTicketResponseSchema, "ثبت چاپ فیش بار ناموفق بود.");
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function readOrderReceipt(orderId: string): Promise<ApiResult<OrderReceipt>> {
  const parsed = parseResponse(
    await request<unknown>(`/orders/${encodeURIComponent(orderId)}/receipt`, undefined, false),
    OrderReceiptResponseSchema,
    "اطلاعات رسید معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function readSettlementReceipt(orderId: string, settlementId: string): Promise<ApiResult<SettlementReceipt>> {
  const parsed = parseResponse(
    await request<unknown>(`/orders/${encodeURIComponent(orderId)}/settlements/${encodeURIComponent(settlementId)}/receipt`, undefined, false),
    SettlementReceiptResponseSchema,
    "اطلاعات رسید پرداخت معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function updateOpenOrder(
  orderId: string,
  input: UpdateOrderRequest,
): Promise<ApiResult<PosOrderDetail>> {
  const parsed = parseResponse(
    await request<unknown>(`/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    OrderDetailResponseSchema,
    "پاسخ ویرایش سفارش معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function deleteOpenOrder(
  orderId: string,
  input: DeleteOrderRequest,
): Promise<ApiResult<PosOrderDetail>> {
  const parsed = parseResponse(
    await request<unknown>(`/orders/${encodeURIComponent(orderId)}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    OrderDetailResponseSchema,
    "پاسخ حذف سفارش معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function transferOrderTable(
  orderId: string,
  input: TransferOrderTableRequest,
): Promise<ApiResult<PosOrderDetail>> {
  const parsed = parseResponse(
    await request<unknown>(`/orders/${encodeURIComponent(orderId)}/transfer-table`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    OrderDetailResponseSchema,
    "پاسخ انتقال میز معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function recordSettlement(
  orderId: string,
  input: RecordSettlementRequest,
  idempotencyKey: string,
): Promise<ApiResult<PosOrderDetail>> {
  const parsed = parseResponse(
    await request<unknown>(`/orders/${encodeURIComponent(orderId)}/record-settlement`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(input),
    }),
    OrderDetailResponseSchema,
    "پاسخ تسویه معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function makeTableAvailable(tableId: string): Promise<ApiResult<PosTable>> {
  const parsed = parseResponse(
    await request<unknown>(`/tables/${encodeURIComponent(tableId)}/make-available`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    PosTableResponseSchema,
    "پاسخ آزادسازی میز معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

export async function readWaiterCalls(): Promise<ApiResult<PosActiveWaiterCall[]>> {
  const parsed = parseResponse(
    await request<unknown>("/waiter-calls", undefined, false),
    ActiveWaiterCallsResponseSchema,
    "فهرست درخواست‌ها معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data.calls, replayed: parsed.replayed } : parsed;
}

export async function acknowledgeWaiterCall(
  tableId: string,
  expectedVersion: number,
): Promise<ApiResult<PosTable>> {
  const parsed = parseResponse(
    await request<unknown>(`/tables/${encodeURIComponent(tableId)}/acknowledge-waiter-call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion }),
    }),
    PosTableResponseSchema,
    "پاسخ رسیدگی به درخواست معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}

async function managerResponse<T>(path: string, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, message: string) {
  return parseResponse(await request<unknown>(path, undefined, false), schema, message);
}

export async function readManagerCatalog(): Promise<ApiResult<ManagerCatalog>> {
  const [categories, products, optionGroups, tables] = await Promise.all([
    managerResponse("/admin/categories", AdminCategoriesResponseSchema, "فهرست دسته‌ها معتبر نیست."),
    managerResponse("/admin/products", AdminProductsResponseSchema, "فهرست محصولات معتبر نیست."),
    managerResponse("/admin/option-groups", AdminOptionGroupsResponseSchema, "فهرست گزینه‌ها معتبر نیست."),
    managerResponse("/admin/tables", AdminTablesResponseSchema, "فهرست میزهای مدیریت معتبر نیست."),
  ]);
  if (!categories.ok) return categories;
  if (!products.ok) return products;
  if (!optionGroups.ok) return optionGroups;
  if (!tables.ok) return tables;
  return { ok: true, replayed: false, data: { categories: categories.data.data.categories, products: products.data.data.products, optionGroups: optionGroups.data.data.optionGroups, tables: tables.data.data.tables } };
}

export const saveProductSaleDiscount = (productId: string, saleDiscount: ProductSaleDiscountRequest["saleDiscount"] | null) =>
  managerMutation(`/admin/products/${productId}/sale-discount`, "PATCH", { saleDiscount }, ProductSaleDiscountResponseSchema, "پاسخ تخفیف محصول معتبر نیست.");

export async function readManagerStaff(): Promise<ApiResult<ManagerStaff>> {
  const parsed = await managerResponse("/admin/users", AdminStaffResponseSchema, "فهرست پرسنل معتبر نیست.");
  return parsed.ok ? { ok: true, data: parsed.data.data.staff, replayed: parsed.replayed } : parsed;
}
export async function readManagerSettings(): Promise<ApiResult<ManagerSettings>> {
  const parsed = await managerResponse("/admin/settings", AdminSettingsResponseSchema, "تنظیمات کافه معتبر نیست.");
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}
export async function readPaymentHistory(filters: PaymentHistoryFilters, orderFilter?: PaymentHistoryOrderFilter): Promise<ApiResult<PaymentHistory>> {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined) as [string, string][]);
  if (orderFilter) query.set("orderFilter", orderFilter);
  const parsed = await managerResponse(`/admin/payments?${query}`, PaymentHistoryResponseSchema, "تاریخچه پرداخت معتبر نیست.");
  return parsed.ok ? { ok: true, data: parsed.data.data.payments, replayed: parsed.replayed } : parsed;
}
export async function readDailyReport(filters: PaymentHistoryFilters): Promise<ApiResult<DailyReport>> {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined) as [string, string][]);
  return managerResponse(`/admin/reports/daily?${query}`, DailyReportResponseSchema, "گزارش حسابداری معتبر نیست.");
}
export async function readAuditLog(cursor?: string, filters: Record<string, string> = {}): Promise<ApiResult<AuditLog>> {
  const query = new URLSearchParams({ limit: "50", ...filters, ...(cursor ? { cursor } : {}) });
  return managerResponse(`/admin/audit-log?${query}`, AuditLogResponseSchema, "تاریخچه حسابرسی معتبر نیست.");
}

async function managerMutation<T>(path: string, method: "POST" | "PATCH" | "PUT", body: unknown, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, message: string, idempotencyKey?: string): Promise<ApiResult<T>> {
  return parseResponse(await request<unknown>(path, { method, headers: { "content-type": "application/json", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }, body: JSON.stringify(body) }), schema, message);
}
export const saveCategory = (id: string | null, body: unknown) => managerMutation(id ? `/admin/categories/${id}` : "/admin/categories", id ? "PATCH" : "POST", body, id ? AdminCategoryResponseSchema : AdminCategoryResponseSchema, "پاسخ دسته معتبر نیست.");
export const savePromotionalCategoryProducts = (id: string, productIds: string[]) => managerMutation(`/admin/categories/${id}/products`, "PATCH", { productIds }, AdminCategoryResponseSchema, "فهرست محصولات این دسته معتبر نیست.");
export const archiveCategory = (id: string) => managerMutation(`/admin/categories/${id}/archive`, "POST", {}, AdminCategoryResponseSchema, "پاسخ بایگانی دسته معتبر نیست.");
export const reorderCategories = (categoryIds: string[]) => managerMutation("/admin/categories/reorder", "PATCH", { categoryIds }, AdminCategoriesResponseSchema, "پاسخ ترتیب دسته‌ها معتبر نیست.");
export const saveProduct = (id: string | null, body: unknown) => managerMutation(id ? `/admin/products/${id}` : "/admin/products", id ? "PATCH" : "POST", body, AdminProductResponseSchema, "پاسخ محصول معتبر نیست.");
export const archiveProduct = (id: string) => managerMutation(`/admin/products/${id}/archive`, "POST", {}, AdminProductResponseSchema, "پاسخ بایگانی محصول معتبر نیست.");
export const reorderProducts = (categoryId: string, productIds: string[]) => managerMutation(`/admin/categories/${categoryId}/products/reorder`, "PATCH", { productIds }, AdminProductsResponseSchema, "پاسخ ترتیب محصولات معتبر نیست.");
export const saveOptionGroup = (id: string | null, body: unknown) => managerMutation(id ? `/admin/option-groups/${id}` : "/admin/option-groups", id ? "PATCH" : "POST", body, AdminOptionGroupResponseSchema, "پاسخ گروه گزینه معتبر نیست.");
export const saveOption = (groupId: string, id: string | null, body: unknown) => managerMutation(id ? `/admin/option-groups/${groupId}/options/${id}` : `/admin/option-groups/${groupId}/options`, id ? "PATCH" : "POST", body, AdminOptionResponseSchema, "پاسخ گزینه معتبر نیست.");
export const archiveOption = (groupId: string, id: string) => managerMutation(`/admin/option-groups/${groupId}/options/${id}/archive`, "POST", {}, AdminOptionResponseSchema, "پاسخ بایگانی گزینه معتبر نیست.");
export const saveTable = (id: string | null, body: unknown) => managerMutation(id ? `/admin/tables/${id}` : "/admin/tables", id ? "PATCH" : "POST", body, AdminTableResponseSchema, "پاسخ میز معتبر نیست.");
export const archiveTable = (id: string) => managerMutation(`/admin/tables/${id}/archive`, "POST", {}, AdminTableResponseSchema, "پاسخ بایگانی میز معتبر نیست.");
export const saveStaff = (id: string | null, body: unknown) => managerMutation(id ? `/admin/users/${id}` : "/admin/users", id ? "PATCH" : "POST", body, AdminStaffSingleResponseSchema, "پاسخ پرسنل معتبر نیست.");
export const deactivateStaff = (id: string) => managerMutation(`/admin/users/${id}/deactivate`, "POST", {}, AdminStaffSingleResponseSchema, "پاسخ غیرفعال‌سازی معتبر نیست.");
export const reactivateStaff = (id: string) => managerMutation(`/admin/users/${id}/reactivate`, "POST", {}, AdminStaffSingleResponseSchema, "پاسخ فعال‌سازی معتبر نیست.");
export const saveSettings = (body: unknown) => managerMutation("/admin/settings", "PATCH", body, AdminSettingsResponseSchema, "پاسخ تنظیمات معتبر نیست.");
export const reverseSettlement = (settlementId: string, body: { expectedVersion: number; reason: string }) => managerMutation(`/admin/settlements/${settlementId}/reverse`, "POST", body, ReverseSettlementResponseSchema, "پاسخ برگشت تسویه معتبر نیست.");
export async function editSettlement(settlementId: string, body: { expectedVersion: number; payments: unknown[]; reason?: string }, idempotencyKey: string): Promise<ApiResult<PosOrderDetail>> {
  const parsed = await managerMutation(`/admin/settlements/${settlementId}/edit`, "POST", body, EditSettlementResponseSchema, "پاسخ ویرایش پرداخت معتبر نیست.", idempotencyKey);
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}
function uploadRequest(
  path: string,
  form: FormData,
  onProgress?: (percentage: number | null) => void,
): Promise<ApiResult<unknown>> {
  const endActivity = beginRecoveryActivity();
  return new Promise<ApiResult<unknown>>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${posBasePath}/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (event) => {
      onProgress?.(event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null);
    };
    xhr.onerror = () => {
      const error = reportFailure({ kind: "network", message: "ارتباط با سرویس برقرار نشد." });
      resolve({ ok: false, error });
    };
    xhr.onload = () => {
      const payload: unknown = xhr.status === 204 ? null : (() => {
        try { return JSON.parse(xhr.responseText); } catch { return null; }
      })();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true, data: payload, replayed: xhr.getResponseHeader("idempotency-replayed") === "true" });
        return;
      }
      const parsed = ErrorResponseSchema.safeParse(payload);
      const error = reportFailure(parsed.success
        ? {
            kind: "response" as const,
            status: xhr.status,
            code: parsed.data.error.code,
            message: parsed.data.error.message,
            requestId: parsed.data.error.requestId,
            ...(parsed.data.error.details ? { details: parsed.data.error.details } : {}),
          }
        : { kind: "response" as const, status: xhr.status, message: "پاسخ سرویس قابل خواندن نیست." });
      resolve({ ok: false, error });
    };
    xhr.send(form);
  }).finally(endActivity);
}

export async function uploadProductImage(
  productId: string,
  file: File,
  onProgress?: (percentage: number | null) => void,
) {
  const form = new FormData(); form.set("file", file);
  return parseResponse(await uploadRequest(`/admin/products/${productId}/image`, form, onProgress), AdminImageResponseSchema, "پاسخ تصویر معتبر نیست.");
}
export const archiveProductImage = (productId: string) => managerMutation(`/admin/products/${productId}/image/archive`, "POST", {}, AdminImageArchiveResponseSchema, "پاسخ حذف تصویر معتبر نیست.");

export const readInventoryStockItems = () => managerResponse("/admin/inventory/stock-items", StockItemsResponseSchema, "فهرست اقلام انبار دریافت نشد.");
export const saveInventoryStockItem = (id: string | null, body: unknown) => managerMutation(id ? `/admin/inventory/stock-items/${id}` : "/admin/inventory/stock-items", id ? "PATCH" : "POST", body, StockItemResponseSchema, "اطلاعات قلم انبار دریافت نشد.");
export const archiveInventoryStockItem = (id: string, expectedVersion: number) => managerMutation(`/admin/inventory/stock-items/${id}/archive`, "POST", { expectedVersion }, StockItemResponseSchema, "وضعیت بایگانی قلم دریافت نشد.");

export async function readInventoryPurchases(query: Partial<PurchaseListQuery> = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit ?? 20));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.search) params.set("search", query.search);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.status) params.set("status", query.status);
  return managerResponse(`/admin/inventory/purchases?${params.toString()}`, PurchasesResponseSchema, "فهرست خریدها دریافت نشد.");
}
export const createInventoryPurchase = (body: unknown) => managerMutation("/admin/inventory/purchases", "POST", body, PurchaseResponseSchema, "اطلاعات خرید دریافت نشد.");
export const updateInventoryPurchase = (id: string, body: unknown) => managerMutation(`/admin/inventory/purchases/${id}`, "PATCH", body, PurchaseResponseSchema, "اطلاعات خرید ویرایش‌شده دریافت نشد.");
export const postInventoryPurchase = (id: string, expectedVersion: number, key: string) => managerMutation(`/admin/inventory/purchases/${id}/post`, "POST", { expectedVersion }, PurchaseResponseSchema, "نتیجه‌ی ثبت رسید خرید دریافت نشد.", key);
export const returnInventoryPurchase = (id: string, body: unknown, key: string) => managerMutation(`/admin/inventory/purchases/${id}/returns`, "POST", body, InventoryMovementResponseSchema, "نتیجه‌ی ثبت مرجوعی خرید دریافت نشد.", key);

export const readInventoryRecipes = () => managerResponse("/admin/inventory/recipes", RecipesResponseSchema, "فهرست دستورهای تهیه دریافت نشد.");
export const saveInventoryRecipe = (id: string | null, body: unknown) => managerMutation(id ? `/admin/inventory/recipes/${id}` : "/admin/inventory/recipes", id ? "PATCH" : "POST", body, RecipeResponseSchema, "اطلاعات دستور تهیه دریافت نشد.");
export const archiveInventoryRecipe = (id: string, expectedVersion: number) => managerMutation(`/admin/inventory/recipes/${id}/archive`, "POST", { expectedVersion }, RecipeResponseSchema, "وضعیت بایگانی دستور تهیه دریافت نشد.");

export const readProductCosting = (productId: string) => managerResponse(`/admin/products/${productId}/costing`, ProductCostingConfigurationResponseSchema, "تنظیم هزینه‌ی محصول دریافت نشد.");
export const saveProductCosting = (productId: string, body: unknown) => managerMutation(`/admin/products/${productId}/costing`, "PUT", body, ProductCostingConfigurationResponseSchema, "تنظیم ذخیره‌شده‌ی هزینه‌ی محصول دریافت نشد.");
export const previewProductCosting = (productId: string, body: unknown) => managerMutation(`/admin/products/${productId}/costing/preview`, "POST", body, ProductCostingPreviewResponseSchema, "اطلاعات پیش‌نمایش هزینه دریافت نشد.");

export async function readInventoryCounts(query: Partial<InventoryCountListQuery> = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit ?? 20));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.search) params.set("search", query.search);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.kind) params.set("kind", query.kind);
  if (query.status) params.set("status", query.status);
  return managerResponse(`/admin/inventory/counts?${params.toString()}`, InventoryCountsResponseSchema, "فهرست شمارش‌ها دریافت نشد.");
}
export const createInventoryCount = (body: unknown) => managerMutation("/admin/inventory/counts", "POST", body, InventoryCountResponseSchema, "اطلاعات شمارش موجودی دریافت نشد.");
export const updateInventoryCount = (id: string, body: unknown) => managerMutation(`/admin/inventory/counts/${id}`, "PATCH", body, InventoryCountResponseSchema, "اطلاعات شمارش ویرایش‌شده دریافت نشد.");
export const postInventoryCount = (id: string, body: unknown, key: string) => managerMutation(`/admin/inventory/counts/${id}/post`, "POST", body, InventoryCountResponseSchema, "نتیجه‌ی ثبت شمارش دریافت نشد.", key);

export const readInventoryMovements = (filters: Record<string, string> = {}) => {
  const query = new URLSearchParams({ limit: "50", ...filters });
  return managerResponse(`/admin/inventory/movements?${query}`, InventoryMovementsResponseSchema, "فهرست تغییرهای موجودی دریافت نشد.");
};
export const readPendingInventoryConsumption = () => managerResponse("/admin/inventory/pending-consumption?limit=50", PendingConsumptionsResponseSchema, "فهرست سفارش‌های در انتظار کسر از موجودی دریافت نشد.");
export const readGrossProfitReport = (fromDate: string, toDate: string) => {
  const query = new URLSearchParams({ fromDate, toDate });
  return managerResponse(`/admin/reports/gross-profit?${query}`, GrossProfitReportResponseSchema, "گزارش سود ناخالص دریافت نشد.");
};

export const activateInventory = () => managerMutation("/admin/settings/inventory/activate", "POST", {}, AdminSettingsResponseSchema, "پاسخ فعال‌سازی انبار معتبر نیست.");
