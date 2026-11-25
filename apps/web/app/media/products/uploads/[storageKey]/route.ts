const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const imageKeyPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|png|webp)$/i;
const imageTypes = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
const immutableCacheControl = "public, max-age=2592000, immutable";

function noStoreResponse(status: number) {
  return new Response(null, { status, headers: { "cache-control": "no-store, max-age=0" } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storageKey: string }> },
) {
  const { storageKey } = await params;
  const match = imageKeyPattern.exec(storageKey);
  if (!match) return noStoreResponse(404);

  const expectedType = imageTypes[match[1] as keyof typeof imageTypes];
  if (!expectedType) return noStoreResponse(404);

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiBaseUrl}/api/v1/media/products/uploads/${encodeURIComponent(storageKey)}`,
      {
        cache: "no-store",
        redirect: "manual",
        headers: { accept: "image/*", "accept-encoding": "identity" },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    return noStoreResponse(503);
  }

  if (upstream.status !== 200) {
    await upstream.body?.cancel().catch(() => undefined);
    return noStoreResponse(upstream.status === 404 ? 404 : 502);
  }

  const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!upstream.body || contentType !== expectedType) {
    await upstream.body?.cancel().catch(() => undefined);
    return noStoreResponse(502);
  }

  const headers = new Headers({
    "content-type": expectedType,
    "cache-control": immutableCacheControl,
    "x-content-type-options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  if (length && /^\d+$/.test(length)) headers.set("content-length", length);
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("etag", etag);

  return new Response(upstream.body, { status: 200, headers });
}
