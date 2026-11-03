"use client";

import { roundDiscountedAmount, type PosCatalogCategory, type PosCatalogProduct } from "@cafe/contracts";
import { useEffect, useState, type FormEvent } from "react";
import {
  createStaffConsumption,
  deleteOpenOrder,
  discountStaffConsumption,
  readPosCatalog,
  readStaffConsumption,
  type StaffConsumptionEntry,
} from "../lib/api-client";
import { formatOrderNumber, formatToman, positiveIntegerAmount, sumAmounts, weightedPricePreview } from "../lib/pos-utils";
import { MenuIcon } from "./icons";
import { ProductPicker } from "./product-picker";

type Option = PosCatalogProduct["optionGroups"][number]["options"][number];
type Draft = { key: string; product: PosCatalogProduct; options: Option[]; weightGrams: number | undefined; quantity: number };
type DiscountKind = "FIXED" | "PERCENTAGE";
const newKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const productConfigurationKey = (productId: string, options: Option[], weightGrams?: number) =>
  `${productId}:${options.map((option) => option.id).sort().join(",")}:${weightGrams ?? ""}`;

function draftLineAmount(item: Draft): number {
  const optionAmount = sumAmounts(item.options.map((option) => option.priceAmount));
  const weighted = item.product.pricingMode === "WEIGHTED_PER_KG";
  const baseAmount = weighted
    ? weightedPricePreview(item.product.priceAmount, 0, item.weightGrams ?? 0, item.quantity)
    : item.product.priceAmount * item.quantity;
  const grossAmount = weighted
    ? baseAmount + weightedPricePreview(0, optionAmount, item.weightGrams ?? 0, item.quantity)
    : baseAmount + optionAmount * item.quantity;
  const saleDiscountAmount = !item.product.saleDiscountKind || !item.product.saleDiscountValue
    ? 0
    : item.product.saleDiscountKind === "PERCENTAGE"
      ? Math.floor(baseAmount * item.product.saleDiscountValue / 100)
      : weighted
        ? Math.floor(item.product.saleDiscountValue * (item.weightGrams ?? 0) * item.quantity / 1000)
        : item.product.saleDiscountValue * item.quantity;
  return saleDiscountAmount > 0
    ? Math.min(grossAmount, roundDiscountedAmount(Math.max(0, grossAmount - saleDiscountAmount)))
    : grossAmount;
}

