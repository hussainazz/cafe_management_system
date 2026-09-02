const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/public/table-context`, {
      cache: "no-store",
      headers: { accept: "application/json", cookie: request.headers.get("cookie") ?? "" },
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.text();
    const headers = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) headers.set("set-cookie", setCookie);
    return new Response(body, { status: response.status, headers });
  } catch {
    return Response.json({ error: { code: "TABLE_CONTEXT_UNAVAILABLE" } }, { status: 503 });
  }
}
