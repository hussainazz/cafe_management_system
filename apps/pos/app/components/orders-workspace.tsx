"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from "react";
import type { PosCatalogCategory, PosCatalogProduct, PosTable } from "@cafe/contracts";
import { roundDiscountedAmount } from "@cafe/contracts";
import {
  acknowledgeWaiterCall,
  createOpenOrder,
  deleteOpenOrder,
  readOpenOrders,
  readOrder,
  readPosCatalog,
  readPosTables,
  readWaiterCalls,
  recordSettlement,
  editSettlement,
  transferOrderTable,
  makeTableAvailable,
  updateOpenOrder,
  type PosOrderDetail,
  posApiFailureEvent,
} from "../lib/api-client";
import { readRecentItemNotes, rememberItemNotes } from "../lib/recent-item-notes";
import { useRecoveryState, readRecovery, writeRecovery, finishRecoveryEpisode, requestAutomaticRecovery, recoveryNoticeEvent } from "../lib/automatic-recovery";
import { recoveryStateFor, type RecoveryState } from "../lib/recovery-state";
import { canClearTableAfterDeletion, deleteAndClearTableOrder } from "../lib/order-clear-workflow";
import { printDocument, printRoute, type PrintKind } from "../lib/print-routes";
import { acknowledgeAndOpenWaiterCall } from "../lib/waiter-call-workflow";
import { operationalRefreshIntervalMs } from "../lib/operational-refresh";
import { canChangeDiscount, discountPayload } from "../lib/discount-workflow";
import { createWaiterCallSoundObserver } from "../lib/waiter-call-sound";
import {
  englishNumber,
  formatOrderNumber,
  formatToman,
  positiveIntegerAmount,
  settlementAllocationAmount,
  settlementAvailability,
  sumAmounts,
  weightedPricePreview,
} from "../lib/pos-utils";
import { AccountingIcon, CheckIcon, AlertIcon, ServiceBellIcon, BagIcon, ClockIcon, CloseIcon, CupIcon, MenuIcon, RefreshIcon, TableIcon, WifiIcon } from "./icons";
import type { PosActivity } from "./release-update-guard";
import { useTerminalPayment, TerminalPaymentStatus } from "./terminal-payment";
import { ProductPicker } from "./product-picker";

