"use client";
import { InventoryPreparations } from "./inventory-preparations";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { useRecoveryState } from "../lib/automatic-recovery";
import {
  archiveInventoryStockItem,
  createInventoryCount,
  createInventoryPurchase,
  previewProductCosting,
  postInventoryCount,
  postInventoryPurchase,
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
import { InventoryStockDetail } from "./inventory-stock-detail";
import { InventoryIcon, RefreshIcon } from "./icons";
import { InventoryProfitPanel } from "./inventory-profit";
import { InventorySalesChannelsPanel } from "./inventory-sales-channels";
import { InventoryOverview } from "./inventory-dashboard";
import { emptyInventoryItem, lowInventoryItem, inventoryAmountTotal, inventoryNumber, inventoryQuantity, inventoryUnitLabels as unitLabels, inventoryMovementLabels as movementLabels } from "./inventory-presentation";

type View = "overview" | "profit" | "sales" | "stock" | "purchases" | "preparations" | "recipes" | "counts" | "history";
type Unit = "GRAM" | "MILLILITER" | "PIECE";
type StockConversion = { id?: string; label: string; baseQuantityPerPack: string; isActive: boolean };
type PurchaseLineDraft = { stockItemId: string; conversionId: string; purchaseUnitLabel: string; purchaseQuantity: string; directCostAmount: string };
type DraftGuardProps = { onDirtyChange: (dirty: boolean) => void };

function useInventoryDraftGuard(onDirtyChange: DraftGuardProps["onDirtyChange"], additionalDirty = false) {
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onDirtyChange(dirty || additionalDirty); }, [dirty, additionalDirty, onDirtyChange]);
  return [dirty, setDirty] as const;
}

type InventoryConfirm = { title: string; detail: string; summary?: string[]; actionLabel: string; danger?: boolean; run: () => Promise<boolean> };

