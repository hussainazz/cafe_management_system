import { PublicMenuResponseSchema } from "@cafe/contracts";

export type PublicMenuResult =
  | {
      ok: true;
      categories: ReturnType<typeof PublicMenuResponseSchema.parse>["data"]["categories"];
      requestId: string;
    }
  | {
      ok: false;
      reason: "not_configured" | "timeout" | "unavailable" | "invalid_response";
    };

type Fetcher = typeof globalThis.fetch;

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function getPublicMenu(
  apiBaseUrl: string | undefined,
  fetcher: Fetcher = globalThis.fetch,
): Promise<PublicMenuResult> {
  if (!apiBaseUrl?.trim()) return { ok: false, reason: "not_configured" };

  let endpoint: URL;
  try {
    endpoint = new URL("/api/v1/public/menu", apiBaseUrl);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      return { ok: false, reason: "not_configured" };
    }
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  try {
    const response = await fetcher(endpoint, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      return { ok: false, reason: isTimeout(error) ? "timeout" : "invalid_response" };
    }

    const parsed = PublicMenuResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, reason: "invalid_response" };

    return {
      ok: true,
      categories: parsed.data.data.categories,
      requestId: parsed.data.meta.requestId,
    };
  } catch (error) {
    if (isTimeout(error)) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "unavailable" };
  }
}
