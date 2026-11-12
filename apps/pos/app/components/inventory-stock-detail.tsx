"use client";
import { useEffect, useState } from "react";
import {
  readInventoryMovements,
  type InventoryMovement,
  type InventoryStockItem,
} from "../lib/api-client";
import { inventoryErrorMessage } from "../lib/inventory-errors";
import {
  inventoryNumber,
  inventoryQuantity,
  inventoryUnitLabels,
  inventoryMovementLabels,
  lowInventoryItem,
} from "./inventory-presentation";
import { formatToman } from "../lib/pos-utils";
import { InventoryIcon, EditIcon, ClockIcon } from "./icons";

export function InventoryStockDetail({
  item,
  onEdit,
}: {
  item: InventoryStockItem;
  onEdit: () => void;
}) {
  const [tab, setTab] = useState<"summary" | "movements">("summary");
  const [rows, setRows] = useState<InventoryMovement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setRows([]);
    setError(null);
    setLoading(true);
    void readInventoryMovements({ stockItemId: item.id, limit: "6" })
      .then((result) => {
        if (!active) return;
        if (result.ok) setRows(result.data.data.movements);
        else setError(inventoryErrorMessage(result.error));
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError("گردش این کالا دریافت نشد. دوباره تلاش کنید.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [item.id, item.version, retry]);
  return (
    <aside className="manager-card inventory-stock-detail" aria-label={`جزئیات ${item.name}`}>
      <header className="inventory-item-heading">
        <span className="inventory-item-symbol">
          <InventoryIcon />
        </span>
        <div>
          <h2>{item.name}</h2>
          <p>
            {item.category} · {inventoryUnitLabels[item.baseUnit]}
          </p>
        </div>
      </header>
      <div className="inventory-detail-tabs">
        <button type="button" aria-pressed={tab === "summary"} onClick={() => setTab("summary")}>
          نمای کلی
        </button>
        <button
          type="button"
          aria-pressed={tab === "movements"}
          onClick={() => setTab("movements")}
        >
          گردش موجودی
        </button>
      </div>
      {tab === "summary" ? (
        <>
          <dl className="inventory-detail-values">
            <div>
              <dt>موجودی فعلی</dt>
              <dd>
                {item.balance.quantityOnHand === null
                  ? "ثبت نشده"
                  : inventoryQuantity(item.balance.quantityOnHand)}{" "}
                <small>{inventoryUnitLabels[item.baseUnit]}</small>
              </dd>
            </div>
            <div>
              <dt>ارزش موجودی</dt>
              <dd>
                {item.balance.carryingValueAmount === null
                  ? "ارزش‌گذاری نشده"
                  : inventoryNumber(formatToman(item.balance.carryingValueAmount))}{" "}
                <small>تومان</small>
              </dd>
            </div>
            <div>
              <dt>هزینه‌ی میانگین هر واحد</dt>
              <dd>
                {item.balance.movingAverageCostPerBaseUnit === null
                  ? "محاسبه نشده"
                  : inventoryQuantity(item.balance.movingAverageCostPerBaseUnit)}{" "}
                <small>تومان</small>
              </dd>
            </div>
            <div>
              <dt>حد هشدار مدیر</dt>
              <dd>
                {item.lowStockThreshold == null
                  ? "تنظیم نشده"
                  : inventoryQuantity(item.lowStockThreshold)}{" "}
                {item.lowStockThreshold != null && (
                  <small>{inventoryUnitLabels[item.baseUnit]}</small>
                )}
              </dd>
            </div>
          </dl>
          <p className={`inventory-note${lowInventoryItem(item) ? " inventory-low-stock" : ""}`}>
            {!item.balance.trackingStartedAt
              ? "برای نمایش وضعیت، موجودی آغازین این کالا را ثبت کنید."
              : item.lowStockThreshold == null
                ? "هشدار کمبود برای این کالا تنظیم نشده است."
                : lowInventoryItem(item)
                  ? "موجودی به حد هشدار تعیین‌شده رسیده است. خرید این کالا را بررسی کنید."
                  : "موجودی بالاتر از حد هشدار تعیین‌شده است."}
          </p>
          <h3>بسته‌بندی‌های خرید</h3>
          <ul className="inventory-attention-list">
            {item.conversions
              .filter((c) => c.isActive)
              .map((c) => (
                <li key={c.id}>
                  <strong>{c.label}</strong>
                  <span>
                    {inventoryQuantity(c.baseQuantityPerPack)} {inventoryUnitLabels[item.baseUnit]}
                  </span>
                </li>
              ))}
          </ul>
          {!item.conversions.some((c) => c.isActive) && (
            <p className="inventory-note">خرید با واحد مبنا ثبت می‌شود.</p>
          )}
        </>
      ) : (
        <>
          <h3>
            <ClockIcon /> آخرین تغییرهای این کالا
          </h3>
          {loading ? (
            <p role="status">در حال دریافت گردش کالا…</p>
          ) : error ? (
            <p role="alert" className="form-error">
              {error}{" "}
              <button type="button" onClick={() => setRetry((v) => v + 1)}>
                تلاش دوباره
              </button>
            </p>
          ) : (
            <ul className="inventory-activity">
              {rows.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{inventoryMovementLabels[row.kind] ?? row.kind}</strong>
                    <small>
                      {new Date(row.occurredAt).toLocaleString("fa-IR", {
                        timeZone: "Asia/Tehran",
                      })}
                    </small>
                  </div>
                  <span
                    className={
                      row.quantityDelta.startsWith("-")
                        ? "inventory-negative"
                        : "inventory-positive"
                    }
                  >
                    <bdi>{inventoryQuantity(row.quantityDelta)}</bdi>{" "}
                    {inventoryUnitLabels[item.baseUnit]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!loading && !error && !rows.length && (
            <p className="inventory-empty">گردشی برای این کالا ثبت نشده است.</p>
          )}
        </>
      )}
      <button className="primary-button" type="button" onClick={onEdit}>
        <EditIcon /> ویرایش کالا و حد هشدار
      </button>
    </aside>
  );
}
