"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CreateOrderRequest, PosCatalogCategory, PosCatalogProduct, PosTable } from "@cafe/contracts";
import { createOpenOrder, readPosCatalog, readPosTables, type ApiFailure } from "../lib/api-client";
import { Button, InlineAlert, Panel, Skeleton, StatusBadge } from "./ui";

type Channel = "TABLE" | "TAKEAWAY";
type DraftItem = { key: string; productId: string; productName: string; quantity: number; note: string; optionIds: string[] };
type Submission = { kind: "idle" } | { kind: "pending"; key: string } | { kind: "failure"; error: ApiFailure; key: string } | { kind: "success"; orderNumber: string; totalAmount: number; preparationMinutes: number; replayed: boolean };

const toman = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
const money = (amount: number) => `${toman.format(amount)} تومان`;
const retryable = (error: ApiFailure) => error.kind === "network" || error.status === undefined || error.status >= 500;
const idempotencyKey = () => `pos-order-${crypto.randomUUID()}`;

export function NewOrderWorkspace() {
  const [catalog, setCatalog] = useState<PosCatalogCategory[]>([]);
  const [tables, setTables] = useState<PosTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null);
  const [channel, setChannel] = useState<Channel>("TABLE");
  const [tableId, setTableId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [submission, setSubmission] = useState<Submission>({ kind: "idle" });

  const refetch = useCallback(async () => {
    setLoading(true); setLoadFailure(null);
    const [catalogResult, tablesResult] = await Promise.all([readPosCatalog(), readPosTables()]);
    if (!catalogResult.ok) { setLoadFailure(catalogResult.error); setLoading(false); return; }
    if (!tablesResult.ok) { setLoadFailure(tablesResult.error); setLoading(false); return; }
    setCatalog(catalogResult.data); setTables(tablesResult.data);
    setCategoryId((current) => current && catalogResult.data.some((category) => category.id === current) ? current : catalogResult.data[0]?.id ?? "");
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);
  const category = catalog.find((entry) => entry.id === categoryId) ?? catalog[0];
  const selectedTable = tables.find((table) => table.id === tableId);
  const canSubmit = draft.length > 0 && (channel === "TAKEAWAY" || Boolean(tableId)) && submission.kind !== "pending";

  const submit = async () => {
    if (!canSubmit) return;
    const key = submission.kind === "failure" ? submission.key : idempotencyKey();
    const items = draft.map(({ productId, quantity, note, optionIds }) => ({ productId, quantity, ...(note.trim() ? { note: note.trim() } : {}), options: optionIds.map((optionId) => ({ optionId, quantity })) }));
    const input: CreateOrderRequest = channel === "TABLE" ? { channel, tableId, items } : { channel, items };
    setSubmission({ kind: "pending", key });
    const result = await createOpenOrder(input, key);
    if (result.ok) {
      setSubmission({ kind: "success", orderNumber: result.data.orderNumber, totalAmount: result.data.totalAmount, preparationMinutes: result.data.estimatedPreparationMinutes, replayed: result.replayed });
      return;
    }
    setSubmission({ kind: "failure", error: result.error, key });
    if (result.error.code === "UNAVAILABLE_PRODUCT" || result.error.status === 409 || result.error.status === 422) void refetch();
  };

  const addItem = (item: DraftItem) => { setDraft((current) => [...current, item]); setSubmission({ kind: "idle" }); };
  const changeQuantity = (key: string, delta: number) => { setDraft((current) => current.map((item) => item.key === key ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item)); setSubmission({ kind: "idle" }); };
  const removeItem = (key: string) => { setDraft((current) => current.filter((item) => item.key !== key)); setSubmission({ kind: "idle" }); };
  const updateNote = (key: string, note: string) => { setDraft((current) => current.map((item) => item.key === key ? { ...item, note } : item)); setSubmission({ kind: "idle" }); };

  if (loading) return <OrderLoading />;
  if (loadFailure) return <Panel className="order-load-failure"><InlineAlert tone="danger" title="فضای سفارش آماده نشد">{loadFailure.message}</InlineAlert><Button tone="secondary" onClick={() => void refetch()}>تلاش دوباره</Button></Panel>;

  return <div className="order-workspace">
    <section className="order-workspace__heading"><div><h1>سفارش جدید</h1><p>اقلام را انتخاب کنید؛ مبلغ و زمان نهایی فقط پس از ثبت از سرویس تأیید می‌شود.</p></div><StatusBadge tone="info">ثبت سفارش باز</StatusBadge></section>
    <div className="order-workspace__grid">
      <aside className="order-context" aria-label="نوع و مقصد سفارش">
        <Panel className="order-context__panel"><h2>نوع سفارش</h2><div className="order-channel" role="radiogroup" aria-label="نوع سفارش"><button className={channel === "TABLE" ? "is-selected" : ""} role="radio" aria-checked={channel === "TABLE"} onClick={() => { setChannel("TABLE"); setSubmission({ kind: "idle" }); }}>برای میز</button><button className={channel === "TAKEAWAY" ? "is-selected" : ""} role="radio" aria-checked={channel === "TAKEAWAY"} onClick={() => { setChannel("TAKEAWAY"); setTableId(""); setSubmission({ kind: "idle" }); }}>بیرون‌بر</button></div></Panel>
        {channel === "TABLE" ? <Panel className="order-context__panel"><h2>انتخاب میز <span aria-hidden="true">*</span></h2><p className="field-help">میز مقصد را انتخاب کنید. اعتبار نهایی هنگام ثبت بررسی می‌شود.</p><div className="table-picker">{tables.map((table) => <button key={table.id} type="button" className={tableId === table.id ? "is-selected" : ""} onClick={() => { setTableId(table.id); setSubmission({ kind: "idle" }); }}><b>{table.name}</b><small>{table.activeOrders.length ? `سفارش باز: ${table.activeOrders.length}` : table.occupancyState === "OCCUPIED" ? "اشغال" : "آزاد"}</small></button>)}</div>{selectedTable ? <p className="selection-note">میز «{selectedTable.name}» انتخاب شد.</p> : null}</Panel> : <Panel className="order-context__panel takeaway-note"><h2>بیرون‌بر</h2><p>این سفارش به میزی وابسته نیست و زمان آماده‌سازی آن پس از ثبت از سرویس دریافت می‌شود.</p></Panel>}</aside>
      <section className="catalog-browser" aria-label="فهرست محصولات"><Panel className="catalog-browser__panel"><div className="catalog-browser__title"><h2>فهرست محصولات</h2><Button tone="quiet" onClick={() => void refetch()}>به‌روزرسانی فهرست</Button></div><div className="category-tabs" role="tablist" aria-label="دسته‌بندی محصولات">{catalog.map((entry) => <button key={entry.id} role="tab" aria-selected={entry.id === category?.id} className={entry.id === category?.id ? "is-active" : ""} onClick={() => setCategoryId(entry.id)}>{entry.name}</button>)}</div><div className="product-list">{category?.products.map((product) => <ProductAdd key={product.id} product={product} onAdd={addItem} />)}</div></Panel></section>
      <aside className="order-draft" aria-label="ترکیب سفارش"><Panel className="order-draft__panel"><OrderDraft items={draft} catalog={catalog} channel={channel} table={selectedTable} submission={submission} onQuantity={changeQuantity} onRemove={removeItem} onNote={updateNote} onSubmit={() => void submit()} canSubmit={canSubmit} onRefresh={() => void refetch()} /></Panel></aside>
    </div>
  </div>;
}

function ProductAdd({ product, onAdd }: { product: PosCatalogProduct; onAdd: (item: DraftItem) => void }) {
  const [open, setOpen] = useState(false); const [quantity, setQuantity] = useState(1); const [note, setNote] = useState(""); const [optionIds, setOptionIds] = useState<string[]>([]);
  const availableOptions = product.optionGroups.flatMap((group) => group.options.filter((option) => option.isAvailable));
  const add = () => { onAdd({ key: crypto.randomUUID(), productId: product.id, productName: product.name, quantity, note, optionIds }); setOpen(false); setQuantity(1); setNote(""); setOptionIds([]); };
  return <article className={`product-entry ${product.isAvailable ? "" : "product-entry--unavailable"}`}><div className="product-entry__summary"><div><h3>{product.name}</h3><p>{money(product.priceAmount)} <span>·</span> آماده‌سازی تا {toman.format(product.preparationDeadlineMinutes)} دقیقه</p></div>{product.isAvailable ? <Button tone="secondary" onClick={() => setOpen((value) => !value)}>{open ? "بستن" : "افزودن"}</Button> : <StatusBadge tone="danger">ناموجود</StatusBadge>}</div>{open ? <div className="product-entry__composer"><div className="quantity-control" aria-label={`تعداد ${product.name}`}><Button tone="quiet" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="کم کردن تعداد">−</Button><output>{toman.format(quantity)}</output><Button tone="quiet" onClick={() => setQuantity((value) => value + 1)} aria-label="زیاد کردن تعداد">+</Button></div>{product.optionGroups.map((group) => <fieldset key={group.id}><legend>{group.name}</legend>{group.options.map((option) => <label key={option.id} className={!option.isAvailable ? "is-unavailable" : ""}><input type="checkbox" checked={optionIds.includes(option.id)} disabled={!option.isAvailable} onChange={() => setOptionIds((current) => current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id])} /><span>{option.name}</span><em>{option.isAvailable ? money(option.priceAmount) : "ناموجود"}</em></label>)}</fieldset>)}<label className="note-field">یادداشت سفارش<textarea value={note} maxLength={1000} placeholder="مثلاً بدون شکر" onChange={(event) => setNote(event.target.value)} /></label><Button onClick={add}>افزودن به سفارش{availableOptions.length ? " با گزینه‌ها" : ""}</Button></div> : null}</article>;
}

