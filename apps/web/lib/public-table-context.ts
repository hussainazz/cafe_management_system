const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

export type PublicTableContext = {
  active: boolean;
  tableName: string | null;
  occupancyState: "AVAILABLE" | "OCCUPIED" | null;
  waiterCallStatus: "PENDING" | null;
  canCallWaiter: boolean;
  authenticationRequired?: boolean;
  customerAuthenticated?: boolean;
  visitActive?: boolean;
};

function isPublicTableContext(value: unknown): value is PublicTableContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<PublicTableContext>;
  return (
    typeof context.active === "boolean" &&
    (typeof context.tableName === "string" || context.tableName === null) &&
    (context.occupancyState === "AVAILABLE" || context.occupancyState === "OCCUPIED" || context.occupancyState === null) &&
    (context.waiterCallStatus === "PENDING" || context.waiterCallStatus === null) &&
    typeof context.canCallWaiter === "boolean"
  );
}

export async function getPublicTableContext(
  cookieHeader: string | null | undefined,
): Promise<PublicTableContext | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/public/table-context`, {
      cache: "no-store",
      headers: { accept: "application/json", cookie: cookieHeader ?? "" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("data" in body) || !isPublicTableContext(body.data)) {
      return null;
    }
    return body.data;
  } catch {
    return null;
  }
}
