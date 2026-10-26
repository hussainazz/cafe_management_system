import { TerminalIntentSchema, type TerminalIntent } from "@cafe/contracts";

export async function sendTerminalPurchase(intent: TerminalIntent): Promise<boolean> {
  const parsed = TerminalIntentSchema.safeParse(intent);
  if (!parsed.success) return false;
  const port = Number(process.env.NEXT_PUBLIC_SEP_BRIDGE_PORT ?? "18711");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return false;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    // Called only from the cashier's explicit action. Never retry this fetch.
    const response = await fetch(`http://127.0.0.1:${port}/payments`, {
      method: "POST", mode: "cors", credentials: "omit", redirect: "error", cache: "no-store",
      headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data), signal: controller.signal,
    });
    if (response.status !== 200) return false;
    const body: unknown = await response.json();
    return !!body && typeof body === "object" && "attemptId" in body && body.attemptId === intent.attemptId;
  } catch { return false; } finally { clearTimeout(timer); }
}
