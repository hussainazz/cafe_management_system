"use client";

import { useEffect, useState } from "react";
import type { z } from "zod";
import type { OrderSummarySchema } from "@cafe/contracts";
import { readOrderList } from "../lib/api-client";
import { formatOrderNumber, formatToman } from "../lib/pos-utils";
import { MenuIcon } from "./icons";

type Order = z.infer<typeof OrderSummarySchema>;

export function DeferredOrders({ onOpenMenu, onOpenOrder, menuOpen = false }: { onOpenMenu: () => void; onOpenOrder: (id: string) => void; menuOpen?: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async (next?: string) => {
    setLoading(true);
    const result = await readOrderList({ state: "OPEN", deferred: "true", limit: 100, ...(next ? { cursor: next } : {}) });
    setLoading(false);
    if (!result.ok) { setError(result.error.message); return; }
    setError(null);
    setOrders((current) => next ? [...current, ...result.data.data.orders] : result.data.data.orders);
    setCursor(result.data.meta.page.nextCursor);
  };
  useEffect(() => { void load(); }, []);
  return <section className="pos-workspace" dir="rtl">
    <header className="workspace-header"><h1>سفارش‌های تسویه‌نشده</h1><button className="menu-button" type="button" aria-label="باز کردن منو" aria-expanded={menuOpen} aria-controls="pos-navigation-drawer" onClick={onOpenMenu}><MenuIcon /></button></header>
    {error && <p role="alert">{error}</p>}
    {error && !loading && <button className="button button--quiet" type="button" onClick={() => void load()}>دریافت دوباره</button>}
    {!loading && !error && orders.length === 0 && <p>سفارشی در این فهرست نیست.</p>}
    {orders.length > 0 && <div className="manager-card"><ul className="deferred-orders-list">{orders.map((order) => <li key={order.id}>
      <button className="button button--quiet deferred-order-row" type="button" onClick={() => onOpenOrder(order.id)}>
        <span className="deferred-order-row__identity"><strong>سفارش {formatOrderNumber(order.dailyOrderNumber)}</strong>{order.deferredCustomerName && <small>{order.deferredCustomerName}</small>}</span>
        <span className="deferred-order-row__balance">مانده {formatToman(order.balanceAmount)} تومان</span>
      </button>
    </li>)}</ul></div>}
    {loading && <p role="status">در حال دریافت سفارش‌ها…</p>}
    {cursor && <button className="button button--quiet" disabled={loading} onClick={() => void load(cursor)}>نمایش سفارش‌های بیشتر</button>}
  </section>;
}
