"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { useRecoveryState } from "../lib/automatic-recovery";
import {
  archiveInventoryRecipe,
  archiveInventoryStockItem,
  createInventoryCount,
  createInventoryPurchase,
  previewProductCosting,
  postInventoryCount,
  postInventoryPurchase,
  readGrossProfitReport,
  readInventoryCounts,
  readInventoryMovements,
  readInventoryPurchases,
  readInventoryRecipes,
  readInventoryStockItems,
  readPendingInventoryConsumption,
  readProductCosting,
  returnInventoryPurchase,
  saveInventoryRecipe,
  saveInventoryStockItem,
  saveProductCosting,
  updateInventoryCount,
  updateInventoryPurchase,
  type ApiResult,
  type GrossProfitReport,
  type InventoryCount,
  type InventoryMovement,
  type InventoryPurchase,
  type InventoryRecipe,
  type InventoryStockItem,
  type ManagerCatalog,
  type PendingInventoryConsumption,
  type ProductCostingConfiguration,
  type ProductCostingPreview,
} from "../lib/api-client";
import { currentPersianDateInput, persianDateToGregorianDate } from "../lib/tehran-date";
import { formatToman } from "../lib/pos-utils";
import { inventoryErrorMessage } from "../lib/inventory-errors";

type View = "profit" | "stock" | "purchases" | "recipes" | "counts" | "history";
type Unit = "GRAM" | "MILLILITER" | "PIECE";
type StockConversion = { id?: string; label: string; baseQuantityPerPack: string; isActive: boolean };
type PurchaseLineDraft = { stockItemId: string; conversionId: string; purchaseUnitLabel: string; purchaseQuantity: string; directCostAmount: string };
type RecipeComponentDraft = { componentKey: string; sourceKind: "STOCK_ITEM" | "RECIPE"; sourceId: string; quantity: string };
type RuleDraft = { action: "CHANGE_QUANTITY" | "REPLACE_COMPONENT" | "ADD_COMPONENT"; componentKey: string; quantity: string; label: string; sourceKind: "STOCK_ITEM" | "RECIPE"; sourceId: string };
type RuleTarget = { key: string; label: string };
type OptionRuleDraft = { optionId: string; rules: RuleDraft[] };
type CombinationDraft = { name: string; optionIds: string[]; rules: RuleDraft[] };
type CostingDraft = { mode: "RECIPE" | "PURCHASED_ITEM"; recipeId: string; recipeQuantity: string; extrasRecipeId: string; purchasedStockItemId: string; purchasedQuantity: string; optionRules: OptionRuleDraft[]; combinations: CombinationDraft[] };
type InventoryConfirm = { title: string; detail: string; summary?: string[]; actionLabel: string; danger?: boolean; run: () => Promise<boolean> };

