"use client";

import { useEffect, useRef, useState } from "react";
import { currentSession } from "../lib/api-client";
import { bridgeHealthUrl, probeBridge, type BridgeProbe } from "../lib/sep-bridge-diagnostic";

export function PaymentBridgeDiagnostic({ port }: { port: number }) {
  const [session, setSession] = useState<"loading" | "ready" | "required">("loading");
  const [busy, setBusy] = useState(false);
  const [probes, setProbes] = useState<BridgeProbe[]>([]);
  const [timedOut, setTimedOut] = useState(false);
  const [context, setContext] = useState<{ origin: string; secure: boolean; browser: string } | null>(null);
  const running = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void currentSession().then(result => { if (active) setSession(result.ok ? "ready" : "required"); });
    setContext({ origin: window.location.origin, secure: window.isSecureContext, browser: navigator.userAgent });
    return () => { active = false; const controller = running.current; running.current = null; controller?.abort(); };
  }, []);

  const run = async () => {
    if (running.current || session !== "ready") return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setProbes([]);
    setTimedOut(false);
    const timer = setTimeout(() => { setTimedOut(true); controller.abort(); }, 10000);
    try {
      const simple = await probeBridge(port, "simple", controller.signal);
      if (controller.signal.aborted) return;
      setProbes([simple]);
      const preflight = await probeBridge(port, "preflight", controller.signal);
      if (!controller.signal.aborted) setProbes([simple, preflight]);
    } finally {
      clearTimeout(timer);
      if (running.current === controller) {
        running.current = null;
        setBusy(false);
      }
    }
  };

  return <main className="session-screen" dir="rtl">
    <section className="session-card">
      <h1>بررسی ارتباط صندوق با برنامه‌ی واسط</h1>
      <p>این بررسی فقط ارتباط مرورگر با برنامه‌ی همین رایانه را آزمایش می‌کند. مبلغی به کارت‌خوان ارسال نمی‌شود و پرداختی ثبت نمی‌شود.</p>
      <p>نشانی برنامه: <bdi dir="ltr">{bridgeHealthUrl(port)}</bdi></p>
      {session === "loading" && <p role="status">در حال بررسی ورود…</p>}
      {session === "required" && <p role="alert">ابتدا وارد صندوق شوید و سپس این صفحه را دوباره باز کنید.</p>}
      <p><a href="/pos">بازگشت به صندوق</a></p>
      <button className="button button--primary" disabled={busy || session !== "ready"} onClick={() => void run()}>
        {busy ? "در حال بررسی…" : "شروع بررسی ارتباط"}
      </button>
      <div aria-live="polite" aria-busy={busy}>
        {timedOut && <p role="alert">مهلت بررسی تمام شد. برنامه‌ی واسط و خطاهای مرورگر را بررسی کنید.</p>}
        {probes.map(probe => <p key={probe.kind}>
          {probe.kind === "simple" ? "درخواست ساده" : "درخواست با بررسی مجوز مرورگر"}:
          {probe.ok ? " ارتباط برقرار شد." : probe.error === "unexpected-response"
            ? " پاسخ برنامه‌ی واسط با نسخه‌ی این بررسی سازگار نیست."
            : " ارتباط برقرار نشد. باز بودن برنامه و خطاهای بخش شبکه و کنسول مرورگر را بررسی کنید."}
        </p>)}
        {!busy && !timedOut && probes.length === 0 && session === "ready" && <p>برای بررسی ارتباط، دکمه‌ی بالا را بزنید.</p>}
      </div>
      <p>موفقیت این بررسی، اتصال یا آمادگی کارت‌خوان برای پرداخت را تأیید نمی‌کند.</p>
      {context && <details>
        <summary>اطلاعات مرورگر برای بررسی فنی</summary>
        <p>مبدأ صفحه: <bdi dir="ltr">{context.origin}</bdi></p>
        <p>وضعیت امن صفحه: {context.secure ? "تأیید شد" : "تأیید نشد"}</p>
        <p>مرورگر: <bdi dir="ltr">{context.browser}</bdi></p>
      </details>}
    </section>
  </main>;
}
