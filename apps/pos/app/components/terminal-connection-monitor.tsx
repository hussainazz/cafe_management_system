"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { terminalConfig } from "../lib/api-client";
import { bridgeHealthUrl } from "../lib/sep-bridge-diagnostic";

const healthSchema = z.object({
  service: z.literal("run-cafe-sep-bridge"),
  terminalConnection: z.object({
    status: z.enum(["unknown", "connected", "unavailable"]),
    ageSeconds: z.number().nonnegative().nullable(),
    checking: z.boolean(),
  }),
});
type Health = z.infer<typeof healthSchema>["terminalConnection"];
const numbers = new Intl.NumberFormat("fa-IR");

export function TerminalConnectionMonitor() {
  const [enabled, setEnabled] = useState(false);
  const [sample, setSample] = useState<{ health: Health; received: number } | null>(null);
  const [bridgeAvailable, setBridgeAvailable] = useState(true);
  const [now, setNow] = useState(0);
  useEffect(() => {
    let alive = true;
    let interval: ReturnType<typeof setInterval> | undefined;
    let controller: AbortController | null = null;
    const poll = async () => {
      if (controller) return;
      const current = new AbortController(); controller = current;
      const deadline = setTimeout(() => current.abort(), 3000);
      try {
        const response = await fetch(bridgeHealthUrl(Number(process.env.NEXT_PUBLIC_SEP_BRIDGE_PORT ?? "18711")), {
          mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", signal: current.signal,
        });
        const health = healthSchema.safeParse(await response.json());
        if (!response.ok || !health.success) throw new Error("Bridge health unavailable");
        if (alive) { setSample({ health: health.data.terminalConnection, received: performance.now() }); setBridgeAvailable(true); }
      } catch { if (alive) setBridgeAvailable(false); }
      finally { clearTimeout(deadline); controller = null; }
    };
    void terminalConfig().then(config => {
      if (!alive || !config.ok || !config.data.enabled) return;
      setEnabled(true); void poll(); interval = setInterval(() => void poll(), 60000);
    }).catch(() => { /* Payment actions retain their own status handling. */ });
    const ageTimer = setInterval(() => setNow(performance.now()), 1000);
    return () => { alive = false; clearInterval(interval); clearInterval(ageTimer); controller?.abort(); };
  }, []);
  if (!enabled) return null;
  const age = sample?.health.ageSeconds == null ? null : Math.floor(sample.health.ageSeconds + Math.max(0, now - sample.received) / 1000);
  const stale = age !== null && age > 150;
  const failed = !bridgeAvailable || sample?.health.status === "unavailable" || stale;
  const message = !bridgeAvailable ? "ارتباط با برنامهٔ کارت‌خوان برقرار نیست."
    : stale ? "وضعیت ارتباط کارت‌خوان به‌روز نیست."
    : sample?.health.status === "connected" ? "آخرین بررسی ارتباط کارت‌خوان موفق بود."
    : sample?.health.status === "unavailable" ? "در آخرین بررسی، ارتباط با کارت‌خوان برقرار نشد."
    : "کارت‌خوان: در انتظار بررسی ارتباط.";
  return <aside className={`terminal-connection-status connection ${failed ? "connection--offline" : sample?.health.status === "connected" ? "connection--connected" : "connection--busy"}`}
    role={failed ? "alert" : "status"} aria-live="polite">
    <span>{message}{age !== null && <> آخرین بررسی: {numbers.format(age)} ثانیه پیش.</>}</span>
  </aside>;
}