const unitLabels: Record<Unit, string> = { GRAM: "گرم", MILLILITER: "میلی‌لیتر", PIECE: "عدد" };
const movementLabels: Record<string, string> = {
  OPENING_COUNT: "موجودی آغازین",
  PURCHASE_RECEIPT: "رسید خرید",
  ORDER_CONSUMPTION: "مصرف سفارش",
  ORDER_RESTORATION: "برگشت مصرف سفارش",
  PHYSICAL_COUNT_ADJUSTMENT: "اصلاح موجودی پس از شمارش",
  PURCHASE_RETURN: "مرجوعی خرید",
};
const emptyRule = (): RuleDraft => ({ action: "CHANGE_QUANTITY", componentKey: "", quantity: "", label: "", sourceKind: "STOCK_ITEM", sourceId: "" });
const emptyCosting = (): CostingDraft => ({ mode: "RECIPE", recipeId: "", recipeQuantity: "1", extrasRecipeId: "", purchasedStockItemId: "", purchasedQuantity: "1", optionRules: [], combinations: [] });
const localDateTime = (source = new Date()) => {
  const date = new Date(source);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const resultError = (result: Extract<ApiResult<unknown>, { ok: false }>) => inventoryErrorMessage(result.error);

export function InventoryWorkspace({ catalog }: { catalog: ManagerCatalog }) {
  const [view, setView] = useRecoveryState<View>("inventory-view", "profit");
  const [stockItems, setStockItems] = useState<InventoryStockItem[]>([]);
  const [purchases, setPurchases] = useState<InventoryPurchase[]>([]);
  const [recipes, setRecipes] = useState<InventoryRecipe[]>([]);
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [pending, setPending] = useState<PendingInventoryConsumption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readErrors, setReadErrors] = useState<Partial<Record<View, string>>>({});
  const [confirm, setConfirm] = useState<InventoryConfirm | null>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const confirmOpenerRef = useRef<HTMLElement | null>(null);
  const keys = useRef(new Map<string, string>());
  const mutationInFlight = useRef(false);

  const idempotencyKey = (name: string) => {
    const previous = keys.current.get(name);
    if (previous) return previous;
    const next = crypto.randomUUID();
    keys.current.set(name, next);
    return next;
  };
  const clearIdempotencyKey = (name: string) => keys.current.delete(name);

  const loadedOnce = useRef(false);
  const reload = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    const results = await Promise.all([
      readInventoryStockItems(),
      readInventoryPurchases(),
      readInventoryRecipes(),
      readInventoryCounts(),
      readInventoryMovements(),
      readPendingInventoryConsumption(),
    ]);
    if (results[0]!.ok) setStockItems(results[0]!.data.data.stockItems);
    if (results[1]!.ok) setPurchases(results[1]!.data.data.purchases);
    if (results[2]!.ok) setRecipes(results[2]!.data.data.recipes);
    if (results[3]!.ok) setCounts(results[3]!.data.data.counts);
    if (results[4]!.ok) setMovements(results[4]!.data.data.movements);
    if (results[5]!.ok) setPending(results[5]!.data.data.consumptions);
    const dependencies: Partial<Record<View, number[]>> = { stock: [0], purchases: [0, 1], recipes: [0, 2], counts: [0, 3, 5], history: [0, 4, 5] };
    const failures: Partial<Record<View, string>> = {};
    for (const [panel, indices] of Object.entries(dependencies)) {
      const failure = indices!.map((index) => results[index]!).find((result) => !result.ok);
      if (failure && !failure.ok) failures[panel as View] = resultError(failure);
    }
    setReadErrors(failures);
    loadedOnce.current = true;
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const openConfirm = (value: InventoryConfirm) => {
    confirmOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(null);
    setConfirm(value);
  };
  const closeConfirm = () => {
    setConfirm(null);
    requestAnimationFrame(() => confirmOpenerRef.current?.focus());
  };
  useEffect(() => { if (confirm) confirmCancelRef.current?.focus(); }, [confirm]);
  const handleConfirmKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !busy) { event.preventDefault(); closeConfirm(); }
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    if (!controls.length) return;
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1]?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0]?.focus(); }
  };

  const mutate = async (action: () => Promise<ApiResult<unknown>>) => {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) { setError(resultError(result)); return false; }
      setError(null);
      await reload();
      return true;
    } catch {
      setError(inventoryErrorMessage({ kind: "invalid-response", code: "INTERNAL_ERROR", message: "" }));
      return false;
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  const loadMovements = async (stockItemId: string) => {
    const result = await readInventoryMovements(stockItemId ? { stockItemId } : {});
    if (result.ok) { setMovements(result.data.data.movements); setError(null); }
    else setError(resultError(result));
  };

  return (
    <section className="inventory-workspace" aria-busy={loading || busy}>
      <nav className="inventory-tabs manager-tabs" aria-label="بخش‌های موجودی و گزارش سود">
        {([
          ["profit", "سود ناخالص"], ["stock", "اقلام موجودی"], ["purchases", "خریدها"],
          ["recipes", "دستور تهیه و هزینه"], ["counts", "شمارش انبار"], ["history", "گردش موجودی"],
        ] as const).map(([id, label]) => <button key={id} id={`inventory-view-${id}`} type="button" disabled={busy || !!confirm} className={view === id ? "is-active" : ""} aria-pressed={view === id} aria-controls="inventory-active-panel" onClick={() => { setError(null); setView(id); }}>{label}</button>)}
      </nav>
      {error && !confirm && <p className="form-error" role="alert">{error}</p>}
      {readErrors[view] && !error && !confirm && <p className="form-error" role="alert">{readErrors[view]} <button type="button" disabled={loading || busy} onClick={() => void reload()}>بارگذاری دوباره</button></p>}
      {loading ? <p className="manager-empty">در حال بارگذاری اطلاعات موجودی…</p> : <div id="inventory-active-panel" role="region" aria-labelledby={`inventory-view-${view}`}>
        {view === "profit" && <ProfitPanel />}
        {view === "stock" && <StockPanel items={stockItems} mutate={mutate} confirm={openConfirm} />}
        {view === "purchases" && <PurchasePanel items={stockItems} purchases={purchases} mutate={mutate} confirm={openConfirm} keyFor={idempotencyKey} clearKey={clearIdempotencyKey} />}
        {view === "recipes" && <RecipePanel catalog={catalog} items={stockItems} recipes={recipes} mutate={mutate} confirm={openConfirm} />}
        {view === "counts" && <CountPanel items={stockItems} counts={counts} pending={pending} mutate={mutate} confirm={openConfirm} keyFor={idempotencyKey} clearKey={clearIdempotencyKey} />}
        {view === "history" && <HistoryPanel movements={movements} pending={pending} items={stockItems} loadMovements={loadMovements} />}
      </div>}
      {confirm && <div className="manager-dialog-backdrop" role="presentation"><section className="manager-dialog" role="alertdialog" aria-modal="true" aria-labelledby="inventory-confirm-title" aria-describedby="inventory-confirm-detail" onKeyDown={handleConfirmKeyDown}><h2 id="inventory-confirm-title">{confirm.title}</h2><p id="inventory-confirm-detail">{confirm.detail}</p>{confirm.summary && <ul className="inventory-confirm-summary">{confirm.summary.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul>}{error && <p className="form-error" role="alert">{error}</p>}<div className="inventory-actions"><button className={confirm.danger ? "danger-button" : undefined} type="button" disabled={busy} onClick={() => { void confirm.run().then((ok) => { if (ok) closeConfirm(); }); }}>{confirm.actionLabel}</button><button ref={confirmCancelRef} className="secondary-button" type="button" disabled={busy} onClick={closeConfirm}>بازگشت</button></div></section></div>}
    </section>
  );
}

function ProfitPanel() {
  const initial = currentPersianDateInput();
  const [from, setFrom] = useState(initial);
  const [to, setTo] = useState(initial);
  const [report, setReport] = useState<GrossProfitReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fromDate = persianDateToGregorianDate(from.year, from.value);
    const toDate = persianDateToGregorianDate(to.year, to.value);
    if (!fromDate || !toDate || fromDate > toDate) { setError("تاریخ شروع و پایان را بررسی کنید."); return; }
    setLoading(true);
    const result = await readGrossProfitReport(fromDate, toDate);
    if (result.ok) { setReport(result.data); setError(null); }
    else setError(resultError(result));
    setLoading(false);
  };
  useEffect(() => { const initialReport = async () => { const fromDate = persianDateToGregorianDate(from.year, from.value); const toDate = persianDateToGregorianDate(to.year, to.value); if (!fromDate || !toDate) return; setLoading(true); const result = await readGrossProfitReport(fromDate, toDate); if (result.ok) setReport(result.data); else setError(resultError(result)); setLoading(false); }; void initialReport(); }, []);

  return <div className="manager-grid inventory-profit-layout">
    <div className="inventory-report-filter"><ManagerCard title="گزارش سود ناخالص" hint="فروش هر سفارش پس از تسویه‌ی کامل در این گزارش می‌آید. اگر هزینه‌ی مواد مشخص نباشد، حاشیه‌ی سود محاسبه نمی‌شود.">
      <form className="manager-form" onSubmit={submit}>
        <div className="inventory-date-fields">
          <label><span>از تاریخ شمسی</span><input aria-label="از تاریخ شمسی" inputMode="numeric" placeholder="ماه/روز" value={from.value} onChange={(event) => setFrom({ ...from, value: event.target.value })} /></label>
          <label><span>سال</span><input aria-label="سال آغاز" inputMode="numeric" value={from.year} onChange={(event) => setFrom({ ...from, year: event.target.value })} /></label>
          <label><span>تا تاریخ شمسی</span><input aria-label="تا تاریخ شمسی" inputMode="numeric" placeholder="ماه/روز" value={to.value} onChange={(event) => setTo({ ...to, value: event.target.value })} /></label>
          <label><span>سال</span><input aria-label="سال پایان" inputMode="numeric" value={to.year} onChange={(event) => setTo({ ...to, year: event.target.value })} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? "در حال محاسبه…" : "نمایش گزارش"}</button>
      </form>
    </ManagerCard></div>
    {report && <>
      <div className="inventory-report-summary"><ManagerCard title="جمع کل کافه" hint={`${new Date(report.meta.range.from).toLocaleDateString("fa-IR")} تا ${new Date(new Date(report.meta.range.to).getTime() - 1).toLocaleDateString("fa-IR")}`}>
        <dl className="report-grid">
          <dt>فروش خالص</dt><dd>{formatToman(report.data.totals.netSalesAmount)}</dd>
          <dt>هزینه‌ی محاسبه‌شده</dt><dd>{formatToman(report.data.totals.knownCogsAmount)}</dd>
          <dt>هزینه‌ی برآوردی مواد</dt><dd>{report.data.totals.theoreticalCogsAmount === null ? "اطلاعات هزینه کامل نیست" : formatToman(report.data.totals.theoreticalCogsAmount)}</dd>
          <dt>سود ناخالص</dt><dd>{report.data.totals.grossProfitAmount === null ? "محاسبه نشده" : formatToman(report.data.totals.grossProfitAmount)}</dd>
          <dt>حاشیه‌ی سود</dt><dd>{report.data.totals.grossMarginPercent === null ? "محاسبه نشده" : `${report.data.totals.grossMarginPercent}٪`}</dd>
          <dt>کامل‌بودن محاسبه‌ی هزینه</dt><dd>{report.data.costCoverage.completeOrderItemCount} قلم کامل، {report.data.costCoverage.incompleteOrderItemCount} قلم ناقص</dd>
          <dt>ارزش مصرف موجودی (برآوردی)</dt><dd>{report.data.inventoryConsumption.amount === null ? "اطلاعات ارزش‌گذاری کافی نیست" : formatToman(report.data.inventoryConsumption.amount)}</dd>
          <dt>سفارش‌های در انتظار کسر موجودی</dt><dd>{report.data.pendingConsumptionCount}</dd>
        </dl>
        {(report.data.inventoryConsumption.isEstimate || report.data.inventoryConsumption.missingValuationCount > 0) && <p className="inventory-note">ارزش مصرف موجودی برآوردی است. {report.data.inventoryConsumption.missingValuationCount > 0 ? `${report.data.inventoryConsumption.missingValuationCount} کالا ارزش‌گذاری کامل ندارد.` : "اختلاف این دو عدد به‌تنهایی علت اختلاف را مشخص نمی‌کند."}</p>}
        {report.data.costCoverage.incompleteOrderItemCount > 0 && <p className="inventory-note">برای بعضی از اقلام، دستور تهیه یا ارزش‌گذاری کامل نیست؛ بنابراین حاشیه‌ی سود کل محاسبه نشده است.</p>}
      </ManagerCard></div>
      <div className="inventory-report-products"><ManagerCard title="سود هر کالا" hint="حاشیه‌ی سود هر کالا از فروش خالص و هزینه‌ی همان کالا به دست می‌آید.">
        <p className="inventory-table-hint">برای دیدن همه‌ی ستون‌ها در صفحه‌ی کوچک، جدول را به طرفین بکشید.</p>
        <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>کالا</th><th>فروش خالص</th><th>هزینه‌ی محاسبه‌شده</th><th>سود ناخالص</th><th>حاشیه‌ی سود</th><th>کامل‌بودن محاسبه‌ی هزینه</th></tr></thead><tbody>
          {report.data.products.map((product) => <tr key={product.productId}><td>{product.productName}</td><td>{formatToman(product.netSalesAmount)}</td><td>{formatToman(product.knownCogsAmount)}</td><td>{product.grossProfitAmount === null ? "—" : formatToman(product.grossProfitAmount)}</td><td>{product.grossMarginPercent === null ? "—" : `${product.grossMarginPercent}٪`}</td><td>{product.completeOrderItemCount} قلم کامل، {product.incompleteOrderItemCount} قلم ناقص</td></tr>)}
          {report.data.products.length === 0 && <tr><td colSpan={6}>در این بازه سفارشی تسویه‌ی کامل نشده است.</td></tr>}
        </tbody></table></div>
      </ManagerCard></div>
    </>}
  </div>;
}

