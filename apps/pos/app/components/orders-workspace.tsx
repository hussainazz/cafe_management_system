"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PosCatalogCategory, PosCatalogProduct, PosTable } from "@cafe/contracts";
import {
  markTableOccupied,
  readOpenOrders,
  readPosCatalog,
  readPosTables,
  type ApiFailure,
} from "../lib/api-client";
import { elapsedLabel, formatToman, persianNumber, sumAmounts } from "../lib/pos-utils";
import { BagIcon, CheckIcon, ClockIcon, CupIcon, TableIcon } from "./icons";

type Channel = "TABLE" | "TAKEAWAY";
type View = { kind: "dashboard" } | { kind: "composer"; channel: Channel; table: PosTable | null };
type CatalogOption = PosCatalogProduct["optionGroups"][number]["options"][number];
type DraftOption = Pick<CatalogOption, "id" | "name" | "priceAmount">;
type DraftItem = {
  key: string;
  productId: string;
  name: string;
  quantity: number;
  basePrice: number;
  options: DraftOption[];
};

type WorkspaceData = {
  catalog: PosCatalogCategory[];
  tables: PosTable[];
  openOrders: Array<{ tableId: string | null; totalAmount: number }>;
};

export function OrdersWorkspace() {
  const [section, setSection] = useState<Channel>("TABLE");
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [ordersWarning, setOrdersWarning] = useState<string | null>(null);
  const [occupyingId, setOccupyingId] = useState<string | null>(null);
  const [actionFailure, setActionFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    setOrdersWarning(null);
    const [catalog, tables, orders] = await Promise.all([
      readPosCatalog(),
      readPosTables(),
      readOpenOrders(),
    ]);
    if (!catalog.ok) {
      setFailure(catalog.error);
      setLoading(false);
      return;
    }
    if (!tables.ok) {
      setFailure(tables.error);
      setLoading(false);
      return;
    }
    if (!orders.ok)
      setOrdersWarning("مبلغ سفارش‌های باز اکنون قابل دریافت نیست؛ وضعیت میزها همچنان تازه است.");
    setData({
      catalog: catalog.data,
      tables: tables.data,
      openOrders: orders.ok ? orders.data : [],
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const occupyAndOpen = useCallback(async (table: PosTable) => {
    if (table.occupancyState === "OCCUPIED") {
      setView({ kind: "composer", channel: "TABLE", table });
      return;
    }
    setOccupyingId(table.id);
    setActionFailure(null);
    const result = await markTableOccupied(table.id);
    setOccupyingId(null);
    if (!result.ok) {
      setActionFailure(result.error.message);
      return;
    }
    setData((current) =>
      current
        ? {
            ...current,
            tables: current.tables.map((item) => (item.id === table.id ? result.data : item)),
          }
        : current,
    );
    setView({ kind: "composer", channel: "TABLE", table: result.data });
  }, []);

  if (loading) return <WorkspaceLoading />;
  if (failure || !data)
    return (
      <WorkspaceFailure
        message={failure?.message ?? "اطلاعات سفارش آماده نشد."}
        onRetry={() => void load()}
      />
    );

  return (
    <section className="orders-page" aria-labelledby="orders-title">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">فضای کاری روزانه</p>
          <h1 id="orders-title">سفارش</h1>
        </div>
        {view.kind === "composer" ? (
          <button
            className="back-button"
            type="button"
            onClick={() => {
              setView({ kind: "dashboard" });
            }}
          >
            بازگشت به میزها
          </button>
        ) : null}
      </header>

      <div className="channel-switch" role="tablist" aria-label="نوع سفارش">
        <button
          type="button"
          role="tab"
          aria-selected={section === "TABLE"}
          className={section === "TABLE" ? "is-active" : ""}
          onClick={() => {
            setSection("TABLE");
            setView({ kind: "dashboard" });
          }}
        >
          <TableIcon />
          سالن
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "TAKEAWAY"}
          className={section === "TAKEAWAY" ? "is-active" : ""}
          onClick={() => {
            setSection("TAKEAWAY");
            setView({ kind: "dashboard" });
          }}
        >
          <BagIcon />
          بیرون بر
        </button>
      </div>

      {actionFailure ? (
        <div className="inline-error workspace-alert" role="alert">
          {actionFailure}
          <button
            type="button"
            onClick={() => {
              setActionFailure(null);
            }}
          >
            بستن
          </button>
        </div>
      ) : null}
      {ordersWarning ? (
        <div className="inline-warning workspace-alert" role="status">
          {ordersWarning}
        </div>
      ) : null}

      {view.kind === "composer" ? (
        <OrderComposer
          key={`${view.channel}-${view.table?.id ?? "takeaway"}`}
          catalog={data.catalog}
          channel={view.channel}
          table={view.table}
        />
      ) : section === "TABLE" ? (
        <TableDashboard
          data={data}
          occupyingId={occupyingId}
          onOpen={(table) => {
            setView({ kind: "composer", channel: "TABLE", table });
          }}
          onOccupy={(table) => void occupyAndOpen(table)}
        />
      ) : (
        <TakeawayEntry
          onOpen={() => {
            setView({ kind: "composer", channel: "TAKEAWAY", table: null });
          }}
        />
      )}
    </section>
  );
}

function TableDashboard({
  data,
  occupyingId,
  onOpen,
  onOccupy,
}: {
  data: WorkspaceData;
  occupyingId: string | null;
  onOpen: (table: PosTable) => void;
  onOccupy: (table: PosTable) => void;
}) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(clock);
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    data.openOrders.forEach((order) => {
      if (order.tableId) map.set(order.tableId, (map.get(order.tableId) ?? 0) + order.totalAmount);
    });
    return map;
  }, [data.openOrders]);

  if (!data.tables.length)
    return (
      <EmptyPanel title="هنوز میزی تعریف نشده است">
        پس از فعال شدن میزهای فیزیکی، آن‌ها در این بخش دیده می‌شوند.
      </EmptyPanel>
    );

  return (
    <div className="tables-section">
      <div className="section-copy">
        <div>
          <h2>میزهای سالن</h2>
          <p>برای باز کردن سفارش، میز را انتخاب کنید.</p>
        </div>
        <div className="table-legend" aria-label="راهنمای وضعیت میز">
          <span>
            <i className="legend-free" />
            آزاد
          </span>
          <span>
            <i className="legend-busy" />
            اشغال
          </span>
          <span>
            <i className="legend-order" />
            سفارش باز
          </span>
        </div>
      </div>
      <div className="table-grid">
        {data.tables.map((table) => {
          const subtotal = totals.get(table.id);
          const hasOrder = table.activeOrders.length > 0;
          const state = hasOrder ? "order" : table.occupancyState === "OCCUPIED" ? "busy" : "free";
          const elapsed = elapsedLabel(
            table.occupiedAt ?? table.activeOrders[0]?.createdAt ?? null,
            now,
          );
          return (
            <article className={`table-card table-card--${state}`} key={table.id}>
              <button
                className="table-card__open"
                type="button"
                onClick={() => {
                  if (clickTimer.current) clearTimeout(clickTimer.current);
                  clickTimer.current = setTimeout(() => {
                    onOpen(table);
                  }, 230);
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  if (clickTimer.current) clearTimeout(clickTimer.current);
                  if (table.occupancyState === "AVAILABLE") onOccupy(table);
                  else onOpen(table);
                }}
                aria-label={`باز کردن میز ${table.name}، ${hasOrder ? "دارای سفارش باز" : table.occupancyState === "OCCUPIED" ? "اشغال" : "آزاد"}`}
              >
                <span className="table-card__top">
                  <span className="table-name">{table.name}</span>
                  <span className={`table-state table-state--${state}`}>
                    {hasOrder ? (
                      <CupIcon />
                    ) : table.occupancyState === "OCCUPIED" ? (
                      <ClockIcon />
                    ) : (
                      <CheckIcon />
                    )}
                    {hasOrder
                      ? "سفارش باز"
                      : table.occupancyState === "OCCUPIED"
                        ? "اشغال"
                        : "آزاد"}
                  </span>
                </span>
                <span className="table-card__details">
                  {elapsed ? (
                    <span>
                      <ClockIcon />
                      {elapsed}
                    </span>
                  ) : (
                    <span className="quiet-detail">آماده پذیرش</span>
                  )}
                  {hasOrder ? (
                    <strong>
                      {subtotal === undefined ? "مبلغ نامشخص" : formatToman(subtotal)}
                    </strong>
                  ) : null}
                </span>
              </button>
              {table.occupancyState === "AVAILABLE" ? (
                <button
                  className="occupy-button"
                  type="button"
                  disabled={occupyingId === table.id}
                  onClick={() => {
                    onOccupy(table);
                  }}
                >
                  {occupyingId === table.id ? "در حال تغییر…" : "اشغال کردن میز"}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      <p className="dashboard-hint">
        روی میز آزاد دوبار کلیک کنید یا برای لمس و صفحه‌کلید، دکمه «اشغال کردن میز» را بزنید.
      </p>
    </div>
  );
}

function TakeawayEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="takeaway-entry">
      <div className="takeaway-entry__icon">
        <BagIcon />
      </div>
      <p className="eyebrow">بدون میز فیزیکی</p>
      <h2>سفارش بیرون بر</h2>
      <p>محصولات را انتخاب کنید و سفارش را بدون وابستگی به میز آماده کنید.</p>
      <button className="primary-button" type="button" onClick={onOpen}>
        شروع سفارش بیرون بر
      </button>
    </div>
  );
}

function OrderComposer({
  catalog,
  channel,
  table,
}: {
  catalog: PosCatalogCategory[];
  channel: Channel;
  table: PosTable | null;
}) {
  const [categoryId, setCategoryId] = useState(catalog[0]?.id ?? "");
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [choosing, setChoosing] = useState<PosCatalogProduct | null>(null);
  const selectedCategory = catalog.find((category) => category.id === categoryId) ?? catalog[0];
  const subtotal = sumAmounts(draft.map((item) => unitPrice(item) * item.quantity));

  const addProduct = (product: PosCatalogProduct, options: DraftOption[] = []) => {
    const signature = `${product.id}:${options
      .map((option) => option.id)
      .sort()
      .join(",")}`;
    setDraft((current) => {
      const existing = current.find((item) => item.key === signature);
      return existing
        ? current.map((item) =>
            item.key === signature ? { ...item, quantity: item.quantity + 1 } : item,
          )
        : [
            ...current,
            {
              key: signature,
              productId: product.id,
              name: product.name,
              quantity: 1,
              basePrice: product.priceAmount,
              options,
            },
          ];
    });
    setChoosing(null);
  };

  if (!catalog.length)
    return (
      <EmptyPanel title="فهرست محصولات خالی است">
        در حال حاضر محصول فعالی برای سفارش وجود ندارد.
      </EmptyPanel>
    );

  return (
    <div className="composer-wrap">
      <div className="composer-context">
        <span>{channel === "TABLE" ? `میز ${table?.name ?? "—"}` : "بیرون بر"}</span>
        <small>پیش‌نویس محلی · قیمت و موجودی از فهرست سرویس</small>
      </div>
      <div className="order-composer">
        <aside className="category-column" aria-label="دسته‌بندی محصولات">
          <div className="column-heading">
            <span>۱</span>
            <div>
              <h2>دسته‌ها</h2>
              <p>انتخاب گروه</p>
            </div>
          </div>
          <div className="category-list" role="tablist" aria-label="دسته‌بندی محصولات">
            {catalog.map((category) => (
              <button
                key={category.id}
                type="button"
                role="tab"
                aria-selected={category.id === selectedCategory?.id}
                className={category.id === selectedCategory?.id ? "is-active" : ""}
                onClick={() => {
                  setCategoryId(category.id);
                }}
              >
                {category.name}
                <small>{persianNumber.format(category.products.length)}</small>
              </button>
            ))}
          </div>
        </aside>
        <section className="products-column" aria-label="محصولات">
          <div className="column-heading">
            <span>۲</span>
            <div>
              <h2>{selectedCategory?.name ?? "محصولات"}</h2>
              <p>برای افزودن انتخاب کنید</p>
            </div>
          </div>
          {selectedCategory?.products.length ? (
            <div className="product-grid">
              {selectedCategory.products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="product-card"
                  disabled={!product.isAvailable}
                  onClick={() => {
                    if (product.optionGroups.length) setChoosing(product);
                    else addProduct(product);
                  }}
                >
                  <span className="product-card__name">{product.name}</span>
                  <span className="product-card__price">
                    {product.isAvailable ? formatToman(product.priceAmount) : "ناموجود"}
                  </span>
                  {product.optionGroups.length ? (
                    <span className="product-card__option">انتخاب گزینه</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="column-empty">محصولی در این دسته وجود ندارد.</div>
          )}
        </section>
        <aside className="cart-column" aria-label="اقلام انتخاب‌شده">
          <div className="column-heading">
            <span>۳</span>
            <div>
              <h2>سفارش جاری</h2>
              <p>{persianNumber.format(draft.length)} ردیف</p>
            </div>
          </div>
          <Cart
            items={draft}
            subtotal={subtotal}
            onQuantity={(key, delta) => {
              setDraft((current) =>
                current.flatMap((item) =>
                  item.key !== key
                    ? [item]
                    : item.quantity + delta <= 0
                      ? []
                      : [{ ...item, quantity: item.quantity + delta }],
                ),
              );
            }}
          />
        </aside>
      </div>
      {choosing ? (
        <OptionDialog
          product={choosing}
          onClose={() => {
            setChoosing(null);
          }}
          onConfirm={(options) => {
            addProduct(choosing, options);
          }}
        />
      ) : null}
    </div>
  );
}

function unitPrice(item: DraftItem) {
  return item.basePrice + sumAmounts(item.options.map((option) => option.priceAmount));
}

function Cart({
  items,
  subtotal,
  onQuantity,
}: {
  items: DraftItem[];
  subtotal: number;
  onQuantity: (key: string, delta: number) => void;
}) {
  return (
    <div className="cart-body">
      {items.length ? (
        <ul className="cart-lines">
          {items.map((item) => (
            <li key={item.key}>
              <div className="cart-line__title">
                <strong>{item.name}</strong>
                {item.options.length ? (
                  <small>{item.options.map((option) => option.name).join("، ")}</small>
                ) : null}
              </div>
              <div className="cart-line__money">
                <span>واحد: {formatToman(unitPrice(item))}</span>
                <strong>{formatToman(unitPrice(item) * item.quantity)}</strong>
              </div>
              <div className="quantity-control" aria-label={`تعداد ${item.name}`}>
                <button
                  type="button"
                  onClick={() => {
                    onQuantity(item.key, -1);
                  }}
                  aria-label={`کم کردن ${item.name}`}
                >
                  −
                </button>
                <output>{persianNumber.format(item.quantity)}</output>
                <button
                  type="button"
                  onClick={() => {
                    onQuantity(item.key, 1);
                  }}
                  aria-label={`زیاد کردن ${item.name}`}
                >
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="cart-empty">
          <CupIcon />
          <strong>سفارش خالی است</strong>
          <p>از ستون محصولات یک مورد انتخاب کنید.</p>
        </div>
      )}
      <div className="subtotal">
        <span>جمع سفارش</span>
        <strong>{formatToman(subtotal)}</strong>
      </div>
      <p className="server-truth">مبلغ نهایی هنگام ثبت سفارش توسط سرویس دوباره محاسبه می‌شود.</p>
    </div>
  );
}

function OptionDialog({
  product,
  onClose,
  onConfirm,
}: {
  product: PosCatalogProduct;
  onClose: () => void;
  onConfirm: (options: DraftOption[]) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const availableGroups = product.optionGroups.map((group) => ({
    ...group,
    options: group.options.filter((option) => option.isAvailable),
  }));
  const [selected, setSelected] = useState<Record<string, string>>({});
  const complete = availableGroups.every((group) => group.options.length > 0 && selected[group.id]);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  const chosen = availableGroups.flatMap((group) =>
    group.options.filter((option) => option.id === selected[group.id]),
  );
  const selectedPrice =
    product.priceAmount + sumAmounts(chosen.map((option) => option.priceAmount));

  return (
    <dialog
      ref={dialogRef}
      className="option-dialog"
      aria-labelledby="option-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (complete) onConfirm(chosen);
        }}
      >
        <div className="option-dialog__head">
          <div>
            <p className="eyebrow">انتخاب الزامی</p>
            <h2 id="option-title">{product.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="بستن انتخاب گزینه">
            ×
          </button>
        </div>
        {availableGroups.map((group) => (
          <fieldset key={group.id}>
            <legend>{group.name}</legend>
            <div className="option-grid">
              {group.options.map((option) => (
                <label
                  key={option.id}
                  className={selected[group.id] === option.id ? "is-selected" : ""}
                >
                  <input
                    type="radio"
                    name={group.id}
                    value={option.id}
                    checked={selected[group.id] === option.id}
                    onChange={() => {
                      setSelected((current) => ({ ...current, [group.id]: option.id }));
                    }}
                  />
                  <span>{option.name}</span>
                  <small>
                    {option.priceAmount ? `+ ${formatToman(option.priceAmount)}` : "بدون افزایش"}
                  </small>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {!complete && availableGroups.some((group) => !group.options.length) ? (
          <div className="inline-error" role="alert">
            گزینه قابل انتخابی برای این محصول موجود نیست.
          </div>
        ) : null}
        <div className="option-dialog__actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            انصراف
          </button>
          <button className="primary-button" type="submit" disabled={!complete}>
            افزودن · {formatToman(selectedPrice)}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function EmptyPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-panel">
      <CupIcon />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
function WorkspaceFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty-panel empty-panel--error" role="alert">
      <h2>فضای سفارش آماده نشد</h2>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={onRetry}>
        تلاش دوباره
      </button>
    </div>
  );
}
function WorkspaceLoading() {
  return (
    <div className="workspace-loading" aria-busy="true" aria-label="در حال دریافت میزها و محصولات">
      <div className="skeleton skeleton--heading" />
      <div className="skeleton-tabs">
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
      <div className="skeleton-grid">
        {Array.from({ length: 8 }, (_, index) => (
          <span className="skeleton" key={index} />
        ))}
      </div>
    </div>
  );
}
