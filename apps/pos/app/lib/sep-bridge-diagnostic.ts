export type BridgeProbe = { kind: "simple" | "preflight"; ok: boolean; status?: number; error?: "network-or-policy" | "unexpected-response" };

export function bridgeHealthUrl(port: number): string {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid bridge port");
  return `http://127.0.0.1:${port}/health`;
}

// No payment/API-client imports, cookies, automatic retries, or terminal calls.
export async function probeBridge(port: number, kind: BridgeProbe["kind"], signal: AbortSignal): Promise<BridgeProbe> {
  const url = bridgeHealthUrl(port);
  try {
    const response = await fetch(url, {
      method: "GET", mode: "cors", credentials: "omit", cache: "no-store",
      redirect: "error", signal,
      ...(kind === "preflight" ? { headers: { "x-run-cafe-diagnostic": "1" } } : {}),
    });
    const body: unknown = await response.json();
    const health = body as Record<string, unknown> | null;
    const knownHealth = health && ((health.version === "0.1.0" && health.mode === "health-only" && health.paymentEnabled === false && health.terminalAccess === false) ||
      (health.version === "0.2.0" && health.mode === "payments" && typeof health.paymentEnabled === "boolean" && health.manualVerificationRequired === true));
    if (response.status !== 200 || !health || health.service !== "run-cafe-sep-bridge" || !knownHealth) {
      return { kind, ok: false, status: response.status, error: "unexpected-response" };
    }
    return { kind, ok: true, status: response.status };
  } catch {
    // Fetch cannot distinguish offline, mixed content, CSP, CORS, or proxy errors.
    return { kind, ok: false, error: "network-or-policy" };
  }
}
