"use client";
import { useState } from "react";
import type { InventoryStockItem } from "../lib/api-client";
import { formatToman } from "../lib/pos-utils";
import {
  emptyInventoryItem,
  lowInventoryItem,
  inventoryQuantity,
  inventoryNumber,
  inventoryUnitLabels,
} from "./inventory-presentation";
import { InventoryIcon } from "./icons";

export function InventoryStockTable({
  items,
  onOpen,
  onPurchase,
}: {
  items: InventoryStockItem[];
  onOpen: (id: string) => void;
  onPurchase?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const active = items.filter((item) => item.isActive && !item.archivedAt);
  const filtered = active.filter(
    (item) =>
      item.name.includes(search.trim()) &&
      (!status ||
        (status === "low"
          ? lowInventoryItem(item)
          : status === "zero"
            ? emptyInventoryItem(item)
            : !item.balance.trackingStartedAt)),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / 10) - 1);
  const currentPage = Math.min(page, lastPage);
  return (
    <section className="manager-card inventory-overview-stock">
      <header className="inventory-section-heading">
        <h2>
          <InventoryIcon /> موجودی محصولات و مواد اولیه
        </h2>
        <div className="inventory-actions">
          {onPurchase && (
            <button className="primary-button" type="button" onClick={onPurchase}>
              ثبت خرید جدید
            </button>
          )}
          <button className="secondary-button" type="button" onClick={() => onOpen("")}>
            مدیریت اقلام
          </button>
        </div>
      </header>
      <div className="inventory-toolbar">
        <label>
          <span className="sr-only">جست‌وجوی موجودی نمای کلی</span>
          <input
            type="search"
            placeholder="جست‌وجوی ماده یا کالای انبار…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          <span className="sr-only">وضعیت موجودی نمای کلی</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="">همه‌ی وضعیت‌ها</option>
            <option value="low">در حد هشدار مدیر</option>
            <option value="zero">موجودی صفر</option>
            <option value="unknown">مقدار آغازین ثبت نشده</option>
          </select>
        </label>
      </div>
      <div
        className="inventory-table-wrap"
        role="region"
        tabIndex={0}
        aria-label="جدول موجودی نمای کلی"
      >
        <table className="inventory-table">
          <thead>
            <tr>
              <th scope="col">کالا / ماده‌ی اولیه</th>
              <th scope="col">دسته‌بندی</th>
              <th scope="col">موجودی فعلی</th>
              <th scope="col">حد هشدار</th>
              <th scope="col">ارزش موجودی (تومان)</th>
              <th scope="col">وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(currentPage * 10, currentPage * 10 + 10).map((item) => (
              <tr key={item.id}>
                <th scope="row">
                  <button
                    className="inventory-item-link"
                    type="button"
                    onClick={() => onOpen(item.id)}
                  >
                    {item.name}
                  </button>
                </th>
                <td>{item.category}</td>
                <td>
                  {item.balance.quantityOnHand === null
                    ? "ثبت نشده"
                    : inventoryQuantity(item.balance.quantityOnHand)}{" "}
                  <small>{inventoryUnitLabels[item.baseUnit]}</small>
                </td>
                <td>
                  {item.lowStockThreshold == null
                    ? "تنظیم نشده"
                    : inventoryQuantity(item.lowStockThreshold)}
                </td>
                <td>
                  {item.balance.carryingValueAmount === null
                    ? "ارزش‌گذاری نشده"
                    : inventoryNumber(formatToman(item.balance.carryingValueAmount))}
                </td>
                <td>
                  <span
                    className={`inventory-status${emptyInventoryItem(item) || lowInventoryItem(item) ? " inventory-status--warning" : item.balance.trackingStartedAt ? " inventory-status--success" : ""}`}
                  >
                    {!item.balance.trackingStartedAt
                      ? "ثبت نشده"
                      : emptyInventoryItem(item)
                        ? "موجودی صفر"
                        : lowInventoryItem(item)
                          ? "کمبود موجودی"
                          : "موجود"}
                  </span>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6}>
                  {active.length ? "کالایی با این فیلترها پیدا نشد." : "هنوز کالایی ثبت نشده است."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="inventory-table-footer">
        <span>
          {inventoryNumber(filtered.length)} قلم
          {filtered.length > 0 &&
            ` · نمایش ${inventoryNumber(currentPage * 10 + 1)} تا ${inventoryNumber(Math.min(filtered.length, currentPage * 10 + 10))}`}
        </span>
        <div className="inventory-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            قبلی
          </button>
          <span>صفحه‌ی {inventoryNumber(currentPage + 1)}</span>
          <button
            className="secondary-button"
            type="button"
            disabled={currentPage >= lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            بعدی
          </button>
        </div>
      </div>
    </section>
  );
}
