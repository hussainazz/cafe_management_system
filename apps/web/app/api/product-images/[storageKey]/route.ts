const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storageKey: string }> },
) {
  const { storageKey } = await params;
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(storageKey)) {
    return new Response(null, { status: 404 });
  }

  try {
    const response = await fetch(
      `${apiBaseUrl}/api/v1/product-images/${encodeURIComponent(storageKey)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8_000) },
    );
    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    headers.set("cache-control", "no-store");

    return new Response(response.body, { status: response.status, headers });
  } catch {
    return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
