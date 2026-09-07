"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  updateOpenOrder,
  type PosOrderDetail,
} from "../lib/api-client";
import { elapsedLabel, englishNumber, formatToman, sumAmounts } from "../lib/pos-utils";
import { AlertIcon, BagIcon, CupIcon, RefreshIcon, TableIcon } from "./icons";

type Channel = "TABLE" | "TAKEAWAY";
type OrderDetail = PosOrderDetail;
type Option = PosCatalogProduct["optionGroups"][number]["options"][number];
type Draft = { key: string; product: PosCatalogProduct; options: Option[]; quantity: number };
type ProductCard = { key: string; name: string; products: PosCatalogProduct[] };
type Data = {
  catalog: PosCatalogCategory[];
  tables: PosTable[];
  calls: Array<{ tableId: string; version: number }>;
  openOrders: Array<{ id: string; tableId: string | null; totalAmount: number }>;
};
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

export function OrdersWorkspace({ refreshing }: { refreshing: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [channel, setChannel] = useState<Channel>("TABLE");
  const [selected, setSelected] = useState<PosTable | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: "error" | "notice"; text: string } | null>(null);
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
    setChannel("TABLE");
  };
  const close = () => {
    setSelected(null);
    setOrder(null);
  };
  if (loading) return <Loading />;
  if (!data) return <Failure onRetry={load} message={message?.text ?? "صندوق آماده نشد."} />;
  return (
    <section className="pos-workspace">
      <header className="workspace-header">
        <div className="header-actions">
          <span className={`connection ${refreshing ? "connection--busy" : ""}`}>
            <i aria-hidden="true" />
            {refreshing ? "در حال بازخوانی" : "متصل"}
          </span>
          <button className="icon-button" onClick={() => void load()} aria-label="تازه‌سازی">
            <RefreshIcon />
          </button>
          {(selected || channel === "TAKEAWAY") && (
            <button className="button button--quiet" onClick={close}>
              بازگشت به میزها
            </button>
          )}
        </div>
        <div className="channel-tabs" role="tablist" aria-label="کانال سفارش">
          <button
            className={channel === "TABLE" && !selected ? "active" : ""}
            onClick={() => {
              setChannel("TABLE");
              close();
            }}
          >
            <TableIcon /> سالن
          </button>
          <button
            className={channel === "TAKEAWAY" ? "active" : ""}
            onClick={() => {
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
      {selected || channel === "TAKEAWAY" ? (
        <OrderDesk
          catalog={data.catalog}
          table={selected}
          channel={channel}
          initialOrder={order}
          onOrder={setOrder}
          onDone={async (notice) => {
            setMessage({ tone: "notice", text: notice });
            close();
            await load();
          }}
        />
      ) : (
        <TableBoard
          tables={data.tables}
          calls={data.calls}
          orders={data.openOrders}
          onSelect={selectTable}
        />
      )}
    </section>
  );
}

function TableBoard({
  tables,
  calls,
  orders,
  onSelect,
}: {
  tables: PosTable[];
  calls: Data["calls"];
  orders: Data["openOrders"];
  onSelect: (table: PosTable) => void;
}) {
  const totals = new Map(orders.filter((x) => x.tableId).map((x) => [x.tableId!, x.totalAmount]));
  return (
    <div className="table-board">
      <div className="table-grid">
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
            <article key={table.id} className={`table-tile table-tile--${state}`}>
              <button className="table-tile__main" onClick={() => onSelect(table)}>
                <span className="table-tile__top">
                  <strong>{table.name}</strong>
                </span>
                <span className="table-tile__details">
                  {hasOrder ? (
                    <>
                      <span>{table.activeOrders[0]?.orderNumber}</span>
                      <b>{formatToman(totals.get(table.id) ?? 0)}</b>
                    </>
                  ) : (
                    <span>{table.occupiedAt ? elapsedLabel(table.occupiedAt) : "آماده پذیرش"}</span>
                  )}
                </span>
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function OrderDesk({
  catalog,
  table,
  channel,
  initialOrder,
  onOrder,
  onDone,
}: {
  catalog: PosCatalogCategory[];
  table: PosTable | null;
  channel: Channel;
  initialOrder: OrderDetail | null;
  onOrder: (order: OrderDetail | null) => void;
  onDone: (message: string) => void;
}) {
  const [categoryId, setCategoryId] = useState(catalog[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft[]>([]);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<PosCatalogProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState(false);
  const category = catalog.find((x) => x.id === categoryId) ?? catalog[0];
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
        : [...current, { key: signature, product, options, quantity: 1 }];
    });
    setExpandedCard(null);
    setSelectedProduct(null);
  };
  const payloadItems = () =>
    draft.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      options: item.options.map((option) => ({ optionId: option.id, quantity: 1 })),
    }));
  const save = async () => {
    if (!draft.length) return;
    setBusy(true);
    setError(null);
    if (initialOrder) {
      const result = await updateOpenOrder(initialOrder.id, {
        expectedVersion: initialOrder.version,
        addItems: payloadItems(),
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onOrder(result.data);
    } else {
      const result = await createOpenOrder(
        channel === "TABLE"
          ? { channel, tableId: table!.id, items: payloadItems() }
          : { channel, items: payloadItems() },
        requestKey(),
      );
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const detail = await readOrder(result.data.id);
      if (!detail.ok) {
        setError(detail.error.message);
        return;
      }
      onOrder(detail.data);
    }
    setDraft([]);
  };
  const remove = async () => {
    if (
      !initialOrder ||
      !confirm("این سفارش به‌صورت منطقی از عملیات فعال حذف می‌شود. ادامه می‌دهید؟")
    )
      return;
    setBusy(true);
    const result = await deleteOpenOrder(initialOrder.id, {
      expectedVersion: initialOrder.version,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onDone("سفارش از فهرست فعال حذف شد.");
  };
  return (
    <>
      <div className="service-context">
        <span className="context-icon">{channel === "TABLE" ? <TableIcon /> : <BagIcon />}</span>
        <div>
          <b>{channel === "TABLE" ? `میز ${table?.name}` : "سفارش بیرون‌بر"}</b>
          <small>
            {initialOrder
              ? `${initialOrder.orderNumber} · ${initialOrder.paymentStatus === "PAID" ? "تسویه‌شده" : "باز"}`
              : "پیش‌نویس جدید"}
          </small>
        </div>
        {initialOrder && (
          <span className="payment-chip">مانده {formatToman(initialOrder.balanceAmount)}</span>
        )}
      </div>
      {error && (
        <div className="toast toast--error" role="alert">
          <AlertIcon />
          {error}
        </div>
      )}
      <div className="order-desk">
        <aside className="categories">
          <p className="kicker">دسته‌ها</p>
          <h2>فهرست</h2>
          <div>
            {catalog.map((item) => (
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
        </aside>
        <section className="products">
          <div className="section-title">
            <div>
              <p className="kicker">انتخاب محصول</p>
              <h2>{category?.name}</h2>
            </div>
            <span>{englishNumber.format(category?.products.length ?? 0)} آیتم</span>
          </div>
          <div className="product-grid">
            {cards.map((card) => (
              <ProductPicker
                key={card.key}
                card={card}
                expanded={expandedCard === card.key}
                selectedProduct={selectedProduct}
                onOpen={() => {
                  const soleProduct = card.products[0];
                  if (card.products.length === 1 && soleProduct && soleProduct.optionGroups.length === 0) {
                    add(soleProduct);
                    return;
                  }
                  setExpandedCard(card.key);
                  setSelectedProduct(card.products.length === 1 ? soleProduct ?? null : null);
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
            onSave={() => void save()}
            onCheckout={() => setCheckout(true)}
            onDelete={() => void remove()}
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
            if (updated.state === "DELETED" && channel === "TABLE") {
              onDone("پرداخت ثبت شد و میز آزاد شد.");
              return;
            }
            onOrder(updated);
          }}
        />
      )}
    </>
  );
}

function OrderSummary({
  order,
  draft,
  total,
  onQuantity,
  onSave,
  onCheckout,
  onDelete,
  busy,
}: {
  order: OrderDetail | null;
  draft: Draft[];
  total: number;
  onQuantity: (key: string, delta: number) => void;
  onSave: () => void;
  onCheckout: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [expandedDraftKey, setExpandedDraftKey] = useState<string | null>(null);
  return (
    <>
      <div className="section-title">
        <div>
          <p className="kicker">سفارش جاری</p>
          <h2>{order ? order.orderNumber : "پیش‌نویس"}</h2>
        </div>
        {order && (
          <span className="status-badge">
            {order.paymentStatus === "PAID"
              ? "تسویه شد"
              : order.paymentStatus === "PARTIALLY_PAID"
                ? "بخشی پرداخت شد"
                : "بدون پرداخت"}
          </span>
        )}
      </div>
      <div className="order-lines">
        {order?.items.map((item) => (
          <div className="order-line order-line--saved" key={item.id}>
            <b>
              {item.productNameSnapshot} × {englishNumber.format(item.quantity)}
            </b>
            <span>{formatToman(Math.floor(item.lineTotalAmount / item.quantity))}</span>
          </div>
        ))}
        {draft.map((item) => {
          const expanded = expandedDraftKey === item.key;
          const unitPrice = item.product.priceAmount + sumAmounts(item.options.map((x) => x.priceAmount));
          return (
            <article className={expanded ? "order-line order-line--expanded" : "order-line"} key={item.key}>
              <button
                className="order-line__summary"
                type="button"
                aria-expanded={expanded}
                aria-controls={`quantity-${item.key}`}
                onClick={() => setExpandedDraftKey((current) => (current === item.key ? null : item.key))}
              >
                <span className="order-line__count">
                  {englishNumber.format(item.quantity)} <b>×</b>
                </span>
                <span className="order-line__details">
                  <b>{item.product.name}</b>
                  {item.options.length > 0 && <small>{item.options.map((x) => x.name).join("، ")}</small>}
                </span>
                <strong>{formatToman(unitPrice)}</strong>
              </button>
              {expanded && (
                <div className="quantity" id={`quantity-${item.key}`} aria-label={`تعداد ${item.product.name}`}>
                  <button type="button" aria-label={`کم کردن ${item.product.name}`} onClick={() => onQuantity(item.key, -1)}>
                    −
                  </button>
                  <output>{englishNumber.format(item.quantity)}</output>
                  <button type="button" aria-label={`زیاد کردن ${item.product.name}`} onClick={() => onQuantity(item.key, 1)}>
                    +
                  </button>
                  <strong className="quantity__total">
                    <small>جمع این آیتم</small>
                    {formatToman(unitPrice * item.quantity)}
                  </strong>
                </div>
              )}
            </article>
          );
        })}
        {!order && !draft.length && (
          <div className="empty-order">
            <CupIcon />
            <b>سفارش خالی است</b>
            <span>یک محصول را انتخاب کنید.</span>
          </div>
        )}
      </div>
      <div className="order-total">
        <span>{order ? "مانده پرداخت" : "جمع پیش‌نویس"}</span>
        <strong>{formatToman(order ? order.balanceAmount : total)}</strong>
      </div>
      {draft.length > 0 && (
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
          <button className="button button--quiet" onClick={() => window.print()}>
            چاپ رسید
          </button>
          <button className="text-danger" disabled={busy} onClick={onDelete}>
            حذف سفارش
          </button>
        </div>
      )}
      <p className="server-note">قیمت، موجودی و مبلغ نهایی در سرویس تأیید می‌شود.</p>
    </>
  );
}

function ProductPicker({
  card,
  expanded,
  selectedProduct,
  onOpen,
  onSelectProduct,
  onSelectOptions,
}: {
  card: ProductCard;
  expanded: boolean;
  selectedProduct: PosCatalogProduct | null;
  onOpen: () => void;
  onSelectProduct: (product: PosCatalogProduct) => void;
  onSelectOptions: (product: PosCatalogProduct, options: Option[]) => void;
}) {
  const [picked, setPicked] = useState<Record<string, Option>>({});
  useEffect(() => setPicked({}), [expanded, selectedProduct?.id]);
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
    <article className={expanded ? "product-picker product-picker--expanded" : "product-picker"}>
      <button className="product-card" disabled={!isAvailable} onClick={onOpen} aria-expanded={expanded}>
        <span>{card.name}</span>
        <b>{isAvailable ? formatToman(Math.min(...card.products.map((product) => product.priceAmount))) : "ناموجود"}</b>
        {(showSizeChoices || card.products.some((product) => product.optionGroups.length > 0)) && <small>دارای انتخاب</small>}
      </button>
      {expanded && (
        <div className="product-picker__choices">
          {showSizeChoices && (
            <div className="shot-choices" aria-label="اندازه شات">
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
          {selectedProduct && groups.map((group) => (
            <section className="product-option-group" key={group.id}>
              <small>{group.name}</small>
              <div>
                {group.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={picked[group.id]?.id === option.id ? "active" : ""}
                    onClick={() => chooseOption(group.id, option)}
                  >
                    <span>{option.name}</span>
                    <b>{formatToman(option.priceAmount)}</b>
                  </button>
                ))}
              </div>
            </section>
          ))}
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
  const unpaid = useMemo(() => {
    const used = new Map<string, number>();
    order.settlements
      .filter((x) => !x.reversedAt)
      .forEach((s) =>
        s.allocations.forEach((a) =>
          used.set(a.orderItemId, (used.get(a.orderItemId) ?? 0) + a.quantity),
        ),
      );
    return order.items
      .map((item) => ({ item, quantity: item.quantity - (used.get(item.id) ?? 0) }))
      .filter((x) => x.quantity > 0);
  }, [order]);
  const [method, setMethod] = useState<"CASH" | "CARD_TERMINAL" | "CARD_TRANSFER">("CARD_TERMINAL");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = sumAmounts(
    unpaid.map(({ item, quantity }) =>
      Math.floor((item.lineTotalAmount / item.quantity) * quantity),
    ),
  );
  const settle = async () => {
    setBusy(true);
    const payment =
      method === "CARD_TRANSFER" && reference.trim()
        ? { method, amount, reference: reference.trim() }
        : { method, amount };
    const result = await recordSettlement(
      order.id,
      {
        expectedVersion: order.version,
        allocations: unpaid.map(({ item, quantity }) => ({ orderItemId: item.id, quantity })),
        payments: [payment],
      },
      requestKey(),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onSuccess(result.data);
  };
  return (
    <div className="modal-backdrop">
      <section className="modal-card">
        <div className="modal-header">
          <div>
            <p className="kicker">ثبت پرداخت</p>
            <h2>تسویه {order.orderNumber}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="settlement-total">
          مبلغ انتخاب‌شده <strong>{formatToman(amount)}</strong>
        </p>
        <div className="payment-methods">
          {(["CASH", "CARD_TERMINAL", "CARD_TRANSFER"] as const).map((item) => (
            <button
              key={item}
              className={method === item ? "active" : ""}
              onClick={() => setMethod(item)}
            >
              {item === "CASH" ? "نقدی" : item === "CARD_TERMINAL" ? "کارتخوان" : "کارت‌به‌کارت"}
            </button>
          ))}
        </div>
        {method === "CARD_TRANSFER" && (
          <label className="field">
            شماره پیگیری
            <input value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        )}
        {error && <div className="toast toast--error">{error}</div>}
        <div className="modal-actions">
          <button className="button button--quiet" onClick={onClose}>
            انصراف
          </button>
          <button
            className="button button--primary"
            disabled={busy || !amount}
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
