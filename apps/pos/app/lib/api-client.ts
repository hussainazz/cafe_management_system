import {
  AuthenticationResponseSchema,
  CreateOrderResponseSchema,
  ErrorResponseSchema,
  PosCatalogResponseSchema,
  PosTablesResponseSchema,
  type AuthenticatedUser,
  type CreateOrderRequest,
  type CreatedOrder,
  type PosCatalogCategory,
  type PosTable,
} from "@cafe/contracts";

export type ApiFailure = { kind: "network" | "response" | "invalid-response"; status?: number; code?: string; message: string; requestId?: string };
export type ApiResult<T> = { ok: true; data: T; replayed: boolean } | { ok: false; error: ApiFailure };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`/api/v1${path}`, { ...init, headers: { accept: "application/json", ...init?.headers }, credentials: "same-origin", cache: "no-store" });
    const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ErrorResponseSchema.safeParse(payload);
      return { ok: false, error: parsed.success ? { kind: "response", status: response.status, code: parsed.data.error.code, message: parsed.data.error.message, requestId: parsed.data.error.requestId } : { kind: "response", status: response.status, message: "پاسخ سرویس قابل خواندن نیست." } };
    }
    return { ok: true, data: payload as T, replayed: response.headers.get("idempotency-replayed") === "true" };
  } catch {
    return { ok: false, error: { kind: "network", message: "ارتباط با سرویس برقرار نشد." } };
  }
}

function parseAuthentication(result: ApiResult<unknown>, invalidMessage: string): ApiResult<AuthenticatedUser> {
  if (!result.ok) return result;
  const parsed = AuthenticationResponseSchema.safeParse(result.data);
  return parsed.success ? { ok: true, data: parsed.data.data, replayed: result.replayed } : { ok: false, error: { kind: "invalid-response", message: invalidMessage } };
}

export async function currentSession() { return parseAuthentication(await request<unknown>("/auth/me"), "پاسخ نشست معتبر نیست."); }
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
export async function refreshSession() { return parseAuthentication(await request<unknown>("/auth/refresh", { method: "POST" }), "پاسخ نوسازی نشست معتبر نیست."); }
export async function endSession() { const result = await request<null>("/auth/logout", { method: "POST" }); return result.ok ? { ok: true as const, data: null } : result; }

function parseResponse<T>(result: ApiResult<unknown>, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, invalidMessage: string): ApiResult<T> {
  if (!result.ok) return result;
  const parsed = schema.safeParse(result.data);
  return parsed.success ? { ok: true, data: parsed.data, replayed: result.replayed } : { ok: false, error: { kind: "invalid-response", message: invalidMessage } };
}

export async function readPosCatalog(): Promise<ApiResult<PosCatalogCategory[]>> {
  const parsed = parseResponse(await request<unknown>("/pos/catalog"), PosCatalogResponseSchema, "فهرست محصولات معتبر نیست.");
  return parsed.ok ? { ok: true, data: parsed.data.data.categories, replayed: parsed.replayed } : parsed;
}

export async function readPosTables(): Promise<ApiResult<PosTable[]>> {
  const parsed = parseResponse(await request<unknown>("/tables"), PosTablesResponseSchema, "فهرست میزها معتبر نیست.");
  return parsed.ok ? { ok: true, data: parsed.data.data.tables, replayed: parsed.replayed } : parsed;
}

export async function createOpenOrder(input: CreateOrderRequest, idempotencyKey: string): Promise<ApiResult<CreatedOrder>> {
  const parsed = parseResponse(
    await request<unknown>("/orders", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(input) }),
    CreateOrderResponseSchema,
    "پاسخ ثبت سفارش معتبر نیست.",
  );
  return parsed.ok ? { ok: true, data: parsed.data.data, replayed: parsed.replayed } : parsed;
}
