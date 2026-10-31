const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

const imageKeyPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|png|webp)$/i;
const imageTypes = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
const upstreamTimeoutMs = 8_000;
const immutableCacheControl = "public, max-age=31536000, immutable";

class UpstreamImageTimeout extends Error {
  constructor() {
    super("Upstream image request timed out");
    this.name = "UpstreamImageTimeout";
  }
}

function noStoreResponse(status: number) {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortController: AbortController,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new UpstreamImageTimeout();
          abortController.abort(error);
          reject(error);
        }, upstreamTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function reportTransferFailure(
  requestId: string,
  category: string,
  error: unknown,
  status?: number,
) {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.warn("Product image proxy transfer failed", {
    requestId,
    category,
    errorName,
    ...(status === undefined ? {} : { status }),
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storageKey: string }> },
) {
  const { storageKey } = await params;
  const match = imageKeyPattern.exec(storageKey);
  if (!match) return noStoreResponse(404);

  const extension = match[1]?.toLowerCase();
  let expectedType: string;
  switch (extension) {
    case "jpg":
      expectedType = imageTypes.jpg;
      break;
    case "png":
      expectedType = imageTypes.png;
      break;
    case "webp":
      expectedType = imageTypes.webp;
      break;
    default:
      return noStoreResponse(404);
  }
  const abortController = new AbortController();
  const requestId = crypto.randomUUID();
  const headerTimeout = new UpstreamImageTimeout();
  const headerTimer = setTimeout(() => {
    abortController.abort(headerTimeout);
  }, upstreamTimeoutMs);
  const abortFromClient = () => {
    abortController.abort(request.signal.reason);
  };
  request.signal.addEventListener("abort", abortFromClient, { once: true });
  if (request.signal.aborted) abortFromClient();

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiBaseUrl}/api/v1/product-images/${encodeURIComponent(storageKey)}`,
      {
        cache: "no-store",
        headers: { accept: "image/*", "accept-encoding": "identity" },
        signal: abortController.signal,
      },
    );
  } catch (error) {
    clearTimeout(headerTimer);
    request.signal.removeEventListener("abort", abortFromClient);
    if (!request.signal.aborted) reportTransferFailure(requestId, "upstream-fetch", error);
    return noStoreResponse(abortController.signal.reason === headerTimeout ? 504 : 503);
  }
  clearTimeout(headerTimer);

  if (upstream.status !== 200) {
    request.signal.removeEventListener("abort", abortFromClient);
    await upstream.body?.cancel().catch(() => undefined);
    if (upstream.status !== 404) {
      reportTransferFailure(requestId, "upstream-status", new Error("Unexpected upstream status"), upstream.status);
    }
    return noStoreResponse(upstream.status === 404 ? 404 : 502);
  }

  const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const contentEncoding = upstream.headers.get("content-encoding");
  const upstreamBody = upstream.body as ReadableStream<Uint8Array> | null;
  if (upstreamBody === null || contentType !== expectedType || (contentEncoding && contentEncoding !== "identity")) {
    request.signal.removeEventListener("abort", abortFromClient);
    await upstream.body?.cancel().catch(() => undefined);
    reportTransferFailure(requestId, "upstream-representation", new Error("Unexpected upstream image representation"));
    return noStoreResponse(502);
  }

  const reader = upstreamBody.getReader();
  let firstChunk: ReadableStreamReadResult<Uint8Array>;
  try {
    do {
      firstChunk = await readWithTimeout(reader, abortController);
    } while (!firstChunk.done && firstChunk.value.byteLength === 0);
  } catch (error) {
    request.signal.removeEventListener("abort", abortFromClient);
    await reader.cancel(error).catch(() => undefined);
    reportTransferFailure(requestId, "upstream-body-start", error);
    return noStoreResponse(error instanceof UpstreamImageTimeout ? 504 : 502);
  }
  if (firstChunk.done) {
    request.signal.removeEventListener("abort", abortFromClient);
    await reader.cancel().catch(() => undefined);
    reportTransferFailure(requestId, "upstream-empty-body", new Error("Upstream image body was empty"));
    return noStoreResponse(502);
  }
  const firstBytes = firstChunk.value;

  const headers = new Headers({
    "content-type": expectedType,
    "cache-control": immutableCacheControl,
    "x-content-type-options": "nosniff",
  });
  for (const name of ["content-length", "etag", "last-modified"] as const) {
    const value = upstream.headers.get(name);
    if (value && (name !== "content-length" || /^\d+$/.test(value))) headers.set(name, value);
  }
  const declaredLength = headers.has("content-length")
    ? Number(headers.get("content-length"))
    : null;
  let transferredLength = firstBytes.byteLength;
  if (declaredLength !== null && transferredLength > declaredLength) {
    request.signal.removeEventListener("abort", abortFromClient);
    abortController.abort();
    await reader.cancel().catch(() => undefined);
    reportTransferFailure(requestId, "upstream-length", new Error("Upstream image exceeded declared length"));
    return noStoreResponse(502);
  }

  let firstChunkPending = true;
  let transferFailed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (firstChunkPending) {
        firstChunkPending = false;
        controller.enqueue(firstBytes);
        return;
      }

      try {
        const next = await readWithTimeout(reader, abortController);
        if (next.done) {
          request.signal.removeEventListener("abort", abortFromClient);
          reader.releaseLock();
          if (declaredLength !== null && transferredLength !== declaredLength) {
            reportTransferFailure(requestId, "upstream-length", new Error("Upstream image length mismatch"));
            controller.error(new Error("Upstream image length mismatch"));
            return;
          }
          controller.close();
          return;
        }
        if (declaredLength !== null && transferredLength + next.value.byteLength > declaredLength) {
          request.signal.removeEventListener("abort", abortFromClient);
          abortController.abort();
          await reader.cancel().catch(() => undefined);
          reportTransferFailure(requestId, "upstream-length", new Error("Upstream image exceeded declared length"));
          controller.error(new Error("Upstream image exceeded declared length"));
          return;
        }
        transferredLength += next.value.byteLength;
        controller.enqueue(next.value);
      } catch (error) {
        request.signal.removeEventListener("abort", abortFromClient);
        abortController.abort(error);
        await reader.cancel(error).catch(() => undefined);
        if (!transferFailed && !request.signal.aborted) {
          reportTransferFailure(requestId, "upstream-body-stream", error);
        }
        transferFailed = true;
        controller.error(error);
      }
    },
    async cancel(reason) {
      request.signal.removeEventListener("abort", abortFromClient);
      abortController.abort(reason);
      await reader.cancel(reason).catch(() => undefined);
    },
  });

  return new Response(body, { status: 200, headers });
}
