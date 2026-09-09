"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PosCatalogCategory, PosCatalogProduct, PosTable } from "@cafe/contracts";
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
  transferOrderTable,
  makeTableAvailable,
  updateOpenOrder,
  type PosOrderDetail,
} from "../lib/api-client";
import { canClearTableAfterDeletion, deleteAndClearTableOrder } from "../lib/order-clear-workflow";
import { printRoute, type PrintKind } from "../lib/print-routes";
import {
  elapsedLabel,
  englishNumber,
  formatToman,
  positiveIntegerAmount,
  settlementAllocationAmount,
  settlementAvailability,
  sumAmounts,
} from "../lib/pos-utils";
import { AlertIcon, BagIcon, ClockIcon, CloseIcon, CupIcon, MenuIcon, RefreshIcon, TableIcon } from "./icons";

type Channel = "TABLE" | "TAKEAWAY";
type OrderDetail = PosOrderDetail;
type Option = PosCatalogProduct["optionGroups"][number]["options"][number];
type Draft = { key: string; product: PosCatalogProduct; options: Option[]; quantity: number; note: string };
type SavedDraft = { id: string; productId: string; name: string; quantity: number; originalQuantity: number; note: string; originalNote: string | null; options: Array<{ optionId: string; quantity: number }>; lineTotalAmount: number };
type ProductCard = { key: string; name: string; products: PosCatalogProduct[] };
type Data = {
  catalog: PosCatalogCategory[];
  tables: PosTable[];
  calls: Array<{ tableId: string; version: number }>;
  openOrders: Array<{ id: string; tableId: string | null; totalAmount: number }>;
};
type PendingTableClear = { tableId: string; tableName: string; orderNumber: string; error: string };
type PendingTransfer = { order: OrderDetail; source: PosTable; destination: PosTable; swaps: boolean };
type TenderMethod = "CASH" | "CARD_TERMINAL" | "CARD_TRANSFER";
type TenderDraft = { id: string; method: TenderMethod; amount: string; reference: string };
const requestKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const shotName = /^(.*)\s(سینگل|دبل)$/;
const coffeeRatio = (name: string) => name.replace(/\s*(روبوستا|عربیکا)/g, "").replace("٪", "%");

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

function savedDrafts(order: OrderDetail | null): SavedDraft[] {
  return (order?.items ?? []).map((item) => ({
    id: item.id, productId: item.productId, name: item.productNameSnapshot,
    quantity: item.quantity, originalQuantity: item.quantity,
    note: item.note ?? "", originalNote: item.note,
    options: item.options.map((option) => ({ optionId: option.optionId, quantity: option.quantity })),
    lineTotalAmount: item.lineTotalAmount,
  }));
}

