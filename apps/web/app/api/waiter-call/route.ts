const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

export async function POST(request: Request) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/public/waiter-calls`, {
      method: "POST",
      cache: "no-store",
      headers: { accept: "application/json", cookie: request.headers.get("cookie") ?? "" },
      signal: AbortSignal.timeout(8_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: { code: "WAITER_CALL_UNAVAILABLE" } }, { status: 503 });
  }
}