function StockPanel({ items, mutate, confirm }: { items: InventoryStockItem[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; confirm: (value: InventoryConfirm) => void }) {
  const activeItems = items.filter((item) => item.isActive && !item.archivedAt);
  const [editing, setEditing] = useState<InventoryStockItem | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("مواد اولیه");
  const [baseUnit, setBaseUnit] = useState<Unit>("GRAM");
  const [conversions, setConversions] = useState<StockConversion[]>([{ label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }]);
  const [localError, setLocalError] = useState<string | null>(null);
  const reset = () => { setEditing(null); setName(""); setCategory("مواد اولیه"); setBaseUnit("GRAM"); setConversions([{ label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }]); setLocalError(null); };
  const startEdit = (item: InventoryStockItem) => { setEditing(item); setName(item.name); setCategory(item.category); setBaseUnit(item.baseUnit); setConversions(item.conversions.map((conversion) => ({ id: conversion.id, label: conversion.label, baseQuantityPerPack: conversion.baseQuantityPerPack, isActive: conversion.isActive }))); setLocalError(null); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const packs = conversions.filter((entry) => entry.label.trim() || entry.baseQuantityPerPack.trim());
    if (packs.some((entry) => !entry.label.trim() || !/^\d+(?:\.\d{1,6})?$/.test(entry.baseQuantityPerPack))) { setLocalError("نام بسته‌بندی و مقدار تبدیل را وارد کنید."); return; }
    const body = { name: name.trim(), category: category.trim(), baseUnit, conversions: packs.map((entry) => ({ ...(entry.id ? { id: entry.id } : {}), label: entry.label.trim(), baseQuantityPerPack: entry.baseQuantityPerPack, isActive: entry.isActive })) };
    const ok = await mutate(() => saveInventoryStockItem(editing?.id ?? null, { ...body, ...(editing ? { expectedVersion: editing.version } : {}) }));
    if (ok) reset();
  };
  return <div className="manager-grid">
    <ManagerCard title={editing ? "ویرایش کالای انبار" : "افزودن کالای انبار"} hint="واحد مبنا و مقدار هر بسته را مشخص کنید. تبدیل وزن به حجم یا برعکس انجام نمی‌شود.">
      <form className="manager-form" onSubmit={(event) => void submit(event)}>
        <div className="manager-fields">
          <label><span>نام کالا</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>دسته‌بندی</span><input required value={category} onChange={(event) => setCategory(event.target.value)} /></label>
          <label><span>واحد مبنا</span><select value={baseUnit} onChange={(event) => { const nextUnit = event.target.value as Unit; setBaseUnit(nextUnit); if (!editing) setConversions(nextUnit === "GRAM" ? [{ label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }] : nextUnit === "MILLILITER" ? [{ label: "لیتر", baseQuantityPerPack: "1000", isActive: true }] : []); }}>{Object.entries(unitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <fieldset><legend>تبدیل واحد بسته‌بندی</legend>
          {conversions.map((conversion, index) => <div className="inventory-entry-row" key={conversion.id ?? index}>
            <label><span>نام بسته‌بندی</span><input value={conversion.label} onChange={(event) => setConversions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row))} placeholder="مثلاً کیلوگرم" /></label>
            <label><span>مقدار هر بسته به {unitLabels[baseUnit]}</span><input inputMode="decimal" value={conversion.baseQuantityPerPack} onChange={(event) => setConversions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, baseQuantityPerPack: event.target.value } : row))} placeholder="۱۰۰۰" /></label>
            <button className="text-button" type="button" onClick={() => setConversions((current) => current.filter((_, rowIndex) => rowIndex !== index))}>حذف تبدیل</button>
          </div>)}
          <button className="secondary-button" type="button" onClick={() => setConversions((current) => [...current, { label: "", baseQuantityPerPack: "", isActive: true }])}>افزودن تبدیل</button>
        </fieldset>
        {localError && <p className="form-error" role="alert">{localError}</p>}
        <div className="inventory-actions"><button type="submit">{editing ? "ذخیره تغییرات" : "ثبت کالا"}</button>{editing && <button className="secondary-button" type="button" onClick={reset}>انصراف از ویرایش</button>}</div>
      </form>
    </ManagerCard>
    <ManagerCard title="اقلام موجودی" hint="ارزش موجودی با ثبت شمارش آغازین یا رسید خرید مشخص می‌شود.">
      <ul className="inventory-list">{activeItems.map((item) => <li key={item.id}>
        <div><strong>{item.name}</strong><small>{item.category} · {unitLabels[item.baseUnit as Unit]} · {item.isActive ? "فعال" : "بایگانی‌شده"}</small><small>موجودی: {item.balance.quantityOnHand ?? "موجودی ثبت نشده"} · ارزش موجودی: {item.balance.carryingValueAmount === null ? "—" : formatToman(item.balance.carryingValueAmount)}</small></div>
        <div className="inventory-actions"><button className="secondary-button" type="button" disabled={!item.isActive} onClick={() => startEdit(item)}>ویرایش</button>{item.isActive && <button className="danger-button" type="button" onClick={() => confirm({ title: "بایگانی کالای انبار", detail: `قلم «${item.name}» از فهرست فعال خارج می‌شود. سابقه‌ی خرید و گردش آن حفظ می‌شود.`, actionLabel: "بایگانی کالا", danger: true, run: () => mutate(() => archiveInventoryStockItem(item.id, item.version)) })}>بایگانی</button>}</div>
      </li>)}{activeItems.length === 0 && <li>هنوز کالای فعالی ثبت نشده است.</li>}</ul>
    </ManagerCard>
  </div>;
}