export function OrdersWorkspace({
  refreshing,
  onOpenMenu,
  menuOpen,
}: {
  refreshing: boolean;
  onOpenMenu: () => void;
  menuOpen: boolean;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [channel, setChannel] = useState<Channel>("TABLE");
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
  const [pendingChannel, setPendingChannel] = useState<Channel | null>(null);
  const submitDeskRef = useRef<(() => void) | null>(null);
  const load = useCallback(async () => {
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
      setMessage({ tone: "error", text: failure?.message ?? "اطلاعات صندوق آماده نشد." });
      setLoading(false);
      return;
    }
    setData({
      catalog: catalog.data,
      tables: tables.data,
      calls: calls.ok ? calls.data : [],
      openOrders: orders.ok ? orders.data : [],
    });
    if (!calls.ok || !orders.ok)
      setMessage({
        tone: "notice",
        text: "بخشی از وضعیت زنده صندوق در دسترس نیست؛ برای تازه‌سازی دوباره تلاش کنید.",
      });
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const selectTable = async (table: PosTable) => {
    setMessage(null);
    const call = data?.calls.find((item) => item.tableId === table.id);
    if (call) {
      const result = await acknowledgeWaiterCall(table.id, call.version);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error.message });
        return;
      }
      setMessage({ tone: "notice", text: `درخواست میز ${result.data.name} پذیرفته شد.` });
      await load();
      return;
    }
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
  const close = () => {
    setSelected(null);
    setOrder(null);
    setEditingOrder(false);
  };
  if (loading) return <Loading />;
  if (!data) return <Failure onRetry={load} message={message?.text ?? "صندوق آماده نشد."} />;
  return (
    <section className="pos-workspace">
      <header className="workspace-header">
        <div className="header-actions">
          <span className={`connection ${refreshing ? "connection--busy" : ""}`}>
            <i aria-hidden="true" />
            <span title={refreshing ? "در حال بازخوانی وضعیت" : "اتصال برقرار است"}>
              {refreshing ? "در حال بازخوانی" : "متصل"}
            </span>
          </span>
          <button className="icon-button" onClick={() => void load()} aria-label="تازه‌سازی">
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
        <div className="channel-tabs" role="tablist" aria-label="کانال سفارش">
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
            className={channel === "TAKEAWAY" ? "active" : ""}
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
      </header>
      {message && (
        <div
          className={`toast toast--${message.tone}`}
          role={message.tone === "error" ? "alert" : "status"}
        >
          <AlertIcon />
          {message.text}
          <button onClick={() => setMessage(null)}>×</button>
        </div>
      )}
      {pendingTableClear && (
        <section className="clear-retry" role="alert" aria-live="assertive">
          <div>
            <b>سفارش {pendingTableClear.orderNumber} از فهرست فعال حذف شد.</b>
            <span>
              میز {pendingTableClear.tableName} هنوز اشغال است و زمینه مهمان قبلی پایان نیافته: {pendingTableClear.error}
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
              setMessage({ tone: "notice", text: `میز ${pendingTableClear.tableName} آماده پذیرش شد.` });
            }}
          >
            {retryingTableClear ? "در حال آزادسازی…" : "تلاش دوباره برای آزادسازی میز"}
          </button>
        </section>
      )}
      {editingOrder || (selected && !order) || channel === "TAKEAWAY" ? (
        <OrderDesk
          key={`${channel}:${selected?.id ?? "takeaway"}:${order?.id ?? "new"}`}
          catalog={data.catalog}
          table={selected}
          channel={channel}
          initialOrder={order}
          onOrder={async (updated) => {
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
        />
      ) : (
        <TableBoard
          tables={data.tables}
          calls={data.calls}
          orders={data.openOrders}
          selectedTableId={selected?.id ?? null}
          selectedOrder={order}
          onSelect={selectTable}
          onClosePanel={close}
          onEditOrder={() => setEditingOrder(true)}
          onCheckout={() => setCheckout(true)}
          onPrint={(kind) => window.open(printRoute(order!.id, kind), "run-cafe-print", "popup=yes")}
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
          onDiscard={() => { setDeskDirty(false); setChannel(pendingChannel); setSelected(null); setOrder(null); setEditingOrder(false); setPendingChannel(null); }}
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

function TableBoard({
  tables,
  calls,
  orders,
  selectedTableId,
  selectedOrder,
  onSelect,
  onClosePanel,
  onEditOrder,
  onCheckout,
  onPrint,
  onRequestTransfer,
}: {
  tables: PosTable[];
  calls: Data["calls"];
  orders: Data["openOrders"];
  selectedTableId: string | null;
  selectedOrder: OrderDetail | null;
  onSelect: (table: PosTable) => void;
  onClosePanel: () => void;
  onEditOrder: () => void;
  onCheckout: () => void;
  onPrint: (kind: Exclude<PrintKind, "settlement">) => void;
  onRequestTransfer: (source: PosTable, destination: PosTable) => Promise<void>;
}) {
  const [transferSourceId, setTransferSourceId] = useState<string | null>(null);
  const totals = new Map(orders.filter((x) => x.tableId).map((x) => [x.tableId!, x.totalAmount]));
  return (
    <div className={selectedOrder ? "table-board table-board--inspecting" : "table-board"}>
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
        <div className="table-board__heading">
          <div>
            <h1>مدیریت میزها</h1>
          </div>
        </div>
      {transferSourceId && <p className="table-transfer-hint" role="status">مقصد انتقال میز را انتخاب کنید. میزهای دارای درخواست گارسون قابل انتخاب نیستند.</p>}
      <div className="table-grid" id="table-transfer-targets" tabIndex={-1}>
        {tables.map((table) => {
          const hasOrder = table.activeOrders.length > 0;
          const call = calls.some((x) => x.tableId === table.id);
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
              draggable={hasOrder && !call}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", table.id)}
              onDragOver={(event) => {
                if (!call) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const source = tables.find((item) => item.id === event.dataTransfer.getData("text/plain"));
                if (!source || !source.activeOrders[0] || source.id === table.id || call) return;
                void onRequestTransfer(source, table);
              }}
              className={`table-tile table-tile--${state}${selectedTableId === table.id ? " is-selected" : ""}`}
            >
              <button className="table-tile__main" onClick={() => {
                const source = tables.find((item) => item.id === transferSourceId);
                if (source && source.id !== table.id && !call) {
                  setTransferSourceId(null);
                  void onRequestTransfer(source, table);
                  return;
                }
                void onSelect(table);
              }} aria-pressed={selectedTableId === table.id}>
                <span className="table-tile__top">
                  <strong>{table.name}</strong>
                  {call && <AlertIcon />}
                </span>
                <span className="table-tile__details">
                  <span className="table-status"><i />{call ? "درخواست گارسون" : hasOrder ? "سفارش باز" : table.occupancyState === "OCCUPIED" ? "اشغال" : "آماده"}</span>
                  {hasOrder && <span className="table-tile__meta">{elapsedLabel(table.activeOrders[0]!.createdAt)}</span>}
                  {call && <span className="table-tile__meta">نیاز به رسیدگی</span>}
                  {!hasOrder && !call && <span className="table-tile__meta">{table.occupiedAt ? elapsedLabel(table.occupiedAt) : "آماده پذیرش"}</span>}
                  {hasOrder && <b>{formatToman(totals.get(table.id) ?? 0)}</b>}
                </span>
              </button>
            </article>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function OccupiedTablePanel({ table, order, onClose, onEdit, onCheckout, onPrint, onTransfer }: { table: PosTable | null; order: OrderDetail; onClose: () => void; onEdit: () => void; onCheckout: () => void; onPrint: (kind: Exclude<PrintKind, "settlement">) => void; onTransfer: () => void }) {
  const status = order.paymentStatus === "PAID" ? "تسویه شد" : order.paymentStatus === "PARTIALLY_PAID" ? "بخشی پرداخت شد" : "بدون پرداخت";
  return <aside className="occupied-panel" aria-label={`جزئیات سفارش میز ${table?.name ?? ""}`}>
    <header className="occupied-panel__header">
      <button className="icon-button" type="button" onClick={onClose} aria-label="بستن جزئیات"><CloseIcon /></button>
      <div><h2>میز {table?.name}</h2><span><ClockIcon /> {elapsedLabel(order.createdAt)} · {status}</span></div>
    </header>
    <div className="occupied-panel__items">
      {order.items.map((item) => <div className="occupied-panel__item" key={item.id}><div><b>{item.productNameSnapshot} <small>× {englishNumber.format(item.quantity)}</small></b>{item.options.length > 0 && <span>{item.options.map((option) => option.optionNameSnapshot).join("، ")}</span>}</div><strong>{formatToman(item.lineTotalAmount)}</strong></div>)}
    </div>
    <footer className="occupied-panel__footer">
      <div className="occupied-panel__total"><span>جمع کل</span><strong>{formatToman(order.totalAmount)}</strong></div>
      {order.paidAmount > 0 && <div className="occupied-panel__balance">مانده: {formatToman(order.balanceAmount)}</div>}
      <button className="button button--primary button--wide" disabled={order.balanceAmount === 0} onClick={onCheckout}>تسویه و پرداخت</button>
      <button className="button button--quiet button--wide" onClick={() => onPrint("bar-ticket")}>چاپ فیش بار</button>
      <button className="button button--quiet button--wide" onClick={() => onPrint("receipt")}>چاپ رسید</button>
      <button className="button button--quiet button--wide" onClick={onEdit}>ویرایش سفارش</button>
      <button className="button button--quiet button--wide" onClick={onTransfer}>انتقال میز</button>
    </footer>
  </aside>;
}

function OrderDesk({
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
}) {
  const posCatalog = useMemo(
    () => catalog.filter((item) => item.name !== "ویژه و جدید"),
    [catalog],
  );
  const [categoryId, setCategoryId] = useState("");
  const [draft, setDraft] = useState<Draft[]>([]);
  const [saved, setSaved] = useState<SavedDraft[]>(() => savedDrafts(initialOrder));
  const [createAttemptKey, setCreateAttemptKey] = useState(requestKey);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<PosCatalogProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  useEffect(() => {
    setSaved(savedDrafts(initialOrder));
    setDraft([]);
    setCreateAttemptKey(requestKey());
  }, [initialOrder?.id, initialOrder?.version]);
  const category = posCatalog.find((x) => x.id === categoryId) ?? posCatalog[0];
  const cards = productCards(category?.products ?? []);
  const draftTotal = sumAmounts(
    draft.map(
      (x) => (x.product.priceAmount + sumAmounts(x.options.map((o) => o.priceAmount))) * x.quantity,
    ),
  );
  const add = (product: PosCatalogProduct, options: Option[] = []) => {
    const signature = `${product.id}:${options
      .map((x) => x.id)
      .sort()
      .join(",")}`;
    setDraft((current) => {
      const found = current.find((x) => x.key === signature);
      return found
        ? current.map((x) => (x.key === signature ? { ...x, quantity: x.quantity + 1 } : x))
        : [...current, { key: signature, product, options, quantity: 1, note: "" }];
    });
    setExpandedCard(null);
    setSelectedProduct(null);
  };
  const payloadItems = () =>
    draft.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      ...(item.note.trim() ? { note: item.note.trim() } : {}),
      options: item.options.map((option) => ({ optionId: option.id, quantity: 1 })),
    }));
  const replacementItems = () => [
    ...saved.filter((item) => item.quantity > 0).map((item) => ({
      productId: item.productId, quantity: item.quantity,
      ...(item.note.trim() ? { note: item.note.trim() } : {}), options: item.options,
    })),
    ...payloadItems(),
  ];
  const dirty = draft.length > 0 || saved.some((item) => item.quantity !== item.originalQuantity || item.note !== (item.originalNote ?? ""));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const save = async () => {
    if (!draft.length && !saved.some((item) => item.quantity !== item.originalQuantity || item.note !== (item.originalNote ?? ""))) return;
    setBusy(true);
    setError(null);
    if (initialOrder) {
      const isUnpaid = initialOrder.paymentStatus === "UNPAID";
      const changedSaved = saved.filter((item) => item.quantity !== item.originalQuantity || item.note !== (item.originalNote ?? ""));
      const result = await updateOpenOrder(initialOrder.id, isUnpaid
        ? { expectedVersion: initialOrder.version, items: replacementItems() }
        : {
            expectedVersion: initialOrder.version,
            ...(draft.length ? { addItems: payloadItems() } : {}),
            ...(changedSaved.length ? { itemUpdates: changedSaved.map((item) => ({ orderItemId: item.id, quantity: item.quantity })) } : {}),
          });
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await onOrder(result.data);
    } else {
      const result = await createOpenOrder(
        channel === "TABLE"
          ? { channel, tableId: table!.id, items: payloadItems() }
          : { channel, items: payloadItems() },
        createAttemptKey,
        { requestId: requestKey(), ...(channel === "TABLE" ? { tableName: table!.name } : {}) },
      );
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message);
        if (channel === "TABLE") await onCreateFailure(result.error.message);
        return;
      }
      const detail = await readOrder(result.data.id);
      if (!detail.ok) {
        setError(detail.error.message);
        return;
      }
      await onOrder(detail.data);
    }
    setDraft([]);
    setSaved(savedDrafts(initialOrder));
    setCreateAttemptKey(requestKey());
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
      onTableClearNeeded({ tableId: table.id, tableName: table.name, orderNumber: initialOrder.orderNumber, error: result.error.message });
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
  return (
    <>
      {error && (
        <div className="toast toast--error" role="alert">
          <AlertIcon />
          {error}
        </div>
      )}
      <div className="order-desk">
        <aside className="desk-sidebar">
          <div className="desk-context">
            <span className="context-icon">
              {channel === "TABLE" ? <TableIcon /> : <BagIcon />}
            </span>
            <span>
              <b>{channel === "TABLE" ? `میز ${table?.name}` : "بیرون‌بر"}</b>
              <small>{initialOrder ? "ویرایش سفارش" : "سفارش جدید"}</small>
            </span>
            {initialOrder ? <em>مانده {formatToman(initialOrder.balanceAmount)}</em> : null}
          </div>
          <nav className="categories" aria-label="دسته‌های محصولات">
            <div>
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
          </nav>
        </aside>
        <section className="products">
          <div className="product-grid">
            {cards.map((card) => (
              <ProductPicker
                key={card.key}
                card={card}
                expanded={expandedCard === card.key}
                selectedProduct={selectedProduct}
                onOpen={() => {
                  const soleProduct = card.products[0];
                  if (
                    card.products.length === 1 &&
                    soleProduct &&
                    soleProduct.optionGroups.length === 0
                  ) {
                    add(soleProduct);
                    return;
                  }
                  setExpandedCard(card.key);
                  setSelectedProduct(
                    card.products.find(
                      (product) => product.name.includes("دبل") && product.optionGroups.length > 0,
                    ) ??
                      card.products.find((product) => product.optionGroups.length > 0) ??
                      soleProduct ??
                      null,
                  );
                }}
                onClose={() => {
                  setExpandedCard(null);
                  setSelectedProduct(null);
                }}
                onSelectProduct={(product) => {
                  if (!product.optionGroups.length) add(product);
                  else setSelectedProduct(product);
                }}
                onSelectOptions={(product, options) => add(product, options)}
              />
            ))}
          </div>
        </section>
        <aside className="order-panel">
          <OrderSummary
            order={initialOrder}
            draft={draft}
            saved={saved}
            canEditSaved={initialOrder?.paymentStatus === "UNPAID"}
            total={draftTotal}
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
            onCheckout={() => setCheckout(true)}
            onPrint={(kind, settlementId) => {
              if (!initialOrder) return;
              window.open(printRoute(initialOrder.id, kind, settlementId), "run-cafe-print", "popup=yes");
            }}
            onRequestDelete={() => setDeleteDialogOpen(true)}
            busy={busy}
          />
        </aside>
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
    </>
  );
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
  onCheckout,
  onPrint,
  onRequestDelete,
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
  onCheckout: () => void;
  onPrint: (kind: PrintKind, settlementId?: string) => void;
  onRequestDelete: () => void;
  busy: boolean;
}) {
  const [expandedDraftKey, setExpandedDraftKey] = useState<string | null>(null);
  return (
    <>
      {order && (
        <div className="section-title">
          <span className="status-badge">
            {order.paymentStatus === "PAID"
              ? "تسویه شد"
              : order.paymentStatus === "PARTIALLY_PAID"
                ? "بخشی پرداخت شد"
                : "بدون پرداخت"}
          </span>
        </div>
      )}
      <div className="order-lines">
        {order?.items.map((item) => {
          const edit = saved.find((candidate) => candidate.id === item.id)!;
          return edit.quantity > 0 && <article className="order-line order-line--saved" key={item.id}>
            <div><b>{edit.name} × {englishNumber.format(edit.quantity)}</b><small>{edit.note || "بدون یادداشت"}</small></div>
            <span>{formatToman(item.lineTotalAmount)}</span>
            <div className="saved-edit"><div className="quantity">{canEditSaved && <button type="button" aria-label={`کم کردن ${edit.name}`} onClick={() => onSavedQuantity(edit.id, -1)}>−</button>}<output>{englishNumber.format(edit.quantity)}</output><button type="button" aria-label={`زیاد کردن ${edit.name}`} onClick={() => onSavedQuantity(edit.id, 1)}>+</button></div>{canEditSaved ? <input aria-label={`یادداشت ${edit.name}`} value={edit.note} onChange={(event) => onSavedNote(edit.id, event.target.value)} placeholder="یادداشت" /> : <small className="saved-lock">پس از پرداخت فقط افزایش تعداد مجاز است</small>}</div>
          </article>;
        })}
        {draft.map((item) => {
          const expanded = expandedDraftKey === item.key;
          const unitPrice =
            item.product.priceAmount + sumAmounts(item.options.map((x) => x.priceAmount));
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
                    {item.product.name}{" "}
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
                    {formatToman(unitPrice * item.quantity)}
                  </strong>
                  <input className="order-note" aria-label={`یادداشت ${item.product.name}`} value={item.note} onChange={(event) => onDraftNote(item.key, event.target.value)} placeholder="یادداشت" />
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
        <span>{order ? "مانده پرداخت" : "جمع پیش‌نویس"}</span>
        <strong>{formatToman(order ? order.balanceAmount : total)}</strong>
      </div>
      {(draft.length > 0 || saved.some((item) => item.quantity !== item.originalQuantity || item.note !== (item.originalNote ?? ""))) && (
        <button className="button button--primary button--wide" disabled={busy} onClick={onSave}>
          {busy ? "در حال ثبت…" : order ? "افزودن به سفارش" : "ثبت سفارش"}
        </button>
      )}
      {order && (
        <div className="order-actions">
          <button
            className="button button--primary"
            disabled={order.balanceAmount === 0}
            onClick={onCheckout}
          >
            تسویه حساب
          </button>
          <button className="button button--quiet" onClick={() => onPrint("bar-ticket")}>
            چاپ فیش بار
          </button>
          <button className="button button--quiet" onClick={() => onPrint("receipt")}>
            چاپ رسید
          </button>
          <button className="text-danger" disabled={busy} onClick={onRequestDelete}>
            حذف سفارش
          </button>
          {order.settlements.filter((settlement) => !settlement.reversedAt).map((settlement) => (
            <button className="button button--quiet order-actions__settlement" key={settlement.id} onClick={() => onPrint("settlement", settlement.id)}>
              رسید پرداخت {formatToman(settlement.totalAmount)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function DeleteOrderDialog({ order, table, clearsTable, busy, onCancel, onConfirm }: { order: OrderDetail; table: PosTable | null; clearsTable: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const paymentStatus = order.paymentStatus === "PAID" ? "تسویه‌شده" : order.paymentStatus === "PARTIALLY_PAID" ? "بخشی پرداخت‌شده" : "بدون پرداخت";
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
        <p id="delete-order-description">سفارش {order.orderNumber} {tableOrder ? `برای میز ${table!.name}` : "بیرون‌بر"} با وضعیت {paymentStatus} از عملیات فعال حذف می‌شود.</p>
        <p className="deletion-dialog__notice">این حذف فیزیکی نیست؛ اطلاعات مالی و سابقه ثبت‌شده حفظ می‌شود و دلیل حذف لازم نیست.</p>
        {clearsTable && <p className="deletion-dialog__consequence">پس از حذف، میز آماده پذیرش می‌شود، زمینه مهمان قبلی پایان می‌یابد و درخواست گارسون باز آن بسته می‌شود.</p>}
        {tableOrder && !clearsTable && <p className="deletion-dialog__consequence">این میز سفارش باز دیگری دارد؛ فقط این سفارش حذف می‌شود و میز تا پایان سفارش‌های باقی‌مانده آماده پذیرش نخواهد شد.</p>}
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
  return <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="leave-draft-title"><div className="modal-header"><h2 id="leave-draft-title">تغییرات ثبت نشده است</h2><button className="icon-button" type="button" onClick={onContinue} aria-label="ادامه ویرایش"><CloseIcon /></button></div><p>برای خروج، سفارش را ثبت کنید یا تغییرات محلی را دور بریزید.</p><div className="modal-actions"><button className="button button--quiet" type="button" ref={continueRef} onClick={onContinue}>ادامه ویرایش</button><button className="button button--danger" type="button" disabled={busy} onClick={onDiscard}>دور ریختن</button><button className="button button--primary" type="button" disabled={busy} onClick={onSubmit}>ثبت تغییرات</button></div></section></div>;
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
        <p className="deletion-dialog__notice">مبالغ، اقلام و پرداخت‌های ثبت‌شده تغییر نمی‌کنند؛ فقط زمینه میزها به‌صورت ایمن جابه‌جا می‌شود.</p>
        <div className="modal-actions">
          <button className="button button--quiet" type="button" ref={cancelButtonRef} disabled={busy} onClick={onCancel}>انصراف</button>
          <button className="button button--primary" type="button" disabled={busy} onClick={onConfirm}>{busy ? "در حال انتقال…" : transfer.swaps ? "جابه‌جایی میزها" : "انتقال سفارش"}</button>
        </div>
      </section>
    </div>
  );
}

function ProductPicker({
  card,
  expanded,
  selectedProduct,
  onOpen,
  onClose,
  onSelectProduct,
  onSelectOptions,
}: {
  card: ProductCard;
  expanded: boolean;
  selectedProduct: PosCatalogProduct | null;
  onOpen: () => void;
  onClose: () => void;
  onSelectProduct: (product: PosCatalogProduct) => void;
  onSelectOptions: (product: PosCatalogProduct, options: Option[]) => void;
}) {
  const pickerRef = useRef<HTMLElement>(null);
  const [picked, setPicked] = useState<Record<string, Option>>({});
  useEffect(() => setPicked({}), [expanded, selectedProduct?.id]);
  useEffect(() => {
    if (!expanded) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [expanded, onClose]);
  const groups = (selectedProduct?.optionGroups ?? []).map((g) => ({
    ...g,
    options: g.options.filter((x) => x.isAvailable),
  }));
  const chooseOption = (groupId: string, option: Option) => {
    if (!selectedProduct) return;
    const next = { ...picked, [groupId]: option };
    setPicked(next);
    const selectedOptions = groups
      .map((group) => next[group.id])
      .filter((candidate): candidate is Option => candidate !== undefined);
    if (selectedOptions.length === groups.length) onSelectOptions(selectedProduct, selectedOptions);
  };
  const isAvailable = card.products.some((product) => product.isAvailable);
  const showSizeChoices = card.products.length > 1;
  return (
    <article className="product-picker" ref={pickerRef}>
      <button
        className="product-card"
        disabled={!isAvailable}
        onClick={onOpen}
        aria-expanded={expanded}
      >
        <span>{card.name}</span>
        {(showSizeChoices || card.products.some((product) => product.optionGroups.length > 0)) && (
          <span className="product-card__add" aria-label="دارای انتخاب">
            +
          </span>
        )}
      </button>
      {expanded && (
        <div className="product-overlay" aria-label={`انتخاب گزینه برای ${card.name}`}>
          <div className="product-overlay__card">
            <span>{card.name}</span>
          </div>
          {showSizeChoices && (
            <div className="shot-choices" aria-label={`انتخاب شات ${card.name}`}>
              {card.products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className={selectedProduct?.id === product.id ? "active" : ""}
                  onClick={() => onSelectProduct(product)}
                >
                  {product.name.match(shotName)?.[2]}
                </button>
              ))}
            </div>
          )}
          {selectedProduct && (
            <div className="product-picker__choices">
              {groups.map((group) => (
                <section className="product-option-group" key={group.id}>
                  <div>
                    {group.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={picked[group.id]?.id === option.id ? "active" : ""}
                        onClick={() => chooseOption(group.id, option)}
                      >
                        <span>
                          {group.name === "لاین قهوه" ? coffeeRatio(option.name) : option.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function SettlementSheet({
  order,
  onClose,
  onSuccess,
}: {
  order: OrderDetail;
  onClose: () => void;
  onSuccess: (order: OrderDetail) => void;
}) {
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
  const available = useMemo(
    () => settlementAvailability(settlementItems, order.settlements),
    [order.settlements, settlementItems],
  );
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(available.map(({ item, availableQuantity }) => [item.id, availableQuantity])),
  );
  const selected = available
    .map((entry) => ({ ...entry, quantity: selectedQuantities[entry.item.id] ?? 0 }))
    .filter((entry) => entry.quantity > 0);
  const selectedAmount = sumAmounts(selected.map((entry) => settlementAllocationAmount(entry)));
  const [tenders, setTenders] = useState<TenderDraft[]>(() => [
    { id: requestKey(), method: "CARD_TERMINAL", amount: String(selectedAmount), reference: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptKey, setAttemptKey] = useState(requestKey);
  const tenderAmount = sumAmounts(tenders.map((tender) => positiveIntegerAmount(tender.amount)));
  const isReconciled = selectedAmount > 0 && tenderAmount === selectedAmount;
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
    if (!isReconciled || busy) return;
    setBusy(true);
    const result = await recordSettlement(
      order.id,
      {
        expectedVersion: order.version,
        allocations: selected.map(({ item, quantity }) => ({ orderItemId: item.id, quantity })),
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
    onSuccess(result.data);
  };
  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);
  return (
    <div className="modal-backdrop">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="settlement-title">
        <div className="modal-header">
          <div>
            <h2 id="settlement-title">ثبت پرداخت {order.orderNumber}</h2>
          </div>
          <button className="icon-button" type="button" ref={closeButtonRef} onClick={onClose} aria-label="بستن ثبت پرداخت">
            <CloseIcon />
          </button>
        </div>
        <section className="settlement-selection" aria-labelledby="settlement-items-title">
          <div className="settlement-section-heading">
            <h3 id="settlement-items-title">اقلام قابل پرداخت</h3>
            <span>تعداد موردنظر را انتخاب کنید</span>
          </div>
          {available.map(({ item, availableQuantity }) => {
            const quantity = selectedQuantities[item.id] ?? 0;
            return (
              <div className="settlement-item" key={item.id}>
                <div>
                  <b>{item.productNameSnapshot}</b>
                  <span>{formatToman(settlementAllocationAmount({ item, alreadyAllocatedQuantity: available.find((entry) => entry.item.id === item.id)?.alreadyAllocatedQuantity ?? 0, quantity: Math.max(quantity, 0) }))}</span>
                </div>
                <div className="settlement-quantity" aria-label={`تعداد قابل پرداخت ${item.productNameSnapshot}`}>
                  <button type="button" disabled={busy || quantity === 0} onClick={() => setSelectedQuantity(item.id, quantity - 1, availableQuantity)} aria-label={`کم کردن ${item.productNameSnapshot}`}>−</button>
                  <output>{englishNumber.format(quantity)} از {englishNumber.format(availableQuantity)}</output>
                  <button type="button" disabled={busy || quantity === availableQuantity} onClick={() => setSelectedQuantity(item.id, quantity + 1, availableQuantity)} aria-label={`زیاد کردن ${item.productNameSnapshot}`}>+</button>
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
              setTenders((current) => [...current, { id: requestKey(), method: "CASH", amount: "", reference: "" }]);
            }}>افزودن روش</button>
          </div>
          {tenders.map((tender, index) => (
            <div className="tender-row" key={tender.id}>
              <label>روش
                <select value={tender.method} disabled={busy} onChange={(event) => updateTender(tender.id, { method: event.target.value as TenderMethod, reference: "" })}>
                  <option value="CASH">نقدی</option>
                  <option value="CARD_TERMINAL">کارتخوان</option>
                  <option value="CARD_TRANSFER">کارت‌به‌کارت</option>
                </select>
              </label>
              <label>مبلغ (تومان)
                <input inputMode="numeric" value={tender.amount} disabled={busy} onChange={(event) => updateTender(tender.id, { amount: event.target.value.replace(/[^0-9]/g, "") })} aria-label={`مبلغ روش پرداخت ${index + 1}`} />
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
        <div className={`settlement-total ${isReconciled ? "settlement-total--matched" : "settlement-total--mismatch"}`} aria-live="polite">
          <span>جمع اقلام انتخاب‌شده <strong>{formatToman(selectedAmount)}</strong></span>
          <span>جمع روش‌های پرداخت <strong>{formatToman(tenderAmount)}</strong></span>
          <b>{selectedAmount === 0 ? "حداقل یک قلم را انتخاب کنید." : isReconciled ? "مبالغ با هم برابرند." : "جمع روش‌های پرداخت باید دقیقاً با مبلغ اقلام برابر باشد."}</b>
        </div>
        {error && <div className="toast toast--error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button className="button button--quiet" onClick={onClose}>
            انصراف
          </button>
          <button
            className="button button--primary"
            disabled={busy || !isReconciled}
            onClick={() => void settle()}
          >
            {busy ? "در حال ثبت…" : "تأیید پرداخت"}
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