export function StaffConsumption({ role, onOpenMenu, menuOpen = false }: {
  role: "STAFF" | "MANAGER";
  onOpenMenu: () => void;
  menuOpen?: boolean;
}) {
  const [catalog, setCatalog] = useState<PosCatalogCategory[]>([]);
  const [entries, setEntries] = useState<StaffConsumptionEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [key, setKey] = useState(newKey);
  const [staffName, setStaffName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [discountEntryId, setDiscountEntryId] = useState<string | null>(null);
  const [removeEntryId, setRemoveEntryId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setListError(null);
    try {
      const [products, list] = await Promise.all([readPosCatalog(), readStaffConsumption()]);
      if (!products.ok) { setError(products.error.message); setListError(products.error.message); }
      else setCatalog(products.data);
      if (!list.ok) { setError(list.error.message); setListError(list.error.message); }
      else { setEntries(list.data.data); setCursor(list.data.meta.nextCursor); }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const addDraft = (product: PosCatalogProduct, options: Option[], weightGrams?: number) => {
    const itemKey = productConfigurationKey(product.id, options, weightGrams);
    setDraft((current) => {
      const found = current.find((item) => item.key === itemKey);
      return found
        ? current.map((item) => item.key === itemKey ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { key: itemKey, product, options, weightGrams, quantity: 1 }];
    });
    setKey(newKey());
  };
  const changeDraftQuantity = (itemKey: string, delta: number) => {
    setDraft((current) => current.flatMap((item) => {
      if (item.key !== itemKey) return [item];
      const quantity = item.quantity + delta;
      return quantity > 0 ? [{ ...item, quantity }] : [];
    }));
    setKey(newKey());
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.length || busy) return;
    setBusy(true);
    setError(null);
    const result = await createStaffConsumption({
      channel: "TAKEAWAY",
      items: draft.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        ...(item.weightGrams ? { weightGrams: item.weightGrams } : {}),
        options: item.options.map((option) => ({ optionId: option.id, quantity: item.product.pricingMode === "FIXED" ? item.quantity : 1 })),
      })),
    }, key, staffName.trim() || undefined);
    if (!result.ok) setError(result.error.message);
    else {
      setDraft([]);
      setKey(newKey());
      setStaffName("");
      await load();
    }
    setBusy(false);
  };
  const applyDiscount = async (entry: StaffConsumptionEntry, kind: DiscountKind, value: string) => {
    const amount = positiveIntegerAmount(value);
    if (!amount || (kind === "PERCENTAGE" && amount > 100)) {
      setError(kind === "PERCENTAGE" ? "درصد تخفیف باید بین ۱ تا ۱۰۰ باشد." : "مبلغ تخفیف را وارد کنید.");
      return false;
    }
    setBusy(true);
    setError(null);
    const result = await discountStaffConsumption(entry.id, entry.version, { kind, value: amount });
    if (!result.ok) setError(result.error.message);
    else {
      setDiscountEntryId(null);
      await load();
    }
    setBusy(false);
    return result.ok;
  };
  const remove = async (entry: StaffConsumptionEntry) => {
    setBusy(true);
    setError(null);
    const result = await deleteOpenOrder(entry.id, { expectedVersion: entry.version });
    if (!result.ok) setError(result.error.message);
    else { setRemoveEntryId(null); await load(); }
    setBusy(false);
  };
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    const result = await readStaffConsumption(cursor);
    if (result.ok) {
      setListError(null);
      setEntries((current) => [...current, ...result.data.data]);
      setCursor(result.data.meta.nextCursor);
    } else { setError(result.error.message); setListError(result.error.message); }
    setLoadingMore(false);
  };
  const total = sumAmounts(draft.map(draftLineAmount));

  return <section className="pos-workspace staff-consumption-workspace" dir="rtl">
    <header className="workspace-header staff-consumption-header">
      <h1>حساب پرسنل</h1>
      <button className="menu-button" type="button" aria-label="باز کردن منو" aria-expanded={menuOpen} aria-controls="pos-navigation-drawer" onClick={onOpenMenu}><MenuIcon /></button>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="staff-consumption-layout">
    <form className="staff-consumption-form" onSubmit={(event) => void create(event)}>
      <h2>ثبت سفارش پرسنل</h2>
      <p>سفارش با حساب کاربری شما ثبت می‌شود. نام زیر فقط شخص آغازکننده را مشخص می‌کند.</p>
      <label htmlFor="staff-consumption-initiator">نام شخص آغازکننده (اختیاری)</label>
      <input id="staff-consumption-initiator" name="staffName" value={staffName} maxLength={120} onChange={(event) => setStaffName(event.target.value)} placeholder="نام شخصی که سفارش را آغاز کرده است" />
      {loading && catalog.length === 0
        ? <p role="status">در حال دریافت فهرست کالاها…</p>
        : catalog.map((category) => <section key={category.id}>
          <h3>{category.name}</h3>
          <div className="product-grid">{category.products.map((product) => {
            const quantityFor = (selected: PosCatalogProduct, options: Option[], weightGrams?: number) =>
              draft.find((item) => item.key === productConfigurationKey(selected.id, options, weightGrams))?.quantity ?? 0;
            const decrease = (selected: PosCatalogProduct, options: Option[], weightGrams?: number) =>
              changeDraftQuantity(productConfigurationKey(selected.id, options, weightGrams), -1);
            return <ProductPicker key={product.id} card={{ key: product.id, name: product.name, products: [product] }} expanded={expanded === product.id} onOpen={() => setExpanded(product.id)} onClose={() => setExpanded(null)} getQuantity={quantityFor} onDecrease={decrease} onSelectOptions={addDraft} />;
          })}</div>
        </section>)}
      {draft.length > 0 && <section className="staff-draft" aria-labelledby="staff-draft-title">
        <h3 id="staff-draft-title">مرور سفارش</h3>
        <ul className="staff-draft__list">{draft.map((item) => <li className="staff-draft__item" key={item.key}>
          <div className="staff-draft__details"><strong>{item.product.name}{item.weightGrams ? ` · ${item.weightGrams.toLocaleString("fa-IR")} گرم` : ""}</strong>{item.options.length > 0 && <small>{item.options.map((option) => option.name).join("، ")}</small>}</div>
          <div className="quantity" role="group" aria-label={`تعداد ${item.product.name}`}>
            <button type="button" aria-label={`کم کردن ${item.product.name}`} disabled={busy} onClick={() => changeDraftQuantity(item.key, -1)}>−</button>
            <output aria-live="polite">{item.quantity.toLocaleString("fa-IR")}</output>
            <button type="button" aria-label={`زیاد کردن ${item.product.name}`} disabled={busy} onClick={() => changeDraftQuantity(item.key, 1)}>+</button>
          </div>
          <strong>{formatToman(draftLineAmount(item))} تومان</strong>
        </li>)}</ul>
        <div className="staff-draft__total"><span>جمع سفارش پیش از تخفیف نهایی</span><strong>{formatToman(total)} تومان</strong></div>
      </section>}
      <button className="button button--primary" type="submit" disabled={busy || loading || !draft.length}>{busy ? "در حال ثبت سفارش…" : "ثبت سفارش پرسنل"}</button>
    </form>
    <section className="staff-consumption-orders" aria-labelledby="staff-orders-title">
    <h2 id="staff-orders-title">سفارش‌های پرسنل</h2>
    {loading && <p role="status">در حال دریافت سفارش‌های پرسنل…</p>}
    {!loading && entries.length === 0 && !listError && <p>سفارشی ثبت نشده است.</p>}
    {entries.map((entry) => <article className="manager-card staff-entry" key={entry.id}>
      <h3>سفارش {formatOrderNumber(entry.dailyOrderNumber)} · {entry.staffName || entry.username}</h3>
      <p>{entry.items.map((item) => `${item.productNameSnapshot} × ${item.quantity}`).join("، ")}</p>
      <p>{new Date(entry.createdAt).toLocaleString("fa-IR")} · {formatToman(entry.totalAmount)} تومان{entry.discountAmount ? ` · تخفیف ${formatToman(entry.discountAmount)} تومان` : ""}</p>
      {discountEntryId === entry.id
        ? <StaffDiscountForm entry={entry} busy={busy} onCancel={() => setDiscountEntryId(null)} onApply={(kind, value) => applyDiscount(entry, kind, value)} />
        : <button className="button button--quiet" type="button" disabled={busy} onClick={() => { setError(null); setDiscountEntryId(entry.id); }}>تخفیف</button>}
      {role === "MANAGER" && (removeEntryId === entry.id
        ? <div className="staff-remove-confirm" role="group" aria-label={`تأیید حذف سفارش ${formatOrderNumber(entry.dailyOrderNumber)}`}>
          <p>این سفارش از فهرست حساب پرسنل خارج می‌شود؛ سابقه‌ی ثبت آن باقی می‌ماند.</p>
          <div className="modal-actions"><button className="button button--quiet" type="button" disabled={busy} onClick={() => setRemoveEntryId(null)}>انصراف</button><button className="button button--danger" type="button" disabled={busy} onClick={() => void remove(entry)}>{busy ? "در حال حذف…" : "تأیید حذف"}</button></div>
        </div>
        : <button className="text-danger" type="button" disabled={busy} onClick={() => { setError(null); setRemoveEntryId(entry.id); }}>حذف</button>)}
    </article>)}
    {listError && !loading && <button className="button button--quiet" type="button" disabled={busy} onClick={() => void load()}>دریافت دوباره</button>}
    {cursor && <button className="button button--quiet" type="button" disabled={busy || loadingMore} onClick={() => void loadMore()}>{loadingMore ? "در حال دریافت…" : "نمایش سفارش‌های بیشتر"}</button>}
    </section>
    </div>
  </section>;
}