function PurchasePanel({ items, purchases, mutate, confirm, keyFor, clearKey }: { items: InventoryStockItem[]; purchases: InventoryPurchase[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; confirm: (value: InventoryConfirm) => void; keyFor: (name: string) => string; clearKey: (name: string) => void }) {
  const activeItems = items.filter((item) => item.isActive && !item.archivedAt);
  const emptyLine = (): PurchaseLineDraft => { const item = activeItems[0]; return { stockItemId: item?.id ?? "", conversionId: "", purchaseUnitLabel: item?.baseUnit ?? "", purchaseQuantity: "1", directCostAmount: "0" }; };
  const [lines, setLines] = useState<PurchaseLineDraft[]>([emptyLine()]);
  const [receivedAt, setReceivedAt] = useState(localDateTime());
  const [supplier, setSupplier] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<InventoryPurchase | null>(null);
  const [returning, setReturning] = useState<{ purchase: InventoryPurchase; lineId: string } | null>(null);
  const [returnQuantity, setReturnQuantity] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const resetPurchase = () => { setEditingPurchase(null); setLines([emptyLine()]); setSupplier(""); setReceivedAt(localDateTime()); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const received = new Date(receivedAt);
    if (Number.isNaN(received.getTime())) { setLocalError("زمان دریافت را وارد کنید."); return; }
    setLocalError(null);
    const purchaseInput = { receivedAt: received.toISOString(), supplier: supplier.trim() || null, lines: lines.map((line) => ({ stockItemId: line.stockItemId, conversionId: line.conversionId || null, purchaseUnitLabel: line.purchaseUnitLabel, purchaseQuantity: line.purchaseQuantity, directCostAmount: Number(line.directCostAmount) })) };
    const result = await mutate(() => editingPurchase ? updateInventoryPurchase(editingPurchase.id, { ...purchaseInput, expectedVersion: editingPurchase.version }) : createInventoryPurchase(purchaseInput));
    if (result) resetPurchase();
  };
  const startEditPurchase = (purchase: InventoryPurchase) => {
    setEditingPurchase(purchase); setReceivedAt(localDateTime(new Date(purchase.receivedAt))); setSupplier(purchase.supplier ?? "");
    setLines(purchase.lines.map((line) => ({ stockItemId: line.stockItemId, conversionId: line.conversionId ?? "", purchaseUnitLabel: line.purchaseUnitLabel, purchaseQuantity: line.purchaseQuantity, directCostAmount: String(line.directCostAmount) })));
  };
  const changeStock = (index: number, stockItemId: string) => {
    const item = activeItems.find((entry) => entry.id === stockItemId);
    setLines((current) => current.map((line, rowIndex) => rowIndex === index ? { ...line, stockItemId, conversionId: "", purchaseUnitLabel: item?.baseUnit ?? "" } : line));
  };
  const unitsFor = (line: PurchaseLineDraft) => {
    const item = activeItems.find((entry) => entry.id === line.stockItemId);
    return item ? [{ id: "", label: item.baseUnit, title: unitLabels[item.baseUnit as Unit] }, ...item.conversions.filter((conversion) => conversion.isActive).map((conversion) => ({ id: conversion.id, label: conversion.label, title: conversion.label }))] : [];
  };
  return <div className="manager-grid">
    <ManagerCard title={editingPurchase ? "ویرایش پیش‌نویس خرید" : "پیش‌نویس خرید"} hint="ابتدا خرید را به‌صورت پیش‌نویس ذخیره کنید. پس از بررسی ردیف‌ها، «ثبت رسید در موجودی» مقدار و ارزش موجودی را به‌روز می‌کند.">
      {activeItems.length === 0 ? <p className="inventory-note">برای ثبت خرید، ابتدا یک قلم فعال به موجودی اضافه کنید.</p> : <form className="manager-form" onSubmit={(event) => void submit(event)}>
        {localError && <p className="form-error" role="alert">{localError}</p>}
        <div className="manager-fields"><label><span>زمان دریافت</span><input type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} required /></label><label><span>تأمین‌کننده (اختیاری)</span><input value={supplier} onChange={(event) => setSupplier(event.target.value)} /></label></div>
        {lines.map((line, index) => <div className="inventory-entry-row" key={index}>
          <label><span>کالا</span><select value={line.stockItemId} onChange={(event) => changeStock(index, event.target.value)}>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>واحد خرید</span><select value={line.conversionId} onChange={(event) => { const selected = unitsFor(line).find((unit) => unit.id === event.target.value); setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, conversionId: selected?.id ?? "", purchaseUnitLabel: selected?.label ?? "" } : row)); }}>{unitsFor(line).map((unit) => <option key={`${unit.id}-${unit.label}`} value={unit.id}>{unit.title}</option>)}</select></label>
          <label><span>مقدار خرید ({unitsFor(line).find((unit) => unit.id === line.conversionId)?.title ?? "واحد انتخابی"})</span><input required inputMode="decimal" value={line.purchaseQuantity} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, purchaseQuantity: event.target.value } : row))} /></label>
          <label><span>هزینه‌ی مستقیم (تومان)</span><input required type="number" min="0" value={line.directCostAmount} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, directCostAmount: event.target.value } : row))} /></label>
          {lines.length > 1 && <button className="text-button" type="button" onClick={() => setLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>حذف ردیف</button>}
        </div>)}
        <div className="inventory-actions"><button className="secondary-button" type="button" onClick={() => setLines((current) => [...current, emptyLine()])}>افزودن ردیف کالا</button><button type="submit">{editingPurchase ? "ذخیره پیش‌نویس" : "ایجاد پیش‌نویس خرید"}</button>{editingPurchase && <button className="secondary-button" type="button" onClick={resetPurchase}>انصراف از ویرایش</button>}</div>
      </form>}
    </ManagerCard>
    <ManagerCard title="خریدها و پیش‌نویس‌ها" hint="فقط رسیدهای ثبت‌شده در مقدار و ارزش موجودی محاسبه می‌شوند.">
      <ul className="inventory-list">{purchases.map((purchase) => <li key={purchase.id}>
        <div><strong>{purchase.supplier || "بدون نام تأمین‌کننده"}</strong><small>{new Date(purchase.receivedAt).toLocaleString("fa-IR")} · {purchase.status === "POSTED" ? "رسید ثبت شده" : "پیش‌نویس"}</small><small>{purchase.lines.map((line) => `${items.find((item) => item.id === line.stockItemId)?.name ?? "قلم بایگانی‌شده"}: ${line.baseQuantityReceived} ${unitLabels[(items.find((item) => item.id === line.stockItemId)?.baseUnit ?? "PIECE") as Unit]}، ${formatToman(line.directCostAmount)}`).join("؛ ")}</small></div>
        <div className="inventory-actions">{purchase.status === "DRAFT" ? <><button className="secondary-button" type="button" onClick={() => startEditPurchase(purchase)}>ویرایش پیش‌نویس</button><button type="button" onClick={() => confirm({ title: "بررسی رسید خرید", detail: "با ثبت رسید، مقدار و ارزش موجودی بر اساس این ردیف‌ها به‌روز می‌شود.", summary: [...purchase.lines.map((line) => { const item = items.find((entry) => entry.id === line.stockItemId); return `${item?.name ?? "قلم بایگانی‌شده"}: ${line.baseQuantityReceived} ${unitLabels[(item?.baseUnit ?? "PIECE") as Unit]}، ${formatToman(line.directCostAmount)}`; }), `جمع هزینه‌ی مستقیم: ${formatToman(purchase.lines.reduce((total, line) => total + line.directCostAmount, 0))}`], actionLabel: "ثبت رسید در موجودی", run: () => { const key = `purchase:post:${purchase.id}`; return mutate(async () => { const result = await postInventoryPurchase(purchase.id, purchase.version, keyFor(key)); if (result.ok) clearKey(key); return result; }); } })}>ثبت رسید در موجودی</button></> : <button className="secondary-button" type="button" onClick={() => { const line = purchase.lines[0]; if (line) { setReturning({ purchase, lineId: line.id }); setReturnQuantity(""); setReturnReason(""); } }}>ثبت برگشت خرید</button>}</div>
        {returning?.purchase.id === purchase.id && <form className="inventory-return-form" onSubmit={(event) => { event.preventDefault(); const key = `purchase:return:${purchase.id}:${returning.lineId}`; void mutate(async () => { const result = await returnInventoryPurchase(purchase.id, { purchaseLineId: returning.lineId, baseQuantity: returnQuantity, occurredAt: new Date().toISOString(), reason: returnReason }, keyFor(key)); if (result.ok) { clearKey(key); setReturning(null); } return result; }); }}><label><span>ردیف خرید</span><select value={returning.lineId} onChange={(event) => { setReturning({ purchase, lineId: event.target.value }); setReturnQuantity(""); }}>{purchase.lines.map((line) => <option key={line.id} value={line.id}>{items.find((item) => item.id === line.stockItemId)?.name ?? "کالا"} · {line.baseQuantityReceived} {items.find((item) => item.id === line.stockItemId)?.baseUnit ?? ""}</option>)}</select></label><p>مقدار مرجوعی را با واحد مبنا وارد کنید.</p><label><span>مقدار برگشتی</span><input required inputMode="decimal" value={returnQuantity} onChange={(event) => setReturnQuantity(event.target.value)} /></label><label><span>دلیل</span><input required value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></label><div className="inventory-actions"><button type="submit">ثبت مرجوعی</button><button className="secondary-button" type="button" onClick={() => setReturning(null)}>انصراف</button></div></form>}
      </li>)}{purchases.length === 0 && <li>هنوز خریدی ثبت نشده است.</li>}</ul>
    </ManagerCard>
  </div>;
}

