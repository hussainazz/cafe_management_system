"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  readInventoryMovements,
  type InventoryMovement,
  type InventoryStockItem,
  type PendingInventoryConsumption,
} from "../lib/api-client";
import { InventoryStockTable } from "./inventory-stock-table";
import { InventoryOverviewTrends } from "./inventory-charts";
import { InventoryIcon, AlertIcon, ClockIcon, CatalogIcon, AccountingIcon } from "./icons";
import { inventoryErrorMessage } from "../lib/inventory-errors";
import { formatToman } from "../lib/pos-utils";

import { emptyInventoryItem, lowInventoryItem, inventoryAmountTotal, inventoryNumber, inventoryQuantity, inventoryUnitLabels, inventoryMovementLabels } from "./inventory-presentation";
export { emptyInventoryItem, lowInventoryItem, inventoryAmountTotal, inventoryNumber, inventoryQuantity, inventoryUnitLabels, inventoryMovementLabels } from "./inventory-presentation";

export function InventoryMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone?: "warning" | "success" | undefined;
}) {
  return (
    <div className={`inventory-metric${tone ? ` inventory-metric--${tone}` : ""}`}>
      <dt>{label.includes("انتظار") ? <ClockIcon /> : label.includes("تأمین") ? <AlertIcon /> : label.includes("فعال") ? <CatalogIcon /> : label.includes("سود") || label.includes("فروش") ? <AccountingIcon /> : <InventoryIcon />}{label}</dt>
      <dd>{value}</dd>
      <small>{detail}</small>
    </div>
  );
}

