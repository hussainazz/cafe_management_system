const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const clearedTableContextCookie = [
  "cafe_table_context=",
  "HttpOnly",
  "Path=/",
  "SameSite=Lax",
  "Max-Age=0",
  ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
].join("; ");

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const menuUrl = new URL("/menu", "http://menu.local");
  let setCookie: string | null = null;
  let valid = false;

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/public/table-context/exchange`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8_000),
    });
    setCookie = response.headers.get("set-cookie");
    valid = response.ok;
  } catch {
    valid = false;
  }

  if (!valid) {
    menuUrl.searchParams.set("table-context", "invalid");
    setCookie ??= clearedTableContextCookie;
  }
  const headers = new Headers({ location: `${menuUrl.pathname}${menuUrl.search}`, "cache-control": "no-store" });
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(null, { status: 303, headers });
}