function StaffDiscountForm({ entry, busy, onCancel, onApply }: {
  entry: StaffConsumptionEntry;
  busy: boolean;
  onCancel: () => void;
  onApply: (kind: DiscountKind, value: string) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<DiscountKind>("FIXED");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const previewAmount = positiveIntegerAmount(value);
  const subtotal = entry.totalAmount + entry.discountAmount;
  const requestedDiscount = kind === "PERCENTAGE" ? Math.floor(subtotal * Math.min(previewAmount, 100) / 100) : previewAmount;
  const previewFinal = Math.min(subtotal, roundDiscountedAmount(Math.max(0, subtotal - requestedDiscount)));
  const previewDiscount = subtotal - previewFinal;
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!previewAmount || (kind === "PERCENTAGE" && previewAmount > 100)) {
      setError(kind === "PERCENTAGE" ? "درصد تخفیف باید بین ۱ تا ۱۰۰ باشد." : "مبلغ تخفیف را وارد کنید.");
      return;
    }
    const ok = await onApply(kind, value);
    if (!ok) setError("تخفیف ثبت نشد. پیام خطا را بالای صفحه ببینید و دوباره تلاش کنید.");
  };
  return <form className="staff-discount-form" aria-label={`ثبت تخفیف سفارش ${formatOrderNumber(entry.dailyOrderNumber)}`} onSubmit={(event) => void onSubmit(event)}>
    <fieldset disabled={busy}>
      <legend>نوع تخفیف</legend>
      <label><input type="radio" name={`staff-discount-${entry.id}`} checked={kind === "FIXED"} onChange={() => setKind("FIXED")} /> مبلغ (تومان)</label>
      <label><input type="radio" name={`staff-discount-${entry.id}`} checked={kind === "PERCENTAGE"} onChange={() => setKind("PERCENTAGE")} /> درصد</label>
    </fieldset>
    <label htmlFor={`staff-discount-value-${entry.id}`}>{kind === "PERCENTAGE" ? "درصد تخفیف (۱ تا ۱۰۰)" : "مبلغ تخفیف به تومان"}</label>
    <input id={`staff-discount-value-${entry.id}`} inputMode="numeric" value={value} onChange={(event) => { setValue(event.target.value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/\D/g, "")); setError(null); }} />
    <p>جمع پیش از تخفیف {formatToman(subtotal)} تومان · تخفیف جدید {formatToman(previewDiscount)} تومان · جمع پس از تخفیف {formatToman(previewFinal)} تومان. مبلغ نهایی را سرویس ثبت سفارش تأیید می‌کند.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button button--quiet" type="button" disabled={busy} onClick={onCancel}>انصراف</button><button className="button button--primary" type="submit" disabled={busy || !value}>{busy ? "در حال ثبت…" : "ثبت تخفیف"}</button></div>
  </form>;
}