type Channel = "TABLE" | "TAKEAWAY";
type OrderDetail = PosOrderDetail;
type Option = PosCatalogProduct["optionGroups"][number]["options"][number];
type Draft = { key: string; product: PosCatalogProduct; options: Option[]; quantity: number; weightGrams: number | null; note: string };
type SavedDraft = { id: string; productId: string; name: string; quantity: number; originalQuantity: number; weightGrams: number | null; pricingModeSnapshot: "FIXED" | "WEIGHTED_PER_KG"; note: string; originalNote: string | null; options: Array<{ optionId: string; quantity: number }>; lineTotalAmount: number };
type ProductCard = { key: string; name: string; products: PosCatalogProduct[] };
type Data = {
  catalog: PosCatalogCategory[];
  tables: PosTable[];
  tableSeatingLimitMinutes: number | null;
  calls: Array<{ tableId: string; tableName: string; version: number; requestedAt: string }>;
  openOrders: Array<{ id: string; tableId: string | null; channel: Channel; paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID"; dailyOrderNumber: number; totalAmount: number; balanceAmount: number }>;
};
type PendingTableClear = { tableId: string; tableName: string; dailyOrderNumber: number; error: string };
type PendingTransfer = { order: OrderDetail; source: PosTable; destination: PosTable; swaps: boolean };
type TenderMethod = "CASH" | "CARD_TERMINAL" | "CARD_TRANSFER";
type TenderDraft = { id: string; method: TenderMethod; amount: string; reference: string };
type DiscountTarget = { type: "order" } | { type: "item"; id: string; name: string };
const productConfigurationKey = (productId: string, options: Array<{ id: string }>, weightGrams: number | null = null) =>
  `${productId}:${options.map((option) => option.id).sort().join(",")}:${weightGrams ?? ""}`;
const requestKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const shotName = /^(.*)\s(سینگل|دبل)$/;

function productCards(products: PosCatalogProduct[]): ProductCard[] {
  const grouped = new Map<string, PosCatalogProduct[]>();
  products.forEach((product) => {
    const match = product.name.match(shotName);
    const key = match ? `shot:${match[1]}` : `product:${product.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), product]);
  });
  return [...grouped.entries()].map(([key, groupedProducts]) => ({
    key,
    name: key.startsWith("shot:") ? key.slice(5) : groupedProducts[0]!.name,
    products: groupedProducts,
  }));
}

function discountedDraftLineAmount(item: Draft): number {
  const optionAmount = sumAmounts(item.options.map((option) => option.priceAmount));
  const baseAmount = item.product.pricingMode === "WEIGHTED_PER_KG"
    ? weightedPricePreview(item.product.priceAmount, 0, item.weightGrams ?? 0, item.quantity)
    : item.product.priceAmount * item.quantity;
  const grossAmount = item.product.pricingMode === "WEIGHTED_PER_KG"
    ? baseAmount + weightedPricePreview(0, optionAmount, item.weightGrams ?? 0, item.quantity)
    : baseAmount + optionAmount * item.quantity;
  const saleDiscountAmount = !item.product.saleDiscountKind || !item.product.saleDiscountValue
    ? 0
    : item.product.saleDiscountKind === "PERCENTAGE"
      ? Math.floor(baseAmount * item.product.saleDiscountValue / 100)
      : item.product.pricingMode === "WEIGHTED_PER_KG"
        ? Math.floor(item.product.saleDiscountValue * (item.weightGrams ?? 0) * item.quantity / 1000)
        : item.product.saleDiscountValue * item.quantity;
  return saleDiscountAmount > 0
    ? Math.min(grossAmount, roundDiscountedAmount(Math.max(0, grossAmount - saleDiscountAmount)))
    : grossAmount;
}

function editedOrderTotal(order: OrderDetail, saved: SavedDraft[], draftTotal: number): number {
  const savedSubtotal = order.items.reduce((subtotal, item) => {
    const edit = saved.find((candidate) => candidate.id === item.id);
    if (!edit || edit.quantity <= 0) return subtotal;
    const optionAmount = item.options.reduce(
      (sum, option) => sum + option.priceSnapshot * (item.pricingModeSnapshot === "FIXED" && order.paymentStatus === "UNPAID" ? edit.quantity : option.quantity),
      0,
    );
    const grossAmount = item.pricingModeSnapshot === "WEIGHTED_PER_KG"
      ? Math.floor((item.basePriceSnapshot * (edit.weightGrams ?? 0) * edit.quantity) / 1000)
        + Math.floor((optionAmount * (edit.weightGrams ?? 0) * edit.quantity) / 1000)
      : item.basePriceSnapshot * edit.quantity + optionAmount;
    const requestedDiscount = item.discountKind === "PERCENTAGE" && item.discountValue
      ? Math.floor(grossAmount * item.discountValue / 100)
      : item.discountKind === "FIXED" ? item.discountValue ?? 0 : 0;
    const lineTotal = requestedDiscount > 0
      ? Math.min(grossAmount, roundDiscountedAmount(Math.max(0, grossAmount - requestedDiscount)))
      : grossAmount;
    return subtotal + lineTotal;
  }, 0);
  const subtotal = savedSubtotal + draftTotal;
  const requestedOrderDiscount = order.discountKind === "PERCENTAGE" && order.discountValue
    ? Math.floor(subtotal * order.discountValue / 100)
    : order.discountKind === "FIXED" ? order.discountValue ?? 0 : 0;
  return requestedOrderDiscount > 0
    ? Math.min(subtotal, roundDiscountedAmount(Math.max(0, subtotal - requestedOrderDiscount)))
    : subtotal;
}

function savedDrafts(order: OrderDetail | null): SavedDraft[] {
  return (order?.items ?? []).map((item) => ({
    id: item.id, productId: item.productId, name: item.productNameSnapshot,
    quantity: item.quantity, originalQuantity: item.quantity,
    weightGrams: item.weightGrams, pricingModeSnapshot: item.pricingModeSnapshot,
    note: item.note ?? "", originalNote: item.note,
    options: item.options.map((option) => ({ optionId: option.optionId, quantity: option.quantity })),
    lineTotalAmount: item.lineTotalAmount,
  }));
}

function clearDeskRecovery(channel: Channel, tableId: string | null, orderId: string | null) {
  const prefix = `desk:${channel}:${tableId ?? "takeaway"}:${orderId ?? "new"}`;
  for (const suffix of ["draft", "saved", "version", "create-key", "create-fingerprint", "checkout"]) writeRecovery(`${prefix}:${suffix}`, undefined);
}

function clearPaymentRecovery(orderId: string, version: number | null) {
  if (version === null) return;
  for (const suffix of ["tenders", "quantities"]) writeRecovery(`payment:${orderId}:${version}:new:${suffix}`, undefined);
}

export function OrdersWorkspace({
  refreshing,
  onActivityChange,
  onOpenMenu,
  menuOpen,
}: {
  refreshing: boolean;
  onActivityChange: (activity: PosActivity) => void;
  onOpenMenu: () => void;
  menuOpen: boolean;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [channel, setChannel] = useRecoveryState<Channel>("channel", "TABLE");
  const [selected, setSelected] = useState<PosTable | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [editingOrder, setEditingOrder] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: "error" | "notice"; text: string } | null>(null);
  const [pendingTableClear, setPendingTableClear] = useState<PendingTableClear | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [retryingTableClear, setRetryingTableClear] = useState(false);
  const [deskDirty, setDeskDirty] = useState(false);
  const [deskGeneration, setDeskGeneration] = useState(0);
  const [pendingChannel, setPendingChannel] = useState<Channel | null>(null);
  const [acknowledgingTableId, setAcknowledgingTableId] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [online, setOnline] = useState(true);
  const [liveDataLimited, setLiveDataLimited] = useState(false);
  const observeWaiterCalls = useRef(createWaiterCallSoundObserver());
  const submitDeskRef = useRef<(() => void) | null>(null);
  const restoredContext = useRef(readRecovery<{ tableId: string | null; orderId: string | null; version: number | null; editing: boolean; checkout: boolean }>("order-context"));
  const restorePending = useRef(Boolean(restoredContext.current));
  const [restoringContext, setRestoringContext] = useState(Boolean(restoredContext.current));
  useEffect(() => {
    if (!data || !restorePending.current) return;
    restorePending.current = false;
    const context = restoredContext.current!;
    const restoredOrderId = context.orderId;
    setSelected(data.tables.find(table => table.id === context.tableId) ?? null);
    if (!restoredOrderId) { setRestoringContext(false); return; }
    void readOrder(restoredOrderId).then(result => {
      if (!result.ok || result.data.state !== "OPEN") {
        clearDeskRecovery(channel, context.tableId, restoredOrderId);
        clearPaymentRecovery(restoredOrderId, context.version);
        setOrder(null);
        setEditingOrder(false);
        setCheckout(false);
        setRestoringContext(false);
        return;
      }
      const changed = result.data.version !== context.version;
      if (changed) {
        clearDeskRecovery(channel, context.tableId, restoredOrderId);
        clearPaymentRecovery(restoredOrderId, context.version);
      }
      setOrder(result.data);
      setEditingOrder(context.editing);
      setCheckout(context.checkout && !changed);
      setRestoringContext(false);
    });
  }, [data]);
  useEffect(() => {
    if (restorePending.current || restoringContext || loading) return;
    writeRecovery("order-context", { tableId: selected?.id ?? null, orderId: order?.id ?? null, version: order?.version ?? null, editing: editingOrder, checkout });
  }, [selected, order, editingOrder, checkout, loading, restoringContext]);
  const load = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setMessage(null);
    const [catalog, tables, calls, orders] = await Promise.all([
      readPosCatalog(),
      readPosTables(),
      readWaiterCalls(),
      readOpenOrders(),
    ]);
    if (!catalog.ok || !tables.ok) {
      const failure = !catalog.ok ? catalog.error : !tables.ok ? tables.error : null;
      setMessage({ tone: "error", text: failure?.message ?? "اطلاعات صندوق بارگذاری نشد." });
      setLoading(false);
      return false;
    }
    setData((current) => ({
      catalog: catalog.data,
      tables: tables.data.tables,
      tableSeatingLimitMinutes: tables.data.tableSeatingLimitMinutes,
      calls: calls.ok ? calls.data : current?.calls ?? [],
      openOrders: orders.ok ? orders.data : current?.openOrders ?? [],
    }));
    if (calls.ok) {
      observeWaiterCalls.current(calls.data);
    }
    setLiveDataLimited(!calls.ok || !orders.ok);
    setLoading(false);
    return true;
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    onActivityChange({
      // An opened table/takeaway workspace is deliberately conservative: it may
      // contain a draft, payment sheet, transfer, or browser-print interaction.
      isBusy: loading || Boolean(selected) || channel === "TAKEAWAY" || editingOrder || checkout || Boolean(pendingTableClear) || Boolean(pendingTransfer) || Boolean(pendingChannel) || transferring || retryingTableClear || acknowledgingTableId !== null,
      hasUnsavedChanges: deskDirty,
    });
  }, [acknowledgingTableId, channel, checkout, deskDirty, editingOrder, loading, onActivityChange, pendingChannel, pendingTableClear, pendingTransfer, retryingTableClear, selected, transferring]);
  useEffect(() => () => onActivityChange({ isBusy: true, hasUnsavedChanges: false }), [onActivityChange]);
  useEffect(() => {
    setOnline(navigator.onLine);
    const offline = () => {
      setOnline(false);
      setRecovery(recoveryStateFor({ kind: "network", message: "اتصال به سرویس برقرار نشد." }));
    };
    const online = () => {
      setOnline(true);
      setRecovery((current) => current?.kind === "offline" ? {
        kind: "offline",
        title: "اتصال دوباره برقرار شد",
        detail: "برای دیدن آخرین وضعیت، میزها و سفارش‌ها را دوباره از سرویس دریافت کنید.",
        action: "بازخوانی وضعیت",
      } : current);
    };
    const failure = (event: Event) => setRecovery(recoveryStateFor((event as CustomEvent<Parameters<typeof recoveryStateFor>[0]>).detail));
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    window.addEventListener(posApiFailureEvent, failure);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      window.removeEventListener(posApiFailureEvent, failure);
    };
  }, []);
  useEffect(() => {
    const show = (event: Event) => setMessage({ tone: "error", text: (event as CustomEvent<string>).detail });
    window.addEventListener(recoveryNoticeEvent, show);
    return () => window.removeEventListener(recoveryNoticeEvent, show);
  }, []);
  useEffect(() => {
    if (!recovery) return;
    return requestAutomaticRecovery();
  }, [recovery]);
  useEffect(() => {
    if (!data || loading || liveDataLimited || recovery || restoringContext) return;
    const healthy = window.setTimeout(finishRecoveryEpisode, 30_000);
    return () => window.clearTimeout(healthy);
  }, [data, loading, liveDataLimited, recovery, restoringContext]);
  const refreshOperationalData = useCallback(async () => {
    const [tables, calls, orders] = await Promise.all([readPosTables(), readWaiterCalls(), readOpenOrders()]);
    if (!tables.ok) {
      setLiveDataLimited(true);
      setMessage({ tone: "notice", text: "وضعیت میزها به‌روز نیست. برای دریافت اطلاعات تازه دوباره تلاش کنید." });
      return;
    }
    if (calls.ok) {
      observeWaiterCalls.current(calls.data);
    }
    setData((current) => current && {
      ...current,
      tables: tables.data.tables,
      tableSeatingLimitMinutes: tables.data.tableSeatingLimitMinutes,
      calls: calls.ok ? calls.data : current.calls,
      openOrders: orders.ok ? orders.data : current.openOrders,
    });
    setLiveDataLimited(!calls.ok || !orders.ok);
  }, []);
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void refreshOperationalData();
    };
    const interval = window.setInterval(refreshIfVisible, operationalRefreshIntervalMs);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshOperationalData]);
  const openTable = async (table: PosTable) => {
    const summary = data?.openOrders.find((item) => item.tableId === table.id);
    if (summary) {
      const result = await readOrder(summary.id);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error.message });
        return;
      }
      setOrder(result.data);
    } else setOrder(null);
    setSelected(table);
    setEditingOrder(false);
    setChannel("TABLE");
  };
  const handleWaiterCall = async (table: PosTable, call: Data["calls"][number]) => {
    setAcknowledgingTableId(table.id);
    setMessage(null);
    const result = await acknowledgeAndOpenWaiterCall({
      call,
      table,
      acknowledge: acknowledgeWaiterCall,
      refresh: refreshOperationalData,
      openTable,
    });
    setAcknowledgingTableId(null);
    if (result.status === "failed") {
      setMessage({ tone: "error", text: result.error.message });
      await refreshOperationalData();
      return;
    }
    setMessage({ tone: "notice", text: `به درخواست میز ${result.table.name} رسیدگی شد.` });
  };
  const close = () => {
    setSelected(null);
    setOrder(null);
    setEditingOrder(false);
  };
  const recover = async () => {
    setRecovering(true);
    const loaded = await load();
    let orderLoaded = true;
    if (loaded && order) {
      const latest = await readOrder(order.id);
      if (latest.ok) setOrder(latest.data);
      else if (latest.error.status === 404 || latest.error.code === "NOT_FOUND") close();
      else orderLoaded = false;
    }
    setRecovering(false);
    if (loaded && orderLoaded) {
      setOnline(true);
      setRecovery(null);
      finishRecoveryEpisode();
      setMessage({ tone: "notice", text: "اطلاعات صندوق از سرویس به‌روز شد." });
    }
  };
  if (loading) return <Loading />;
  if (!data) return <Failure onRetry={load} message={message?.text ?? "اطلاعات صندوق بارگذاری نشد."} />;
  return (
    <section className="pos-workspace">
      <header className="workspace-header">
        <div className="header-actions">
          <span className={`connection ${!online ? "connection--offline" : liveDataLimited || refreshing ? "connection--busy" : "connection--connected"}`} role="status" aria-label={!online ? "اتصال شبکه قطع است" : liveDataLimited ? "بخشی از اطلاعات به‌روز نیست" : refreshing ? "در حال دریافت اطلاعات تازه" : "اتصال برقرار است"}>
            <WifiIcon />
            <span title={!online ? "اتصال شبکه در دسترس نیست." : liveDataLimited ? "بخشی از اطلاعات به‌روز نیست. برای دریافت دوباره، دکمه‌ی تازه‌سازی را بزنید." : refreshing ? "در حال دریافت اطلاعات تازه…" : "اتصال برقرار است"}>
              {!online ? "قطع ارتباط" : liveDataLimited ? "اطلاعات ناقص" : refreshing ? "در حال به‌روزرسانی" : "متصل"}
            </span>
          </span>
          <button className={`icon-button refresh-button${refreshing ? " is-refreshing" : ""}`} onClick={() => void load()} aria-label="تازه‌سازی وضعیت" title="تازه‌سازی وضعیت">
            <RefreshIcon />
          </button>
          <button
            className="menu-button"
            type="button"
            aria-label="باز کردن منو"
            aria-expanded={menuOpen}
            onClick={onOpenMenu}
          >
            <MenuIcon />
          </button>
        </div>
        {(message || recovery || pendingTableClear) && (
          <div className="workspace-header__notices" aria-label="پیام‌های وضعیت">
            {message && (
              <div
                className={"toast toast--" + message.tone}
                role={message.tone === "error" ? "alert" : "status"}
              >
                <AlertIcon />
                {message.text}
                <button onClick={() => setMessage(null)} aria-label="بستن پیام">×</button>
              </div>
            )}
            {recovery && (
              <section className={"recovery-banner recovery-banner--" + recovery.kind} role={recovery.kind === "conflict" ? "alert" : "status"} aria-live="polite">
                <AlertIcon />
                <div>
                  <b>{recovery.title}</b>
                  <span>{recovery.detail}</span>
                </div>
                <button className="button button--quiet" type="button" disabled={recovering || (!online && recovery.kind === "offline")} onClick={() => void recover()}>
                  {recovering ? "در حال بازخوانی…" : recovery.action}
                </button>
                <button className="recovery-banner__close" type="button" aria-label="بستن پیام بازیابی" onClick={() => setRecovery(null)}>×</button>
              </section>
            )}
            {pendingTableClear && (
              <section className="clear-retry" role="alert" aria-live="assertive">
                <div>
                  <b>سفارش {formatOrderNumber(pendingTableClear.dailyOrderNumber)} از فهرست فعال حذف شد.</b>
                  <span>
                    میز {pendingTableClear.tableName} هنوز اشغال است و نشست مهمان قبلی پایان نیافته است: {pendingTableClear.error}
                  </span>
                </div>
                <button
                  className="button button--primary"
                  type="button"
                  disabled={retryingTableClear}
                  onClick={async () => {
                    setRetryingTableClear(true);
                    const result = await makeTableAvailable(pendingTableClear.tableId);
                    setRetryingTableClear(false);
                    if (!result.ok) {
                      setPendingTableClear({ ...pendingTableClear, error: result.error.message });
                      return;
                    }
                    setPendingTableClear(null);
                    await load();
                    setMessage({ tone: "notice", text: "میز " + pendingTableClear.tableName + " آماده پذیرش شد." });
                  }}
                >
                  {retryingTableClear ? "در حال آزادسازی…" : "تلاش دوباره برای آماده‌کردن میز"}
                </button>
              </section>
            )}
          </div>
        )}
        {selected && channel === "TABLE" ? (
          <div className="active-table-context" dir="rtl" aria-label="میز انتخاب‌شده">
            <TableIcon />
            <span className="active-table-context__label">
              <b>میز {selected.name.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!)}</b>
              <small>{order ? (editingOrder ? "ویرایش سفارش" : formatOrderNumber(order.dailyOrderNumber)) : "سفارش تازه"}</small>
            </span>
            <button type="button" aria-label="بستن میز انتخاب‌شده" onClick={() => {
              if (deskDirty) { setPendingChannel("TABLE"); return; }
              close();
            }}><CloseIcon /></button>
          </div>
        ) : channel === "TAKEAWAY" ? (
          <div className="active-table-context" dir="rtl" aria-label="سفارش بیرون‌بر">
            <BagIcon />
            <span className="active-table-context__label">
              <b>بیرون‌بر</b>
              <small>{order ? (editingOrder ? "ویرایش سفارش" : formatOrderNumber(order.dailyOrderNumber)) : "سفارش تازه"}</small>
            </span>
            <button type="button" aria-label="بستن سفارش بیرون‌بر" onClick={() => {
              if (deskDirty) { setPendingChannel("TABLE"); return; }
              setChannel("TABLE");
              setSelected(null);
              setOrder(null);
              setEditingOrder(false);
            }}><CloseIcon /></button>
          </div>
        ) : (
        <div className="channel-tabs" role="tablist" aria-label="نوع سفارش">
          <button
            className={channel === "TABLE" ? "active" : ""}
            onClick={() => {
              if (deskDirty) { setPendingChannel("TABLE"); return; }
              setChannel("TABLE");
              close();
            }}
          >
            <TableIcon /> سالن
          </button>
          <button
            className=""
            onClick={() => {
              if (deskDirty) { setPendingChannel("TAKEAWAY"); return; }
              setChannel("TAKEAWAY");
              setSelected(null);
              setOrder(null);
            }}
          >
            <BagIcon /> بیرون‌بر
          </button>
        </div>
        )}
      </header>
      {editingOrder || (selected && !order) || channel === "TAKEAWAY" ? (
        <OrderDesk
          key={`${channel}:${selected?.id ?? "takeaway"}:${order?.id ?? "new"}:${deskGeneration}`}
          catalog={data.catalog}
          table={selected}
          channel={channel}
          initialOrder={order}
          takeawayOrders={data.openOrders.filter((item) => item.channel === "TAKEAWAY" && item.paymentStatus !== "PAID")}
          onOpenTakeaway={async (orderId) => {
            const result = await readOrder(orderId);
            if (result.ok && result.data.state === "OPEN") setOrder(result.data);
            else if (result.ok) { setOrder(null); await load(); setMessage({ tone: "notice", text: "این سفارش بسته شده است و دیگر نمی‌توانید آن را ویرایش کنید." }); }
            else setMessage({ tone: "error", text: result.error.message });
          }}
          onOrder={async (updated) => {
            if (channel === "TAKEAWAY" && updated?.state === "CLOSED") {
              setOrder(null);
              await load();
              setMessage({ tone: "notice", text: "پرداخت ثبت شد و سفارش بیرون‌بر بسته شد." });
              return;
            }
            if (channel === "TABLE" && editingOrder) {
              close();
              void refreshOperationalData();
              return;
            }
            setOrder(updated);
            await load();
          }}
          onDone={async (notice) => {
            close();
            await load();
            setMessage({ tone: "notice", text: notice });
          }}
          onTableClearNeeded={(clear) => {
            setPendingTableClear(clear);
            close();
          }}
          onCreateFailure={async (error) => {
            close();
            await load();
            setMessage({ tone: "error", text: error });
          }}
          onDirtyChange={setDeskDirty}
          onSubmitReady={(submit) => { submitDeskRef.current = submit; }}
          onCloseTakeawayPanel={() => setOrder(null)}
        />
      ) : (
        <TableBoard
          tables={data.tables}
          tableSeatingLimitMinutes={data.tableSeatingLimitMinutes}
          calls={data.calls}
          orders={data.openOrders}
          selectedTableId={selected?.id ?? null}
          selectedOrder={order}
          onSelect={openTable}
          onAcknowledgeWaiterCall={handleWaiterCall}
          acknowledgingTableId={acknowledgingTableId}
          onMakeAvailable={async (table) => {
            const result = await makeTableAvailable(table.id);
            if (!result.ok) {
              setMessage({ tone: "error", text: result.error.message });
              return;
            }
            await refreshOperationalData();
            setMessage({ tone: "notice", text: `میز ${result.data.name} آزاد شد.` });
          }}
          onClosePanel={close}
          onEditOrder={() => setEditingOrder(true)}
          onCheckout={() => setCheckout(true)}
          onPrint={(kind) => {
            void printDocument(printRoute(order!.id, kind)).catch((error: unknown) => {
              setMessage({ tone: "error", text: error instanceof Error ? error.message : "سند چاپ آماده نشد." });
            });
          }}
          onRequestTransfer={async (source, destination) => {
            let sourceOrder: OrderDetail | null = order?.tableId === source.id ? order : null;
            if (!sourceOrder) {
              const result = await readOrder(source.activeOrders[0]!.id);
              if (!result.ok) {
                setMessage({ tone: "error", text: result.error.message });
                return;
              }
              sourceOrder = result.data;
            }
            setPendingTransfer({ order: sourceOrder, source, destination, swaps: destination.activeOrders.length > 0 });
          }}
        />
      )}
      {pendingTransfer && (
        <TransferTableDialog
          transfer={pendingTransfer}
          busy={transferring}
          onCancel={() => setPendingTransfer(null)}
          onConfirm={async () => {
            setTransferring(true);
            const result = await transferOrderTable(pendingTransfer.order.id, {
              expectedVersion: pendingTransfer.order.version,
              tableId: pendingTransfer.destination.id,
            });
            setTransferring(false);
            if (!result.ok) {
              setMessage({ tone: "error", text: result.error.message });
              return;
            }
            setPendingTransfer(null);
            close();
            await load();
            setMessage({
              tone: "notice",
              text: pendingTransfer.swaps
                ? `سفارش‌های میز ${pendingTransfer.source.name} و میز ${pendingTransfer.destination.name} جابه‌جا شدند.`
                : `سفارش میز ${pendingTransfer.source.name} به میز ${pendingTransfer.destination.name} منتقل شد.`,
            });
          }}
        />
      )}
      {pendingChannel && (
        <LeaveDraftDialog
          busy={false}
          onContinue={() => setPendingChannel(null)}
          onDiscard={() => {
            clearDeskRecovery(channel, selected?.id ?? null, order?.id ?? null);
            if (order) clearPaymentRecovery(order.id, order.version);
            writeRecovery("order-context", { tableId: null, orderId: null, version: null, editing: false, checkout: false });
            setDeskDirty(false); setDeskGeneration((generation) => generation + 1); setChannel(pendingChannel); setSelected(null); setOrder(null); setEditingOrder(false); setCheckout(false); setPendingChannel(null);
          }}
          onSubmit={() => { submitDeskRef.current?.(); setPendingChannel(null); }}
        />
      )}
      {checkout && order && (
        <SettlementSheet
          order={order}
          onClose={() => setCheckout(false)}
          onSuccess={async (updated) => {
            setCheckout(false);
            if (updated.state === "CLOSED") {
              setMessage({ tone: "notice", text: "پرداخت ثبت شد و میز آزاد شد." });
              close();
              await load();
              return;
            }
            setOrder(updated);
          }}
        />
      )}
    </section>
  );
}

export function TableBoard({
  tables,
  tableSeatingLimitMinutes,
  calls,
  orders,
  selectedTableId,
  selectedOrder,
  onSelect,
  onAcknowledgeWaiterCall,
  acknowledgingTableId,
  onMakeAvailable,
  onClosePanel,
  onEditOrder,
  onCheckout,
  onPrint,
  onRequestTransfer,
}: {
  tables: PosTable[];
  tableSeatingLimitMinutes: number | null;
  calls: Data["calls"];
  orders: Data["openOrders"];
  selectedTableId: string | null;
  selectedOrder: OrderDetail | null;
  onSelect: (table: PosTable) => void;
  onAcknowledgeWaiterCall: (table: PosTable, call: Data["calls"][number]) => void;
  acknowledgingTableId: string | null;
  onMakeAvailable: (table: PosTable) => Promise<void>;
  onClosePanel: () => void;
  onEditOrder: () => void;
  onCheckout: () => void;
  onPrint: (kind: Exclude<PrintKind, "settlement">) => void;
  onRequestTransfer: (source: PosTable, destination: PosTable) => Promise<void>;
}) {
  const [transferSourceId, setTransferSourceId] = useState<string | null>(null);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [dragDestinationId, setDragDestinationId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const transferDragTimer = useRef<number | null>(null);
  const pointerStart = useRef<{ id: number; x: number; y: number } | null>(null);
  const transferDrag = useRef<{ sourceId: string; pointerId: number } | null>(null);
  const dragDestination = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const cancelTransferDragHold = () => {
    if (transferDragTimer.current !== null) window.clearTimeout(transferDragTimer.current);
    transferDragTimer.current = null;
  };
  const endTransferDrag = (destinationId: string | null) => {
    const drag = transferDrag.current;
    if (!drag) return;
    const source = tables.find((item) => item.id === drag.sourceId);
    const destination = destinationId ? tables.find((item) => item.id === destinationId) : null;
    transferDrag.current = null;
    dragDestination.current = null;
    setDraggingTableId(null);
    setDragDestinationId(null);
    suppressClick.current = true;
    if (!source || !source.activeOrders[0] || !destination || source.id === destination.id || calls.some((call) => call.tableId === destination.id)) return;
    void onRequestTransfer(source, destination);
  };
  useEffect(() => {
    const refreshClock = () => setNow(Date.now());
    const timer = window.setInterval(refreshClock, 1_000);
    document.addEventListener("visibilitychange", refreshClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshClock);
    };
  }, []);
  const tableElapsedLabel = (createdAt: string) => {
    const startedAt = Date.parse(createdAt);
    const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1_000)) : 0;
    const hours = Math.floor(elapsedSeconds / 3_600);
    const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  };
  const totals = new Map(orders.filter((x) => x.tableId).map((x) => [x.tableId!, x.totalAmount]));
  return (
    <div role="region" aria-label="مدیریت میزها" className={selectedOrder ? "table-board table-board--inspecting" : "table-board"}>
      {selectedOrder && (
        <>
          <button
            className="panel-scrim"
            type="button"
            aria-label="بستن جزئیات سفارش"
            onClick={onClosePanel}
          />
          <OccupiedTablePanel
            table={tables.find((table) => table.id === selectedTableId) ?? null}
            order={selectedOrder}
            onClose={onClosePanel}
            onEdit={onEditOrder}
            onCheckout={onCheckout}
            onPrint={onPrint}
            onTransfer={() => {
              setTransferSourceId(selectedOrder.tableId);
              requestAnimationFrame(() => document.getElementById("table-transfer-targets")?.focus());
            }}
          />
        </>
      )}
      <div className="table-board__content">
      {transferSourceId && <p className="table-transfer-hint" role="status">میز مقصد را انتخاب کنید. میزی را که درخواست میزبان دارد نمی‌توانید انتخاب کنید.</p>}
      <div className="table-grid" id="table-transfer-targets" tabIndex={-1}>
        {tables.map((table) => {
          const hasOrder = table.activeOrders.length > 0;
          const call = calls.find((item) => item.tableId === table.id);
          const state = call
            ? "call"
            : hasOrder
              ? "order"
              : table.occupancyState === "OCCUPIED"
                ? "occupied"
                : "available";
          return (
            <article
              key={table.id}
              data-table-id={table.id}
              className={`table-tile table-tile--${state}${selectedTableId === table.id ? " is-selected" : ""}${draggingTableId === table.id ? " is-dragging" : ""}${dragDestinationId === table.id ? " is-drag-target" : ""}`}
            >
              <button className="table-tile__main" disabled={Boolean(call)} onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => {
                pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                suppressClick.current = false;
                if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
                if (hasOrder && !call) {
                  const startDrag = () => {
                    transferDrag.current = { sourceId: table.id, pointerId: event.pointerId };
                    setDraggingTableId(table.id);
                  };
                  if (event.pointerType === "touch" || event.pointerType === "pen") {
                    transferDragTimer.current = window.setTimeout(startDrag, 420);
                  }
                }
              }} onPointerMove={(event) => {
                const start = pointerStart.current;
                if (!start || start.id !== event.pointerId) return;
                const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10;
                if (moved) {
                  if (!transferDrag.current) cancelTransferDragHold();
                }
                if (hasOrder && !call && !transferDrag.current && moved && event.pointerType === "mouse") {
                  transferDrag.current = { sourceId: table.id, pointerId: event.pointerId };
                  setDraggingTableId(table.id);
                }
                const drag = transferDrag.current;
                if (drag?.pointerId === event.pointerId) {
                  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-table-id]")?.dataset.tableId ?? null;
                  const destination = target && target !== drag.sourceId && !calls.some((item) => item.tableId === target) ? target : null;
                  dragDestination.current = destination;
                  setDragDestinationId(destination);
                }
              }} onPointerUp={(event) => {
                cancelTransferDragHold();
                if (transferDrag.current?.pointerId === event.pointerId) {
                  endTransferDrag(dragDestination.current);
                }
                pointerStart.current = null;
              }} onPointerCancel={(event) => {
                cancelTransferDragHold();
                if (transferDrag.current?.pointerId === event.pointerId) endTransferDrag(null);
                pointerStart.current = null;
              }} onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                const source = tables.find((item) => item.id === transferSourceId);
                if (source && source.id !== table.id && !call) {
                  setTransferSourceId(null);
                  void onRequestTransfer(source, table);
                  return;
                }
                void onSelect(table);
              }} aria-pressed={selectedTableId === table.id}>
                <span className={`table-tile__top${Array.from(table.name).length > 1 ? " table-tile__top--compact" : ""}`}>
                  <strong>{table.name}</strong>
                </span>
                <span className="table-tile__details">
                  <span className="table-status">{call && <span className="table-status__alert" aria-hidden="true"><ServiceBellIcon /></span>}<i />{call ? "درخواست میزبان" : hasOrder ? "سفارش باز" : table.occupancyState === "OCCUPIED" ? "اشغال‌شده" : "آزاد"}</span>
                  {hasOrder && <span className="table-tile__meta table-tile__meta--order-time table-tile__meta--live-time"><ClockIcon />{tableElapsedLabel(table.activeOrders[0]!.createdAt)}</span>}
                  {call && <span className="table-tile__meta table-tile__meta--live-time">{tableElapsedLabel(call.requestedAt)} از ثبت درخواست</span>}
                  {!hasOrder && !call && <span className="table-tile__meta table-tile__meta--live-time">{table.occupiedAt ? tableElapsedLabel(table.occupiedAt) : "آماده پذیرش"}</span>}
{hasOrder && <span className="table-tile__amount"><b>{formatToman(totals.get(table.id) ?? 0)}</b></span>}
                </span>
              </button>
              {call && (
                <button
                  className="table-tile__call-action"
                  type="button"
                  disabled={acknowledgingTableId === table.id}
                  aria-label={`بازکردن میز ${table.name} و ثبت رسیدگی به درخواست`}
                  onClick={() => void onAcknowledgeWaiterCall(table, call)}
                >
                  {acknowledgingTableId === table.id ? "در حال ثبت رسیدگی…" : "رسیدگی"}
                </button>
              )}
              {!call && !hasOrder && table.occupancyState === "OCCUPIED" && (
                <button
                  className="table-tile__call-action"
                  type="button"
                  aria-label={`آزاد کردن میز ${table.name}`}
                  onClick={() => void onMakeAvailable(table)}
                >
                  آزاد کردن میز
                </button>
              )}
            </article>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function OccupiedTablePanel({ table, order, onClose, onEdit, onCheckout, onPrint, onTransfer, title, closeButtonRef }: { table: PosTable | null; order: OrderDetail; onClose: () => void; onEdit: () => void; onCheckout: () => void; onPrint: (kind: Exclude<PrintKind, "settlement">) => void; onTransfer?: () => void; title?: string; closeButtonRef?: RefObject<HTMLButtonElement | null> }) {
  const status = order.paymentStatus === "PAID" ? "تسویه‌شده" : order.paymentStatus === "PARTIALLY_PAID" ? "بخشی پرداخت‌شده" : "پرداخت‌نشده";
  const settledQuantities = new Map<string, number>();
  const settledAmounts = new Map<string, number>();
  order.settlements.filter((settlement) => !settlement.reversedAt).forEach((settlement) => {
    settlement.allocations.forEach((allocation) => {
      settledAmounts.set(allocation.orderItemId, (settledAmounts.get(allocation.orderItemId) ?? 0) + allocation.amount);
      if (allocation.quantity > 0) {
        settledQuantities.set(allocation.orderItemId, (settledQuantities.get(allocation.orderItemId) ?? 0) + allocation.quantity);
      }
    });
  });
  let subtotalBeforeItem = 0;
  const payableAmounts = new Map<string, number>();
  order.items.forEach((item) => {
    const discountBefore = order.subtotalAmount > 0
      ? Math.floor(order.discountAmount * subtotalBeforeItem / order.subtotalAmount)
      : 0;
    subtotalBeforeItem += item.lineTotalAmount;
    const discountAfter = order.subtotalAmount > 0
      ? Math.floor(order.discountAmount * subtotalBeforeItem / order.subtotalAmount)
      : 0;
    payableAmounts.set(item.id, item.lineTotalAmount - (discountAfter - discountBefore));
  });
  const renderItemLine = (item: OrderDetail["items"][number], quantity: number, amount: number, settled: boolean) => (
    <div className={`occupied-panel__item${settled ? " occupied-panel__item--settled" : ""}`} key={`${item.id}-${settled ? "settled" : "unsettled"}`} role="listitem" aria-label={`${item.productNameSnapshot} × ${englishNumber.format(quantity)}${settled ? "، تسویه‌شده" : "، پرداخت‌نشده"}`}>
      <div>
        <b>{item.productNameSnapshot} {item.pricingModeSnapshot === "WEIGHTED_PER_KG" && item.weightGrams ? <small>{englishNumber.format(item.weightGrams)} گرم × </small> : <small>× </small>}<span className="occupied-panel__quantity">{englishNumber.format(quantity)}</span></b>
        {item.options.length > 0 && <span>{item.options.map((option) => option.optionNameSnapshot).join("، ")}</span>}
      </div>
      <strong>{formatToman(amount)}</strong>
    </div>
  );
  const unpaidLines: ReactNode[] = [];
  const settledLines: ReactNode[] = [];
  order.items.forEach((item) => {
    const settledQuantity = Math.min(item.quantity, settledQuantities.get(item.id) ?? 0);
    if (settledQuantity === 0) {
      unpaidLines.push(renderItemLine(item, item.quantity, item.lineTotalAmount, false));
      return;
    }
    const payableAmount = payableAmounts.get(item.id) ?? item.lineTotalAmount;
    const settledAmount = Math.min(payableAmount, settledAmounts.get(item.id) ?? 0);
    settledLines.push(renderItemLine(item, settledQuantity, settledAmount, true));
    const remainingQuantity = item.quantity - settledQuantity;
    if (remainingQuantity > 0) {
      unpaidLines.push(renderItemLine(item, remainingQuantity, payableAmount - settledAmount, false));
    }
  });
  return <aside className="occupied-panel" aria-label={title ? `جزئیات ${title}` : `جزئیات سفارش میز ${table?.name ?? ""}`}>
    <header className="occupied-panel__header">
      <button className="icon-button" type="button" ref={closeButtonRef} onClick={onClose} aria-label="بستن جزئیات"><CloseIcon /></button>
      <div className="occupied-panel__heading">
        <h2>{title ?? `میز ${table?.name}`}</h2>
        <span className="status-badge">{status}</span>
      </div>
    </header>
    <div className="occupied-panel__items" role="list" aria-label="اقلام سفارش">
      {unpaidLines}
      {settledLines}
    </div>
    <footer className="occupied-panel__footer">
      <div className="occupied-panel__total"><span>جمع کل</span><strong>{formatToman(order.totalAmount)}</strong></div>
      {order.paidAmount > 0 && <div className="occupied-panel__balance">مانده‌ی پرداخت: {formatToman(order.balanceAmount)}</div>}
      <button className="button button--primary button--wide" disabled={order.balanceAmount === 0} onClick={onCheckout}>ثبت پرداخت</button>
      <div className="occupied-panel__tickets">
        <button className="button button--quiet button--wide" onClick={() => onPrint("bar-ticket")}>چاپ فیش بار</button>
        <button className="button button--quiet button--wide" onClick={() => onPrint("receipt")}>چاپ رسید</button>
      </div>
      <button className="button button--quiet button--wide occupied-panel__edit" onClick={onEdit}>ویرایش سفارش</button>
      {onTransfer && <button className="button button--quiet button--wide occupied-panel__transfer" onClick={onTransfer}>انتقال سفارش به میز دیگر</button>}
    </footer>
  </aside>;
}

export function OrderDesk({
  catalog,
  table,
  channel,
  initialOrder,
  onOrder,
  onDone,
  onTableClearNeeded,
  onCreateFailure,
  onDirtyChange,
  onSubmitReady,
  takeawayOrders,
  onOpenTakeaway,
  onCloseTakeawayPanel,
}: {
  catalog: PosCatalogCategory[];
  table: PosTable | null;
  channel: Channel;
  initialOrder: OrderDetail | null;
  onOrder: (order: OrderDetail | null) => Promise<void>;
  onDone: (message: string) => void;
  onTableClearNeeded: (clear: PendingTableClear) => void;
  onCreateFailure: (error: string) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onSubmitReady: (submit: () => void) => void;
  takeawayOrders: Data["openOrders"] | null;
  onOpenTakeaway: (orderId: string) => Promise<void>;
  onCloseTakeawayPanel: () => void;
}) {
  const posCatalog = useMemo(
    () => catalog.filter((item) => item.name !== "ویژه و جدید"),
    [catalog],
  );
  const recoveryPrefix = `desk:${channel}:${table?.id ?? "takeaway"}:${initialOrder?.id ?? "new"}`;
  const restoredVersion = useRef(readRecovery<number>(`${recoveryPrefix}:version`));
  const [categoryId, setCategoryId] = useState("");
  const categoryNavRef = useRef<HTMLElement>(null);
  const categoryListRef = useRef<HTMLDivElement>(null);
  const categoryDragRef = useRef<{ start: number; scroll: number } | null>(null);
  const [categoryScroll, setCategoryScroll] = useState({ horizontal: false, visible: false, thumb: 100, position: 0, maximum: 0 });
  const [draft, setDraft] = useRecoveryState<Draft[]>(`${recoveryPrefix}:draft`, []);
  const [saved, setSaved] = useRecoveryState<SavedDraft[]>(`${recoveryPrefix}:saved`, () => savedDrafts(initialOrder));
  const [createAttemptKey, setCreateAttemptKey] = useRecoveryState<string>(`${recoveryPrefix}:create-key`, requestKey);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useRecoveryState(`${recoveryPrefix}:checkout`, false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [discountTarget, setDiscountTarget] = useState<DiscountTarget | null>(null);
  const discountTriggerRef = useRef<HTMLElement | null>(null);
  const takeawayCloseRef = useRef<HTMLButtonElement>(null);
  const takeawayOrderPanelOpen = channel === "TAKEAWAY" && initialOrder !== null;
  const [takeawayEditing, setTakeawayEditing] = useState(false);
  const previousDeskOrder = useRef(`${initialOrder?.id ?? "new"}:${initialOrder?.version ?? 0}`);
  useEffect(() => {
    const identity = `${initialOrder?.id ?? "new"}:${initialOrder?.version ?? 0}`;
    if (previousDeskOrder.current === identity) { writeRecovery(`${recoveryPrefix}:version`, initialOrder?.version ?? 0); return; }
    previousDeskOrder.current = identity;
    setTakeawayEditing(false);
    restoredVersion.current = initialOrder?.version ?? 0;
    writeRecovery(`${recoveryPrefix}:version`, initialOrder?.version ?? 0);
    setSaved(savedDrafts(initialOrder));
    setDraft([]);
    setCreateAttemptKey(requestKey());
  }, [initialOrder?.id, initialOrder?.version]);
  const savedIdsMatchOrder = !initialOrder || (initialOrder.items.length === saved.length && initialOrder.items.every((item) => saved.some((candidate) => candidate.id === item.id)));
  const recoveredVersionIsStale = Boolean(initialOrder) && restoredVersion.current !== undefined && restoredVersion.current !== initialOrder?.version;
  const recoveredEditorIsDirty = draft.length > 0 || saved.some((item) => item.quantity !== item.originalQuantity || item.note !== (item.originalNote ?? ""));
  const discardRecoveredEdits = Boolean(initialOrder) && (recoveredVersionIsStale || (!savedIdsMatchOrder && recoveredEditorIsDirty));
  const draftForOrder = discardRecoveredEdits ? [] : draft;
  const savedForOrder = initialOrder && (!savedIdsMatchOrder || discardRecoveredEdits) ? savedDrafts(initialOrder) : saved;
  const category = posCatalog.find((x) => x.id === categoryId) ?? posCatalog[0];
  const cards = useMemo(() => productCards(category?.products ?? []), [category?.products]);
  useEffect(() => {
    const nav = categoryNavRef.current;
    const list = categoryListRef.current;
    if (!nav || !list) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const horizontal = window.matchMedia?.("(max-width: 680px)").matches ?? window.innerWidth <= 680;
      const viewport = horizontal ? list.clientWidth : nav.clientHeight;
      const content = horizontal ? list.scrollWidth : nav.scrollHeight;
      // RTL horizontal scrollers start at zero and move toward negative scrollLeft.
      const offset = horizontal ? -list.scrollLeft : nav.scrollTop;
      const maximum = Math.max(0, content - viewport);
      const thumb = content > 0 ? Math.min(100, viewport / content * 100) : 100;
      setCategoryScroll((previous) => {
        const next = { horizontal, visible: maximum > 1, thumb, position: maximum ? Math.max(0, Math.min(maximum, offset)) / maximum * (100 - thumb) : 0, maximum };
        return Object.keys(next).every((key) => next[key as keyof typeof next] === previous[key as keyof typeof previous]) ? previous : next;
      });
    };
    const scheduleMeasure = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    measure();
    nav.addEventListener("scroll", scheduleMeasure, { passive: true });
    list.addEventListener("scroll", scheduleMeasure, { passive: true });
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(nav); observer.observe(list);
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      nav.removeEventListener("scroll", scheduleMeasure);
      list.removeEventListener("scroll", scheduleMeasure);
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [posCatalog.length, channel]);
  const scrollCategoriesToPointer = (clientPosition: number, rect: DOMRect) => {
    const nav = categoryNavRef.current; const list = categoryListRef.current;
    if (!nav || !list) return;
    const trackSize = categoryScroll.horizontal ? rect.width : rect.height;
    const pointer = Math.max(0, Math.min(trackSize, clientPosition - (categoryScroll.horizontal ? rect.left : rect.top)));
    const progress = trackSize > 0 ? (categoryScroll.horizontal ? 1 - pointer / trackSize : pointer / trackSize) : 0;
    const thumbRatio = categoryScroll.thumb / 100;
    const max = categoryScroll.maximum;
    if (categoryScroll.horizontal) list.scrollLeft = -Math.max(0, Math.min(max, (progress - thumbRatio / 2) / (1 - thumbRatio) * max));
    else nav.scrollTop = Math.max(0, Math.min(max, (progress - thumbRatio / 2) / (1 - thumbRatio) * max));
  };
  const draftTotal = sumAmounts(draftForOrder.map(discountedDraftLineAmount));
  const orderTotal = initialOrder ? editedOrderTotal(initialOrder, savedForOrder, draftTotal) : draftTotal;
  const add = (product: PosCatalogProduct, options: Option[] = [], weightGrams: number | null = null) => {
    const signature = productConfigurationKey(product.id, options, weightGrams);
    setDraft((current) => {
      const found = current.find((x) => x.key === signature);
      return found
        ? current.map((x) => (x.key === signature ? { ...x, quantity: x.quantity + 1 } : x))
        : [...current, { key: signature, product, options, quantity: 1, weightGrams, note: "" }];
    });
    setExpandedCard(null);
  };
  const payloadItems = () =>
    draftForOrder.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      ...(item.weightGrams === null ? {} : { weightGrams: item.weightGrams }),
      ...(item.note.trim() ? { note: item.note.trim() } : {}),
      options: item.options.map((option) => ({
        optionId: option.id,
        // Fixed-price options apply to every unit in this grouped draft line.
        // Weighted prices multiply by item quantity in the API calculation,
        // so their option quantity remains one.
        quantity: item.product.pricingMode === "FIXED" ? item.quantity : 1,
      })),
    }));
  const createRequestFingerprint = JSON.stringify({
    channel,
    tableId: channel === "TABLE" ? table?.id ?? null : null,
    items: payloadItems(),
  });
  const attemptedCreateFingerprint = useRef(readRecovery<string>(`${recoveryPrefix}:create-fingerprint`));
  useEffect(() => {
    if (attemptedCreateFingerprint.current === undefined || attemptedCreateFingerprint.current === createRequestFingerprint) return;
    // Keep the key for an identical uncertain retry. A changed request needs a
    // new key so the API does not treat the edited draft as a conflicting replay.
    attemptedCreateFingerprint.current = undefined;
    writeRecovery(`${recoveryPrefix}:create-fingerprint`, undefined);
    setCreateAttemptKey(requestKey());
  }, [createRequestFingerprint]);
  const replacementItems = () => [
    ...savedForOrder.filter((item) => item.quantity > 0).map((item) => ({
      productId: item.productId, quantity: item.quantity,
      ...(item.weightGrams === null ? {} : { weightGrams: item.weightGrams }),
      ...(item.note.trim() ? { note: item.note.trim() } : {}),
      options: item.options.map((option) => ({
        ...option,
        quantity: item.pricingModeSnapshot === "FIXED" ? item.quantity : 1,
      })),
    })),
    ...payloadItems(),
  ];
  const dirty = draftForOrder.length > 0 || savedForOrder.some((item) => item.quantity !== item.originalQuantity || item.note !== (item.originalNote ?? ""));
  // Recovery storage can lag an authoritative order refresh. Render current
  // server snapshots immediately, then persist the reconciled editor state.
  useEffect(() => {
    if (!initialOrder || (savedIdsMatchOrder && !discardRecoveredEdits)) return;
    restoredVersion.current = initialOrder.version;
    writeRecovery(`${recoveryPrefix}:version`, initialOrder.version);
    writeRecovery(`${recoveryPrefix}:draft`, []);
    setSaved(savedDrafts(initialOrder));
    setDraft([]);
  }, [initialOrder?.id, initialOrder?.version, savedIdsMatchOrder, discardRecoveredEdits]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    return () => {
      onDirtyChange(false);
    };
  }, [onDirtyChange]);
  const printOrderDocument = async (orderId: string, kind: "bar-ticket" | "receipt") => {
    try {
      await printDocument(printRoute(orderId, kind));
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : "سند چاپ آماده نشد.");
    }
  };
  const finishSuccessfulSave = async (updatedOrder: OrderDetail, printAfterSave: "bar-ticket" | "receipt" | null = null) => {
    rememberItemNotes([...draftForOrder.map((item) => ({ productId: item.product.id, note: item.note })), ...savedForOrder.filter((item) => item.quantity > 0 && item.note !== (item.originalNote ?? "")).map((item) => ({ productId: item.productId, note: item.note }))]);
    setDraft([]);
    setSaved(initialOrder ? savedDrafts(updatedOrder) : []);
    writeRecovery(`${recoveryPrefix}:version`, initialOrder ? updatedOrder.version : 0);
    setCreateAttemptKey(requestKey());
    attemptedCreateFingerprint.current = undefined;
    writeRecovery(`${recoveryPrefix}:create-fingerprint`, undefined);
    if (!initialOrder) clearDeskRecovery(channel, table?.id ?? null, null);
    onDirtyChange(false);
    await onOrder(updatedOrder);
    if (printAfterSave) await printOrderDocument(updatedOrder.id, printAfterSave);
  };
  const save = async (printAfterSave: "bar-ticket" | "receipt" | null = null) => {
    const hasChanges = draftForOrder.length > 0 || savedForOrder.some((item) => item.quantity !== item.originalQuantity || item.note !== (item.originalNote ?? ""));
    if (!hasChanges) {
      if (printAfterSave && initialOrder) await printOrderDocument(initialOrder.id, printAfterSave);
      return;
    }
    setBusy(true);
    setError(null);
    if (initialOrder) {
      const isUnpaid = initialOrder.paymentStatus === "UNPAID";
      const changedSaved = savedForOrder.filter((item) => item.quantity !== item.originalQuantity || item.note !== (item.originalNote ?? ""));
      const result = await updateOpenOrder(initialOrder.id, isUnpaid
        ? { expectedVersion: initialOrder.version, items: replacementItems() }
        : {
            expectedVersion: initialOrder.version,
            ...(draftForOrder.length ? { addItems: payloadItems() } : {}),
            ...(changedSaved.length ? { itemUpdates: changedSaved.map((item) => ({ orderItemId: item.id, quantity: item.quantity })) } : {}),
          });
      if (!result.ok) {
        setBusy(false);
        setError(result.error.message);
        return;
      }
      await finishSuccessfulSave(result.data, printAfterSave);
      setBusy(false);
    } else {
      attemptedCreateFingerprint.current = createRequestFingerprint;
      writeRecovery(`${recoveryPrefix}:create-fingerprint`, createRequestFingerprint);
      const result = await createOpenOrder(
        channel === "TABLE"
          ? { channel, tableId: table!.id, items: payloadItems() }
          : { channel, items: payloadItems() },
        createAttemptKey,
        { requestId: requestKey(), ...(channel === "TABLE" ? { tableName: table!.name } : {}) },
      );
      if (!result.ok) {
        setBusy(false);
        setError(result.error.message);
        if (channel === "TABLE") await onCreateFailure(result.error.message);
        return;
      }
      rememberItemNotes(draftForOrder.map((item) => ({ productId: item.product.id, note: item.note })));
      const detail = await readOrder(result.data.id);
      if (!detail.ok) {
        setBusy(false);
        setError(detail.error.message);
        return;
      }
      await finishSuccessfulSave(detail.data, printAfterSave);
      setBusy(false);
    }
  };
  useEffect(() => { onSubmitReady(() => void save()); }, [onSubmitReady, save]);
  const remove = async () => {
    if (!initialOrder) return;
    const clearsTable = channel === "TABLE" && canClearTableAfterDeletion(table?.activeOrders.length);
    setBusy(true);
    setError(null);
    const result = await deleteAndClearTableOrder(
      () => deleteOpenOrder(initialOrder.id, { expectedVersion: initialOrder.version }),
      clearsTable && table ? () => makeTableAvailable(table.id) : null,
    );
    setBusy(false);
    if (result.status === "delete-failed") {
      setError(result.error.message);
      return;
    }
    setDeleteDialogOpen(false);
    if (result.status === "needs-table-clear" && table) {
      onTableClearNeeded({ tableId: table.id, tableName: table.name, dailyOrderNumber: initialOrder.dailyOrderNumber, error: result.error.message });
      return;
    }
    onDone(
      channel === "TABLE"
        ? clearsTable
          ? `سفارش حذف شد و میز ${table?.name} آماده پذیرش است.`
          : `سفارش حذف شد؛ میز ${table?.name} همچنان سفارش باز دارد.`
        : "سفارش از فهرست فعال حذف شد.",
    );
  };
  useEffect(() => {
    if (!takeawayOrderPanelOpen) return;
    takeawayCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCloseTakeawayPanel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCloseTakeawayPanel, takeawayOrderPanelOpen]);
  const orderPanel = takeawayOrderPanelOpen && !takeawayEditing && !dirty ? (
    <OccupiedTablePanel
      table={null}
      order={initialOrder}
      title={`سفارش ${formatOrderNumber(initialOrder.dailyOrderNumber)}`}
      closeButtonRef={takeawayCloseRef}
      onClose={onCloseTakeawayPanel}
      onEdit={() => setTakeawayEditing(true)}
      onCheckout={() => setCheckout(true)}
      onPrint={(kind) => {
        void printDocument(printRoute(initialOrder.id, kind)).catch((printError: unknown) => {
          setError(printError instanceof Error ? printError.message : "سند چاپ آماده نشد.");
        });
      }}
    />
  ) : (
    <aside className={`order-panel${takeawayOrderPanelOpen ? " order-panel--takeaway" : ""}`} aria-label={takeawayOrderPanelOpen ? `سفارش بیرون‌بر ${formatOrderNumber(initialOrder!.dailyOrderNumber)}` : "خلاصه سفارش"}>
      {takeawayOrderPanelOpen && <header className="order-panel__header">
        <button className="icon-button" type="button" ref={takeawayCloseRef} disabled={busy} onClick={onCloseTakeawayPanel} aria-label="بستن سفارش بیرون‌بر"><CloseIcon /></button>
        <div className="order-panel__heading">
          <h2>سفارش {formatOrderNumber(initialOrder!.dailyOrderNumber)}</h2>
          <span className="status-badge">{initialOrder!.paymentStatus === "PAID" ? "تسویه‌شده" : initialOrder!.paymentStatus === "PARTIALLY_PAID" ? "بخشی پرداخت‌شده" : "پرداخت‌نشده"}</span>
        </div>
      </header>}
      <OrderSummary
        order={initialOrder}
        draft={draftForOrder}
        saved={savedForOrder}
        canEditSaved={initialOrder?.paymentStatus === "UNPAID"}
        total={orderTotal}
        onQuantity={(key, value) =>
          setDraft((items) =>
            items.flatMap((item) =>
              item.key !== key
                ? [item]
                : item.quantity + value > 0
                  ? [{ ...item, quantity: item.quantity + value }]
                  : [],
            ),
          )
        }
        onSavedQuantity={(id, delta) => setSaved((items) => items.map((item) => item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item))}
        onSavedNote={(id, note) => setSaved((items) => items.map((item) => item.id === id ? { ...item, note } : item))}
        onDraftNote={(key, note) => setDraft((items) => items.map((item) => item.key === key ? { ...item, note } : item))}
        onSave={() => void save()}
        onConfirmAndPrint={(kind) => void save(kind)}
        onCheckout={() => setCheckout(true)}
        onPrint={(kind, settlementId) => {
          if (!initialOrder) return;
          void printDocument(printRoute(initialOrder.id, kind, settlementId)).catch((printError: unknown) => {
            setError(printError instanceof Error ? printError.message : "سند چاپ آماده نشد.");
          });
        }}
        onRequestDelete={() => setDeleteDialogOpen(true)}
        onRequestDiscount={(target) => { discountTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDiscountTarget(target); }}
        busy={busy}
      />
    </aside>
  );
  return (
    <>
      {error && (
        <div className="toast toast--error" role="alert">
          <AlertIcon />
          {error}
        </div>
      )}
      <div className={channel === "TAKEAWAY" ? "order-desk order-desk--takeaway" : "order-desk"}>
        {channel === "TAKEAWAY" && takeawayOrders && <aside className="takeaway-orders" aria-labelledby="takeaway-orders-title">
          <h2 id="takeaway-orders-title">سفارش‌های بیرون‌برِ تسویه‌نشده</h2>
          {takeawayOrders.length === 0 ? <p>سفارش تسویه‌نشده‌ای وجود ندارد.</p> : takeawayOrders.map((takeaway) => <button key={takeaway.id} type="button" className={initialOrder?.id === takeaway.id ? "is-selected" : ""} onClick={() => void onOpenTakeaway(takeaway.id)}><b>{formatOrderNumber(takeaway.dailyOrderNumber)}</b><span>مانده: {formatToman(takeaway.balanceAmount)}</span></button>)}
        </aside>}
        <aside className="desk-sidebar">
          <nav className="categories" aria-label="دسته‌های محصولات" ref={categoryNavRef}>
            <div className="categories__list" id="pos-category-list" ref={categoryListRef} onWheel={(event) => {
              if (categoryScroll.horizontal && Math.abs(event.deltaY) > Math.abs(event.deltaX) && categoryListRef.current) categoryListRef.current.scrollLeft -= event.deltaY;
            }}>
              {posCatalog.map((item) => (
                <button
                  key={item.id}
                  className={item.id === category?.id ? "active" : ""}
                  onClick={() => setCategoryId(item.id)}
                >
                  <span>{item.name}</span>
                  <small>{englishNumber.format(item.products.length)}</small>
                </button>
              ))}
            </div>
            {!categoryScroll.horizontal && categoryScroll.visible && <div className="categories__scrollbar" role="scrollbar" aria-label="دسته‌های محصولات" aria-controls="pos-category-list" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(categoryScroll.maximum)} aria-valuenow={Math.round(categoryScroll.maximum * categoryScroll.position / Math.max(1, 100 - categoryScroll.thumb))} tabIndex={0} onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect(); categoryDragRef.current = { start: event.clientY, scroll: categoryNavRef.current?.scrollTop ?? 0 }; event.currentTarget.setPointerCapture(event.pointerId); scrollCategoriesToPointer(event.clientY, rect);
            }} onPointerMove={(event) => { if (categoryDragRef.current) { const rect = event.currentTarget.getBoundingClientRect(); scrollCategoriesToPointer(event.clientY, rect); } }} onPointerUp={() => { categoryDragRef.current = null; }} onPointerCancel={() => { categoryDragRef.current = null; }} onKeyDown={(event) => {
              const nav = categoryNavRef.current; if (!nav) return;
              if (event.key === "ArrowDown") nav.scrollTop += 40; else if (event.key === "ArrowUp") nav.scrollTop -= 40; else if (event.key === "PageDown") nav.scrollTop += nav.clientHeight; else if (event.key === "PageUp") nav.scrollTop -= nav.clientHeight; else if (event.key === "Home") nav.scrollTop = 0; else if (event.key === "End") nav.scrollTop = nav.scrollHeight;
              else return; event.preventDefault();
            }}><span style={{ height: `${categoryScroll.thumb}%`, top: `${categoryScroll.position}%` }} /></div>}
            {categoryScroll.horizontal && categoryScroll.visible && <div className="categories__scrollbar" role="scrollbar" aria-label="دسته‌های محصولات" aria-controls="pos-category-list" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={Math.round(categoryScroll.maximum)} aria-valuenow={Math.round(categoryScroll.maximum * categoryScroll.position / Math.max(1, 100 - categoryScroll.thumb))} tabIndex={0} onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect(); categoryDragRef.current = { start: event.clientX, scroll: categoryListRef.current?.scrollLeft ?? 0 }; event.currentTarget.setPointerCapture(event.pointerId); scrollCategoriesToPointer(event.clientX, rect);
            }} onPointerMove={(event) => { if (categoryDragRef.current) { const rect = event.currentTarget.getBoundingClientRect(); scrollCategoriesToPointer(event.clientX, rect); } }} onPointerUp={() => { categoryDragRef.current = null; }} onPointerCancel={() => { categoryDragRef.current = null; }} onKeyDown={(event) => {
              const list = categoryListRef.current; if (!list) return;
              if (event.key === "ArrowRight") list.scrollLeft += 40; else if (event.key === "ArrowLeft") list.scrollLeft -= 40; else if (event.key === "PageDown") list.scrollLeft -= list.clientWidth; else if (event.key === "PageUp") list.scrollLeft += list.clientWidth; else if (event.key === "Home") list.scrollLeft = 0; else if (event.key === "End") list.scrollLeft = -categoryScroll.maximum;
              else return; event.preventDefault();
            }}><span style={{ width: `${categoryScroll.thumb}%`, right: `${categoryScroll.position}%`, left: "auto" }} /></div>}
          </nav>
        </aside>
        <section className="products">
          <div className="product-grid">
            {cards.map((card) => (
              <ProductPicker
                key={card.key}
                card={card}
                expanded={expandedCard === card.key}
                onOpen={() => setExpandedCard(card.key)}
                onClose={() => setExpandedCard(null)}
                onSelectOptions={(product, options, weightGrams) => add(product, options, weightGrams)}
                getQuantity={(product, options, weightGrams) => draftForOrder.find((item) => item.key === productConfigurationKey(product.id, options, weightGrams))?.quantity ?? 0}
                onDecrease={(product, options, weightGrams) => {
                  const key = productConfigurationKey(product.id, options, weightGrams);
                  setDraft((items) => items.map((item) => item.key === key ? { ...item, quantity: item.quantity - 1 } : item).filter((item) => item.quantity > 0));
                }}
              />
            ))}
          </div>
        </section>
        {orderPanel}
      </div>
      {checkout && initialOrder && (
        <SettlementSheet
          order={initialOrder}
          onClose={() => setCheckout(false)}
          onSuccess={(updated) => {
            setCheckout(false);
            if (updated.state === "CLOSED" && channel === "TABLE") {
              onDone("پرداخت ثبت شد و میز آزاد شد.");
              return;
            }
            void onOrder(updated);
          }}
        />
      )}
      {deleteDialogOpen && initialOrder && (
        <DeleteOrderDialog
          order={initialOrder}
          table={channel === "TABLE" ? table : null}
          clearsTable={channel === "TABLE" && canClearTableAfterDeletion(table?.activeOrders.length)}
          busy={busy}
          onCancel={() => setDeleteDialogOpen(false)}
          onConfirm={() => void remove()}
        />
      )}
      {discountTarget && initialOrder && (
        <DiscountDialog
          order={initialOrder}
          target={discountTarget}
          onCancel={() => { setDiscountTarget(null); discountTriggerRef.current?.focus(); }}
          onSuccess={async (updated) => {
            setDiscountTarget(null); discountTriggerRef.current?.focus();
            await onOrder(updated);
          }}
        />
      )}
    </>
  );
}

function ItemNoteInput({ productId, name, value, onChange }: { productId: string; name: string; value: string; onChange: (value: string) => void }) {
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => { setNotes(readRecentItemNotes(productId)); }, [productId]);
  return <><input className="order-note" aria-label={`یادداشت ${name}`} value={value} onChange={(event) => onChange(event.target.value)} placeholder="یادداشت" />{notes.length > 0 && <select aria-label={`یادداشت‌های اخیر ${name}`} value="" onChange={(event) => onChange(event.target.value)}><option value="">یادداشت‌های اخیر</option>{notes.map((note) => <option key={note} value={note}>{note}</option>)}</select>}</>;
}

function OrderSummary({
  order,
  draft,
  saved,
  canEditSaved,
  total,
  onQuantity,
  onSavedQuantity,
  onSavedNote,
  onDraftNote,
  onSave,
  onConfirmAndPrint,
  onCheckout,
  onPrint,
  onRequestDelete,
  onRequestDiscount,
  busy,
}: {
  order: OrderDetail | null;
  draft: Draft[];
  saved: SavedDraft[];
  canEditSaved: boolean;
  total: number;
  onQuantity: (key: string, delta: number) => void;
  onSavedQuantity: (id: string, delta: number) => void;
  onSavedNote: (id: string, note: string) => void;
  onDraftNote: (key: string, note: string) => void;
  onSave: () => void;
  onConfirmAndPrint: (kind: "bar-ticket" | "receipt") => void;
  onCheckout: () => void;
  onPrint: (kind: PrintKind, settlementId?: string) => void;
  onRequestDelete: () => void;
  onRequestDiscount: (target: DiscountTarget) => void;
  busy: boolean;
}) {
  const [expandedDraftKey, setExpandedDraftKey] = useState<string | null>(null);
  const [expandedSavedId, setExpandedSavedId] = useState<string | null>(null);
  const hasUnsavedChanges = draft.length > 0 || saved.some((item) => item.quantity !== item.originalQuantity || item.note !== (item.originalNote ?? ""));
  return (
    <>
      {order && (
        <div className="section-title">
          <span className="status-badge">
            {order.paymentStatus === "PAID"
              ? "تسویه‌شده"
              : order.paymentStatus === "PARTIALLY_PAID"
                ? "بخشی پرداخت‌شده"
                : "پرداخت‌نشده"}
          </span>
        </div>
      )}
      <div className="order-lines">
        {order?.items.map((item) => {
          const edit = saved.find((candidate) => candidate.id === item.id)!;
          const expanded = expandedSavedId === item.id;
          return edit.quantity > 0 && <article className={`order-line order-line--saved${expanded ? " order-line--expanded" : ""}`} key={item.id}>
            <button className="order-line__summary" type="button" aria-expanded={expanded} onClick={() => setExpandedSavedId((current) => current === item.id ? null : item.id)}><span className="order-line__details"><b>{edit.name}{edit.weightGrams ? ` · ${englishNumber.format(edit.weightGrams)} گرم` : ""} × {englishNumber.format(edit.quantity)}</b><small>{edit.note || "بدون یادداشت"}</small></span><strong>{formatToman(item.lineTotalAmount)}</strong></button>
            {expanded && <><div className="saved-edit"><div className="quantity">{canEditSaved && <button type="button" aria-label={`کم کردن ${edit.name}`} onClick={() => onSavedQuantity(edit.id, -1)}>−</button>}<output>{englishNumber.format(edit.quantity)}</output><button type="button" aria-label={`زیاد کردن ${edit.name}`} onClick={() => onSavedQuantity(edit.id, 1)}>+</button></div>{canEditSaved ? <ItemNoteInput productId={edit.productId} name={edit.name} value={edit.note} onChange={(note) => onSavedNote(edit.id, note)} /> : <small className="saved-lock">پس از ثبت پرداخت، فقط می‌توانید تعداد را افزایش دهید.</small>}</div><button className="button button--quiet saved-discount" type="button" disabled={!canChangeDiscount(order!.paymentStatus, "item") || busy} onClick={() => onRequestDiscount({ type: "item", id: item.id, name: item.productNameSnapshot })}>تخفیف کالا</button></>}
          </article>;
        })}
        {draft.map((item) => {
          const expanded = expandedDraftKey === item.key;
          const unitPrice = discountedDraftLineAmount(item);
          return (
            <article
              className={expanded ? "order-line order-line--expanded" : "order-line"}
              key={item.key}
            >
              <button
                className="order-line__summary"
                type="button"
                aria-expanded={expanded}
                aria-controls={`quantity-${item.key}`}
                onClick={() =>
                  setExpandedDraftKey((current) => (current === item.key ? null : item.key))
                }
              >
                <span className="order-line__details">
                  <b>
                    {item.product.name}{item.weightGrams ? ` · ${englishNumber.format(item.weightGrams)} گرم` : ""}{" "}
                    <span className="order-line__inline-count">
                      × {englishNumber.format(item.quantity)}
                    </span>
                  </b>
                  {item.options.length > 0 && (
                    <small>{item.options.map((x) => x.name).join("، ")}</small>
                  )}
                </span>
                <strong>{formatToman(unitPrice)}</strong>
              </button>
              {expanded && (
                <div
                  className="quantity"
                  id={`quantity-${item.key}`}
                  aria-label={`تعداد ${item.product.name}`}
                >
                  <button
                    type="button"
                    aria-label={`کم کردن ${item.product.name}`}
                    onClick={() => onQuantity(item.key, -1)}
                  >
                    −
                  </button>
                  <output>{englishNumber.format(item.quantity)}</output>
                  <button
                    type="button"
                    aria-label={`زیاد کردن ${item.product.name}`}
                    onClick={() => onQuantity(item.key, 1)}
                  >
                    +
                  </button>
                  <strong className="quantity__total">
                    {formatToman(unitPrice)}
                  </strong>
                  <ItemNoteInput productId={item.product.id} name={item.product.name} value={item.note} onChange={(note) => onDraftNote(item.key, note)} />
                </div>
              )}
            </article>
          );
        })}
        {!order && !draft.length && (
          <div className="empty-order">
            <CupIcon />
            <b>سفارش خالی است</b>
          </div>
        )}
      </div>
      <div className="order-total">
        <span>{order ? "جمع کل" : "جمع سفارش"}</span>
        <strong>{formatToman(total)}</strong>
      </div>
      {order && order.discountAmount > 0 && <div className="order-discount-summary">تخفیف سفارش: {formatToman(order.discountAmount)}{order.discountReason ? ` · ${order.discountReason}` : ""}</div>}
      {(order || hasUnsavedChanges) && (
        <button className="button button--primary button--wide" disabled={busy || !hasUnsavedChanges} onClick={onSave}>
          {busy ? "در حال ثبت…" : order ? "تأیید و ثبت ویرایش" : "ثبت سفارش"}
        </button>
      )}
      {!order && draft.length > 0 && (
        <>
          <button className="button button--quiet button--wide" type="button" disabled={busy} onClick={() => onConfirmAndPrint("bar-ticket")}>
            {busy ? "در حال ثبت…" : "تأیید سفارش و چاپ فیش بار"}
          </button>
          <button className="button button--quiet button--wide" type="button" disabled={busy} onClick={() => onConfirmAndPrint("receipt")}>
            {busy ? "در حال ثبت…" : "تأیید سفارش و چاپ رسید مشتری"}
          </button>
        </>
      )}
      {order && (
        <div className="order-actions">
          <button
            className="button button--primary"
            disabled={order.balanceAmount === 0}
            onClick={onCheckout}
          >
            ثبت پرداخت
          </button>
          <button className="button button--quiet" onClick={() => onPrint("bar-ticket")}>
            چاپ فیش بار
          </button>
          <button className="button button--quiet" onClick={() => onPrint("receipt")}>
            چاپ رسید
          </button>
          <button className="button button--quiet" disabled={!canChangeDiscount(order.paymentStatus, "order") || busy} title={!canChangeDiscount(order.paymentStatus, "order") ? "پس از اولین پرداخت، تخفیف سفارش قابل تغییر نیست." : undefined} onClick={() => onRequestDiscount({ type: "order" })}>
            تخفیف سفارش
          </button>
          <button className="text-danger" disabled={busy} onClick={onRequestDelete}>
            حذف سفارش
          </button>
        </div>
      )}
    </>
  );
}

function DiscountDialog({ order, target, onCancel, onSuccess }: { order: OrderDetail; target: DiscountTarget; onCancel: () => void; onSuccess: (order: OrderDetail) => Promise<void> }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [kind, setKind] = useState<"FIXED" | "PERCENTAGE">("FIXED");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { closeRef.current?.focus(); const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); }; document.addEventListener("keydown", closeOnEscape); return () => document.removeEventListener("keydown", closeOnEscape); }, [busy, onCancel]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const discount = discountPayload({ kind, value, reason });
    if (!discount) { setError("مبلغ یا درصد تخفیف را به‌درستی وارد کنید."); return; }
    setBusy(true); setError(null);
    const result = await updateOpenOrder(order.id, target.type === "order"
      ? { expectedVersion: order.version, orderDiscount: discount }
      : { expectedVersion: order.version, itemUpdates: [{ orderItemId: target.id, discount }] });
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    await onSuccess(result.data);
  };
  return <div className="modal-backdrop"><form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="discount-title" onSubmit={submit}>
    <div className="modal-header"><div><h2 id="discount-title">{target.type === "order" ? "تخفیف سفارش" : `تخفیف ${target.name}`}</h2><p>مبلغ نهایی را سرویس محاسبه می‌کند.</p></div><button ref={closeRef} type="button" className="icon-button" onClick={onCancel} aria-label="بستن"><CloseIcon /></button></div>
    <fieldset disabled={busy}><legend>نوع تخفیف</legend><label><input type="radio" checked={kind === "FIXED"} onChange={() => setKind("FIXED")} /> مبلغ (تومان)</label><label><input type="radio" checked={kind === "PERCENTAGE"} onChange={() => setKind("PERCENTAGE")} /> درصد</label></fieldset>
    <label> {kind === "FIXED" ? "مبلغ تومان" : "درصد"}<input inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))} required /></label>
    <label>دلیل تخفیف (اختیاری)<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button button--quiet" type="button" onClick={onCancel} disabled={busy}>انصراف</button><button className="button button--primary" type="submit" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت تخفیف"}</button></div>
  </form></div>;
}

function DeleteOrderDialog({ order, table, clearsTable, busy, onCancel, onConfirm }: { order: OrderDetail; table: PosTable | null; clearsTable: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const paymentStatus = order.paymentStatus === "PAID" ? "تسویه‌شده" : order.paymentStatus === "PARTIALLY_PAID" ? "بخشی پرداخت‌شده" : "پرداخت‌نشده";
  useEffect(() => {
    cancelButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);
  const tableOrder = Boolean(table);
  return (
    <div className="modal-backdrop">
      <section className="modal-card deletion-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-order-title" aria-describedby="delete-order-description">
        <div className="modal-header">
          <div><h2 id="delete-order-title">{clearsTable ? "پایان و آزادسازی میز" : "حذف از سفارش‌های فعال"}</h2></div>
          <button className="icon-button" type="button" disabled={busy} onClick={onCancel} aria-label="بستن تأیید حذف"><CloseIcon /></button>
        </div>
        <p id="delete-order-description">سفارش {formatOrderNumber(order.dailyOrderNumber)} {tableOrder ? `برای میز ${table!.name}` : "بیرون‌بر"} با وضعیت «{paymentStatus}» از فهرست سفارش‌های فعال خارج می‌شود.</p>
        <p className="deletion-dialog__notice">اطلاعات مالی و سابقه‌ی سفارش حفظ می‌شود. واردکردن دلیل حذف لازم نیست.</p>
        {clearsTable && <p className="deletion-dialog__consequence">میز برای پذیرش مشتری بعدی آماده می‌شود، نشست مهمان قبلی پایان می‌یابد و درخواست باز میزبان بسته می‌شود.</p>}
        {tableOrder && !clearsTable && <p className="deletion-dialog__consequence">این میز سفارش باز دیگری دارد. فقط سفارش انتخاب‌شده حذف می‌شود و میز تا پایان سفارش‌های دیگر آزاد نخواهد شد.</p>}
        <div className="modal-actions">
          <button className="button button--quiet" type="button" ref={cancelButtonRef} disabled={busy} onClick={onCancel}>انصراف</button>
          <button className="button button--danger" type="button" disabled={busy} onClick={onConfirm}>{busy ? "در حال ثبت…" : clearsTable ? "پایان و آزادسازی میز" : "حذف از فهرست فعال"}</button>
        </div>
      </section>
    </div>
  );
}

function LeaveDraftDialog({ busy, onContinue, onDiscard, onSubmit }: { busy: boolean; onContinue: () => void; onDiscard: () => void; onSubmit: () => void }) {
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { continueRef.current?.focus(); }, []);
  return <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="leave-draft-title"><div className="modal-header"><h2 id="leave-draft-title">تغییرات ذخیره‌نشده</h2><button className="icon-button" type="button" onClick={onContinue} aria-label="ادامه ویرایش"><CloseIcon /></button></div><p>برای خروج، سفارش را ثبت کنید یا تغییرات ذخیره‌نشده را حذف کنید.</p><div className="modal-actions"><button className="button button--quiet" type="button" ref={continueRef} onClick={onContinue}>ادامه ویرایش</button><button className="button button--danger" type="button" disabled={busy} onClick={onDiscard}>حذف تغییرات</button><button className="button button--primary" type="button" disabled={busy} onClick={onSubmit}>ثبت تغییرات</button></div></section></div>;
}

function TransferTableDialog({ transfer, busy, onCancel, onConfirm }: { transfer: PendingTransfer; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);
  const title = transfer.swaps ? "تأیید جابه‌جایی میزها" : "تأیید انتقال میز";
  const description = transfer.swaps
    ? `سفارش‌های باز میز ${transfer.source.name} و میز ${transfer.destination.name} با هم جابه‌جا می‌شوند.`
    : `سفارش باز میز ${transfer.source.name} به میز ${transfer.destination.name} منتقل می‌شود و میز ${transfer.source.name} آماده پذیرش خواهد شد.`;
  return (
    <div className="modal-backdrop">
      <section className="modal-card transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-table-title" aria-describedby="transfer-table-description">
        <div className="modal-header">
          <h2 id="transfer-table-title">{title}</h2>
          <button className="icon-button" type="button" disabled={busy} onClick={onCancel} aria-label="بستن تأیید انتقال"><CloseIcon /></button>
        </div>
        <p id="transfer-table-description">{description}</p>
        <p className="deletion-dialog__notice">مبلغ، اقلام و پرداخت‌های ثبت‌شده تغییر نمی‌کنند؛ فقط سفارش‌ها بین میزها جابه‌جا می‌شوند.</p>
        <div className="modal-actions">
          <button className="button button--quiet" type="button" ref={cancelButtonRef} disabled={busy} onClick={onCancel}>انصراف</button>
          <button className="button button--primary" type="button" disabled={busy} onClick={onConfirm}>{busy ? "در حال انتقال…" : transfer.swaps ? "جابه‌جایی میزها" : "انتقال سفارش"}</button>
        </div>
      </section>
    </div>
  );
}

export function SettlementSheet({
  order,
  onClose,
  onSuccess,
  historicalSettlement,
}: {
  order: OrderDetail;
  onClose: () => void;
  onSuccess: (order: OrderDetail) => void;
  historicalSettlement?: OrderDetail["settlements"][number];
}) {
  const paymentPrefix = `payment:${order.id}:${order.version}:${historicalSettlement?.id ?? "new"}`;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const settlementItems = useMemo(() => {
    let runningSubtotal = 0;
    return order.items.map((item) => {
      const discountBefore = Math.floor((order.discountAmount * runningSubtotal) / order.subtotalAmount);
      runningSubtotal += item.lineTotalAmount;
      const discountAfter = Math.floor((order.discountAmount * runningSubtotal) / order.subtotalAmount);
      return { ...item, lineTotalAmount: item.lineTotalAmount - (discountAfter - discountBefore) };
    });
  }, [order.discountAmount, order.items, order.subtotalAmount]);
  const available = useMemo(() => historicalSettlement
    ? historicalSettlement.allocations.flatMap((allocation) => {
      const item = settlementItems.find((candidate) => candidate.id === allocation.orderItemId);
      return item ? [{ item, availableQuantity: allocation.quantity, alreadyAllocatedQuantity: 0, fixedAmount: allocation.amount }] : [];
    })
    : settlementAvailability(settlementItems, order.settlements).map((entry) => ({ ...entry, fixedAmount: undefined })), [historicalSettlement, order.settlements, settlementItems]);
  const [selectedQuantities, setSelectedQuantities] = useRecoveryState<Record<string, number>>(`${paymentPrefix}:quantities`, () =>
    Object.fromEntries(available.map(({ item, availableQuantity }) => [item.id, availableQuantity])),
  );
  const selected = available
    .map((entry) => ({ ...entry, quantity: selectedQuantities[entry.item.id] ?? 0 }))
    .filter((entry) => historicalSettlement ? (entry.fixedAmount ?? 0) > 0 : entry.quantity > 0);
  const quantityAmount = historicalSettlement
    ? sumAmounts(selected.map((entry) => entry.fixedAmount ?? 0))
    : sumAmounts(selected.map((entry) => settlementAllocationAmount(entry)));
  const hasAmountPartial = !historicalSettlement && order.settlements.some(settlement => !settlement.reversedAt && settlement.allocations.some(allocation => allocation.quantity === 0));
  const [amountMode, setAmountMode] = useRecoveryState(`${paymentPrefix}:amount-mode`, hasAmountPartial);
  const [enteredAmount, setEnteredAmount] = useRecoveryState(`${paymentPrefix}:amount`, String(order.balanceAmount ?? quantityAmount));
  const byAmount = !historicalSettlement && (hasAmountPartial || amountMode);
  const selectedAmount = byAmount ? positiveIntegerAmount(enteredAmount) : quantityAmount;
  const [tenders, setTenders] = useRecoveryState<TenderDraft[]>(`${paymentPrefix}:tenders`, () => historicalSettlement
    ? historicalSettlement.payments.map((payment) => ({ id: requestKey(), method: payment.method, amount: String(payment.amount), reference: payment.reference ?? "" }))
    : [{ id: requestKey(), method: "CARD_TERMINAL", amount: String(selectedAmount), reference: "" }]);
  const [showSettlementSummary, setShowSettlementSummary] = useState(false);
  const [reason, setReason] = useRecoveryState(`${paymentPrefix}:reason`, "");
  const [manualBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptKey, setAttemptKey] = useRecoveryState<string>(`${paymentPrefix}:attempt-key`, requestKey);
  const [useTerminal, setUseTerminal] = useState(false);
  const complete = (updated: OrderDetail) => {
    writeRecovery(`${paymentPrefix}:tenders`, undefined);
    writeRecovery(`${paymentPrefix}:quantities`, undefined);
    writeRecovery(`${paymentPrefix}:attempt-key`, undefined);
    writeRecovery(`${paymentPrefix}:amount`, undefined);
    writeRecovery(`${paymentPrefix}:amount-mode`, undefined);
    onSuccess(updated);
  };
  const terminal = useTerminalPayment(order.id, complete, Boolean(historicalSettlement));
  const terminalLocked = Boolean(terminal.attempt);
  const terminalResolved = terminal.attempt?.status === "SUCCEEDED" || terminal.attempt?.status === "FAILED";
  const cardTenders = tenders.filter(tender => tender.method === "CARD_TERMINAL");
  useEffect(() => { if (cardTenders.length !== 1) setUseTerminal(false); }, [cardTenders.length]);
  const busy = manualBusy || terminal.busy || terminal.loading;
  const tenderAmount = sumAmounts(tenders.map((tender) => positiveIntegerAmount(tender.amount)));
  const isReconciled = selectedAmount > 0 && tenderAmount === selectedAmount && (!byAmount || selectedAmount <= order.balanceAmount);
  const previousSelectedAmount = useRef(selectedAmount);
  useEffect(() => {
    if (previousSelectedAmount.current === selectedAmount) return;
    previousSelectedAmount.current = selectedAmount;
    setTenders((current) => {
      const primaryTender = current[0];
      if (!primaryTender || primaryTender.amount === String(selectedAmount)) return current;
      return [{ ...primaryTender, amount: String(selectedAmount) }, ...current.slice(1)];
    });
  }, [selectedAmount]);
  const resetAttempt = () => {
    setAttemptKey(requestKey());
    setError(null);
  };
  const setSelectedQuantity = (itemId: string, quantity: number, maximum: number) => {
    resetAttempt();
    setSelectedQuantities((current) => ({
      ...current,
      [itemId]: Math.max(0, Math.min(maximum, quantity)),
    }));
  };
  const updateTender = (id: string, patch: Partial<TenderDraft>) => {
    resetAttempt();
    setTenders((current) => current.map((tender) => (tender.id === id ? { ...tender, ...patch } : tender)));
  };
  const settle = async () => {
    if (busy || terminalLocked || !isReconciled) return;
    if (useTerminal) {
      await terminal.start({ expectedVersion: order.version, ...(byAmount ? { allocationMode: "AMOUNT" as const, amount: selectedAmount } : { allocationMode: "ITEM_QUANTITY" as const, allocations: selected.map(({ item, quantity }) => ({ orderItemId: item.id, quantity })) }), payments: tenders.map(tender => tender.method === "CARD_TRANSFER" && tender.reference.trim() ? { method: tender.method, amount: positiveIntegerAmount(tender.amount), reference: tender.reference.trim() } : { method: tender.method, amount: positiveIntegerAmount(tender.amount) }) }, attemptKey);
      return;
    }
    setBusy(true);
    const result = historicalSettlement
      ? await editSettlement(historicalSettlement.id, {
        expectedVersion: order.version,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        payments: tenders.map((tender) => tender.method === "CARD_TRANSFER" && tender.reference.trim() ? { method: tender.method, amount: positiveIntegerAmount(tender.amount), reference: tender.reference.trim() } : { method: tender.method, amount: positiveIntegerAmount(tender.amount) }),
      }, attemptKey)
      : await recordSettlement(
      order.id,
      {
        expectedVersion: order.version,
        ...(byAmount ? { allocationMode: "AMOUNT" as const, amount: selectedAmount } : {
          allocationMode: "ITEM_QUANTITY" as const,
          allocations: selected.map(({ item, quantity }) => ({ orderItemId: item.id, quantity })),
        }),
        payments: tenders.map((tender) =>
          tender.method === "CARD_TRANSFER" && tender.reference.trim()
            ? { method: tender.method, amount: positiveIntegerAmount(tender.amount), reference: tender.reference.trim() }
            : { method: tender.method, amount: positiveIntegerAmount(tender.amount) },
        ),
      },
      attemptKey,
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    complete(result.data);
  };
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);
  return (
    <div className="modal-backdrop">
      <section className="modal-card settlement-modal" role="dialog" aria-modal="true" aria-labelledby="settlement-title">
        <div className="modal-header">
          <div>
            <h2 id="settlement-title">{historicalSettlement ? "اصلاح پرداخت" : "ثبت پرداخت"} {formatOrderNumber(order.dailyOrderNumber)}</h2>
            {historicalSettlement && <p className="settlement-history-note">این اصلاح سابقه‌ی پرداخت را تغییر می‌دهد و وضعیت زنده‌ی سفارش یا میز را عوض نمی‌کند.</p>}
          </div>
          <button className="icon-button" type="button" ref={closeButtonRef} disabled={busy} onClick={onClose} aria-label="بستن ثبت پرداخت">
            <CloseIcon />
          </button>
        </div>
        {!terminalLocked && <>
        <section className="settlement-selection" aria-labelledby="settlement-items-title">
          <div className="settlement-section-heading">
            <h3 id="settlement-items-title">{historicalSettlement ? "اقلام این پرداخت" : "اقلام این پرداخت"}</h3>
          </div>
        <div className="settlement-payable" aria-live="polite">
          <div><span>مبلغ این پرداخت</span>
          <strong>{formatToman(selectedAmount)} <small>تومان</small></strong></div>
          <span className="settlement-payable-icon" aria-hidden="true"><BagIcon /></span>
        </div>
          {!historicalSettlement && (terminal.enabled || hasAmountPartial) && <label><input type="checkbox" checked={byAmount} disabled={busy || hasAmountPartial} onChange={event => { resetAttempt(); setAmountMode(event.target.checked); }} />پرداخت بخشی از مبلغ سفارش</label>}
          {byAmount && <label>مبلغ این بخش (تومان)<input aria-label="مبلغ این بخش (تومان)" inputMode="numeric" value={enteredAmount} disabled={busy} onChange={event => { resetAttempt(); setEnteredAmount(event.target.value.replace(/[^0-9]/g, "")); }} /><small>مانده سفارش: {formatToman(order.balanceAmount)} تومان. سرور این مبلغ را بین اقلام پرداخت‌نشده تقسیم می‌کند.</small></label>}
          {!byAmount && available.map(({ item, availableQuantity }) => {
            const quantity = selectedQuantities[item.id] ?? 0;
            return (
              <div className={`settlement-item ${quantity > 0 ? "is-selected" : ""}`} key={item.id}>
                <button type="button" className="settlement-item-check" aria-label={`انتخاب ${item.productNameSnapshot}`} aria-pressed={quantity > 0} disabled={busy || Boolean(historicalSettlement)} onClick={() => setSelectedQuantity(item.id, quantity > 0 ? 0 : availableQuantity, availableQuantity)}><CheckIcon /></button>
                <div className="settlement-item-info">
                  <b>{item.productNameSnapshot}</b>
                  <span>{formatToman(settlementAllocationAmount({ item, alreadyAllocatedQuantity: available.find((entry) => entry.item.id === item.id)?.alreadyAllocatedQuantity ?? 0, quantity: Math.max(quantity, 0) }))} تومان</span>
                </div>
                <div className="settlement-item-controls">
                  <span className="settlement-available">{historicalSettlement ? "تعداد ثبت‌شده: " : "پرداخت‌نشده: "}{englishNumber.format(availableQuantity)}</span>
                  <div className="settlement-quantity" aria-label={`تعداد انتخاب‌شده برای پرداخت ${item.productNameSnapshot}`}>
                  <button type="button" disabled={busy || Boolean(historicalSettlement) || quantity === 0} onClick={() => setSelectedQuantity(item.id, quantity - 1, availableQuantity)} aria-label={`کم کردن ${item.productNameSnapshot}`}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" /></svg></button>
                  <output>{englishNumber.format(quantity)}</output>
                  <button type="button" disabled={busy || Boolean(historicalSettlement) || quantity === availableQuantity} onClick={() => setSelectedQuantity(item.id, quantity + 1, availableQuantity)} aria-label={`زیاد کردن ${item.productNameSnapshot}`}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M10 4v12" /></svg></button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
        <section className="settlement-tenders" aria-labelledby="settlement-tenders-title">
          <div className="settlement-section-heading">
            <h3 id="settlement-tenders-title">روش‌های پرداخت</h3>
            <button type="button" className="text-action" disabled={busy || tenders.length >= 10} onClick={() => {
              resetAttempt();
              setShowSettlementSummary(true);
              setTenders((current) => {
                const remainingAmount = Math.max(
                  0,
                  selectedAmount - sumAmounts(current.map((tender) => positiveIntegerAmount(tender.amount))),
                );
                return [...current, { id: requestKey(), method: "CASH", amount: String(remainingAmount), reference: "" }];
              });
            }}><span aria-hidden="true">＋</span> افزودن روش</button>
          </div>
          {tenders.map((tender, index) => (
            <div className="tender-row" key={tender.id}>
              <span className="tender-method-icon" aria-hidden="true"><AccountingIcon /></span>
              <label className="tender-method"><span className="settlement-sr-only">روش پرداخت</span>
                <select value={tender.method} disabled={busy} onChange={(event) => updateTender(tender.id, { method: event.target.value as TenderMethod, reference: "" })}>
                  <option value="CASH">نقدی</option>
                  <option value="CARD_TERMINAL">کارت‌خوان</option>
                  <option value="CARD_TRANSFER">کارت‌به‌کارت</option>
                </select>
              </label>
              <label className="tender-amount"><span className="settlement-sr-only">مبلغ (تومان)</span><span className="tender-currency" aria-hidden="true">تومان</span>
                <input inputMode="numeric" value={tender.amount} disabled={busy} onChange={(event) => updateTender(tender.id, { amount: event.target.value.replace(/[^0-9]/g, "") })} aria-label={`مبلغ روش پرداخت ${index + 1}`} aria-describedby="settlement-tenders-title" />
              </label>
              {tender.method === "CARD_TRANSFER" && <label>شماره پیگیری (اختیاری)
                <input value={tender.reference} disabled={busy} maxLength={128} onChange={(event) => updateTender(tender.id, { reference: event.target.value })} />
              </label>}
              {tenders.length > 1 && <button className="icon-button tender-remove" type="button" disabled={busy} onClick={() => {
                resetAttempt();
                setTenders((current) => current.filter((item) => item.id !== tender.id));
              }} aria-label={`حذف روش پرداخت ${index + 1}`}><CloseIcon /></button>}
            </div>
          ))}
        </section>
        {(showSettlementSummary || !isReconciled) && <div className={`settlement-total ${isReconciled ? "settlement-total--matched" : "settlement-total--mismatch"}`} aria-live="polite">
          <span>جمع اقلام انتخاب‌شده <strong>{formatToman(selectedAmount)} <small>تومان</small></strong></span>
          <span>جمع مبالغ پرداخت <strong>{formatToman(tenderAmount)} <small>تومان</small></strong></span>
          <div className="settlement-balance"><span>{tenderAmount > selectedAmount ? "مبلغ اضافه: " : "باقی‌مانده: "}<strong>{formatToman(Math.abs(selectedAmount - tenderAmount))}</strong> تومان</span><b>{isReconciled && <CheckIcon />}{selectedAmount === 0 ? "برای ثبت پرداخت، دست‌کم یک قلم انتخاب کنید." : isReconciled ? "مبلغ پرداخت با مبلغ اقلام برابر است." : tenderAmount < selectedAmount ? "مبلغ باقی‌مانده را به یکی از روش‌های پرداخت اضافه کنید." : "مبلغ اضافه را از روش‌های پرداخت کم کنید."}</b></div>
        </div>}
        {terminal.enabled && !historicalSettlement && <label className="settlement-history-note"><input type="checkbox" checked={useTerminal} disabled={busy || cardTenders.length !== 1} onChange={event => setUseTerminal(event.target.checked)} />ارسال مبلغ به کارت‌خوان</label>}
        {useTerminal && <p>مبلغ ارسالی: {formatToman(positiveIntegerAmount(cardTenders[0]?.amount ?? "0"))} تومان. برای دو کارت بانکی، دو پرداخت جدا ثبت کنید.</p>}
        </>}
        <TerminalPaymentStatus payment={terminal} />
        {error && <div className="toast toast--error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button className="button button--quiet" disabled={busy} onClick={onClose}>
            {terminalLocked ? "بستن پنجره" : "انصراف"}
          </button>
          <button
            className="button button--primary"
            disabled={busy || (terminalLocked ? !terminalResolved : !isReconciled || (useTerminal && cardTenders.length !== 1))}
            onClick={() => void (terminalResolved ? terminal.finish() : settle())}
          >
            {busy ? "در حال بررسی…" : terminalResolved ? "بازگشت به سفارش" : terminalLocked ? "در انتظار بررسی پرداخت" : historicalSettlement ? "ثبت اصلاح پرداخت" : useTerminal ? "شروع پرداخت با کارت‌خوان" : "ثبت پرداخت"}
          </button>
        </div>
      </section>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading-panel" aria-busy="true">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="failure">
      <AlertIcon />
      <h1>صندوق آماده نشد</h1>
      <p>{message}</p>
      <button className="button button--primary" onClick={onRetry}>
        تلاش دوباره
      </button>
    </div>
  );
}