function RecipePanel({ catalog, items, recipes, mutate, confirm }: { catalog: ManagerCatalog; items: InventoryStockItem[]; recipes: InventoryRecipe[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; confirm: (value: InventoryConfirm) => void }) {
  const activeRecipes = recipes.filter((recipe) => recipe.isActive && !recipe.archivedAt);
  const [editing, setEditing] = useState<InventoryRecipe | null>(null);
  const [name, setName] = useState("");
  const [ingredientName, setIngredientName] = useState("");
  const [outputUnit, setOutputUnit] = useState<Unit>("PIECE");
  const [yieldQuantity, setYieldQuantity] = useState("1");
  const [components, setComponents] = useState<RecipeComponentDraft[]>([]);
  const blankComponent = (): RecipeComponentDraft => ({ componentKey: crypto.randomUUID(), sourceKind: "STOCK_ITEM", sourceId: items.find((item) => item.isActive)?.id ?? "", quantity: "" });
  const reset = () => { setEditing(null); setName(""); setIngredientName(""); setOutputUnit("PIECE"); setYieldQuantity("1"); setComponents([blankComponent()]); };
  const startEdit = (recipe: InventoryRecipe) => { setEditing(recipe); setName(recipe.name); setIngredientName(recipe.ingredientName); setOutputUnit(recipe.outputUnit as Unit); setYieldQuantity(recipe.yieldQuantity); setComponents(recipe.components.map((component: any) => ({ componentKey: component.componentKey, sourceKind: component.sourceKind, sourceId: component.stockItemId ?? component.nestedRecipeId, quantity: component.quantity }))); };
  useEffect(() => { if (components.length === 0) setComponents([blankComponent()]); }, [items.length]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = { name: name.trim(), ingredientName: ingredientName.trim(), outputUnit, yieldQuantity, components: components.map((component, displayOrder) => ({ componentKey: component.componentKey.trim(), sourceKind: component.sourceKind, ...(component.sourceKind === "STOCK_ITEM" ? { stockItemId: component.sourceId } : { nestedRecipeId: component.sourceId }), quantity: component.quantity, displayOrder })) };
    const ok = await mutate(() => saveInventoryRecipe(editing?.id ?? null, { ...body, ...(editing ? { expectedVersion: editing.version } : {}) }));
    if (ok) reset();
  };
  return <div className="manager-grid">
    <ManagerCard title={editing ? "ویرایش دستور تهیه" : "ساخت دستور تهیه"} hint="نام دستور تهیه، نسخه‌ی دقیق را مشخص می‌کند؛ شناسه‌ی ماده می‌تواند بین چند نسخه مثل لاته مشترک باشد. هر جزء را به یک قلم موجودی یا دستور تهیه‌ی دیگر وصل کنید.">
      <form className="manager-form" onSubmit={(event) => void submit(event)}>
        <div className="manager-fields"><label><span>نام دستور تهیه</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="مثلاً لاته ۵۰/۵۰" /></label><label><span>شناسه‌ی ماده</span><input required value={ingredientName} onChange={(event) => setIngredientName(event.target.value)} placeholder="مثلاً لاته" /></label><label><span>واحد محصول نهایی</span><select value={outputUnit} onChange={(event) => setOutputUnit(event.target.value as Unit)}>{Object.entries(unitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <p className="inventory-note">برای دستورهای جدید، مقدار خروجی یک واحد است. هنگام ویرایش، مقدار ثبت‌شده‌ی قبلی حفظ می‌شود.</p>
        {components.map((component, index) => {
          const selectedUnit = component.sourceKind === "STOCK_ITEM"
            ? items.find((item) => item.id === component.sourceId)?.baseUnit
            : recipes.find((recipe) => recipe.id === component.sourceId)?.outputUnit;
          const unitLabel = selectedUnit ? unitLabels[selectedUnit as Unit] : "واحد";
          return <div className="inventory-entry-row" key={index}>
          <label><span>قلم یا دستور تهیه</span><select value={component.sourceKind} onChange={(event) => { const sourceKind = event.target.value as "STOCK_ITEM" | "RECIPE"; const sourceId = sourceKind === "STOCK_ITEM" ? items.find((item) => item.isActive)?.id ?? "" : activeRecipes.find((recipe) => recipe.id !== editing?.id)?.id ?? ""; setComponents((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, sourceKind, sourceId } : row)); }}><option value="STOCK_ITEM">قلم موجودی</option><option value="RECIPE">دستور تهیه‌ی دیگر</option></select></label>
          <label><span>قلم موجودی یا دستور تهیه</span><select required value={component.sourceId} onChange={(event) => setComponents((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, sourceId: event.target.value } : row))}>{component.sourceKind === "STOCK_ITEM" ? items.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : activeRecipes.filter((recipe) => recipe.id !== editing?.id).map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label>
          <label><span>مقدار ({unitLabel})</span><input required inputMode="decimal" value={component.quantity} placeholder={`مقدار به ${unitLabel}`} onChange={(event) => setComponents((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} /></label>
          {components.length > 1 && <button className="text-button" type="button" onClick={() => setComponents((current) => current.filter((_, rowIndex) => rowIndex !== index))}>حذف ماده</button>}
          </div>;
        })}
        <div className="inventory-actions"><button className="secondary-button" type="button" onClick={() => setComponents((current) => [...current, blankComponent()])}>افزودن ماده</button><button type="submit">{editing ? "ذخیره‌ی دستور تهیه" : "ثبت دستور تهیه"}</button>{editing && <button className="secondary-button" type="button" onClick={reset}>انصراف</button>}</div>
      </form>
      <ul className="inventory-list">{activeRecipes.map((recipe) => <li key={recipe.id}><div><strong>{recipe.name}</strong><small>شناسه‌ی ماده: {recipe.ingredientName}</small><small>خروجی {recipe.yieldQuantity} {unitLabels[recipe.outputUnit as Unit]} · {recipe.components.length} جزء · نسخه {recipe.version}</small></div><div className="inventory-actions"><button className="secondary-button" type="button" onClick={() => startEdit(recipe)}>ویرایش</button><button className="danger-button" type="button" onClick={() => confirm({ title: "بایگانی دستور تهیه", detail: `دستور تهیه‌ی «${recipe.name}» بایگانی می‌شود و در تنظیم‌های بعدی قابل انتخاب نخواهد بود.`, actionLabel: "بایگانی دستور تهیه", danger: true, run: () => mutate(() => archiveInventoryRecipe(recipe.id, recipe.version)) })}>بایگانی</button></div></li>)}{activeRecipes.length === 0 && <li>هنوز دستوری برای تهیه ثبت نشده است.</li>}</ul>
    </ManagerCard>
    <CostingPanel catalog={catalog} items={items} recipes={recipes} mutate={mutate} />
  </div>;
}

function CostingPanel({ catalog, items, recipes, mutate }: { catalog: ManagerCatalog; items: InventoryStockItem[]; recipes: InventoryRecipe[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean> }) {
  const activeProducts = catalog.products.filter((product) => product.isActive && !product.archivedAt);
  const [productId, setProductId] = useState(activeProducts[0]?.id ?? "");
  const [configuration, setConfiguration] = useState<ProductCostingConfiguration>(null);
  const [draft, setDraft] = useState<CostingDraft>(emptyCosting);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [previewQuantity, setPreviewQuantity] = useState("1");
  const [weightGrams, setWeightGrams] = useState("");
  const [preview, setPreview] = useState<ProductCostingPreview | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadedProductId, setLoadedProductId] = useState<string | null>(null);
  const configurationSequence = useRef(0);
  const [costingError, setCostingError] = useState<string | null>(null);
  const product = activeProducts.find((entry) => entry.id === productId);
  const allowedOptionIds = new Set(product?.optionGroups.flatMap((group) => group.options.map((option) => option.optionId)) ?? []);
  const options = catalog.optionGroups.flatMap((group) => group.options.filter((option) => allowedOptionIds.has(option.id)).map((option) => ({ id: option.id, name: option.name, group: group.name })));
  const baseComponents: RuleTarget[] = draft.mode === "RECIPE"
    ? recipes.find((recipe) => recipe.id === draft.recipeId)?.components.map((component) => ({ key: component.componentKey, label: component.label })) ?? []
    : [{ key: "$purchased", label: items.find((item) => item.id === draft.purchasedStockItemId)?.name ?? "کالای خریداری‌شده" }];

  const loadConfiguration = useCallback(async (id: string) => {
    if (!id) return;
    const sequence = ++configurationSequence.current;
    setLoadedProductId(null); setConfiguration(null); setDraft(emptyCosting()); setPreview(null); setCostingError(null);
    setLoadingConfig(true);
    const result = await readProductCosting(id);
    if (sequence !== configurationSequence.current) return;
    if (!result.ok) { setCostingError(resultError(result)); setLoadingConfig(false); return; }
    setLoadedProductId(id);
    const value = result.data.data;
    setConfiguration(value);
    if (!value) setDraft(emptyCosting());
    else {
      const convertRule = (rule: any): RuleDraft => ({ action: rule.action, componentKey: rule.componentKey, quantity: rule.quantity ?? "", label: rule.label ?? "", sourceKind: (rule.replacement ?? rule.component)?.sourceKind ?? "STOCK_ITEM", sourceId: (rule.replacement?.stockItemId ?? rule.replacement?.recipeId ?? rule.component?.stockItemId ?? rule.component?.recipeId) ?? "" });
      setDraft({
        mode: value.mode,
        recipeId: value.mode === "RECIPE" ? value.recipeId : "",
        recipeQuantity: value.mode === "RECIPE" ? value.recipeQuantity : "1",
        extrasRecipeId: value.extrasRecipeId ?? "",
        purchasedStockItemId: value.mode === "PURCHASED_ITEM" ? value.purchasedStockItemId : "",
        purchasedQuantity: value.mode === "PURCHASED_ITEM" ? value.purchasedQuantity ?? "1" : "1",
        optionRules: value.optionRules.map((entry: any) => ({ optionId: entry.optionId, rules: entry.rules.map(convertRule) })),
        combinations: value.combinations.map((entry: any) => ({ name: entry.name, optionIds: entry.optionIds, rules: entry.rules.map(convertRule) })),
      });
    }
    setSelectedOptionIds([]); setPreview(null); setCostingError(null); setLoadingConfig(false);
  }, []);
  useEffect(() => { void loadConfiguration(productId); }, [loadConfiguration, productId]);

  const updateOptionRule = (index: number, patch: Partial<OptionRuleDraft>) => setDraft((current) => ({ ...current, optionRules: current.optionRules.map((entry, rowIndex) => rowIndex === index ? { ...entry, ...patch } : entry) }));
  const updateOptionRuleLine = (groupIndex: number, ruleIndex: number, patch: Partial<RuleDraft>) => setDraft((current) => ({ ...current, optionRules: current.optionRules.map((entry, i) => i === groupIndex ? { ...entry, rules: entry.rules.map((rule, j) => j === ruleIndex ? { ...rule, ...patch } : rule) } : entry) }));
  const updateCombo = (index: number, patch: Partial<CombinationDraft>) => setDraft((current) => ({ ...current, combinations: current.combinations.map((entry, rowIndex) => rowIndex === index ? { ...entry, ...patch } : entry) }));
  const updateComboRule = (groupIndex: number, ruleIndex: number, patch: Partial<RuleDraft>) => setDraft((current) => ({ ...current, combinations: current.combinations.map((entry, i) => i === groupIndex ? { ...entry, rules: entry.rules.map((rule, j) => j === ruleIndex ? { ...rule, ...patch } : rule) } : entry) }));

  const serializeRule = (rule: RuleDraft) => {
    if (!rule.componentKey.trim() || !/^\d+(?:\.\d{1,6})?$/.test(rule.quantity)) return null;
    if (rule.action === "CHANGE_QUANTITY") return { action: rule.action, componentKey: rule.componentKey.trim(), quantity: rule.quantity };
    if (!rule.sourceId) return null;
    const component = rule.sourceKind === "STOCK_ITEM" ? { sourceKind: rule.sourceKind, stockItemId: rule.sourceId } : { sourceKind: rule.sourceKind, recipeId: rule.sourceId };
    if (rule.action === "REPLACE_COMPONENT") return { action: rule.action, componentKey: rule.componentKey.trim(), replacement: component, quantity: rule.quantity, ...(rule.label.trim() ? { label: rule.label.trim() } : {}) };
    if (!rule.label.trim()) return null;
    return { action: rule.action, componentKey: rule.componentKey.trim(), label: rule.label.trim(), component, quantity: rule.quantity };
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!productId || loadedProductId !== productId) return;
    const optionRules = draft.optionRules.filter((entry) => entry.rules.length).map((entry) => ({ optionId: entry.optionId, rules: entry.rules.map(serializeRule) }));
    const combinations = draft.combinations.filter((entry) => entry.name.trim() && entry.optionIds.length && entry.rules.length).map((entry) => ({ name: entry.name.trim(), optionIds: entry.optionIds, rules: entry.rules.map(serializeRule) }));
    if ([...optionRules.flatMap((entry) => entry.rules), ...combinations.flatMap((entry) => entry.rules)].some((rule) => rule === null)) { setCostingError("برای هر قاعده، ماده و مقدار را مشخص کنید. برای ماده‌ی جدید، کد یکتا و منبع آن را هم وارد کنید."); return; }
    const common = { extrasRecipeId: draft.extrasRecipeId || null, optionRules, combinations };
    const body = draft.mode === "RECIPE"
      ? { ...common, mode: draft.mode, recipeId: draft.recipeId, recipeQuantity: draft.recipeQuantity }
      : { ...common, mode: draft.mode, purchasedStockItemId: draft.purchasedStockItemId, ...(draft.purchasedQuantity.trim() ? { purchasedQuantity: draft.purchasedQuantity } : {}) };
    setCostingError(null);
    await mutate(async () => {
      const result = await saveProductCosting(productId, { ...body, expectedVersion: configuration?.version ?? 1 });
      if (result.ok) setConfiguration(result.data.data);
      return result;
    });
  };
  const runPreview = async () => {
    if (!productId) return;
    const body = { optionIds: selectedOptionIds, quantity: Number(previewQuantity), ...(product?.pricingMode === "WEIGHTED_PER_KG" ? { weightGrams: Number(weightGrams) } : {}) };
    const result = await previewProductCosting(productId, body);
    if (result.ok) { setPreview(result.data.data); setCostingError(null); }
    else setCostingError(resultError(result));
  };

  return <ManagerCard title="هزینه‌ی محصول و پیش‌نمایش دستور تهیه" hint="هزینه را بر پایه‌ی دستور تهیه یا کالای خریداری‌شده محاسبه کنید. اثر هر گزینه و ترکیب گزینه‌ها را جداگانه تنظیم کنید.">
    {activeProducts.length === 0 ? <p className="inventory-note">برای تنظیم هزینه، ابتدا یک محصول فعال در منو بسازید.</p> : <>
      <div className="manager-fields"><label><span>محصول</span><select value={productId} onChange={(event) => setProductId(event.target.value)}>{activeProducts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      {loadingConfig ? <p>در حال دریافت تنظیم هزینه…</p> : loadedProductId !== productId ? <div><p className="form-error" role="alert">{costingError}</p><button type="button" onClick={() => void loadConfiguration(productId)}>بارگذاری تنظیم هزینه</button></div> : <form className="manager-form" onSubmit={(event) => void save(event)}>
        <div className="manager-fields"><label><span>روش محاسبه</span><select value={draft.mode} onChange={(event) => setDraft((current) => ({ ...current, mode: event.target.value as CostingDraft["mode"] }))}><option value="RECIPE">دستور تهیه</option><option value="PURCHASED_ITEM">کالای خریداری‌شده</option></select></label>
          {draft.mode === "RECIPE" ? <><label><span>دستور تهیه‌ی پایه</span><select required value={draft.recipeId} onChange={(event) => setDraft((current) => ({ ...current, recipeId: event.target.value }))}><option value="">انتخاب دستور تهیه</option>{recipes.filter((recipe) => recipe.isActive && !recipe.archivedAt).map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label><label><span>مقدار دستور تهیه</span><input required inputMode="decimal" value={draft.recipeQuantity} onChange={(event) => setDraft((current) => ({ ...current, recipeQuantity: event.target.value }))} /></label></> : <><label><span>کالای خریداری‌شده</span><select required value={draft.purchasedStockItemId} onChange={(event) => setDraft((current) => ({ ...current, purchasedStockItemId: event.target.value }))}><option value="">انتخاب کالا</option>{items.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{product?.pricingMode !== "WEIGHTED_PER_KG" && <label><span>مقدار به‌ازای هر فروش</span><input required inputMode="decimal" value={draft.purchasedQuantity} onChange={(event) => setDraft((current) => ({ ...current, purchasedQuantity: event.target.value }))} /></label>}</>}
          <label><span>دستور تهیه‌ی افزودنی (اختیاری)</span><select value={draft.extrasRecipeId} onChange={(event) => setDraft((current) => ({ ...current, extrasRecipeId: event.target.value }))}><option value="">بدون افزودنی</option>{recipes.filter((recipe) => recipe.isActive && !recipe.archivedAt).map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label>
        </div>
        <RuleGroups title="قاعده‌ی هر گزینه" choices={options} items={items} recipes={recipes} baseComponents={baseComponents} groups={draft.optionRules} onAdd={() => setDraft((current) => ({ ...current, optionRules: [...current.optionRules, { optionId: options[0]?.id ?? "", rules: [emptyRule()] }] }))} onRemove={(index) => setDraft((current) => ({ ...current, optionRules: current.optionRules.filter((_, i) => i !== index) }))} onGroupChange={updateOptionRule} onRuleChange={updateOptionRuleLine} onAddRule={(groupIndex) => setDraft((current) => ({ ...current, optionRules: current.optionRules.map((entry, i) => i === groupIndex ? { ...entry, rules: [...entry.rules, emptyRule()] } : entry) }))} />
        <CombinationGroups choices={options} items={items} recipes={recipes} baseComponents={baseComponents} groups={draft.combinations} onAdd={() => setDraft((current) => ({ ...current, combinations: [...current.combinations, { name: "", optionIds: [], rules: [emptyRule()] }] }))} onRemove={(index) => setDraft((current) => ({ ...current, combinations: current.combinations.filter((_, i) => i !== index) }))} onGroupChange={updateCombo} onRuleChange={updateComboRule} onAddRule={(groupIndex) => setDraft((current) => ({ ...current, combinations: current.combinations.map((entry, i) => i === groupIndex ? { ...entry, rules: [...entry.rules, emptyRule()] } : entry) }))} />
        {costingError && <p className="form-error" role="alert">{costingError}</p>}
        <button type="submit">ذخیره هزینه‌ی محصول</button>
      </form>}
      <section className="inventory-preview">
        <h3>پیش‌نمایش</h3>
        {options.map((option) => <label className="inventory-option-check" key={option.id}><input type="checkbox" checked={selectedOptionIds.includes(option.id)} onChange={(event) => setSelectedOptionIds((current) => event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id))} />{option.name} <small>{option.group}</small></label>)}
        <div className="manager-fields"><label><span>تعداد</span><input type="number" min="1" value={previewQuantity} onChange={(event) => setPreviewQuantity(event.target.value)} /></label>{product?.pricingMode === "WEIGHTED_PER_KG" && <label><span>وزن هر واحد (گرم)</span><input type="number" min="1" value={weightGrams} onChange={(event) => setWeightGrams(event.target.value)} /></label>}</div>
        <button className="secondary-button" type="button" disabled={!productId || loadingConfig || loadedProductId !== productId} onClick={() => void runPreview()}>محاسبه‌ی هزینه</button>
        {preview && <><p>{preview.isComplete ? "هزینه‌ی مواد کامل محاسبه شده است" : "هزینه‌ی مواد به‌طور کامل محاسبه نشده است"} · هزینه‌ی محاسبه‌شده: {formatToman(preview.knownCostAmount)}</p><ul className="inventory-list">{preview.components.map((component) => <li key={component.stockItemId}><span>{component.stockItemName} · {component.quantity} {unitLabels[component.baseUnit as Unit]}</span><strong>{component.knownCostAmount === null ? "ارزش‌گذاری نشده" : formatToman(component.knownCostAmount)}</strong></li>)}</ul>{preview.missingReasons.length > 0 && <p className="inventory-note">موارد ناقص: {preview.missingReasons.join("، ")}</p>}</>}
      </section>
    </>}
  </ManagerCard>;
}

type RuleGroupsProps = {
  choices: Array<{ id: string; name: string }>;
  items: InventoryStockItem[];
  recipes: InventoryRecipe[];
  baseComponents: RuleTarget[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onAddRule: (groupIndex: number) => void;
  onRuleChange: (groupIndex: number, ruleIndex: number, patch: Partial<RuleDraft>) => void;
};

function RuleGroups({ title, choices, items, recipes, baseComponents, groups, onAdd, onRemove, onGroupChange, onRuleChange, onAddRule }: RuleGroupsProps & {
  title: string;
  groups: OptionRuleDraft[];
  onGroupChange: (index: number, patch: Partial<OptionRuleDraft>) => void;
}) {
  return <fieldset className="inventory-rule-groups"><legend>{title}</legend>
    {groups.map((group, groupIndex) => <div className="inventory-rule-group" key={groupIndex}>
      <label><span>گزینه</span><select value={group.optionId} onChange={(event) => onGroupChange(groupIndex, { optionId: event.target.value })}>{choices.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      {group.rules.map((rule, ruleIndex) => <RuleFields key={ruleIndex} rule={rule} items={items} recipes={recipes} baseComponents={baseComponents} change={(patch) => onRuleChange(groupIndex, ruleIndex, patch)} />)}
      <button className="text-button" type="button" onClick={() => onAddRule(groupIndex)}>افزودن قاعده</button>
      <button className="text-button" type="button" onClick={() => onRemove(groupIndex)}>حذف گروه</button>
    </div>)}
    <button className="secondary-button" type="button" disabled={!choices.length} onClick={onAdd}>افزودن قاعده‌ی گزینه</button>
  </fieldset>;
}

function CombinationGroups({ choices, items, recipes, baseComponents, groups, onAdd, onRemove, onGroupChange, onRuleChange, onAddRule }: RuleGroupsProps & {
  groups: CombinationDraft[];
  onGroupChange: (index: number, patch: Partial<CombinationDraft>) => void;
}) {
  return <fieldset className="inventory-rule-groups"><legend>قاعده‌ی ترکیب گزینه‌ها</legend>
    {groups.map((group, groupIndex) => <div className="inventory-rule-group" key={groupIndex}>
      <label><span>نام ترکیب</span><input value={group.name} onChange={(event) => onGroupChange(groupIndex, { name: event.target.value })} /></label>
      <div className="inventory-option-choices">{choices.map((option) => <label key={option.id}><input type="checkbox" checked={group.optionIds.includes(option.id)} onChange={(event) => onGroupChange(groupIndex, { optionIds: event.target.checked ? [...group.optionIds, option.id] : group.optionIds.filter((id) => id !== option.id) })} />{option.name}</label>)}</div>
      {group.rules.map((rule, ruleIndex) => <RuleFields key={ruleIndex} rule={rule} items={items} recipes={recipes} baseComponents={baseComponents} change={(patch) => onRuleChange(groupIndex, ruleIndex, patch)} />)}
      <button className="text-button" type="button" onClick={() => onAddRule(groupIndex)}>افزودن قاعده</button>
      <button className="text-button" type="button" onClick={() => onRemove(groupIndex)}>حذف ترکیب</button>
    </div>)}
    <button className="secondary-button" type="button" disabled={!choices.length} onClick={onAdd}>افزودن ترکیب</button>
  </fieldset>;
}

function RuleFields({ rule, items, recipes, baseComponents, change }: { rule: RuleDraft; items: InventoryStockItem[]; recipes: InventoryRecipe[]; baseComponents: RuleTarget[]; change: (patch: Partial<RuleDraft>) => void }) {
  const sourceOptions = rule.sourceKind === "STOCK_ITEM" ? items.filter((item) => item.isActive).map((item) => ({ id: item.id, name: item.name })) : recipes.filter((recipe) => recipe.isActive && !recipe.archivedAt).map((recipe) => ({ id: recipe.id, name: recipe.name }));
  const targetOptions = rule.componentKey && !baseComponents.some((component) => component.key === rule.componentKey)
    ? [...baseComponents, { key: rule.componentKey, label: `کد «${rule.componentKey}» در دستور فعلی نیست` }]
    : baseComponents;
  return <div className="inventory-entry-row inventory-entry-row--rule">
    <label><span>نوع تغییر</span><select value={rule.action} onChange={(event) => change({ action: event.target.value as RuleDraft["action"], componentKey: "" })}><option value="CHANGE_QUANTITY">تغییر مقدار ماده</option><option value="REPLACE_COMPONENT">جایگزینی ماده</option><option value="ADD_COMPONENT">افزودن ماده</option></select></label>
    {rule.action === "ADD_COMPONENT" ? <label><span>کد یکتای ماده‌ی جدید</span><input required value={rule.componentKey} onChange={(event) => change({ componentKey: event.target.value })} /></label> : <label><span>ماده‌ی دستور پایه</span><select required value={rule.componentKey} onChange={(event) => change({ componentKey: event.target.value })}><option value="">انتخاب ماده</option>{targetOptions.map((component) => <option key={component.key} value={component.key}>{component.label}</option>)}</select></label>}
    <label><span>مقدار ماده</span><input required inputMode="decimal" value={rule.quantity} onChange={(event) => change({ quantity: event.target.value })} /></label>
    {rule.action !== "CHANGE_QUANTITY" && <>
      <label><span>نوع قلم</span><select value={rule.sourceKind} onChange={(event) => { const sourceKind = event.target.value as RuleDraft["sourceKind"]; change({ sourceKind, sourceId: sourceKind === "STOCK_ITEM" ? items.find((item) => item.isActive)?.id ?? "" : recipes.find((recipe) => recipe.isActive && !recipe.archivedAt)?.id ?? "" }); }}><option value="STOCK_ITEM">قلم موجودی</option><option value="RECIPE">دستور تهیه</option></select></label>
      <label><span>قلم یا دستور تهیه</span><select required value={rule.sourceId} onChange={(event) => change({ sourceId: event.target.value })}>{sourceOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>نام ماده {rule.action === "ADD_COMPONENT" ? "(الزامی)" : "(اختیاری)"}</span><input required={rule.action === "ADD_COMPONENT"} value={rule.label} onChange={(event) => change({ label: event.target.value })} /></label>
    </>}
  </div>;
}

function CountPanel({ items, counts, pending, mutate, confirm, keyFor, clearKey }: { items: InventoryStockItem[]; counts: InventoryCount[]; pending: PendingInventoryConsumption[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; confirm: (value: InventoryConfirm) => void; keyFor: (name: string) => string; clearKey: (name: string) => void }) {
  const activeItems = items.filter((item) => item.isActive && !item.archivedAt);
  const [kind, setKind] = useState<"OPENING" | "PHYSICAL">("OPENING");
  const [editingCount, setEditingCount] = useState<InventoryCount | null>(null);
  const [lines, setLines] = useState<Array<{ stockItemId: string; observedQuantity: string; observedValueAmount: string }>>([]);
  const [reconcile, setReconcile] = useState<string[]>([]);
  const makeLines = (nextKind: "OPENING" | "PHYSICAL") => activeItems.filter((item) => nextKind === "OPENING" ? !item.balance.trackingStartedAt : !!item.balance.trackingStartedAt).map((item) => ({ stockItemId: item.id, observedQuantity: item.balance.quantityOnHand ?? "0", observedValueAmount: String(item.balance.carryingValueAmount ?? 0) }));
  useEffect(() => { if (lines.length === 0) setLines(makeLines(kind)); }, [activeItems.length]);
  const startEdit = (count: InventoryCount) => { setEditingCount(count); setKind(count.kind); setLines(count.lines.map((line) => ({ stockItemId: line.stockItemId, observedQuantity: line.observedQuantity, observedValueAmount: String(line.observedValueAmount) }))); };
  const submit = async (event: FormEvent) => { event.preventDefault(); const countLines = lines.map((line) => ({ ...line, observedValueAmount: Number(line.observedValueAmount) })); const result = await mutate(() => editingCount ? updateInventoryCount(editingCount.id, { expectedVersion: editingCount.version, lines: countLines }) : createInventoryCount({ kind, lines: countLines })); if (result) { setEditingCount(null); setLines(makeLines(kind)); } };
  return <div className="manager-grid">
    <ManagerCard title="شمارش موجودی" hint="شمارش فیزیکی، موجودی ثبت‌شده را با مقدار واقعی جایگزین می‌کند. اگر سفارشی هنوز از موجودی کم نشده، پیش از ثبت شمارش آن را انتخاب کنید.">
      <form className="manager-form inventory-count-form" onSubmit={(event) => void submit(event)}>
        <label><span>نوع شمارش</span><select value={kind} disabled={!!editingCount} onChange={(event) => { const nextKind = event.target.value as "OPENING" | "PHYSICAL"; setKind(nextKind); setLines(makeLines(nextKind)); }}><option value="OPENING">موجودی آغازین</option><option value="PHYSICAL">شمارش فیزیکی</option></select></label>
        <fieldset className="inventory-option-choices"><legend>اقلام این شمارش</legend>{makeLines(kind).map((eligible) => <label key={eligible.stockItemId}><input type="checkbox" checked={lines.some((line) => line.stockItemId === eligible.stockItemId)} onChange={(event) => setLines((current) => event.target.checked ? [...current, eligible] : current.filter((line) => line.stockItemId !== eligible.stockItemId))} />شمارش {activeItems.find((item) => item.id === eligible.stockItemId)?.name}</label>)}</fieldset>
        {lines.map((line, index) => { const item = activeItems.find((entry) => entry.id === line.stockItemId); return <div className="inventory-count-line" role="group" aria-label={item?.name ?? "کالا"} key={line.stockItemId}><strong>{item?.name ?? "کالا"}</strong><label><span>مقدار {item ? unitLabels[item.baseUnit as Unit] : ""}</span><input required inputMode="decimal" value={line.observedQuantity} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, observedQuantity: event.target.value } : row))} /></label><label><span>ارزش موجودی (تومان)</span><input required type="number" min="0" value={line.observedValueAmount} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, observedValueAmount: event.target.value } : row))} /></label></div>; })}
        {lines.length === 0 && <p className="inventory-note">برای ثبت شمارش، حداقل یک قلم واجد شرایط انتخاب کنید.</p>}
        <div className="inventory-actions"><button type="submit" disabled={!lines.length}>{editingCount ? "ذخیره پیش‌نویس شمارش" : "ایجاد پیش‌نویس شمارش"}</button>{editingCount && <button className="secondary-button" type="button" onClick={() => { setEditingCount(null); setLines(makeLines(kind)); }}>انصراف از ویرایش</button>}</div>
      </form>
    </ManagerCard>
    <ManagerCard title="پیش‌نویس و شمارش‌های ثبت‌شده" hint="شمارش ثبت‌شده و اختلاف آن با موجودی قبلی در سابقه می‌ماند.">
      <ul className="inventory-list">{counts.map((count) => <li key={count.id}><div><strong>{count.kind === "OPENING" ? "موجودی آغازین" : "شمارش فیزیکی"} · {count.status === "POSTED" ? "ثبت‌شده" : "پیش‌نویس"}</strong><small>{count.lines.map((line) => { const item = items.find((entry) => entry.id === line.stockItemId); return `${item?.name ?? "کالا"}: ${line.observedQuantity}${line.differenceQuantity === null ? "" : ` (اختلاف ${line.differenceQuantity})`}`; }).join("، ")}</small></div>
        {count.status === "DRAFT" && <div className="inventory-count-actions">
          <button className="secondary-button" type="button" onClick={() => startEdit(count)}>ویرایش شمارش</button>
          {count.kind === "PHYSICAL" && pending.length > 0 && <fieldset><legend>سفارش‌هایی که هنوز از موجودی کم نشده‌اند</legend>{pending.map((entry) => <label key={entry.id}><input type="checkbox" checked={reconcile.includes(entry.id)} onChange={(event) => setReconcile((current) => event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} />سفارش {entry.orderNumber} · هزینه‌ی محاسبه‌شده {formatToman(entry.knownCogsAmount)}</label>)}</fieldset>}
          <button type="button" onClick={() => { const absorbedIds = count.kind === "PHYSICAL" ? reconcile.filter((id) => pending.some((entry) => entry.id === id)) : []; const absorbed = pending.filter((entry) => absorbedIds.includes(entry.id)); confirm({ title: "بررسی ثبت شمارش", detail: count.kind === "OPENING" ? "با ثبت موجودی آغازین، مقدار و ارزش این کالاها مبنای موجودی می‌شود." : "با ثبت شمارش فیزیکی، مقدار و ارزش ثبت‌شده با مقدار مشاهده‌شده جایگزین می‌شود.", summary: [...count.lines.map((line) => { const item = items.find((entry) => entry.id === line.stockItemId); return `${item?.name ?? "کالا"}: ${line.observedQuantity} ${unitLabels[(item?.baseUnit ?? "PIECE") as Unit]}، ارزش ${formatToman(line.observedValueAmount)}${line.differenceQuantity === null ? "" : `، اختلاف ${line.differenceQuantity}`}`; }), ...(count.kind === "PHYSICAL" ? [absorbed.length ? `سفارش‌های در انتظار کسر که در این شمارش لحاظ می‌شوند: ${absorbed.map((entry) => entry.orderNumber).join("، ")}` : "هیچ سفارش در انتظار کسر در این شمارش انتخاب نشده است."] : [])], actionLabel: "ثبت شمارش در موجودی", run: () => { const key = `count:post:${count.id}`; return mutate(async () => { const result = await postInventoryCount(count.id, { expectedVersion: count.version, absorbedOrderConsumptionIds: absorbedIds }, keyFor(key)); if (result.ok) { clearKey(key); setReconcile([]); } return result; }); } }); }}>ثبت شمارش</button>
        </div>}
      </li>)}{counts.length === 0 && <li>هنوز شمارشی ثبت نشده است.</li>}</ul>
    </ManagerCard>
  </div>;
}

function HistoryPanel({ movements, pending, items, loadMovements }: { movements: InventoryMovement[]; pending: PendingInventoryConsumption[]; items: InventoryStockItem[]; loadMovements: (stockItemId: string) => Promise<void> }) {
  const [stockItemId, setStockItemId] = useState("");
  return <div className="manager-grid">
    <ManagerCard title="گردش موجودی" hint="همه‌ی تغییرهای موجودی در این فهرست ثبت می‌شوند و سابقه‌ی آن‌ها باقی می‌ماند.">
      <label><span>نمایش بر اساس قلم</span><select value={stockItemId} onChange={(event) => { setStockItemId(event.target.value); void loadMovements(event.target.value); }}><option value="">همه‌ی کالاها</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>زمان ثبت</th><th>کالا</th><th>نوع تغییر</th><th>مقدار</th><th>تغییر ارزش موجودی</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{new Date(movement.occurredAt).toLocaleString("fa-IR")}</td><td>{items.find((item) => item.id === movement.stockItemId)?.name ?? "قلم بایگانی‌شده"}</td><td>{movementLabels[movement.kind] ?? movement.kind}</td><td>{movement.quantityDelta}</td><td>{movement.valueDeltaAmount < 0 ? `−${formatToman(-movement.valueDeltaAmount)}` : formatToman(movement.valueDeltaAmount)}</td></tr>)}{movements.length === 0 && <tr><td colSpan={5}>تغییری برای نمایش ثبت نشده است.</td></tr>}</tbody></table></div>
    </ManagerCard>
    <ManagerCard title="سفارش‌های در انتظار کسر از موجودی" hint="هزینه‌ی سفارش تسویه‌شده فقط وقتی از موجودی کم می‌شود که همه‌ی مواد لازم موجود باشند.">
      <ul className="inventory-list">{pending.map((entry) => <li key={entry.id}><div><strong>سفارش {entry.orderNumber}</strong><small>ثبت در {new Date(entry.recognizedAt).toLocaleString("fa-IR")} · هزینه‌ی محاسبه‌شده {formatToman(entry.knownCogsAmount)}</small><small>{entry.isCostComplete ? "هزینه‌ی مواد کامل محاسبه شده است" : "هزینه‌ی مواد به‌طور کامل محاسبه نشده است"} · اقلام ناموجود: {entry.missingStockItemIds.length}</small></div></li>)}{pending.length === 0 && <li>سفارشی در انتظار کسر از موجودی نیست.</li>}</ul>
    </ManagerCard>
  </div>;
}

function ManagerCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <section className="manager-card"><header><h2>{title}</h2><p>{hint}</p></header>{children}</section>;
}