function OrderDraft({ items, catalog, channel, table, submission, onQuantity, onRemove, onNote, onSubmit, canSubmit, onRefresh }: { items: DraftItem[]; catalog: PosCatalogCategory[]; channel: Channel; table: PosTable | undefined; submission: Submission; onQuantity: (key: string, delta: number) => void; onRemove: (key: string) => void; onNote: (key: string, note: string) => void; onSubmit: () => void; canSubmit: boolean; onRefresh: () => void }) {
  const optionNames = useMemo(() => new Map(catalog.flatMap((category) => category.products).flatMap((product) => product.optionGroups.flatMap((group) => group.options)).map((option) => [option.id, option.name])), [catalog]);
  if (submission.kind === "success") return <div className="order-success"><StatusBadge tone="success">سفارش باز ثبت شد</StatusBadge><h2>سفارش {submission.orderNumber}</h2><p>{submission.replayed ? "ثبت قبلی با همان درخواست با اطمینان تأیید شد." : "سفارش با موفقیت از سرویس تأیید شد."}</p><dl><div><dt>مبلغ نهایی</dt><dd>{money(submission.totalAmount)}</dd></div><div><dt>آماده‌سازی برآوردی</dt><dd>{toman.format(submission.preparationMinutes)} دقیقه</dd></div></dl><p className="server-note">این مبلغ و زمان توسط سرویس محاسبه شده‌اند.</p></div>;
  return <><div className="order-draft__heading"><div><h2>ترکیب سفارش</h2><p>{channel === "TABLE" ? table ? `میز ${table.name}` : "میز را انتخاب کنید" : "بیرون‌بر"}</p></div><StatusBadge tone={items.length ? "info" : "neutral"}>{toman.format(items.length)} قلم</StatusBadge></div>{items.length ? <ul className="draft-lines">{items.map((item) => <li key={item.key}><div><strong>{item.productName}</strong>{item.optionIds.length ? <small>{item.optionIds.map((id) => optionNames.get(id)).filter(Boolean).join("، ")}</small> : null}</div><div className="draft-line__controls"><div className="quantity-control"><Button tone="quiet" onClick={() => onQuantity(item.key, -1)} aria-label={`کم کردن ${item.productName}`}>−</Button><output>{toman.format(item.quantity)}</output><Button tone="quiet" onClick={() => onQuantity(item.key, 1)} aria-label={`زیاد کردن ${item.productName}`}>+</Button></div><Button tone="quiet" onClick={() => onRemove(item.key)}>حذف</Button></div><textarea aria-label={`یادداشت ${item.productName}`} value={item.note} maxLength={1000} placeholder="یادداشت" onChange={(event) => onNote(item.key, event.target.value)} /></li>)}</ul> : <div className="draft-empty"><p>هنوز محصولی به سفارش اضافه نشده است.</p><small>قیمت نهایی با مجموع محلی جایگزین نمی‌شود؛ سرویس آن را هنگام ثبت محاسبه می‌کند.</small></div>}{submission.kind === "failure" ? <InlineAlert tone="danger" title={retryable(submission.error) ? "نتیجه ثبت نامشخص است" : "ثبت سفارش نیاز به اصلاح دارد"}>{retryable(submission.error) ? "ارتباط کامل نشد. «ثبت دوباره» همان کلید امن را استفاده می‌کند و سفارش تکراری نمی‌سازد." : `${submission.error.message} فهرست و وضعیت میز بازخوانی شد؛ موارد را بررسی و دوباره ثبت کنید.`}</InlineAlert> : null}<div className="order-draft__submit"><p>مبلغ و زمان آماده‌سازی پس از ثبت، از سرویس نمایش داده می‌شود.</p>{submission.kind === "failure" && !retryable(submission.error) ? <Button tone="secondary" onClick={onRefresh}>بازخوانی وضعیت</Button> : null}<Button disabled={!canSubmit} onClick={onSubmit}>{submission.kind === "pending" ? "در حال ثبت امن سفارش" : submission.kind === "failure" ? "ثبت دوباره" : "ثبت سفارش باز"}</Button></div></>;
}

function OrderLoading() { return <div className="order-loading" aria-busy="true"><Skeleton className="order-loading__heading" /><div><Skeleton /><Skeleton /><Skeleton /></div></div>; }
