import { beginRecoveryActivity } from "./automatic-recovery";
export type PrintKind = "bar-ticket" | "receipt" | "settlement";

export function printDocument(url: string): Promise<void> {
  if (typeof document === "undefined") return Promise.reject(new Error("چاپ فقط از داخل مرورگر امکان‌پذیر است."));

  const endActivity = beginRecoveryActivity();
  return new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.src = url;
    iframe.title = "سند چاپ کافه";
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.insetInlineStart = "-10000px";
    iframe.style.top = "0";
    iframe.style.width = "80mm";
    iframe.style.height = "1px";
    iframe.style.border = "0";
    iframe.style.pointerEvents = "none";

    let settled = false;
    let prepared = false;
    let observer: MutationObserver | null = null;
    const cleanup = () => {
      observer?.disconnect();
      iframe.remove();
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(preparationTimeout);
      cleanup();
      reject(new Error(message));
    };
    const ready = () => {
      if (settled || prepared) return;
      prepared = true;
      window.clearTimeout(preparationTimeout);
      const printWindow = iframe.contentWindow;
      if (!printWindow) { fail("صفحه‌ی چاپ باز نشد."); return; }
      // Completion follows afterprint AND server acknowledgment, never document load.
      printWindow.addEventListener("cafe-print-complete", ((event: CustomEvent<{ error?: string }>) => {
        if (event.detail?.error) { fail(event.detail.error); return; }
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }) as EventListener, { once: true });
    };
    const inspect = () => {
      try {
        const frameDocument = iframe.contentDocument;
        if (!frameDocument) return;
        const error = frameDocument.querySelector<HTMLElement>(".thermal-error");
        if (error) {
          fail(error.textContent?.trim() || "سند چاپ آماده نشد.");
          return;
        }
        if (frameDocument.querySelector(".thermal-print")) ready();
      } catch {
        fail("مرورگر اجازه‌ی آماده‌سازی سند چاپ را نداد.");
      }
    };
    const preparationTimeout = window.setTimeout(() => fail("آماده‌سازی سند چاپ بیش از حد طول کشید."), 30_000);
    iframe.addEventListener("error", () => fail("صفحه‌ی چاپ بارگذاری نشد."), { once: true });
    iframe.addEventListener("load", () => {
      try {
        const root = iframe.contentDocument?.documentElement;
        if (root) {
          observer = new MutationObserver(inspect);
          observer.observe(root, { childList: true, subtree: true, characterData: true });
        }
        inspect();
      } catch {
        fail("مرورگر اجازه‌ی آماده‌سازی سند چاپ را نداد.");
      }
    }, { once: true });
    document.body.appendChild(iframe);
  }).finally(endActivity);
}

export function printRoute(orderId: string, kind: PrintKind, settlementId?: string): string {
  const base = `/pos/print/${encodeURIComponent(orderId)}`;
  if (kind === "bar-ticket") return `${base}/bar-ticket`;
  if (kind === "receipt") return `${base}/receipt`;
  if (!settlementId) throw new Error("A settlement receipt requires a settlement ID.");
  return `${base}/settlements/${encodeURIComponent(settlementId)}/receipt`;
}
