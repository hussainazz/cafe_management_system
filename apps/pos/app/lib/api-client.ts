import {
  AuthenticationResponseSchema,
  BarTicketResponseSchema,
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
  type RecordSettlementRequest,
  type UpdateOrderRequest,
  type DeleteOrderRequest,
  type TransferOrderTableRequest,
  type AuthenticatedUser,
  type CreateOrderRequest,
  type CreatedOrder,
  type PosCatalogCategory,
  type PosTable,
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
export type Page = z.infer<typeof PaymentHistoryResponseSchema>["meta"]["page"];
export type DailyReport = z.infer<typeof DailyReportResponseSchema>;
export type AuditLog = z.infer<typeof AuditLogResponseSchema>;

export type ApiFailure = {
  kind: "network" | "response" | "invalid-response";
  status?: number;
  code?: string;
  message: string;
  requestId?: string;
};
export type ApiResult<T> =
  { ok: true; data: T; replayed: boolean } | { ok: false; error: ApiFailure };

export const posApiFailureEvent = "run-cafe:api-failure";

function reportFailure(error: ApiFailure) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ApiFailure>(posApiFailureEvent, { detail: error }));
  }
  return error;
}

async function request<T>(path: string, init?: RequestInit, report = true): Promise<ApiResult<T>> {
  try {
    const headers = new Headers(init?.headers);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    const response = await fetch(`/api/v1${path}`, {
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
        error: report ? reportFailure(parsed.success
          ? {
              kind: "response",
              status: response.status,
              code: parsed.data.error.code,
              message: parsed.data.error.message,
              requestId: parsed.data.error.requestId,
            }
          : { kind: "response", status: response.status, message: "پاسخ سرویس قابل خواندن نیست." }) : (parsed.success
          ? {
              kind: "response",
              status: response.status,
              code: parsed.data.error.code,
              message: parsed.data.error.message,
              requestId: parsed.data.error.requestId,
            }
          : { kind: "response", status: response.status, message: "پاسخ سرویس قابل خواندن نیست." }),
      };
    }
    return {
      ok: true,
      data: payload as T,
      replayed: response.headers.get("idempotency-replayed") === "true",
    };
  } catch {
    const error = { kind: "network" as const, message: "ارتباط با سرویس برقرار نشد." };
    return { ok: false, error: report ? reportFailure(error) : error };
  }
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
  return parseAuthentication(await request<unknown>("/auth/me", undefined, false), "پاسخ نشست معتبر نیست.");
}
export async function signIn(input: { username: string; password: string }) {
  return parseAuthentication(
    await request<unknown>("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    "پاسخ ورود معتبر نیست.",
  );
}
export async function refreshSession() {
  return parseAuthentication(
    await request<unknown>("/auth/refresh", { method: "POST" }),
    "پاسخ نوسازی نشست معتبر نیست.",
  );
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

export async function readManagerStaff(): Promise<ApiResult<ManagerStaff>> {
  const parsed = await managerResponse("/admin/users", AdminStaffResponseSchema, "فهرست پرسنل معتبر نیست.");
  return parsed.ok ? { ok: true, data: parsed.data.data.staff, replayed: parsed.replayed } : parsed;
}
export async function readManagerSettings(): Promise<ApiResult<ManagerSettings>> {
  const parsed = await managerResponse("/admin/settings", AdminSettingsResponseSchema, "تنظیمات کافه معتبر نیست.");
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}
export async function readPaymentHistory(cursor?: string): Promise<ApiResult<{ payments: PaymentHistory; page: Page }>> {
  const query = new URLSearchParams({ limit: "50", ...(cursor ? { cursor } : {}) });
  const parsed = await managerResponse(`/admin/payments?${query}`, PaymentHistoryResponseSchema, "تاریخچه پرداخت معتبر نیست.");
  return parsed.ok ? { ok: true, data: { payments: parsed.data.data.payments, page: parsed.data.meta.page }, replayed: parsed.replayed } : parsed;
}
export async function readDailyReport(period: "today" | "yesterday"): Promise<ApiResult<DailyReport>> {
  return managerResponse(`/admin/reports/daily?period=${period}`, DailyReportResponseSchema, "گزارش روزانه معتبر نیست.");
}
export async function readAuditLog(cursor?: string, filters: Record<string, string> = {}): Promise<ApiResult<AuditLog>> {
  const query = new URLSearchParams({ limit: "50", ...filters, ...(cursor ? { cursor } : {}) });
  return managerResponse(`/admin/audit-log?${query}`, AuditLogResponseSchema, "تاریخچه حسابرسی معتبر نیست.");
}

async function managerMutation<T>(path: string, method: "POST" | "PATCH", body: unknown, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, message: string): Promise<ApiResult<T>> {
  return parseResponse(await request<unknown>(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), schema, message);
}
export const saveCategory = (id: string | null, body: unknown) => managerMutation(id ? `/admin/categories/${id}` : "/admin/categories", id ? "PATCH" : "POST", body, id ? AdminCategoryResponseSchema : AdminCategoryResponseSchema, "پاسخ دسته معتبر نیست.");
export const archiveCategory = (id: string) => managerMutation(`/admin/categories/${id}/archive`, "POST", {}, AdminCategoryResponseSchema, "پاسخ بایگانی دسته معتبر نیست.");
export const saveProduct = (id: string | null, body: unknown) => managerMutation(id ? `/admin/products/${id}` : "/admin/products", id ? "PATCH" : "POST", body, AdminProductResponseSchema, "پاسخ محصول معتبر نیست.");
export const archiveProduct = (id: string) => managerMutation(`/admin/products/${id}/archive`, "POST", {}, AdminProductResponseSchema, "پاسخ بایگانی محصول معتبر نیست.");
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
function uploadRequest(
  path: string,
  form: FormData,
  onProgress?: (percentage: number | null) => void,
): Promise<ApiResult<unknown>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/v1${path}`);
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
          }
        : { kind: "response" as const, status: xhr.status, message: "پاسخ سرویس قابل خواندن نیست." });
      resolve({ ok: false, error });
    };
    xhr.send(form);
  });
}

export async function uploadProductImage(
  productId: string,
  file: File,
  altText: string,
  onProgress?: (percentage: number | null) => void,
) {
  const form = new FormData(); form.set("file", file); form.set("altText", altText);
  return parseResponse(await uploadRequest(`/admin/products/${productId}/image`, form, onProgress), AdminImageResponseSchema, "پاسخ تصویر معتبر نیست.");
}
export const archiveProductImage = (productId: string) => managerMutation(`/admin/products/${productId}/image/archive`, "POST", {}, AdminImageArchiveResponseSchema, "پاسخ حذف تصویر معتبر نیست.");
