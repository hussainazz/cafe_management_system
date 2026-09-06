const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

export async function DELETE(request: Request) {
  const response = await fetch(`${apiBaseUrl}/api/v1/public/customer-auth/session`, {
    method: "DELETE", cache: "no-store", headers: { cookie: request.headers.get("cookie") ?? "" }, signal: AbortSignal.timeout(8_000),
  });
  const headers = new Headers({ "cache-control": "no-store" });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(null, { status: response.status, headers });
}
