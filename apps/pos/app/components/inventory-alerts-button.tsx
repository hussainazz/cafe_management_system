"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readInventoryStockItems, type InventoryStockItem } from "../lib/api-client";
import { inventoryErrorMessage } from "../lib/inventory-errors";
import { emptyInventoryItem, inventoryNumber, inventoryQuantity, inventoryUnitLabels, lowInventoryItem } from "./inventory-presentation";
import { AlarmBellIcon, CloseIcon, RefreshIcon } from "./icons";

type AlertLevel = "empty" | "low" | "untracked";
type InventoryAlert = { item: InventoryStockItem; level: AlertLevel };
const alertPriority: Record<AlertLevel, number> = { empty: 0, low: 1, untracked: 2 };

function inventoryAlert(item: InventoryStockItem): InventoryAlert | null {
  if (!item.isActive || item.archivedAt) return null;
  if (emptyInventoryItem(item)) return { item, level: "empty" };
  if (lowInventoryItem(item)) return { item, level: "low" };
  if (item.balance.trackingStartedAt === null || item.balance.quantityOnHand === null) return { item, level: "untracked" };
  return null;
}

function alertLabel(level: AlertLevel): string {
  if (level === "empty") return "موجودی صفر";
  if (level === "low") return "کمبود موجودی";
  return "مقدار آغازین ثبت نشده";
}

export function InventoryAlertsButton() {
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await readInventoryStockItems();
    if (result.ok) {
      const next = result.data.data.stockItems
        .map(inventoryAlert)
        .filter((alert): alert is InventoryAlert => alert !== null)
        .sort((left, right) => alertPriority[left.level] - alertPriority[right.level] || left.item.name.localeCompare(right.item.name, "fa"));
      setAlerts(next);
      setError(null);
      setLoaded(true);
    } else {
      setError(inventoryErrorMessage(result.error));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
      } else if (event.shiftKey && (document.activeElement === focusable[0] || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && (document.activeElement === focusable.at(-1) || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      requestAnimationFrame(() => triggerRef.current?.isConnected && triggerRef.current.focus());
    };
  }, [open]);

  const badge = !loaded && loading ? "…" : loaded ? inventoryNumber(alerts.length) : "!";
  const label = loaded ? `هشدارهای موجودی، ${inventoryNumber(alerts.length)} مورد` : "هشدارهای موجودی، شمارش در دسترس نیست";

  return (
    <>
      <button
        ref={triggerRef}
        className="icon-button inventory-alerts-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="هشدارهای موجودی"
        onClick={() => {
          setOpen(true);
          if (loaded) void refresh();
        }}
      >
        <AlarmBellIcon />
        <span className="inventory-alerts-trigger__count" aria-hidden="true">{badge}</span>
      </button>
      {open && (
        <div className="inventory-alerts-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section
            ref={dialogRef}
            className="inventory-alerts-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-alerts-title"
            aria-describedby="inventory-alerts-description"
            aria-busy={loading}
            tabIndex={-1}
          >
            <header className="inventory-alerts-dialog__header">
              <div>
                <span className="inventory-alerts-dialog__eyebrow">پیگیری موجودی</span>
                <h2 id="inventory-alerts-title">هشدارهای انبار</h2>
              </div>
              <button ref={closeRef} className="icon-button" type="button" aria-label="بستن هشدارهای موجودی" onClick={() => setOpen(false)}><CloseIcon /></button>
              <p id="inventory-alerts-description">اقلام فعالِ کم‌موجود، صفر یا بدون موجودی آغازین.</p>
            </header>
            <div className="inventory-alerts-dialog__body">
              <div className="inventory-alerts-summary">
                <AlarmBellIcon />
                <strong>{loading && !loaded ? "در حال دریافت هشدارها…" : `${inventoryNumber(alerts.length)} قلم نیازمند بررسی`}</strong>
                <button className="inventory-alerts-refresh" type="button" disabled={loading} onClick={() => void refresh()} aria-label="تازه‌سازی هشدارهای موجودی" title="تازه‌سازی هشدارها"><RefreshIcon />تازه‌سازی</button>
              </div>
              {error && <p className="inventory-alerts-error" role="alert">{loaded ? "دریافت تازه انجام نشد؛ اطلاعات قبلی نمایش داده می‌شود." : error}</p>}
              {!loaded && loading ? (
                <p className="inventory-alerts-empty" role="status">در حال دریافت فهرست موجودی…</p>
              ) : alerts.length === 0 ? (
                <p className="inventory-alerts-empty" role="status">در حال حاضر هشداری برای اقلام فعال وجود ندارد.</p>
              ) : (
                <ul className="inventory-alerts-list">
                  {alerts.map(({ item, level }) => (
                    <li className={`inventory-alert-row inventory-alert-row--${level}`} key={item.id}>
                      <div className="inventory-alert-row__heading">
                        <strong>{item.name}</strong>
                        <span>{alertLabel(level)}</span>
                      </div>
                      <dl>
                        <div><dt>موجودی فعلی</dt><dd>{level === "untracked" || item.balance.quantityOnHand === null ? "ثبت نشده" : `${inventoryQuantity(item.balance.quantityOnHand)} ${inventoryUnitLabels[item.baseUnit]}`}</dd></div>
                        {level === "low" && item.lowStockThreshold != null && <div><dt>حد هشدار</dt><dd>{inventoryQuantity(item.lowStockThreshold)} {inventoryUnitLabels[item.baseUnit]}</dd></div>}
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
