const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

export async function POST(request: Request) {
  const response = await fetch(`${apiBaseUrl}/api/v1/public/customer-otp/request`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json", accept: "application/json", cookie: request.headers.get("cookie") ?? "" },
    body: await request.text(), signal: AbortSignal.timeout(8_000),
  });
  return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
