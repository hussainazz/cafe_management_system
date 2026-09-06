const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

export async function POST(request: Request) {
  const response = await fetch(`${apiBaseUrl}/api/v1/public/customer-otp/verify`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json", accept: "application/json", cookie: request.headers.get("cookie") ?? "" },
    body: await request.text(), signal: AbortSignal.timeout(8_000),
  });
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(await response.text(), { status: response.status, headers });
}