export function InventoryOverview({
  items,
  pending,
  pendingHasMore = false,
  onNavigate,
  onOpenStock,
}: {
  items: InventoryStockItem[];
  pending: PendingInventoryConsumption[];
  pendingHasMore?: boolean;
  onOpenStock?: (id: string) => void;
  onNavigate: (view: "stock" | "purchases" | "history" | "recipes") => void;
}) {
  const pendingCount = `${pendingHasMore ? "دست‌کم " : ""}${inventoryNumber(pending.length)}`;
  const active = items.filter((item) => item.isActive && !item.archivedAt);
  const empty = active.filter(emptyInventoryItem);
  const low = active.filter(lowInventoryItem);
  const attention = active.filter(item => emptyInventoryItem(item) || lowInventoryItem(item) || !item.balance.trackingStartedAt);
  const uninitialized = active.filter(
    (item) => !item.balance.trackingStartedAt || item.balance.quantityOnHand === null,
  );
  const missingValues = active.filter(
    (item) => !item.balance.trackingStartedAt || item.balance.carryingValueAmount === null,
  );
  const totalValue = inventoryAmountTotal(
    active.map((item) => item.balance.carryingValueAmount ?? 0),
  );
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void readInventoryMovements({ limit: "6" }).then((result) => {
      if (!current) return;
      if (result.ok) setMovements(result.data.data.movements);
      else setError(inventoryErrorMessage(result.error));
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [retry]);
  return (
    <div className="inventory-overview">
      <dl className="inventory-metrics">
        <InventoryMetric
          label="ارزش موجودی فعلی (تومان)"
          value={
            totalValue === null
              ? "خارج از محدوده‌ی نمایش"
              : active.length === 0
                ? "کالایی ثبت نشده"
                : missingValues.length
                  ? "ارزش‌گذاری ناقص"
                  : inventoryNumber(formatToman(totalValue))
          }
          detail={
            missingValues.length
              ? `${inventoryNumber(missingValues.length)} قلم بدون ارزش‌گذاری کامل`
              : "بر اساس ارزش دفتری اقلام فعال"
          }
        />
        <InventoryMetric
          label="اقلام فعال"
          value={inventoryNumber(active.length)}
          detail={`${inventoryNumber(uninitialized.length)} قلم با موجودی آغازین ثبت‌نشده`}
        />
        <InventoryMetric
          label="اقلام نیازمند تأمین"
          value={inventoryNumber(active.filter(item => emptyInventoryItem(item) || lowInventoryItem(item)).length)}
          detail={`${inventoryNumber(low.length)} قلم در حد هشدار مدیر · ${inventoryNumber(empty.length)} قلم با موجودی صفر`}
          tone={empty.length ? "warning" : undefined}
        />
        <InventoryMetric
          label="در انتظار کسر موجودی"
          value={pendingCount}
          detail={
            pendingHasMore
              ? "فهرست بارگذاری‌شده همه‌ی سفارش‌های در انتظار را شامل نمی‌شود"
              : "سفارش‌هایی که هنوز از انبار کسر نشده‌اند"
          }
          tone={pending.length ? "warning" : undefined}
        />
      </dl>
      <InventoryOverviewTrends />
      <div className="inventory-overview-bottom"><InventoryStockTable items={items} onPurchase={() => onNavigate("purchases")} onOpen={id => onOpenStock ? onOpenStock(id) : onNavigate("stock")} />
      <div className="inventory-overview-columns">
        <section className="manager-card">
          <header>
            <h2><AlertIcon /> هشدارهای موجودی</h2>
            <p>حد هشدار اختیاری مدیر، موجودی صفر و مقادیر ثبت‌نشده.</p>
          </header>
          {active.length === 0 ? (
            <div className="inventory-empty">
              <strong>هنوز کالایی در انبار ثبت نشده است</strong>
              <p>ابتدا کالا و موجودی آغازین آن را ثبت کنید.</p>
              <button className="primary-button" type="button" onClick={() => onNavigate("stock")}>
                افزودن کالای انبار
              </button>
            </div>
          ) : (
            <>
              <ul className="inventory-attention-list">
                {attention.slice(0, 6).map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    <span className="inventory-status inventory-status--warning">
                      {emptyInventoryItem(item) ? "موجودی صفر" : lowInventoryItem(item) ? "کمبود موجودی" : "مقدار آغازین ثبت نشده"}
                    </span>
                  </li>
                ))}
              </ul>
              {attention.length > 6 && (
                <p className="inventory-result-count">
                  نمایش ۶ مورد از {inventoryNumber(attention.length)} قلم نیازمند
                  رسیدگی
                </p>
              )}
              {attention.length === 0 && (
                <p className="inventory-empty">
                  هیچ قلمی در حد هشدار، با موجودی صفر یا مقدار آغازین ثبت‌نشده وجود ندارد.
                </p>
              )}
              <button
                className="secondary-button"
                type="button"
                onClick={() => onNavigate("stock")}
              >
                بررسی اقلام موجودی
              </button>
            </>
          )}
          {pending.length > 0 && (
            <p className="inventory-note">
              {pendingCount} سفارش در انتظار کسر موجودی است.{" "}
              <button className="text-button" type="button" onClick={() => onNavigate("history")}>
                بررسی سفارش‌ها
              </button>
            </p>
          )}
        </section>
        <section className="manager-card">
          <header>
            <h2><ClockIcon /> آخرین تغییرهای موجودی</h2>
            <p>شش تغییر اخیر؛ شامل موجودی آغازین، خرید، شمارش و مصرف.</p>
          </header>
          {error ? (
            <p className="form-error" role="alert">
              {error}{" "}
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                بارگذاری دوباره
              </button>
            </p>
          ) : loading ? (
            <p className="inventory-empty" role="status">
              در حال بارگذاری گردش موجودی…
            </p>
          ) : (
            <ul className="inventory-activity">
              {movements.map((movement) => {
                const item = items.find((entry) => entry.id === movement.stockItemId);
                return (
                  <li key={movement.id}>
                    <div>
                      <strong>{item?.name ?? "نام کالا در دسترس نیست"}</strong>
                      <small>
                        {inventoryMovementLabels[movement.kind] ?? "تغییر موجودی"} ·{" "}
                        {new Date(movement.occurredAt).toLocaleString("fa-IR", {
                          timeZone: "Asia/Tehran",
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </small>
                    </div>
                    <div>
                      <span>
                        <bdi>{inventoryQuantity(movement.quantityDelta)}</bdi>{" "}
                        {item ? inventoryUnitLabels[item.baseUnit] : "واحد نامشخص"}
                      </span>
                      <small>
                        <bdi>{inventoryNumber(formatToman(movement.valueDeltaAmount))}</bdi> تومان
                      </small>
                    </div>
                  </li>
                );
              })}
              {movements.length === 0 && (
                <li className="inventory-empty">هنوز تغییری در موجودی ثبت نشده است.</li>
              )}
            </ul>
          )}
          <button className="secondary-button" type="button" onClick={() => onNavigate("history")}>
            مشاهده‌ی گردش موجودی
          </button>
        </section>
      </div></div>
    </div>
  );
}