const localDateTime = (source = new Date()) => {
  const date = new Date(source);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const tehranDayBoundary = (date: string, endOfDay = false) => new Date(`${date}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+03:30`).toISOString();
const resultError = (result: Extract<ApiResult<unknown>, { ok: false }>) => inventoryErrorMessage(result.error);
const normalizeInventoryQuantity = (value: string) => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return value;
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(6, "0")}`;
};

export function InventoryWorkspace({ catalog, turnoverEnabled = false }: { catalog: ManagerCatalog; turnoverEnabled?: boolean }) {
  const [view, setView] = useRecoveryState<View>("inventory-view", "purchases");
  const [stockSelection, setStockSelection] = useState<string | null>(null);
  const [stockItems, setStockItems] = useState<InventoryStockItem[]>([]);
  const [recipes, setRecipes] = useState<InventoryRecipe[]>([]);
  const [pending, setPending] = useState<PendingInventoryConsumption[]>([]);
  const [pendingHasMore, setPendingHasMore] = useState(false);
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [readErrors, setReadErrors] = useState<Partial<Record<View, string>>>({});
  const [confirm, setConfirm] = useState<InventoryConfirm | null>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const confirmOpenerRef = useRef<HTMLElement | null>(null);
  const keys = useRef(new Map<string, string>());
  const mutationInFlight = useRef(false);
  const dirtyPanel = useRef(false);
  const markDirty = useCallback((dirty: boolean) => { dirtyPanel.current = dirty; }, []);
  const navigate = (next: View) => {
    if (next === view) return;
    if (dirtyPanel.current && !window.confirm("تغییرات این بخش ذخیره نشده است. بدون ذخیره از این بخش خارج می‌شوید؟")) return;
    dirtyPanel.current = false; setError(null); setSuccess(false); setView(next);
  };
  useEffect(() => {
    const preventDraftLoss = (event: BeforeUnloadEvent) => { if (dirtyPanel.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", preventDraftLoss);
    return () => window.removeEventListener("beforeunload", preventDraftLoss);
  }, []);

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
      readInventoryRecipes(),
      readPendingInventoryConsumption(),
    ]);
    if (results[0]!.ok) setStockItems(results[0]!.data.data.stockItems);
    if (results[1]!.ok) setRecipes(results[1]!.data.data.recipes);
    if (results[2]!.ok) { setPending(results[2]!.data.data.consumptions); setPendingHasMore(results[2]!.data.meta?.page?.hasMore ?? false); }
    setHistoryRefreshVersion((current) => current + 1);
    const dependencies: Partial<Record<View, number[]>> = { purchases: [0], overview: [0, 2], stock: [0], recipes: [0, 1], preparations: [0, 1], counts: [0, 2], history: [0, 2] };
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
    setSuccess(false);
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) { setError(resultError(result)); return false; }
      setError(null);
      await reload();
      setSuccess(true);
      return true;
    } catch {
      setError(inventoryErrorMessage({ kind: "invalid-response", code: "INTERNAL_ERROR", message: "" }));
      return false;
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="inventory-workspace" dir="rtl" aria-busy={loading || busy}>
      <div className="inventory-workspace-heading"><div><h2><InventoryIcon /> انبار و موجودی</h2></div><button type="button" className="secondary-button inventory-refresh" aria-label="تازه‌سازی انبار" disabled={loading || busy} onClick={() => void reload()}><RefreshIcon /></button><span className={`inventory-status${turnoverEnabled ? " inventory-status--success" : ""}`}>{turnoverEnabled ? "گردش موجودی فعال است" : "گردش موجودی فعال نشده"}</span></div>
      {!turnoverEnabled && <details className="inventory-turnover-note"><summary>محاسبه‌ی هزینه پیش از فعال‌سازی گردش موجودی</summary><p>ثبت خرید، دستور تهیه و گزارش سود ناخالص در دسترس است. مواد سفارش‌ها تا فعال‌سازی گردش موجودی از انبار کسر نمی‌شود.</p></details>}
      <nav className="inventory-tabs manager-tabs" aria-label="بخش‌های انبار">
        {([
          ["purchases", "خریدها"], ["overview", "نمای کلی"], ["stock", "اقلام موجودی"], ["recipes", "دستور تهیه و هزینه"],
          ["preparations", "دستورهای مشترک"], ["counts", "شمارش انبار"], ["history", "گردش موجودی"], ["sales", "آمار فروش"], ["profit", "سود ناخالص"],
        ] as const).map(([id, label]) => <button key={id} id={`inventory-view-${id}`} type="button" disabled={busy || !!confirm} className={view === id ? "is-active" : ""} aria-pressed={view === id} aria-controls="inventory-active-panel" onClick={() => navigate(id)}>{label}</button>)}
      </nav>
      {success && <p className="inventory-success" role="status">تغییرات ثبت شد.</p>}
      {error && !confirm && <p className="form-error" role="alert">{error}</p>}
      {readErrors[view] && !error && !confirm && <p className="form-error" role="alert">{readErrors[view]} <button type="button" disabled={loading || busy} onClick={() => void reload()}>بارگذاری دوباره</button></p>}
      {loading ? <div className="inventory-loading" role="status"><span>در حال بارگذاری اطلاعات موجودی…</span><div aria-hidden="true" /></div> : <div id="inventory-active-panel" role="region" aria-labelledby={`inventory-view-${view}`}>
        {view === "overview" && !readErrors.overview && <InventoryOverview items={stockItems} pending={pending} pendingHasMore={pendingHasMore} onNavigate={navigate} onOpenStock={id => { setStockSelection(id || null); navigate("stock"); }} />}
        {view === "profit" && <InventoryProfitPanel catalog={catalog} />}
        {view === "sales" && <InventorySalesChannelsPanel />}
        {view === "stock" && <StockPanel initialSelectedId={stockSelection} onDirtyChange={markDirty} items={stockItems} mutate={mutate} confirm={openConfirm} />}
        {view === "purchases" && !readErrors.purchases && <PurchasePanel onDirtyChange={markDirty} items={stockItems} mutate={mutate} confirm={openConfirm} keyFor={idempotencyKey} clearKey={clearIdempotencyKey} />}
        {view === "preparations" && !readErrors.preparations && <InventoryPreparations items={stockItems} recipes={recipes} mutate={mutate} onDirtyChange={markDirty} />}
        {view === "recipes" && <ProductOptionRecipePanel onDirtyChange={markDirty} catalog={catalog} items={stockItems} recipes={recipes} mutate={mutate} />}
        {view === "counts" && <CountPanel onDirtyChange={markDirty} items={stockItems} pending={pending} mutate={mutate} confirm={openConfirm} keyFor={idempotencyKey} clearKey={clearIdempotencyKey} />}
        {view === "history" && <HistoryPanel pending={pending} items={stockItems} refreshVersion={historyRefreshVersion} />}
      </div>}
      {confirm && <div className="manager-dialog-backdrop" role="presentation"><section className="manager-dialog" role="alertdialog" aria-modal="true" aria-labelledby="inventory-confirm-title" aria-describedby="inventory-confirm-detail" onKeyDown={handleConfirmKeyDown}><h2 id="inventory-confirm-title">{confirm.title}</h2><p id="inventory-confirm-detail">{confirm.detail}</p>{confirm.summary && <ul className="inventory-confirm-summary">{confirm.summary.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul>}{error && <p className="form-error" role="alert">{error}</p>}<div className="inventory-actions"><button className={confirm.danger ? "danger-button" : undefined} type="button" disabled={busy} onClick={() => { void confirm.run().then((ok) => { if (ok) closeConfirm(); }); }}>{confirm.actionLabel}</button><button ref={confirmCancelRef} className="secondary-button" type="button" disabled={busy} onClick={closeConfirm}>بازگشت</button></div></section></div>}
    </section>
  );
}

function StockPanel({ initialSelectedId, onDirtyChange, items, mutate, confirm }: { initialSelectedId: string | null; items: InventoryStockItem[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; confirm: (value: InventoryConfirm) => void } & DraftGuardProps) {
  const [dirty, setDirty] = useInventoryDraftGuard(onDirtyChange);
  const activeItems = items.filter((item) => item.isActive && !item.archivedAt);
  const [search, setSearch] = useState("");
  const [stockStatus, setStockStatus] = useState("");
  const [unit, setUnit] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const selected = activeItems.find(item => item.id === selectedId);
  const [threshold, setThreshold] = useState("");
  const shownItems = activeItems.filter((item) => item.name.includes(search.trim()) && (!unit || item.baseUnit === unit) && (!stockStatus || (stockStatus === "low" ? lowInventoryItem(item) : stockStatus === "empty" ? emptyInventoryItem(item) : stockStatus === "untracked" ? !item.balance.trackingStartedAt : !!item.balance.trackingStartedAt && !emptyInventoryItem(item))));
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<InventoryStockItem | null>(null);
  const [name, setName] = useState("");
  const [baseUnit, setBaseUnit] = useState<Unit>("GRAM");
  const [conversions, setConversions] = useState<StockConversion[]>([{ label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }]);
  const [piecePackQuantity, setPiecePackQuantity] = useState("");
  const [openingQuantity, setOpeningQuantity] = useState("0");
  const [openingValueAmount, setOpeningValueAmount] = useState("0");
  const [localError, setLocalError] = useState<string | null>(null);
  const reset = () => { setDirty(false); setSelectedId(null); setThreshold(""); setEditing(null); setName(""); setBaseUnit("GRAM"); setConversions([{ label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }]); setPiecePackQuantity(""); setOpeningQuantity("0"); setOpeningValueAmount("0"); setLocalError(null); };
  const startEdit = (item: InventoryStockItem) => { if (dirty && !window.confirm("تغییرات کالا ذخیره نشده است. ویرایش کالای دیگری را شروع می‌کنید؟")) return; setDirty(false); requestAnimationFrame(() => { nameInputRef.current?.focus(); nameInputRef.current?.scrollIntoView?.({ block: "center", behavior: "auto" }); }); setSelectedId(null); setThreshold(item.lowStockThreshold ?? ""); setEditing(item); setName(item.name); setBaseUnit(item.baseUnit); setConversions(item.conversions.map((conversion) => ({ id: conversion.id, label: conversion.label, baseQuantityPerPack: conversion.baseQuantityPerPack, isActive: conversion.isActive }))); setPiecePackQuantity(item.baseUnit === "PIECE" ? item.conversions.find((conversion) => conversion.isActive)?.baseQuantityPerPack ?? "" : ""); setOpeningQuantity(item.balance.quantityOnHand ?? "0"); setOpeningValueAmount(String(item.balance.carryingValueAmount ?? 0)); setLocalError(null); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((!editing || !editing.balance.trackingStartedAt) && (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(openingQuantity) || !/^\d+$/.test(openingValueAmount))) { setLocalError("مقدار آغازین و ارزش موجودی را به‌درستی وارد کنید."); return; }
    if (baseUnit === "PIECE" && piecePackQuantity.trim() && !/^(?=.*[1-9])\d+(?:\.\d{1,6})?$/.test(piecePackQuantity)) { setLocalError("تعداد داخل بسته باید بیشتر از صفر باشد."); return; }
    const packs = baseUnit === "PIECE"
      ? piecePackQuantity.trim()
        ? (() => {
            const currentPack = editing?.conversions.find((conversion) => conversion.isActive);
            const visiblePack = { ...(currentPack ? { id: currentPack.id } : {}), label: currentPack?.label ?? "بسته", baseQuantityPerPack: piecePackQuantity, isActive: true };
            const hiddenConversions = editing?.conversions.filter((conversion) => conversion.id !== currentPack?.id).map((conversion) => ({ id: conversion.id, label: conversion.label, baseQuantityPerPack: conversion.baseQuantityPerPack, isActive: conversion.isActive })) ?? [];
            return [visiblePack, ...hiddenConversions];
          })()
        : editing?.conversions.map((conversion) => ({ id: conversion.id, label: conversion.label, baseQuantityPerPack: conversion.baseQuantityPerPack, isActive: false })) ?? []
      : conversions.filter((entry) => entry.label.trim() || entry.baseQuantityPerPack.trim());
    if (packs.some((entry) => !entry.label.trim() || !/^\d+(?:\.\d{1,6})?$/.test(entry.baseQuantityPerPack))) { setLocalError("نام بسته‌بندی و مقدار تبدیل را وارد کنید."); return; }
    if (threshold.trim() && (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(threshold) || threshold.split(".")[0]!.length > 14)) { setLocalError("حد هشدار باید عدد نامنفی با حداکثر شش رقم اعشار باشد."); return; }
    const body = { lowStockThreshold: threshold.trim() || null, name: name.trim(), category: editing?.category ?? "مواد اولیه", baseUnit, ...(!editing || !editing.balance.trackingStartedAt ? { openingQuantity, openingValueAmount: Number(openingValueAmount) } : {}), conversions: packs.map((entry) => ({ ...(entry.id ? { id: entry.id } : {}), label: entry.label.trim(), baseQuantityPerPack: entry.baseQuantityPerPack, isActive: entry.isActive })) };
    const ok = await mutate(() => saveInventoryStockItem(editing?.id ?? null, { ...body, ...(editing ? { expectedVersion: editing.version } : {}) }));
    if (ok) reset();
  };
  return <div className="manager-grid inventory-stock-layout">
    {selected ? <InventoryStockDetail item={selected} onEdit={() => startEdit(selected)} /> : <ManagerCard title={editing ? "ویرایش کالای انبار" : "افزودن کالای انبار"} hint="واحد مبنا و موجودی آغازین را وارد کنید. برای گرم و میلی‌لیتر می‌توانید بسته‌بندی تعریف کنید.">
      <form className="manager-form" onChangeCapture={() => setDirty(true)} onSubmit={(event) => void submit(event)}>
        <div className="manager-fields inventory-stock-fields">
          <label><span>نام کالا</span><input ref={nameInputRef} required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <div className="inventory-stock-units">
            <label><span>واحد مبنا</span><select value={baseUnit} onChange={(event) => { const nextUnit = event.target.value as Unit; setBaseUnit(nextUnit); setPiecePackQuantity(""); if (!editing) setConversions(nextUnit === "GRAM" ? [{ label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }] : nextUnit === "MILLILITER" ? [{ label: "لیتر", baseQuantityPerPack: "1000", isActive: true }] : []); }}>{Object.entries(unitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {baseUnit === "PIECE" && <label><span>تعداد در هر بسته (عدد)</span><input inputMode="decimal" value={piecePackQuantity} onChange={(event) => setPiecePackQuantity(event.target.value)} placeholder="مثلاً ۲۴" /></label>}
          </div>
        </div>
        {(!editing || !editing.balance.trackingStartedAt) && <div className="manager-fields"><label><span>مقدار آغازین ({unitLabels[baseUnit]})</span><input required inputMode="decimal" value={openingQuantity} onChange={(event) => setOpeningQuantity(event.target.value)} /></label><label><span>ارزش موجودی آغازین (تومان)</span><input required type="number" min="0" step="1" value={openingValueAmount} onChange={(event) => setOpeningValueAmount(event.target.value)} /></label></div>}
        {baseUnit !== "PIECE" && <fieldset><legend>تبدیل واحد بسته‌بندی</legend>
          {conversions.map((conversion, index) => <div className="inventory-entry-row" key={conversion.id ?? index}>
            <label><span>نام بسته‌بندی</span><input value={conversion.label} onChange={(event) => setConversions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row))} placeholder="مثلاً کیلوگرم" /></label>
            <label><span>مقدار هر بسته به {unitLabels[baseUnit]}</span><input inputMode="decimal" value={conversion.baseQuantityPerPack} onChange={(event) => setConversions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, baseQuantityPerPack: event.target.value } : row))} placeholder="1000" /></label>
            <button className="text-button" type="button" onClick={() => { setDirty(true); setConversions((current) => current.filter((_, rowIndex) => rowIndex !== index)); }}>حذف تبدیل</button>
          </div>)}
          <button className="secondary-button" type="button" onClick={() => { setDirty(true); setConversions((current) => [...current, { label: "", baseQuantityPerPack: "", isActive: true }]); }}>افزودن تبدیل</button>
        </fieldset>}
        <label><span>حد هشدار موجودی ({unitLabels[baseUnit]}) · اختیاری</span><input aria-label={`حد هشدار موجودی (${unitLabels[baseUnit]}) · اختیاری`} aria-describedby="stock-threshold-hint" inputMode="decimal" value={threshold} onChange={event => setThreshold(event.target.value)} placeholder="بدون هشدار" /><small id="stock-threshold-hint">خالی بگذارید تا هشدار کمبود غیرفعال باشد؛ موجودی برابر یا کمتر از این عدد هشدار می‌گیرد.</small></label>
        {localError && <p className="form-error" role="alert">{localError}</p>}
        <div className="inventory-actions"><button type="submit">{editing ? "ذخیره تغییرات" : "ثبت کالا"}</button>{editing && <button className="secondary-button" type="button" onClick={reset}>انصراف از ویرایش</button>}</div>
      </form>
    </ManagerCard>}
    <ManagerCard title="اقلام موجودی" hint="موجودی آغازین در زمان ثبت کالا مشخص می‌شود؛ رسیدهای خرید و شمارش‌های فیزیکی آن را به‌روز می‌کنند.">
      <div className="inventory-toolbar">
        <label><span>جست‌وجوی کالا</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="نام ماده یا کالای انبار" /></label>
        <label><span>وضعیت موجودی</span><select value={stockStatus} onChange={(event) => setStockStatus(event.target.value)}><option value="">همه‌ی وضعیت‌ها</option><option value="available">دارای موجودی</option><option value="low">در حد هشدار مدیر</option><option value="empty">موجودی صفر</option><option value="untracked">مقدار آغازین ثبت نشده</option></select></label>
        <label><span>واحد کالا</span><select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="">همه‌ی واحدها</option>{Object.entries(unitLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div>
      <div className="inventory-actions"><button className="primary-button" type="button" onClick={() => { if (dirty && !window.confirm("تغییرات ذخیره نشده است. کالای جدید ایجاد می‌کنید؟")) return; reset(); requestAnimationFrame(() => nameInputRef.current?.focus()); }}>افزودن کالای جدید</button><button className="secondary-button" type="button" onClick={() => { setSearch(""); setUnit(""); setStockStatus(""); }}>پاک‌کردن فیلترها</button></div><p className="inventory-result-count">{inventoryNumber(shownItems.length)} قلم از {inventoryNumber(activeItems.length)} قلم فعال</p>
      <p className="inventory-table-hint">برای دیدن همه‌ی ستون‌ها، جدول را به طرفین بکشید.</p>
      <div className="inventory-table-wrap" role="region" aria-label="جدول اقلام موجودی" tabIndex={0}><table className="inventory-table"><thead><tr><th scope="col">کالا</th><th scope="col">موجودی فعلی</th><th scope="col">ارزش موجودی (تومان)</th><th scope="col">وضعیت</th><th scope="col">عملیات</th></tr></thead><tbody>{shownItems.map((item) => <tr key={item.id} className={editing?.id === item.id || selectedId === item.id ? "is-selected" : undefined}>
        <th scope="row"><button className="inventory-item-link" type="button" aria-pressed={selectedId === item.id} onClick={() => { if (dirty && !window.confirm("تغییرات ذخیره نشده است. جزئیات کالای دیگری را باز می‌کنید؟")) return; setDirty(false); setEditing(null); setSelectedId(item.id); }}>{item.name}</button><small className="inventory-cell-note">{unitLabels[item.baseUnit as Unit]}</small></th>
        <td><bdi>{item.balance.quantityOnHand === null ? "ثبت نشده" : inventoryQuantity(item.balance.quantityOnHand)}</bdi></td>
        <td><bdi>{item.balance.carryingValueAmount === null ? "ارزش‌گذاری نشده" : inventoryNumber(formatToman(item.balance.carryingValueAmount))}</bdi></td>
        <td><span className={`inventory-status${(emptyInventoryItem(item) || lowInventoryItem(item)) ? " inventory-status--warning" : " inventory-status--success"}`}>{!item.balance.trackingStartedAt ? "مقدار آغازین ثبت نشده" : emptyInventoryItem(item) ? "موجودی صفر" : lowInventoryItem(item) ? "کمبود موجودی" : "دارای موجودی"}</span></td>
        <td><div className="inventory-actions"><button className="secondary-button" type="button" aria-label={`ویرایش ${item.name}`} onClick={() => startEdit(item)}>ویرایش</button><button className="text-button" type="button" aria-label={`بایگانی ${item.name}`} onClick={() => confirm({ title: "بایگانی کالای انبار", detail: `قلم «${item.name}» از فهرست فعال خارج می‌شود. سابقه‌ی خرید و گردش آن حفظ می‌شود.`, actionLabel: "بایگانی کالا", danger: true, run: () => mutate(() => archiveInventoryStockItem(item.id, item.version)) })}>بایگانی</button></div></td>
      </tr>)}{shownItems.length === 0 && <tr><td colSpan={5}>{activeItems.length === 0 ? "هنوز کالای فعالی ثبت نشده است." : "کالایی با این فیلترها پیدا نشد."}</td></tr>}</tbody></table></div>
    </ManagerCard>
  </div>;
}

function PurchasePanel({ onDirtyChange, items, mutate, confirm, keyFor, clearKey }: { items: InventoryStockItem[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; confirm: (value: InventoryConfirm) => void; keyFor: (name: string) => string; clearKey: (name: string) => void } & DraftGuardProps) {
  const [returnDirty, setReturnDirty] = useState(false);
  const [dirty, setDirty] = useInventoryDraftGuard(onDirtyChange, returnDirty);
  const activeItems = items.filter((item) => item.isActive && !item.archivedAt);
  const [purchases, setPurchases] = useState<InventoryPurchase[]>([]);
  const [page, setPage] = useState({ limit: 20, nextCursor: null as string | null, hasMore: false });
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const currentPersianDate = currentPersianDateInput();
  const [filters, setFilters] = useState({ search: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "", status: "" });
  const [appliedFilters, setAppliedFilters] = useState({ search: "", from: "", to: "", status: "" });
  const [filterError, setFilterError] = useState<string | null>(null);
  const emptyLine = (): PurchaseLineDraft => { const item = activeItems[0]; return { stockItemId: item?.id ?? "", conversionId: "", purchaseUnitLabel: item?.baseUnit ?? "", purchaseQuantity: "1", directCostAmount: "0" }; };
  const [lines, setLines] = useState<PurchaseLineDraft[]>([emptyLine()]);
  const [receivedAt, setReceivedAt] = useState(localDateTime());
  const [supplier, setSupplier] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<InventoryPurchase | null>(null);
  const [returning, setReturning] = useState<{ purchase: InventoryPurchase; lineId: string } | null>(null);
  const [returnQuantity, setReturnQuantity] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const draftTotal = inventoryAmountTotal(lines.map((line) => line.directCostAmount));
  const resetPurchase = () => { setDirty(false); setEditingPurchase(null); setLines([emptyLine()]); setSupplier(""); setReceivedAt(localDateTime()); };
  useEffect(() => {
    let current = true;
    setPageLoading(true);
    setPageError(null);
    void readInventoryPurchases({ limit: page.limit, ...(cursor ? { cursor } : {}), ...(appliedFilters.search ? { search: appliedFilters.search } : {}), ...(appliedFilters.from ? { from: appliedFilters.from } : {}), ...(appliedFilters.to ? { to: appliedFilters.to } : {}), ...(appliedFilters.status ? { status: appliedFilters.status as "DRAFT" | "POSTED" } : {}) }).then((result) => {
      if (!current) return;
      if (result.ok) { setPurchases(result.data.data.purchases); setPage(result.data.data.page); }
      else setPageError(resultError(result));
      setPageLoading(false);
    });
    return () => { current = false; };
  }, [appliedFilters, cursor, page.limit, refreshVersion]);
  const mutateAndReload = async (action: () => Promise<ApiResult<unknown>>) => {
    const ok = await mutate(action);
    if (ok) { setCursor(null); setPreviousCursors([]); setRefreshVersion((current) => current + 1); }
    return ok;
  };
  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    const from = filters.fromValue ? persianDateToGregorianDate(filters.fromYear, filters.fromValue) : null;
    const to = filters.toValue ? persianDateToGregorianDate(filters.toYear, filters.toValue) : null;
    if ((filters.fromValue && !from) || (filters.toValue && !to)) { setFilterError("تاریخ شمسی را به شکل ماه/روز وارد کنید."); return; }
    if (from && to && from > to) { setFilterError("تاریخ شروع باید پیش از تاریخ پایان باشد."); return; }
    setFilterError(null);
    setCursor(null);
    setPreviousCursors([]);
    setAppliedFilters({ search: filters.search.trim(), from: from ? tehranDayBoundary(from) : "", to: to ? tehranDayBoundary(to, true) : "", status: filters.status });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const received = new Date(receivedAt);
    if (Number.isNaN(received.getTime())) { setLocalError("زمان دریافت را وارد کنید."); return; }
    setLocalError(null);
    const purchaseInput = { receivedAt: received.toISOString(), supplier: supplier.trim() || null, lines: lines.map((line) => ({ stockItemId: line.stockItemId, conversionId: line.conversionId || null, purchaseUnitLabel: line.purchaseUnitLabel, purchaseQuantity: line.purchaseQuantity, directCostAmount: Number(line.directCostAmount) })) };
    const result = await mutateAndReload(() => editingPurchase ? updateInventoryPurchase(editingPurchase.id, { ...purchaseInput, expectedVersion: editingPurchase.version }) : createInventoryPurchase(purchaseInput));
    if (result) resetPurchase();
  };
  const startEditPurchase = (purchase: InventoryPurchase) => {
    if (dirty && !window.confirm("تغییرات خرید ذخیره نشده است. پیش‌نویس دیگری را باز می‌کنید؟")) return; setDirty(false);
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
  return <div className="manager-grid inventory-purchase-layout">
    <ManagerCard title={editingPurchase ? "ویرایش پیش‌نویس خرید" : "پیش‌نویس خرید"} hint="ابتدا خرید را به‌صورت پیش‌نویس ذخیره کنید. پس از بررسی ردیف‌ها، «ثبت رسید در موجودی» مقدار و ارزش موجودی را به‌روز می‌کند.">
      {activeItems.length === 0 ? <p className="inventory-note">برای ثبت خرید، ابتدا یک قلم فعال به موجودی اضافه کنید.</p> : <form className="manager-form" onChangeCapture={() => setDirty(true)} onSubmit={(event) => void submit(event)}>
        {localError && <p className="form-error" role="alert">{localError}</p>}
        <div className="manager-fields"><label><span>زمان دریافت</span><input type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} required /></label><label><span>تأمین‌کننده (اختیاری)</span><input value={supplier} onChange={(event) => setSupplier(event.target.value)} /></label></div>
        {lines.map((line, index) => <div className="inventory-entry-row inventory-purchase-line" key={index}>
          <label><span>کالا</span><select value={line.stockItemId} onChange={(event) => changeStock(index, event.target.value)}>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>واحد خرید</span><select value={line.conversionId} onChange={(event) => { const selected = unitsFor(line).find((unit) => unit.id === event.target.value); setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, conversionId: selected?.id ?? "", purchaseUnitLabel: selected?.label ?? "" } : row)); }}>{unitsFor(line).map((unit) => <option key={`${unit.id}-${unit.label}`} value={unit.id}>{unit.title}</option>)}</select></label>
          <label><span>مقدار خرید ({unitsFor(line).find((unit) => unit.id === line.conversionId)?.title ?? "واحد انتخابی"})</span><input required inputMode="decimal" value={line.purchaseQuantity} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, purchaseQuantity: event.target.value } : row))} /></label>
          <label><span>هزینه‌ی مستقیم (تومان)</span><input required type="number" min="0" value={line.directCostAmount} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, directCostAmount: event.target.value } : row))} /></label>
          {lines.length > 1 && <button className="text-button" type="button" onClick={() => { setDirty(true); setLines((current) => current.filter((_, rowIndex) => rowIndex !== index)); }}>حذف ردیف</button>}
        </div>)}
        <p className="inventory-invoice-total"><span>جمع هزینه‌ی مستقیم (تومان)</span><strong>{draftTotal === null ? "مبلغ ردیف‌ها را بررسی کنید" : inventoryNumber(formatToman(draftTotal))}</strong></p>
        <div className="inventory-actions"><button className="secondary-button" type="button" onClick={() => { setDirty(true); setLines((current) => [...current, emptyLine()]); }}>افزودن ردیف کالا</button><button type="submit">{editingPurchase ? "ذخیره پیش‌نویس" : "ایجاد پیش‌نویس خرید"}</button>{editingPurchase && <button className="secondary-button" type="button" onClick={resetPurchase}>انصراف از ویرایش</button>}</div>
      </form>}
    </ManagerCard>
    <ManagerCard title="خریدها و پیش‌نویس‌ها" hint="برای پیدا کردن خریدها، جست‌وجو یا بازه‌ی زمانی را وارد کنید.">
      <form className="manager-form inventory-history-filter" onSubmit={applyFilters}>
        <div className="manager-fields">
          <label><span>جست‌وجو در تأمین‌کننده یا کالا</span><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="نام تأمین‌کننده یا کالا" /></label>
          <label><span>از تاریخ شمسی</span><input inputMode="numeric" placeholder="ماه/روز" value={filters.fromValue} onChange={(event) => setFilters((current) => ({ ...current, fromValue: event.target.value }))} /></label>
          <label><span>سال آغاز</span><input inputMode="numeric" value={filters.fromYear} onChange={(event) => setFilters((current) => ({ ...current, fromYear: event.target.value }))} /></label>
          <label><span>تا تاریخ شمسی</span><input inputMode="numeric" placeholder="ماه/روز" value={filters.toValue} onChange={(event) => setFilters((current) => ({ ...current, toValue: event.target.value }))} /></label>
          <label><span>سال پایان</span><input inputMode="numeric" value={filters.toYear} onChange={(event) => setFilters((current) => ({ ...current, toYear: event.target.value }))} /></label>
          <label><span>وضعیت خرید</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">همه‌ی وضعیت‌ها</option><option value="DRAFT">پیش‌نویس</option><option value="POSTED">رسید ثبت‌شده</option></select></label>
        </div>
        {filterError && <p className="form-error" role="alert">{filterError}</p>}
        <div className="inventory-actions"><button type="submit">اعمال فیلترها</button><button className="secondary-button" type="button" onClick={() => { const empty = { search: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "", status: "" }; setFilters(empty); setAppliedFilters({ search: "", from: "", to: "", status: "" }); setFilterError(null); setCursor(null); setPreviousCursors([]); }}>پاک‌کردن فیلترها</button></div>
      </form>
      <p className="inventory-table-hint">برای دیدن همه‌ی ستون‌ها، جدول را به طرفین بکشید.</p>
      {pageError && <p className="form-error" role="alert">{pageError}</p>}
      {pageLoading ? <p className="manager-empty" role="status">در حال بارگذاری خریدها…</p> : <div className="inventory-table-wrap" role="region" aria-label="جدول خریدها" tabIndex={0}><table className="inventory-table inventory-purchase-table"><thead><tr><th scope="col">تأمین‌کننده / دریافت</th><th scope="col">اقلام</th><th scope="col">هزینه‌ی مستقیم (تومان)</th><th scope="col">وضعیت</th><th scope="col">عملیات و جزئیات</th></tr></thead><tbody>{purchases.map((purchase) => <tr key={purchase.id}>
        <th scope="row">{purchase.supplier || "بدون نام تأمین‌کننده"}<small className="inventory-cell-note">{new Date(purchase.receivedAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran", dateStyle: "short", timeStyle: "short" })}</small></th>
        <td>{inventoryNumber(purchase.lines.length)} قلم</td><td><bdi>{inventoryAmountTotal(purchase.lines.map((line) => line.directCostAmount)) === null ? "خارج از محدوده‌ی نمایش" : inventoryNumber(formatToman(inventoryAmountTotal(purchase.lines.map((line) => line.directCostAmount))!))}</bdi></td><td><span className={`inventory-status${purchase.status === "POSTED" ? " inventory-status--success" : ""}`}>{purchase.status === "POSTED" ? "رسید ثبت‌شده" : "پیش‌نویس"}</span></td>
        <td><details className="inventory-purchase-details" open={returning?.purchase.id === purchase.id || undefined}><summary>اقلام خرید</summary><ul>{purchase.lines.map((line) => <li key={line.id}>{items.find((item) => item.id === line.stockItemId)?.name ?? "قلم بایگانی‌شده"}: {inventoryQuantity(line.baseQuantityReceived)} {unitLabels[(items.find((item) => item.id === line.stockItemId)?.baseUnit ?? "PIECE") as Unit]}، {inventoryNumber(formatToman(line.directCostAmount))} تومان</li>)}</ul></details>
        <div className="inventory-actions">{purchase.status === "DRAFT" ? <><button className="secondary-button" type="button" onClick={() => startEditPurchase(purchase)}>ویرایش پیش‌نویس</button><button type="button" onClick={() => confirm({ title: "بررسی رسید خرید", detail: "با ثبت رسید، مقدار و ارزش موجودی بر اساس این ردیف‌ها به‌روز می‌شود.", summary: [...purchase.lines.map((line) => { const item = items.find((entry) => entry.id === line.stockItemId); return `${item?.name ?? "قلم بایگانی‌شده"}: ${line.baseQuantityReceived} ${unitLabels[(item?.baseUnit ?? "PIECE") as Unit]}، ${formatToman(line.directCostAmount)}`; }), `جمع هزینه‌ی مستقیم: ${formatToman(purchase.lines.reduce((total, line) => total + line.directCostAmount, 0))}`], actionLabel: "ثبت رسید در موجودی", run: () => { const key = `purchase:post:${purchase.id}`; return mutateAndReload(async () => { const result = await postInventoryPurchase(purchase.id, purchase.version, keyFor(key)); if (result.ok) clearKey(key); return result; }); } })}>ثبت رسید در موجودی</button></> : <button className="secondary-button" type="button" onClick={() => { const line = purchase.lines[0]; if (line) { setReturning({ purchase, lineId: line.id }); setReturnQuantity(""); setReturnReason(""); } }}>ثبت برگشت خرید</button>}</div>
        {returning?.purchase.id === purchase.id && <form className="inventory-return-form" onChangeCapture={() => setReturnDirty(true)} onSubmit={(event) => { event.preventDefault(); const key = `purchase:return:${purchase.id}:${returning.lineId}`; void mutateAndReload(async () => { const result = await returnInventoryPurchase(purchase.id, { purchaseLineId: returning.lineId, baseQuantity: returnQuantity, occurredAt: new Date().toISOString(), reason: returnReason }, keyFor(key)); if (result.ok) { clearKey(key); setReturning(null); setReturnDirty(false); } return result; }); }}><label><span>ردیف خرید</span><select value={returning.lineId} onChange={(event) => { setReturning({ purchase, lineId: event.target.value }); setReturnQuantity(""); }}>{purchase.lines.map((line) => <option key={line.id} value={line.id}>{items.find((item) => item.id === line.stockItemId)?.name ?? "کالا"} · {line.baseQuantityReceived} {unitLabels[(items.find((item) => item.id === line.stockItemId)?.baseUnit ?? "PIECE") as Unit]}</option>)}</select></label><p>مقدار مرجوعی را با واحد مبنا وارد کنید.</p><label><span>مقدار برگشتی</span><input required inputMode="decimal" value={returnQuantity} onChange={(event) => setReturnQuantity(event.target.value)} /></label><label><span>دلیل</span><input required value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></label><div className="inventory-actions"><button type="submit">ثبت مرجوعی</button><button className="secondary-button" type="button" onClick={() => { setReturning(null); setReturnDirty(false); }}>انصراف</button></div></form>}
      </td></tr>)}{purchases.length === 0 && <tr><td colSpan={5}>خریدی با این فیلترها پیدا نشد.</td></tr>}</tbody></table></div>}
      <div className="inventory-actions inventory-history-pagination">
        <button className="secondary-button" type="button" disabled={pageLoading || previousCursors.length === 0} onClick={() => { const previous = previousCursors[previousCursors.length - 1] ?? null; setPreviousCursors((current) => current.slice(0, -1)); setCursor(previous); }}>صفحه‌ی قبل</button>
        <span>صفحه‌ی {previousCursors.length + 1}</span>
        <button className="secondary-button" type="button" disabled={pageLoading || !page.hasMore || !page.nextCursor} onClick={() => { if (!page.nextCursor) return; setPreviousCursors((current) => [...current, cursor]); setCursor(page.nextCursor); }}>صفحه‌ی بعد</button>
      </div>
    </ManagerCard>
  </div>;
}

type OptionIngredientDraft = { componentKey: string; sourceKind: "STOCK_ITEM" | "RECIPE"; sourceId: string; quantity: string };
type MenuOptionRecipeDraft = { channel?: "TABLE" | "TAKEAWAY"; optionId: string; optionName: string; groupName: string; recipeId: string; components: OptionIngredientDraft[] };

function ProductOptionRecipePanel({ onDirtyChange, catalog, items, recipes, mutate }: { catalog: ManagerCatalog; items: InventoryStockItem[]; recipes: InventoryRecipe[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean> } & DraftGuardProps) {
  const activeProducts = catalog.products.filter((product) => product.isActive && !product.archivedAt);
  const [productSearch, setProductSearch] = useState("");
  const [dirty, setDirty] = useInventoryDraftGuard(onDirtyChange);
  const [saved, setSaved] = useState(false);
  const selectProduct = (id: string) => { if (id === productId) return; if (dirty && !window.confirm("تغییرات دستور تهیه ذخیره نشده است. بدون ذخیره به محصول دیگری می‌روید؟")) return; setProductId(id); setDirty(false); setSaved(false); };
  const [productId, setProductId] = useState(activeProducts[0]?.id ?? "");
  const [configuration, setConfiguration] = useState<ProductCostingConfiguration>(null);
  const [entries, setEntries] = useState<MenuOptionRecipeDraft[]>([]);
  const [packaging, setPackaging] = useState<NonNullable<NonNullable<ProductCostingConfiguration>["takeawayPackaging"]>>([]);
  const [takeawayEntries, setTakeawayEntries] = useState<MenuOptionRecipeDraft[]>([]);
  const savedRecipes = useRef(new Map<string, InventoryRecipe>());
  const [previewChannel, setPreviewChannel] = useState<"TABLE" | "TAKEAWAY">("TABLE");
  const changePackaging = (next: typeof packaging) => { setPackaging(next); setDirty(true); setSaved(false); invalidatePreview(); };
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const previewInFlight = useRef(false);
  const previewVersion = useRef(0);
  const invalidatePreview = () => { previewVersion.current += 1; previewInFlight.current = false; setPreviewing(false); setPreviews({}); };
  const [error, setError] = useState<string | null>(null);
  const [previewQuantity, setPreviewQuantity] = useState("1");
  const [weightGrams, setWeightGrams] = useState("");
  const [previews, setPreviews] = useState<Record<string, ProductCostingPreview>>({});
  const [configRetryVersion, setConfigRetryVersion] = useState(0);
  const product = activeProducts.find((item) => item.id === productId);

  useEffect(() => {
    if (!productId) return;
    let current = true;
    setLoadingConfig(true);
    setLoadFailed(false);
    invalidatePreview();
    setConfiguration(null);
    setEntries([]);
    setPackaging([]);
    setTakeawayEntries([]);
    savedRecipes.current.clear();
    setPreviews({});
    setError(null);
    void readProductCosting(productId).then((result) => {
      if (!current) return;
      if (!result.ok) { setLoadFailed(true); setError(resultError(result)); setLoadingConfig(false); return; }
      const value = result.data.data;
      setConfiguration(value);
      setPackaging(value?.takeawayPackaging ?? []);
      const optionRecipes = value?.optionRecipes ?? [];
      const allowed = catalog.products.find((item) => item.id === productId)?.optionGroups.flatMap((group) => group.options.map((entry) => entry.optionId)) ?? [];
      const options = catalog.optionGroups.flatMap((group) => group.options.filter((option) => allowed.includes(option.id) && option.isActive && !option.archivedAt).map((option) => ({ id: option.id, name: option.name, group: group.name })));
      const normalEntries = (options.length ? options : [{ id: "", name: "مواد اصلی محصول", group: "بدون گزینه" }]).map((option) => {
        const configured = optionRecipes.find((entry) => entry.optionId === option.id) ?? (!option.id && value?.mode === "RECIPE" ? { recipeId: value.recipeId } : undefined);
        const recipe = recipes.find((candidate) => candidate.id === configured?.recipeId);
        return { optionId: option.id, optionName: option.name, groupName: option.group, recipeId: configured?.recipeId ?? "", components: recipe?.components.map((component) => ({ componentKey: component.componentKey, sourceKind: component.sourceKind, sourceId: component.sourceKind === "STOCK_ITEM" ? component.stockItemId : component.nestedRecipeId, quantity: component.quantity })) ?? [{ componentKey: crypto.randomUUID(), sourceKind: "STOCK_ITEM", sourceId: items.find((item) => item.isActive && !item.archivedAt)?.id ?? "", quantity: "" }] };
      });
      setEntries(normalEntries);
      if (value?.takeawayRecipeId || value?.takeawayOptionRecipes?.length) {
        setTakeawayEntries(normalEntries.map((entry) => {
          const configuredId = entry.optionId ? value.takeawayOptionRecipes?.find((row) => row.optionId === entry.optionId)?.recipeId : value.takeawayRecipeId;
          const recipe = recipes.find((row) => row.id === configuredId);
          return { ...entry, channel: "TAKEAWAY", recipeId: configuredId ?? "", components: recipe?.components.map((row) => ({ componentKey: row.componentKey, sourceKind: row.sourceKind, sourceId: row.sourceKind === "STOCK_ITEM" ? row.stockItemId : row.nestedRecipeId, quantity: row.quantity })) ?? entry.components.map((row) => ({ ...row })) };
        }));
      }
      setLoadingConfig(false);
    });
    return () => { current = false; previewVersion.current += 1; };
  }, [productId, configRetryVersion]);

  const changeEntry = (optionId: string, patch: Partial<MenuOptionRecipeDraft>, channel = "TABLE") => { setDirty(true); setSaved(false); invalidatePreview(); (channel === "TAKEAWAY" ? setTakeawayEntries : setEntries)((current) => current.map((entry) => entry.optionId === optionId ? { ...entry, ...patch } : entry)); };
  const changeIngredient = (optionId: string, index: number, patch: Partial<OptionIngredientDraft>, channel = "TABLE") => { setDirty(true); setSaved(false); invalidatePreview(); (channel === "TAKEAWAY" ? setTakeawayEntries : setEntries)((current) => current.map((entry) => entry.optionId === optionId ? { ...entry, components: entry.components.map((component, i) => i === index ? { ...component, ...patch } : component) } : entry)); };
  const runOptionPreview = async (entry: MenuOptionRecipeDraft) => {
    if (!product || previewInFlight.current || dirty) return;
    const version = ++previewVersion.current;
    previewInFlight.current = true;
    setPreviewing(true);
    setError(null);
    try {
      const result = await previewProductCosting(product.id, { channel: previewChannel, optionIds: entry.optionId ? [entry.optionId] : [], quantity: Number(previewQuantity), ...(product.pricingMode === "WEIGHTED_PER_KG" ? { weightGrams: Number(weightGrams) } : {}) });
      if (version !== previewVersion.current) return;
      if (!result.ok) setError(resultError(result));
      else setPreviews((current) => ({ ...current, [entry.optionId || "base"]: result.data.data }));
    } catch {
      if (version === previewVersion.current) setError("هزینه دریافت نشد. اتصال را بررسی کنید و دوباره محاسبه کنید.");
    } finally {
      if (version === previewVersion.current) { previewInFlight.current = false; setPreviewing(false); }
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!product || !entries.length) { setError("این محصول منویی گزینه‌ای برای تنظیم ندارد."); return; }
    if ([...entries, ...takeawayEntries].some((entry) => !entry.components.length || entry.components.some((component) => !component.sourceId || !/^\d+(?:\.\d{1,6})?$/.test(component.quantity)))) { setError("برای هر گزینه، قلم یا دستور تهیه و مقدار آن را کامل کنید."); return; }
    if (packaging.some((entry) => !entry.stockItemId || !/^\d+(?:\.\d{1,6})?$/.test(entry.quantity) || Number(entry.quantity) <= 0) || new Set(packaging.map((entry) => entry.stockItemId)).size !== packaging.length) { setError("قلم و مقدار بسته‌بندی را کامل کنید؛ هر قلم را فقط یک بار وارد کنید."); return; }
    if (packaging.some((entry) => (entry.mode === "PER_GROUP" && (!Number.isInteger(entry.groupSize) || entry.groupSize! < 2 || entry.groupSize! > 10000)) || (entry.minQuantity !== undefined && (!Number.isInteger(entry.minQuantity) || entry.minQuantity < 1)) || (entry.maxQuantity !== undefined && (!Number.isInteger(entry.maxQuantity) || entry.maxQuantity < (entry.minQuantity ?? 1))))) { setError("شرط تعداد بسته‌بندی را بررسی کنید؛ تعداد گروه و بازه باید معتبر باشند."); return; }
    setError(null);
    await mutate(async () => {
      const optionRecipes: Array<{ optionId: string; recipeId: string; recipeQuantity: string }> = [];
      const takeawayOptionRecipes: typeof optionRecipes = [];
      let takeawayRecipeId: string | null = null;
      let fallbackRecipeId: string | undefined;
      for (const entry of [...entries, ...takeawayEntries]) {
        const weighted = product.pricingMode === "WEIGHTED_PER_KG";
        const name = `${product.name} ${entry.optionName} ${entry.optionId.slice(0, 6)}${entry.channel === "TAKEAWAY" ? " بیرون‌بر" : ""}`;
        const existing = savedRecipes.current.get(entry.recipeId) ?? recipes.find((recipe) => recipe.id === entry.recipeId) ?? recipes.find((recipe) => recipe.name === name && recipe.isActive && !recipe.archivedAt);
        const recipeResult = await saveInventoryRecipe(existing?.id ?? null, {
          name,
          ingredientName: product.name,
          outputUnit: weighted ? "GRAM" : "PIECE",
          yieldQuantity: weighted ? "1000" : "1",
          components: entry.components.map((component, displayOrder) => ({ componentKey: component.componentKey, sourceKind: component.sourceKind, ...(component.sourceKind === "STOCK_ITEM" ? { stockItemId: component.sourceId } : { nestedRecipeId: component.sourceId }), quantity: component.quantity, displayOrder })),
          ...(existing ? { expectedVersion: existing.version } : {}),
        });
        if (!recipeResult.ok) return recipeResult;
        const savedRecipe = recipeResult.data.data;
        savedRecipes.current.set(savedRecipe.id, savedRecipe);
        changeEntry(entry.optionId, { recipeId: savedRecipe.id }, entry.channel);
        if (entry.optionId) (entry.channel === "TAKEAWAY" ? takeawayOptionRecipes : optionRecipes).push({ optionId: entry.optionId, recipeId: savedRecipe.id, recipeQuantity: weighted ? "1000" : "1" });
        else if (entry.channel === "TAKEAWAY") takeawayRecipeId = savedRecipe.id;
        else fallbackRecipeId = savedRecipe.id;
      }
      const firstRecipe = optionRecipes[0];
      const baseRecipeId = firstRecipe?.recipeId ?? fallbackRecipeId ?? (configuration?.mode === "RECIPE" ? configuration.recipeId : undefined);
      if (!baseRecipeId) { setError("برای محاسبه‌ی هزینه، یک دستور تهیه به محصول منو وصل کنید."); return { ok: false as const, error: { kind: "response" as const, status: 422, code: "BUSINESS_RULE_VIOLATION", message: "یک گزینه برای این محصول تنظیم نشده است." } }; }
      const result = await saveProductCosting(product.id, { mode: "RECIPE", recipeId: baseRecipeId, recipeQuantity: product.pricingMode === "WEIGHTED_PER_KG" ? "1000" : "1", extrasRecipeId: configuration?.extrasRecipeId ?? null, takeawayPackaging: packaging, takeawayRecipeId, takeawayOptionRecipes, optionRules: configuration?.optionRules ?? [], optionRecipes, combinations: configuration?.combinations.map(({ name, optionIds, rules }) => ({ name, optionIds, rules })) ?? [], expectedVersion: configuration?.version ?? 1 });
      if (result.ok) { setConfiguration(result.data.data); setDirty(false); setSaved(true); setPreviews({}); }
      return result;
    });
  };

  return <div className="inventory-recipe-layout"><aside className="manager-card inventory-product-picker" aria-label="انتخاب محصول برای دستور تهیه"><header><h2>محصولات منو</h2><p>محصول را انتخاب کنید و مواد هر گزینه را تنظیم کنید.</p></header><label><span>جست‌وجوی محصول منو</span><input type="search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="نام محصول" /></label><div className="inventory-product-list">{activeProducts.filter((item) => item.name.includes(productSearch.trim())).map((item) => <button className="secondary-button" type="button" key={item.id} aria-pressed={item.id === productId} onClick={() => selectProduct(item.id)}>{item.name}<small>{item.pricingMode === "WEIGHTED_PER_KG" ? "وزنی" : "واحدی"}</small></button>)}{activeProducts.length > 0 && !activeProducts.some((item) => item.name.includes(productSearch.trim())) && <p className="inventory-empty">محصولی با این نام پیدا نشد.</p>}</div></aside><ManagerCard title="دستور تهیه و هزینه" hint="محصول منو را انتخاب کنید و مواد لازم برای هر گزینه‌ی منو را ثبت کنید.">
    {activeProducts.length === 0 ? <p className="inventory-note">برای شروع، ابتدا یک محصول فعال در منو بسازید.</p> : <>
      <div className="manager-fields inventory-compact-product-picker"><label><span>محصول منو</span><select value={productId} onChange={(event) => selectProduct(event.target.value)}>{activeProducts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      {dirty && <p className="inventory-note" role="status">تغییرات ذخیره نشده است. پس از تکمیل مواد، دستور تهیه را ذخیره کنید.</p>}{saved && <p className="inventory-success" role="status">دستور تهیه ذخیره شد.</p>}
      {loadingConfig ? <p className="manager-empty">در حال بارگذاری گزینه‌های منو…</p> : <>
      {error && <p className="form-error" role="alert">{error} {loadFailed && <button type="button" disabled={loadingConfig} onClick={() => setConfigRetryVersion((current) => current + 1)}>بارگذاری تنظیم هزینه</button>}</p>}
      <div className="inventory-selected-product"><div><strong>مواد لازم برای {product?.name}</strong><small className="inventory-cell-note">قیمت پایه‌ی منو: {product ? formatToman(product.priceAmount) : ""} تومان{product?.pricingMode === "WEIGHTED_PER_KG" ? " در هر کیلوگرم" : ""} · قیمت گزینه‌ها جداگانه محاسبه می‌شود.</small></div></div>
      {entries.length === 0 ? <p className="inventory-note">برای این محصول، گزینه‌ای در منو تعریف نشده است.</p> : <form className="manager-form" onSubmit={(event) => void submit(event)}>
        <label><input type="checkbox" checked={takeawayEntries.length > 0} onChange={(event) => { setDirty(true); setSaved(false); invalidatePreview(); setTakeawayEntries(event.target.checked ? entries.map((entry) => ({ ...entry, channel: "TAKEAWAY", recipeId: "", components: entry.components.map((row) => ({ ...row })) })) : []); }} /> دستور مواد بیرون‌بر جداگانه</label>
        <p className="inventory-note">برای استفاده از کوکی بسته‌بندی‌شده، دستور «کوکی بیرون‌بر» را در دستورهای مشترک بسازید و در مواد بیرون‌بر انتخاب کنید. بدون دستور جداگانه، مواد داخل کافه استفاده می‌شود.</p>
        {[...entries, ...takeawayEntries].map((entry) => <fieldset className="inventory-option-recipe" key={`${entry.channel ?? "TABLE"}:${entry.optionId}`}>
          <legend>{entry.optionName}<small> · {entry.groupName}{entry.channel === "TAKEAWAY" ? " · بیرون‌بر" : " · داخل کافه"}</small></legend>
          {entry.components.map((component, index) => {
            const sourceItems = component.sourceKind === "STOCK_ITEM" ? items.filter((item) => item.isActive && !item.archivedAt) : recipes.filter((recipe) => recipe.isActive && !recipe.archivedAt && recipe.id !== entry.recipeId);
            const sourceUnit = component.sourceKind === "STOCK_ITEM" ? items.find((item) => item.id === component.sourceId)?.baseUnit : recipes.find((recipe) => recipe.id === component.sourceId)?.outputUnit;
            return <div className="inventory-entry-row" key={component.componentKey}>
              <label><span>نوع ماده</span><select value={component.sourceKind} onChange={(event) => { const sourceKind = event.target.value as OptionIngredientDraft["sourceKind"]; const sourceId = sourceKind === "STOCK_ITEM" ? items.find((item) => item.isActive && !item.archivedAt)?.id ?? "" : recipes.find((recipe) => recipe.isActive && !recipe.archivedAt && recipe.id !== entry.recipeId)?.id ?? ""; changeIngredient(entry.optionId, index, { sourceKind, sourceId }, entry.channel); }}><option value="STOCK_ITEM">قلم موجودی</option><option value="RECIPE">دستور تهیه‌ی موجود</option></select></label>
              <label><span>{component.sourceKind === "STOCK_ITEM" ? "قلم موجودی" : "دستور تهیه"}</span><SearchableSourcePicker options={sourceItems.map((source) => ({ id: source.id, name: source.name }))} value={component.sourceId} onChange={(sourceId) => changeIngredient(entry.optionId, index, { sourceId }, entry.channel)} placeholder={component.sourceKind === "STOCK_ITEM" ? "جست‌وجوی قلم موجودی" : "جست‌وجوی دستور تهیه"} /></label>
              <label><span>مقدار{sourceUnit ? ` (${unitLabels[sourceUnit as Unit]})` : ""}</span><input required inputMode="decimal" value={component.quantity} placeholder={sourceUnit ? `مقدار به ${unitLabels[sourceUnit as Unit]}` : "مقدار"} onChange={(event) => changeIngredient(entry.optionId, index, { quantity: event.target.value }, entry.channel)} /></label>
              {entry.components.length > 1 && <button className="text-button" type="button" onClick={() => changeEntry(entry.optionId, { components: entry.components.filter((_, i) => i !== index) }, entry.channel)}>حذف ماده</button>}
            </div>;
          })}
          <button className="secondary-button" type="button" onClick={() => changeEntry(entry.optionId, { components: [...entry.components, { componentKey: crypto.randomUUID(), sourceKind: "STOCK_ITEM", sourceId: items.find((item) => item.isActive && !item.archivedAt)?.id ?? "", quantity: "" }] }, entry.channel)}>افزودن ماده به {entry.optionName}</button>
        </fieldset>)}
        <fieldset className="inventory-option-recipe">
          <legend>بسته‌بندی بیرون‌بر</legend>
          <p className="inventory-note">لیوان، ظرف یا هولدر را ابتدا در اقلام موجودی ثبت کنید. مقدار هر قلم برای یک واحد فروش است؛ برای محصول وزنی هم به تعداد واحدها محاسبه می‌شود. این هزینه فقط به سفارش بیرون‌بر اضافه می‌شود. گروه کامل با جمع تعداد همین محصول در سفارش محاسبه می‌شود؛ گروه ناقص بسته‌بندی نمی‌گیرد. حداقل و حداکثر اختیاری هستند.</p>
          {packaging.map((entry, index) => <div className="inventory-entry-row" key={index}>
            <label><span>قلم بسته‌بندی {index + 1}</span><select required value={entry.stockItemId} onChange={(event) => changePackaging(packaging.map((row, i) => i === index ? { ...row, stockItemId: event.target.value } : row))}>
              <option value="">انتخاب قلم</option>
              {items.filter((item) => (item.isActive && !item.archivedAt) || item.id === entry.stockItemId).map((item) => <option key={item.id} value={item.id}>{item.name}{!item.isActive || item.archivedAt ? " (بایگانی‌شده)" : ""}</option>)}
            </select></label>
            <label><span>مقدار بسته‌بندی {index + 1} ({unitLabels[(items.find((item) => item.id === entry.stockItemId)?.baseUnit ?? "PIECE") as Unit]})</span><input required inputMode="decimal" value={entry.quantity} onChange={(event) => changePackaging(packaging.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row))} /></label>
            <label><span>روش محاسبه‌ی بسته‌بندی {index + 1}</span><select value={entry.mode ?? "PER_UNIT"} onChange={(event) => changePackaging(packaging.map((row, i) => { if (i !== index) return row; const { groupSize, ...rest } = row; return { ...rest, mode: event.target.value as "PER_UNIT" | "PER_GROUP" | "PER_ORDER", ...(event.target.value === "PER_GROUP" ? { groupSize: 2 } : {}) }; }))}><option value="PER_UNIT">برای هر واحد محصول</option><option value="PER_GROUP">برای هر گروه کامل</option><option value="PER_ORDER">یک بار برای محصول در سفارش</option></select></label>
            {entry.mode === "PER_GROUP" && <label><span>تعداد واحد در هر گروه {index + 1}</span><input required type="number" min="2" max="10000" value={entry.groupSize ?? 2} onChange={(event) => changePackaging(packaging.map((row, i) => i === index ? { ...row, groupSize: Number(event.target.value) } : row))} /></label>}
            <label><span>حداقل تعداد محصول برای بسته‌بندی {index + 1}</span><input type="number" min="1" max="1000000" value={entry.minQuantity ?? ""} onChange={(event) => changePackaging(packaging.map((row, i) => { if (i !== index) return row; const { minQuantity, ...rest } = row; return event.target.value ? { ...rest, minQuantity: Number(event.target.value) } : rest; }))} /></label>
            <label><span>حداکثر تعداد محصول برای بسته‌بندی {index + 1}</span><input type="number" min="1" max="1000000" value={entry.maxQuantity ?? ""} onChange={(event) => changePackaging(packaging.map((row, i) => { if (i !== index) return row; const { maxQuantity, ...rest } = row; return event.target.value ? { ...rest, maxQuantity: Number(event.target.value) } : rest; }))} /></label>
            <button type="button" className="text-button" onClick={() => changePackaging(packaging.filter((_, i) => i !== index))}>حذف بسته‌بندی {index + 1}</button>
          </div>)}
          <button type="button" className="secondary-button" onClick={() => changePackaging([...packaging, { stockItemId: "", quantity: "1" }])}>افزودن بسته‌بندی بیرون‌بر</button>
        </fieldset>
        <button type="submit" disabled={loadingConfig || loadFailed}>ذخیره‌ی دستورهای تهیه</button>
      </form>}
      {configuration && <section className="inventory-option-previews">
        <label><span>نوع سفارش برای محاسبه‌ی هزینه</span><select value={previewChannel} disabled={previewing} onChange={(event) => { invalidatePreview(); setPreviewChannel(event.target.value as "TABLE" | "TAKEAWAY"); }}><option value="TABLE">داخل کافه</option><option value="TAKEAWAY">بیرون‌بر</option></select></label>
        <h3>هزینه‌ی دستور ذخیره‌شده</h3><p className="inventory-cell-note">این محاسبه از دستور ذخیره‌شده انجام می‌شود؛ تغییرات فرم را ابتدا ذخیره کنید.</p>
        <div className="manager-fields">
          <label><span>تعداد</span><input type="number" min="1" value={previewQuantity} disabled={previewing} onChange={(event) => { invalidatePreview(); setPreviewQuantity(event.target.value); }} /></label>
          {product?.pricingMode === "WEIGHTED_PER_KG" && <label><span>وزن هر واحد (گرم)</span><input type="number" min="1" value={weightGrams} disabled={previewing} onChange={(event) => { invalidatePreview(); setWeightGrams(event.target.value); }} /></label>}
        </div>
        {entries.map((entry) => { const preview = previews[entry.optionId || "base"]; return <div className="inventory-option-preview" key={entry.optionId}>
          <button className="secondary-button" type="button" disabled={loadingConfig || dirty || previewing} onClick={() => void runOptionPreview(entry)}>{previewing ? "در حال محاسبه‌ی هزینه…" : `محاسبه‌ی هزینه‌ی ${entry.optionName}`}</button>
          {preview && <><p>{preview.isComplete ? "هزینه‌ی مواد کامل است" : "هزینه‌ی مواد کامل نیست"} · {formatToman(preview.knownCostAmount)}</p>{preview.components.length > 0 && <small>{preview.components.map((component) => `${component.stockItemName}: ${component.quantity} ${unitLabels[component.baseUnit as Unit]}`).join("، ")}</small>}{!preview.isComplete && preview.missingReasons.length > 0 && <small>{preview.missingReasons.map(prettyMissingReason).join("، ")}</small>}</>}
        </div>; })}
      </section>}
      </>}
    </>}
  </ManagerCard></div>;
}

function SearchableSourcePicker({ options, value, onChange, placeholder }: { options: Array<{ id: string; name: string }>; value: string; onChange: (value: string) => void; placeholder: string }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredOptions = options.filter((option) => option.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selectedName = options.find((option) => option.id === value)?.name ?? "";
  const selectOption = (option: { id: string; name: string }) => { onChange(option.id); setSearch(""); setOpen(false); };
  return <div className="inventory-search-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setSearch(""); } }}>
    <input
      type="text"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open && filteredOptions[activeIndex] ? `${listId}-${activeIndex}` : undefined}
      autoComplete="off"
      required
      value={open ? search : selectedName}
      placeholder={placeholder}
      onFocus={() => { setOpen(true); setSearch(""); setActiveIndex(0); }}
      onChange={(event) => { setSearch(event.target.value); setOpen(true); setActiveIndex(0); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.min(current + 1, Math.max(filteredOptions.length - 1, 0))); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.max(current - 1, 0)); }
        else if (event.key === "Enter" && open && filteredOptions[activeIndex]) { event.preventDefault(); selectOption(filteredOptions[activeIndex]!); }
        else if (event.key === "Escape") { setSearch(""); setOpen(false); }
      }}
    />
    {open && <div className="inventory-search-picker__list" id={listId} role="listbox">
      {filteredOptions.map((option, index) => <button id={`${listId}-${index}`} type="button" role="option" aria-selected={option.id === value} className={index === activeIndex ? "is-active" : ""} key={option.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectOption(option)}>{option.name}</button>)}
      {filteredOptions.length === 0 && <p>موردی با این نام پیدا نشد.</p>}
    </div>}
  </div>;
}

function prettyMissingReason(reason: string) {
  if (reason.startsWith("missing-costing:")) return `هزینه‌ی ${reason.slice("missing-costing:".length)} تنظیم نشده است`;
  if (reason.startsWith("missing-recipe:")) return "دستور تهیه‌ی یکی از مواد موجود نیست";
  if (reason.startsWith("missing-stock:")) return "قلم موجودی یکی از مواد موجود نیست";
  if (reason.startsWith("missing-valuation:")) return "ارزش موجودی یکی از مواد هنوز ثبت نشده است";
  if (reason.startsWith("recipe-cycle:")) return "در دستورهای تهیه، ارجاع تکراری وجود دارد";
  return "برای تکمیل محاسبه، بخشی از اطلاعات لازم است";
}

function CountPanel({ onDirtyChange, items, pending, mutate, confirm, keyFor, clearKey }: { items: InventoryStockItem[]; pending: PendingInventoryConsumption[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; confirm: (value: InventoryConfirm) => void; keyFor: (name: string) => string; clearKey: (name: string) => void } & DraftGuardProps) {
  const [dirty, setDirty] = useInventoryDraftGuard(onDirtyChange);
  const activeItems = items.filter((item) => item.isActive && !item.archivedAt);
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [page, setPage] = useState({ limit: 20, nextCursor: null as string | null, hasMore: false });
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const currentPersianDate = currentPersianDateInput();
  const [filters, setFilters] = useState({ search: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "", status: "" });
  const [appliedFilters, setAppliedFilters] = useState({ search: "", from: "", to: "", status: "" });
  const [filterError, setFilterError] = useState<string | null>(null);
  const [editingCount, setEditingCount] = useState<InventoryCount | null>(null);
  const [lines, setLines] = useState<Array<{ stockItemId: string; expectedQuantity: string; observedQuantity: string; observedValueAmount: string }>>([]);
  const [reason, setReason] = useState("");
  const [reconcile, setReconcile] = useState<string[]>([]);
  const eligibleLines = () => activeItems.filter((item) => !!item.balance.trackingStartedAt).map((item) => ({ stockItemId: item.id, expectedQuantity: item.balance.quantityOnHand ?? "0", observedQuantity: item.balance.quantityOnHand ?? "0", observedValueAmount: String(item.balance.carryingValueAmount ?? 0) }));
  const hasQuantityDifference = lines.some((line) => {
    const observed = normalizeInventoryQuantity(line.observedQuantity);
    const currentQuantity = items.find((item) => item.id === line.stockItemId)?.balance.quantityOnHand;
    return observed !== normalizeInventoryQuantity(line.expectedQuantity) || (currentQuantity !== null && currentQuantity !== undefined && observed !== normalizeInventoryQuantity(currentQuantity));
  });
  useEffect(() => {
    let current = true;
    setPageLoading(true);
    setPageError(null);
    void readInventoryCounts({ limit: page.limit, kind: "PHYSICAL", ...(cursor ? { cursor } : {}), ...(appliedFilters.search ? { search: appliedFilters.search } : {}), ...(appliedFilters.from ? { from: appliedFilters.from } : {}), ...(appliedFilters.to ? { to: appliedFilters.to } : {}), ...(appliedFilters.status ? { status: appliedFilters.status as "DRAFT" | "POSTED" } : {}) }).then((result) => {
      if (!current) return;
      if (result.ok) { setCounts(result.data.data.counts); setPage(result.data.data.page); }
      else setPageError(resultError(result));
      setPageLoading(false);
    });
    return () => { current = false; };
  }, [appliedFilters, cursor, page.limit, refreshVersion]);
  const mutateAndReload = async (action: () => Promise<ApiResult<unknown>>) => {
    const ok = await mutate(action);
    if (ok) { setCursor(null); setPreviousCursors([]); setRefreshVersion((current) => current + 1); }
    return ok;
  };
  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    const from = filters.fromValue ? persianDateToGregorianDate(filters.fromYear, filters.fromValue) : null;
    const to = filters.toValue ? persianDateToGregorianDate(filters.toYear, filters.toValue) : null;
    if ((filters.fromValue && !from) || (filters.toValue && !to)) { setFilterError("تاریخ شمسی را به شکل ماه/روز وارد کنید."); return; }
    if (from && to && from > to) { setFilterError("تاریخ شروع باید پیش از تاریخ پایان باشد."); return; }
    setFilterError(null);
    setCursor(null);
    setPreviousCursors([]);
    setAppliedFilters({ search: filters.search.trim(), from: from ? tehranDayBoundary(from) : "", to: to ? tehranDayBoundary(to, true) : "", status: filters.status });
  };
  useEffect(() => { if (lines.length === 0) setLines(eligibleLines()); }, [activeItems.length]);
  const startEdit = (count: InventoryCount) => { if (dirty && !window.confirm("تغییرات شمارش ذخیره نشده است. شمارش دیگری را باز می‌کنید؟")) return; setDirty(false); setEditingCount(count); setReason(count.reason ?? ""); setLines(count.lines.map((line) => ({ stockItemId: line.stockItemId, expectedQuantity: line.expectedQuantity ?? "0", observedQuantity: line.observedQuantity, observedValueAmount: String(line.observedValueAmount) }))); };
  const resetCountDraft = () => { setDirty(false); setEditingCount(null); setReason(""); setLines(eligibleLines()); };
  const submit = async (event: FormEvent) => { event.preventDefault(); const countLines = lines.map((line) => ({ stockItemId: line.stockItemId, observedQuantity: line.observedQuantity, observedValueAmount: Number(line.observedValueAmount) })); const countInput = { lines: countLines, ...(reason.trim() ? { reason: reason.trim() } : {}) }; const result = await mutateAndReload(() => editingCount ? updateInventoryCount(editingCount.id, { ...countInput, expectedVersion: editingCount.version }) : createInventoryCount({ ...countInput, kind: "PHYSICAL" })); if (result) resetCountDraft(); };
  return <div className="manager-grid">
    <ManagerCard title="شمارش فیزیکی موجودی" hint="مقدار و ارزش ثبت‌شده را با شمارش واقعی جایگزین کنید. اگر سفارشی هنوز از موجودی کم نشده، پیش از ثبت شمارش آن را انتخاب کنید.">
      <form className="manager-form inventory-count-form" onChangeCapture={() => setDirty(true)} onSubmit={(event) => void submit(event)}>
        <fieldset className="inventory-option-choices"><legend>اقلام این شمارش</legend>{eligibleLines().map((eligible) => <label key={eligible.stockItemId}><input type="checkbox" checked={lines.some((line) => line.stockItemId === eligible.stockItemId)} onChange={(event) => setLines((current) => event.target.checked ? [...current, eligible] : current.filter((line) => line.stockItemId !== eligible.stockItemId))} />شمارش {activeItems.find((item) => item.id === eligible.stockItemId)?.name}</label>)}</fieldset>
        {lines.map((line, index) => { const item = activeItems.find((entry) => entry.id === line.stockItemId); return <div className="inventory-count-line" role="group" aria-label={item?.name ?? "کالا"} key={line.stockItemId}><strong>{item?.name ?? "کالا"}</strong><label><span>مقدار {item ? unitLabels[item.baseUnit as Unit] : ""}</span><input required inputMode="decimal" value={line.observedQuantity} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, observedQuantity: event.target.value } : row))} /></label><label><span>ارزش موجودی (تومان)</span><input required type="number" min="0" value={line.observedValueAmount} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, observedValueAmount: event.target.value } : row))} /></label></div>; })}
        {lines.length === 0 && <p className="inventory-note">برای ثبت شمارش، حداقل یک قلم واجد شرایط انتخاب کنید.</p>}
        {hasQuantityDifference && <label><span>دلیل اختلاف موجودی (برای کل شمارش)</span><textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="علت تفاوت مقدار شمارش‌شده با موجودی ثبت‌شده را بنویسید" /></label>}
        <div className="inventory-actions"><button type="submit" disabled={!lines.length || (hasQuantityDifference && !reason.trim())}>{editingCount ? "ذخیره پیش‌نویس شمارش" : "ایجاد پیش‌نویس شمارش"}</button>{editingCount && <button className="secondary-button" type="button" onClick={resetCountDraft}>انصراف از ویرایش</button>}</div>
      </form>
    </ManagerCard>
    <ManagerCard title="پیش‌نویس و شمارش‌های ثبت‌شده" hint="شمارش ثبت‌شده و اختلاف آن با موجودی قبلی در سابقه می‌ماند.">
      <form className="manager-form inventory-history-filter" onSubmit={applyFilters}>
        <div className="manager-fields">
          <label><span>جست‌وجوی کالا</span><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="نام کالا" /></label>
          <label><span>وضعیت</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">همه‌ی وضعیت‌ها</option><option value="DRAFT">پیش‌نویس</option><option value="POSTED">ثبت‌شده</option></select></label>
          <label><span>از تاریخ شمسی</span><div className="inventory-date-input"><input inputMode="numeric" value={filters.fromValue} onChange={(event) => setFilters((current) => ({ ...current, fromValue: event.target.value }))} placeholder="ماه/روز" /><input inputMode="numeric" aria-label="سال شروع" value={filters.fromYear} onChange={(event) => setFilters((current) => ({ ...current, fromYear: event.target.value }))} /></div></label>
          <label><span>تا تاریخ شمسی</span><div className="inventory-date-input"><input inputMode="numeric" value={filters.toValue} onChange={(event) => setFilters((current) => ({ ...current, toValue: event.target.value }))} placeholder="ماه/روز" /><input inputMode="numeric" aria-label="سال پایان" value={filters.toYear} onChange={(event) => setFilters((current) => ({ ...current, toYear: event.target.value }))} /></div></label>
        </div>
        {filterError && <p className="form-error" role="alert">{filterError}</p>}
        <div className="inventory-actions"><button type="submit">اعمال فیلترها</button><button className="secondary-button" type="button" onClick={() => { const empty = { search: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "", status: "" }; setFilters(empty); setAppliedFilters({ search: "", from: "", to: "", status: "" }); setFilterError(null); setCursor(null); setPreviousCursors([]); }}>پاک‌کردن فیلترها</button></div>
      </form>
      {pageError && <p className="form-error" role="alert">{pageError}</p>}
      {pageLoading ? <p className="manager-empty">در حال بارگذاری شمارش‌ها…</p> : <ul className="inventory-list">{counts.map((count) => <li key={count.id}><div><strong>شمارش فیزیکی · {count.status === "POSTED" ? "ثبت‌شده" : "پیش‌نویس"}</strong><small>{new Date(count.createdAt).toLocaleString("fa-IR-u-nu-latn")}</small><small>{count.lines.map((line) => { const item = items.find((entry) => entry.id === line.stockItemId); return `${item?.name ?? "کالا"}: ${line.observedQuantity}${line.differenceQuantity === null ? "" : ` (اختلاف ${line.differenceQuantity})`}`; }).join("، ")}</small>{count.reason && <small>دلیل اختلاف: {count.reason}</small>}</div>
        {count.status === "DRAFT" && <div className="inventory-count-actions">
          <button className="secondary-button" type="button" onClick={() => startEdit(count)}>ویرایش شمارش</button>
          {count.kind === "PHYSICAL" && pending.length > 0 && <fieldset><legend>سفارش‌هایی که هنوز از موجودی کم نشده‌اند</legend>{pending.map((entry) => <label key={entry.id}><input type="checkbox" checked={reconcile.includes(entry.id)} onChange={(event) => setReconcile((current) => event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} />سفارش {entry.orderNumber} · هزینه‌ی محاسبه‌شده {formatToman(entry.knownCogsAmount)}</label>)}</fieldset>}
          <button type="button" onClick={() => { const absorbedIds = count.kind === "PHYSICAL" ? reconcile.filter((id) => pending.some((entry) => entry.id === id)) : []; const absorbed = pending.filter((entry) => absorbedIds.includes(entry.id)); confirm({ title: "بررسی ثبت شمارش", detail: count.kind === "OPENING" ? "با ثبت موجودی آغازین، مقدار و ارزش این کالاها مبنای موجودی می‌شود." : "با ثبت شمارش فیزیکی، مقدار و ارزش ثبت‌شده با مقدار مشاهده‌شده جایگزین می‌شود.", summary: [...count.lines.map((line) => { const item = items.find((entry) => entry.id === line.stockItemId); return `${item?.name ?? "کالا"}: ${line.observedQuantity} ${unitLabels[(item?.baseUnit ?? "PIECE") as Unit]}، ارزش ${formatToman(line.observedValueAmount)}${line.differenceQuantity === null ? "" : `، اختلاف ${line.differenceQuantity}`}`; }), ...(count.kind === "PHYSICAL" ? [absorbed.length ? `سفارش‌های در انتظار کسر که در این شمارش لحاظ می‌شوند: ${absorbed.map((entry) => entry.orderNumber).join("، ")}` : "هیچ سفارش در انتظار کسر در این شمارش انتخاب نشده است."] : [])], actionLabel: "ثبت شمارش در موجودی", run: () => { const key = `count:post:${count.id}`; return mutateAndReload(async () => { const result = await postInventoryCount(count.id, { expectedVersion: count.version, absorbedOrderConsumptionIds: absorbedIds }, keyFor(key)); if (result.ok) { clearKey(key); setReconcile([]); } return result; }); } }); }}>ثبت شمارش</button>
        </div>}
      </li>)}{counts.length === 0 && <li>شمارشی با این فیلترها پیدا نشد.</li>}</ul>}
      <div className="inventory-actions inventory-history-pagination"><button className="secondary-button" type="button" disabled={pageLoading || previousCursors.length === 0} onClick={() => { const previous = previousCursors[previousCursors.length - 1] ?? null; setPreviousCursors((current) => current.slice(0, -1)); setCursor(previous); }}>صفحه‌ی قبل</button><span>صفحه‌ی {previousCursors.length + 1}</span><button className="secondary-button" type="button" disabled={pageLoading || !page.hasMore || !page.nextCursor} onClick={() => { if (!page.nextCursor) return; setPreviousCursors((current) => [...current, cursor]); setCursor(page.nextCursor); }}>صفحه‌ی بعد</button></div>
    </ManagerCard>
  </div>;
}

function HistoryPanel({ pending, items, refreshVersion }: { pending: PendingInventoryConsumption[]; items: InventoryStockItem[]; refreshVersion: number }) {
  const currentPersianDate = currentPersianDateInput();
  const [filters, setFilters] = useState({ searchBy: "PRODUCT" as "PRODUCT" | "ORDER_NUMBER" | "KIND", search: "", kind: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "" });
  const [applied, setApplied] = useState({ searchBy: "PRODUCT" as "PRODUCT" | "ORDER_NUMBER" | "KIND", search: "", kind: "", from: "", to: "" });
  const [filterError, setFilterError] = useState<string | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [page, setPage] = useState({ limit: 20, nextCursor: null as string | null, hasMore: false });
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    const query: Record<string, string> = { limit: String(page.limit) };
    if (cursor) query.cursor = cursor;
    if (applied.from) query.from = applied.from;
    if (applied.to) query.to = applied.to;
    if (applied.searchBy === "KIND" && applied.kind) { query.searchBy = "KIND"; query.kind = applied.kind; }
    else if (applied.search) { query.searchBy = applied.searchBy; query.search = applied.search; }
    void readInventoryMovements(query).then((result) => {
      if (!current) return;
      if (result.ok) { setMovements(result.data.data.movements); setPage(result.data.meta.page); }
      else setError(resultError(result));
      setLoading(false);
    });
    return () => { current = false; };
  }, [applied, cursor, page.limit, refreshVersion, retryVersion]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    const from = filters.fromValue ? persianDateToGregorianDate(filters.fromYear, filters.fromValue) : null;
    const to = filters.toValue ? persianDateToGregorianDate(filters.toYear, filters.toValue) : null;
    if ((filters.fromValue && !from) || (filters.toValue && !to)) { setFilterError("تاریخ شمسی را به شکل ماه/روز وارد کنید."); return; }
    if (from && to && from > to) { setFilterError("تاریخ شروع باید پیش از تاریخ پایان باشد."); return; }
    setFilterError(null);
    setCursor(null);
    setPreviousCursors([]);
    setApplied({ searchBy: filters.searchBy, search: filters.search.trim(), kind: filters.kind, from: from ? tehranDayBoundary(from) : "", to: to ? tehranDayBoundary(to, true) : "" });
  };
  const clearFilters = () => {
    const empty = { searchBy: "PRODUCT" as const, search: "", kind: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "" };
    setFilters(empty);
    setApplied({ searchBy: "PRODUCT", search: "", kind: "", from: "", to: "" });
    setFilterError(null);
    setCursor(null);
    setPreviousCursors([]);
  };

  return <div className="manager-grid">
    <ManagerCard title="گردش موجودی" hint="شماره‌ی سفارش در تغییرهای ناشی از سفارش نمایش داده می‌شود. جست‌وجو را بر اساس کالا، شماره‌ی سفارش یا نوع تغییر انتخاب کنید.">
      <form className="manager-form inventory-history-filter" onSubmit={applyFilters}>
        <div className="manager-fields">
          <label><span>جست‌وجو بر اساس</span><select value={filters.searchBy} onChange={(event) => setFilters((current) => ({ ...current, searchBy: event.target.value as typeof current.searchBy }))}><option value="PRODUCT">نام کالا</option><option value="ORDER_NUMBER">شماره‌ی سفارش</option><option value="KIND">نوع تغییر</option></select></label>
          {filters.searchBy === "KIND" ? <label><span>نوع تغییر</span><select value={filters.kind} onChange={(event) => setFilters((current) => ({ ...current, kind: event.target.value }))}><option value="">همه‌ی انواع تغییر</option>{Object.entries(movementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <label><span>{filters.searchBy === "ORDER_NUMBER" ? "شماره‌ی سفارش" : "نام کالا"}</span><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder={filters.searchBy === "ORDER_NUMBER" ? "مثلاً ۱۲۳۴" : "نام کالا"} /></label>}
          <label><span>از تاریخ شمسی</span><div className="inventory-date-input"><input inputMode="numeric" value={filters.fromValue} onChange={(event) => setFilters((current) => ({ ...current, fromValue: event.target.value }))} placeholder="ماه/روز" /><input inputMode="numeric" aria-label="سال شروع" value={filters.fromYear} onChange={(event) => setFilters((current) => ({ ...current, fromYear: event.target.value }))} /></div></label>
          <label><span>تا تاریخ شمسی</span><div className="inventory-date-input"><input inputMode="numeric" value={filters.toValue} onChange={(event) => setFilters((current) => ({ ...current, toValue: event.target.value }))} placeholder="ماه/روز" /><input inputMode="numeric" aria-label="سال پایان" value={filters.toYear} onChange={(event) => setFilters((current) => ({ ...current, toYear: event.target.value }))} /></div></label>
        </div>
        {filterError && <p className="form-error" role="alert">{filterError}</p>}
        <div className="inventory-actions"><button type="submit">اعمال فیلترها</button><button className="secondary-button" type="button" onClick={clearFilters}>پاک‌کردن فیلترها</button></div>
      </form>
      {error && <p className="form-error" role="alert">{error} <button type="button" disabled={loading} onClick={() => setRetryVersion((current) => current + 1)}>بارگذاری دوباره</button></p>}
      <p className="inventory-table-hint">برای دیدن همه‌ی ستون‌ها، جدول را به طرفین بکشید.</p><div className="inventory-table-wrap" role="region" aria-label="جدول گردش موجودی" tabIndex={0}><table className="inventory-table"><thead><tr><th scope="col">زمان تغییر</th><th scope="col">کالا</th><th scope="col">شماره‌ی سفارش</th><th scope="col">نوع تغییر</th><th scope="col">مقدار</th><th scope="col">تغییر ارزش موجودی</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{new Date(movement.occurredAt).toLocaleString("fa-IR-u-nu-latn")}</td><td>{items.find((item) => item.id === movement.stockItemId)?.name ?? "قلم بایگانی‌شده"}</td><td>{movement.orderNumber ? `#${movement.orderNumber}` : "—"}</td><td>{movementLabels[movement.kind] ?? movement.kind}</td><td>{movement.quantityDelta}</td><td>{movement.valueDeltaAmount < 0 ? `−${formatToman(-movement.valueDeltaAmount)}` : formatToman(movement.valueDeltaAmount)}</td></tr>)}{!loading && movements.length === 0 && <tr><td colSpan={6}>تغییری با این فیلترها پیدا نشد.</td></tr>}{loading && <tr><td colSpan={6}>در حال بارگذاری گردش موجودی…</td></tr>}</tbody></table></div>
      <div className="inventory-actions inventory-history-pagination"><button className="secondary-button" type="button" disabled={loading || previousCursors.length === 0} onClick={() => { const previous = previousCursors[previousCursors.length - 1] ?? null; setPreviousCursors((current) => current.slice(0, -1)); setCursor(previous); }}>صفحه‌ی قبل</button><span>صفحه‌ی {previousCursors.length + 1}</span><button className="secondary-button" type="button" disabled={loading || !page.hasMore || !page.nextCursor} onClick={() => { if (!page.nextCursor) return; setPreviousCursors((current) => [...current, cursor]); setCursor(page.nextCursor); }}>صفحه‌ی بعد</button></div>
    </ManagerCard>
    <ManagerCard title="سفارش‌های در انتظار کسر از موجودی" hint="هزینه‌ی سفارش تسویه‌شده فقط وقتی از موجودی کم می‌شود که همه‌ی مواد لازم موجود باشند.">
      <ul className="inventory-list">{pending.map((entry) => <li key={entry.id}><div><strong>سفارش #{entry.orderNumber}</strong><small>ثبت در {new Date(entry.recognizedAt).toLocaleString("fa-IR-u-nu-latn")} · هزینه‌ی محاسبه‌شده {formatToman(entry.knownCogsAmount)}</small><small>{entry.isCostComplete ? "هزینه‌ی مواد کامل محاسبه شده است" : "هزینه‌ی مواد به‌طور کامل محاسبه نشده است"} · اقلام ناموجود: {entry.missingStockItemIds.length}</small></div></li>)}{pending.length === 0 && <li>سفارشی در انتظار کسر از موجودی نیست.</li>}</ul>
    </ManagerCard>
  </div>;
}

function ManagerCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <section className="manager-card"><header><h2>{title}</h2><p>{hint}</p></header>{children}</section>;
}
