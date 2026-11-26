"use client";
import { InventoryPreparations } from "./inventory-preparations";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { currentPersianDateInput, normalizeDigits, persianDateToGregorianDate } from "../lib/tehran-date";
import { formatToman } from "../lib/pos-utils";
import { inventoryErrorMessage } from "../lib/inventory-errors";
import { InventoryNumberInput, InventorySearchPicker, inventorySearchMatches } from "./inventory-fields";
import { InventoryStockDetail } from "./inventory-stock-detail";
import { InventoryEmptyState, InventoryOnboarding, type InventoryManagementView } from "./inventory-onboarding";
import { InventoryIcon, RefreshIcon } from "./icons";
import { InventoryProfitPanel } from "./inventory-profit";
import { InventorySalesChannelsPanel } from "./inventory-sales-channels";
import { InventorySalesAnalytics } from "./inventory-sales-analytics";
import { InventoryPricingExperiments } from "./inventory-pricing-experiments";
import { InventoryOverview, InventoryStockAlerts } from "./inventory-dashboard";
import { emptyInventoryItem, lowInventoryItem, inventoryAmountTotal, inventoryNumber, inventoryQuantity, inventoryUnitLabels as unitLabels, inventoryMovementLabels as movementLabels } from "./inventory-presentation";

type View = "overview" | "profit" | "sales" | "analytics" | "pricing-experiments" | "stock" | "purchases" | "preparations" | "recipes" | "counts" | "history";
type Unit = "GRAM" | "MILLILITER" | "PIECE";
type StockConversion = { id?: string; label: string; baseQuantityPerPack: string; isActive: boolean };
type PurchaseLineDraft = { id?: string; stockItemId: string; conversionId: string; purchaseUnitLabel: string; purchaseQuantity: string; directCostAmount: string; snapshotConversionId?: string; snapshotPurchaseUnitLabel?: string; useCurrentConversion?: boolean | undefined };
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
const INVENTORY_SCALE = BigInt(1_000_000);
const MAX_STOCK_QUANTITY_MICROS = BigInt("100000000000000") * INVENTORY_SCALE;
function inventoryMicros(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (whole!.length > 14) return null;
  const micros = BigInt(whole!) * INVENTORY_SCALE + BigInt(fraction.padEnd(6, "0") || "0");
  return micros < MAX_STOCK_QUANTITY_MICROS ? micros : null;
}
function inventoryFromMicros(value: bigint) {
  const whole = value / INVENTORY_SCALE;
  const fraction = (value % INVENTORY_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function inventoryRatioMicros(numerator: bigint, denominator: bigint) {
  return denominator > BigInt(0) ? (numerator + denominator / BigInt(2)) / denominator : null;
}
function stockQuantityFromPackage(size: string, factor: string) {
  const sizeMicros = inventoryMicros(size);
  const factorMicros = inventoryMicros(factor);
  if (sizeMicros === null || factorMicros === null || factorMicros <= BigInt(0)) return null;
  const scaled = sizeMicros * factorMicros;
  if (scaled % INVENTORY_SCALE !== BigInt(0)) return null;
  const quantity = scaled / INVENTORY_SCALE;
  return quantity < MAX_STOCK_QUANTITY_MICROS ? quantity : null;
}

const managerInventoryViews = new Set<View>(["purchases", "stock", "recipes", "preparations", "counts", "history"]);
const analysisInventoryViews = new Set<View>(["overview", "sales", "analytics", "profit", "pricing-experiments"]);
const inventoryViewLabels = [
  ["purchases", "خریدها"], ["overview", "نمای کلی"], ["stock", "اقلام موجودی"], ["recipes", "دستور تهیه و هزینه"],
  ["preparations", "دستورهای مشترک"], ["counts", "شمارش انبار"], ["history", "گردش موجودی"], ["sales", "فروش کانال‌ها"], ["analytics", "اوج و مشارکت"], ["profit", "سود ناخالص"], ["pricing-experiments", "آزمایش قیمت‌گذاری"],
] as const;

export function InventoryWorkspace({ catalog, turnoverEnabled = false, role = "MANAGER" }: { catalog: ManagerCatalog; turnoverEnabled?: boolean; role?: "MANAGER" | "CASHIER" | "STAFF" | "DEVELOPER" }) {
  const [view, setView] = useRecoveryState<View>("inventory-view", role === "DEVELOPER" ? "sales" : "purchases");
  const activeView = role !== "DEVELOPER" && analysisInventoryViews.has(view) ? "purchases" : view;
  const [stockSelection, setStockSelection] = useState<string | null>(null);
  const [costingProductSelection, setCostingProductSelection] = useState<string | undefined>(undefined);
  const [stockItems, setStockItems] = useState<InventoryStockItem[]>([]);
  const [recipes, setRecipes] = useState<InventoryRecipe[]>([]);
  const [pending, setPending] = useState<PendingInventoryConsumption[]>([]);
  const [pendingHasMore, setPendingHasMore] = useState(false);
  const [inventoryRefreshVersion, setInventoryRefreshVersion] = useState(0);
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
  const latestReload = useRef(0);
  const reload = useCallback(async () => {
    const requestId = ++latestReload.current;
    if (!loadedOnce.current) setLoading(true);
    const results = await Promise.all([
      readInventoryStockItems(),
      readInventoryRecipes(),
      readPendingInventoryConsumption(),
    ]);
    if (requestId !== latestReload.current) return;
    if (results[0]!.ok) setStockItems(results[0]!.data.data.stockItems);
    if (results[1]!.ok) setRecipes(results[1]!.data.data.recipes);
    if (results[2]!.ok) { setPending(results[2]!.data.data.consumptions); setPendingHasMore(results[2]!.data.meta?.page?.hasMore ?? false); }
    setInventoryRefreshVersion((current) => current + 1);
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
      {!turnoverEnabled && <details className="inventory-turnover-note"><summary>محاسبه‌ی هزینه پیش از فعال‌سازی گردش موجودی</summary><p>ثبت خرید و دستور تهیه در دسترس است{role === "DEVELOPER" ? "؛ گزارش سود ناخالص نیز قابل مشاهده است" : ""}. مواد سفارش‌ها تا فعال‌سازی گردش موجودی از انبار کسر نمی‌شود.</p></details>}
      <nav className="inventory-tabs manager-tabs" aria-label={role === "DEVELOPER" ? "گروه‌ها و بخش‌های انبار" : "بخش‌های انبار"}>
        {role === "DEVELOPER" && <div className="inventory-tab-groups" aria-label="گروه‌های انبار">
          <button type="button" disabled={busy || !!confirm} aria-pressed={!analysisInventoryViews.has(activeView)} onClick={() => navigate("purchases")}>مدیریت انبار</button>
          <button type="button" disabled={busy || !!confirm} aria-pressed={analysisInventoryViews.has(activeView)} onClick={() => navigate("overview")}>تحلیل و گزارش</button>
        </div>}
        {inventoryViewLabels.filter(([id]) => (analysisInventoryViews.has(activeView) ? analysisInventoryViews.has(id) : managerInventoryViews.has(id)) && (role === "DEVELOPER" || managerInventoryViews.has(id))).map(([id, label]) => <button key={id} id={`inventory-view-${id}`} type="button" disabled={busy || !!confirm} className={activeView === id ? "is-active" : ""} aria-pressed={activeView === id} aria-controls="inventory-active-panel" onClick={() => navigate(id)}>{label}</button>)}
      </nav>
      {success && <p className="inventory-success" role="status">تغییرات ثبت شد.</p>}
      {error && !confirm && <p className="form-error" role="alert">{error}</p>}
      {readErrors[activeView] && !error && !confirm && <p className="form-error" role="alert">{readErrors[activeView]} <button type="button" disabled={loading || busy} onClick={() => void reload()}>بارگذاری دوباره</button></p>}
      {loading ? <div className="inventory-loading" role="status"><span>در حال دریافت اطلاعات موجودی…</span><div aria-hidden="true" /></div> : <div id="inventory-active-panel" role="region" aria-labelledby={`inventory-view-${activeView}`}>
        {managerInventoryViews.has(activeView) && <InventoryOnboarding key={activeView} view={activeView as InventoryManagementView} onNavigate={navigate} />}
        {activeView === "overview" && !readErrors.overview && <InventoryOverview items={stockItems} pending={pending} pendingHasMore={pendingHasMore} onNavigate={navigate} onOpenStock={id => { setStockSelection(id || null); navigate("stock"); }} />}
        {activeView === "profit" && <InventoryProfitPanel catalog={catalog} onInspectProduct={(productId) => { setCostingProductSelection(productId); navigate("recipes"); }} />}
        {activeView === "sales" && <InventorySalesChannelsPanel />}
        {activeView === "analytics" && <InventorySalesAnalytics catalog={catalog} />}
        {activeView === "pricing-experiments" && <InventoryPricingExperiments catalog={catalog} onDirtyChange={markDirty} />}
        {activeView === "stock" && !readErrors.stock && <StockPanel initialSelectedId={stockSelection} onDirtyChange={markDirty} items={stockItems} pending={pending} pendingHasMore={pendingHasMore} onNavigate={navigate} mutate={mutate} confirm={openConfirm} />}
        {activeView === "purchases" && !readErrors.purchases && <PurchasePanel refreshVersion={inventoryRefreshVersion} onNavigate={navigate} onDirtyChange={markDirty} items={stockItems} mutate={mutate} confirm={openConfirm} keyFor={idempotencyKey} clearKey={clearIdempotencyKey} />}
        {activeView === "preparations" && !readErrors.preparations && <InventoryPreparations onOpenStock={() => navigate("stock")} items={stockItems} recipes={recipes} mutate={mutate} onDirtyChange={markDirty} />}
        {activeView === "recipes" && !readErrors.recipes && <ProductOptionRecipePanel canViewCosts={role !== "CASHIER"} onOpenStock={() => navigate("stock")} {...(costingProductSelection ? { initialProductId: costingProductSelection } : {})} onDirtyChange={markDirty} catalog={catalog} items={stockItems} recipes={recipes} mutate={mutate} />}
        {activeView === "counts" && !readErrors.counts && <CountPanel refreshVersion={inventoryRefreshVersion} onOpenStock={() => navigate("stock")} onDirtyChange={markDirty} items={stockItems} pending={pending} mutate={mutate} confirm={openConfirm} keyFor={idempotencyKey} clearKey={clearIdempotencyKey} />}
        {activeView === "history" && !readErrors.history && <HistoryPanel pending={pending} items={stockItems} refreshVersion={inventoryRefreshVersion} />}
      </div>}
      {confirm && <div className="manager-dialog-backdrop" role="presentation"><section className="manager-dialog" role="alertdialog" aria-modal="true" aria-labelledby="inventory-confirm-title" aria-describedby="inventory-confirm-detail" onKeyDown={handleConfirmKeyDown}><h2 id="inventory-confirm-title">{confirm.title}</h2><p id="inventory-confirm-detail">{confirm.detail}</p>{confirm.summary && <ul className="inventory-confirm-summary">{confirm.summary.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul>}{error && <p className="form-error" role="alert">{error}</p>}<div className="inventory-actions"><button className={confirm.danger ? "danger-button" : undefined} type="button" disabled={busy} onClick={() => { void confirm.run().then((ok) => { if (ok) closeConfirm(); }); }}>{confirm.actionLabel}</button><button ref={confirmCancelRef} className="secondary-button" type="button" disabled={busy} onClick={closeConfirm}>بازگشت</button></div></section></div>}
    </section>
  );
}

function StockPanel({ initialSelectedId, onDirtyChange, items, pending, pendingHasMore, onNavigate, mutate, confirm }: { initialSelectedId: string | null; items: InventoryStockItem[]; pending: PendingInventoryConsumption[]; pendingHasMore: boolean; onNavigate: (view: InventoryManagementView) => void; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; confirm: (value: InventoryConfirm) => void } & DraftGuardProps) {
  const [dirty, setDirty] = useInventoryDraftGuard(onDirtyChange);
  const activeItems = items.filter((item) => item.isActive && !item.archivedAt);
  const [search, setSearch] = useState("");
  const [stockStatus, setStockStatus] = useState("");
  const [unit, setUnit] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const selected = activeItems.find(item => item.id === selectedId);
  const [threshold, setThreshold] = useState("");
  const [isPackagingMaterial, setIsPackagingMaterial] = useState(false);
  const shownItems = activeItems.filter((item) => inventorySearchMatches(item.name, search) && (!unit || item.baseUnit === unit) && (!stockStatus || (stockStatus === "low" ? lowInventoryItem(item) : stockStatus === "empty" ? emptyInventoryItem(item) : stockStatus === "untracked" ? !item.balance.trackingStartedAt : !!item.balance.trackingStartedAt && !emptyInventoryItem(item))));
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<InventoryStockItem | null>(null);
  const [name, setName] = useState("");
  const [baseUnit, setBaseUnit] = useState<Unit>("GRAM");
  const [conversions, setConversions] = useState<StockConversion[]>([{ label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }]);
  const [packageUnit, setPackageUnit] = useState("کیلوگرم");
  const [packageQuantity, setPackageQuantity] = useState("");
  const [packagePrice, setPackagePrice] = useState("");
  const [openingMethod, setOpeningMethod] = useState<"PACKAGE_COUNT" | "TOTAL_QUANTITY">("PACKAGE_COUNT");
  const [openingPackages, setOpeningPackages] = useState("0");
  const [openingLoose, setOpeningLoose] = useState("0");
  const [openingTotal, setOpeningTotal] = useState("0");
  const [localError, setLocalError] = useState<string | null>(null);
  const reset = () => { setDirty(false); setSelectedId(null); setThreshold(""); setIsPackagingMaterial(false); setEditing(null); setName(""); setBaseUnit("GRAM"); setConversions([{ label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }]); setPackageUnit("کیلوگرم"); setPackageQuantity(""); setPackagePrice(""); setOpeningMethod("PACKAGE_COUNT"); setOpeningPackages("0"); setOpeningLoose("0"); setOpeningTotal("0"); setLocalError(null); };
  const startEdit = (item: InventoryStockItem) => {
    if (dirty && !window.confirm("تغییرات کالا ذخیره نشده است. ویرایش کالای دیگری را شروع می‌کنید؟")) return;
    const itemConversions = item.conversions.map((conversion) => ({ id: conversion.id, label: conversion.label, baseQuantityPerPack: conversion.baseQuantityPerPack, isActive: conversion.isActive }));
    setDirty(false); requestAnimationFrame(() => { nameInputRef.current?.focus(); nameInputRef.current?.scrollIntoView?.({ block: "center", behavior: "auto" }); });
    setSelectedId(null); setThreshold(item.lowStockThreshold ?? ""); setIsPackagingMaterial(item.isPackagingMaterial); setEditing(item); setName(item.name); setBaseUnit(item.baseUnit); setConversions(itemConversions);
    setPackageUnit(item.referencePurchase?.conversionLabel ?? (itemConversions.find((conversion) => conversion.isActive && conversion.label !== item.baseUnit)?.label ?? item.baseUnit));
    setPackageQuantity(item.referencePurchase?.packageQuantity ?? ""); setPackagePrice(item.referencePurchase ? String(item.referencePurchase.priceAmount) : "");
    setOpeningMethod(item.balance.trackingStartedAt ? "TOTAL_QUANTITY" : "PACKAGE_COUNT"); setOpeningTotal(item.balance.quantityOnHand ?? "0"); setOpeningPackages("0"); setOpeningLoose("0"); setLocalError(null);
  };
  const packageFactor = packageUnit === baseUnit ? "1" : conversions.find((conversion) => conversion.label === packageUnit)?.baseQuantityPerPack;
  const packageBaseMicros = packageFactor ? stockQuantityFromPackage(packageQuantity, packageFactor) : null;
  const normalizedPackagePrice = packagePrice.replace(/^0+(?=\d)/, "");
  const packagePriceNumber = /^\d+$/.test(normalizedPackagePrice) && normalizedPackagePrice.length <= 10 && Number(normalizedPackagePrice) <= 2_147_483_647
    ? Number(normalizedPackagePrice)
    : null;
  const packageOptions = [{ value: baseUnit, label: unitLabels[baseUnit] }, ...conversions.map((conversion) => ({ value: conversion.label, label: `${conversion.label}${conversion.isActive ? "" : " · غیرفعال"}` }))]
    .filter((option, index, all) => all.findIndex((candidate) => candidate.value === option.value) === index);
  const openingQuantityMicros = openingMethod === "PACKAGE_COUNT"
    ? (() => { const count = /^\d+$/.test(openingPackages) ? BigInt(openingPackages) : null; const loose = inventoryMicros(openingLoose); if (count === null || count > BigInt(Number.MAX_SAFE_INTEGER) || loose === null) return null; if (packageBaseMicros === null) return count === BigInt(0) ? loose : null; const total = count * packageBaseMicros + loose; return total < MAX_STOCK_QUANTITY_MICROS ? total : null; })()
    : inventoryMicros(openingTotal);
  const openingValueAmount = openingQuantityMicros !== null && packageBaseMicros !== null && packageBaseMicros > BigInt(0) && packagePriceNumber !== null
    ? (() => { const amount = (openingQuantityMicros * BigInt(packagePriceNumber) + packageBaseMicros / BigInt(2)) / packageBaseMicros; return amount <= BigInt(2_147_483_647) ? Number(amount) : null; })()
    : null;
  const packageUnitCostMicros = packageBaseMicros !== null && packageBaseMicros > BigInt(0) && packagePriceNumber !== null
    ? inventoryRatioMicros(BigInt(packagePriceNumber) * INVENTORY_SCALE * INVENTORY_SCALE, packageBaseMicros)
    : null;
  const switchOpeningMethod = (nextMethod: "PACKAGE_COUNT" | "TOTAL_QUANTITY") => {
    if (nextMethod === openingMethod) return;
    if (nextMethod === "TOTAL_QUANTITY") {
      if (openingQuantityMicros !== null) setOpeningTotal(inventoryFromMicros(openingQuantityMicros));
    } else {
      const total = inventoryMicros(openingTotal);
      if (total !== null && packageBaseMicros !== null && packageBaseMicros > BigInt(0)) {
        const packageCount = total / packageBaseMicros;
        if (packageCount <= BigInt(Number.MAX_SAFE_INTEGER)) {
          setOpeningPackages(packageCount.toString());
          setOpeningLoose(inventoryFromMicros(total % packageBaseMicros));
        } else {
          setOpeningPackages("0");
          setOpeningLoose(inventoryFromMicros(total));
        }
      } else if (total !== null) {
        setOpeningPackages("0"); setOpeningLoose(inventoryFromMicros(total));
      }
    }
    setOpeningMethod(nextMethod);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const packs = conversions.filter((entry) => entry.label.trim() || entry.baseQuantityPerPack.trim());
    if (packs.some((entry) => !entry.label.trim() || !/^\d+(?:\.\d{1,6})?$/.test(entry.baseQuantityPerPack))) { setLocalError("نام بسته‌بندی و مقدار تبدیل را وارد کنید."); return; }
    if (packs.some((entry) => entry.label.trim() === baseUnit
      && !editing?.conversions.some((saved) => saved.id === entry.id && saved.label === baseUnit))) {
      setLocalError("نام واحد تبدیل نباید با واحد مبنای کالا یکسان باشد."); return;
    }
    if (threshold.trim() && (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(threshold) || threshold.split(".")[0]!.length > 14)) { setLocalError("حد هشدار باید عدد نامنفی با حداکثر شش رقم اعشار باشد."); return; }
    const purchasePrice = packagePriceNumber;
    const purchaseQuantity = inventoryMicros(packageQuantity);
    const unitIsValid = packageUnit === baseUnit || conversions.some((conversion) => conversion.label === packageUnit && conversion.isActive);
    const shouldSaveReferencePurchase = !!packageQuantity.trim() || !!packagePrice.trim() || !!editing?.referencePurchase || !editing;
    if (shouldSaveReferencePurchase && (!unitIsValid || purchaseQuantity === null || purchaseQuantity <= BigInt(0) || purchasePrice === null || !Number.isSafeInteger(purchasePrice) || purchasePrice > 2_147_483_647 || packageBaseMicros === null)) { setLocalError("اندازه، واحد و قیمت بسته‌ی خرید را کامل و معتبر وارد کنید."); return; }
    if ((!editing || !editing.balance.trackingStartedAt) && openingQuantityMicros === null) { setLocalError("موجودی اولیه را با مقدار معتبر و حداکثر شش رقم اعشار وارد کنید."); return; }
    if ((!editing || !editing.balance.trackingStartedAt) && openingQuantityMicros !== null && openingQuantityMicros > BigInt(0) && openingValueAmount === null) { setLocalError("برای ارزش‌گذاری موجودی، قیمت بسته‌ی خرید را کامل کنید."); return; }
    if (openingMethod === "PACKAGE_COUNT" && (!/^\d+$/.test(openingPackages) || !Number.isSafeInteger(Number(openingPackages)))) { setLocalError("تعداد بسته‌های کامل باید یک عدد صحیح معتبر باشد."); return; }
    const referencePurchase = shouldSaveReferencePurchase
      ? { conversionLabel: packageUnit, packageQuantity, priceAmount: purchasePrice! }
      : undefined;
    const openingStock = openingMethod === "PACKAGE_COUNT"
      ? { method: "PACKAGE_COUNT" as const, packageCount: Number(openingPackages), looseQuantity: openingLoose }
      : { method: "TOTAL_QUANTITY" as const, totalQuantity: openingTotal };
    const body = { lowStockThreshold: threshold.trim() || null, isPackagingMaterial, name: name.trim(), category: editing?.category ?? "مواد اولیه", baseUnit, ...(referencePurchase === undefined ? {} : { referencePurchase }), ...(!editing || !editing.balance.trackingStartedAt ? { openingStock } : {}), conversions: packs.map((entry) => ({ ...(entry.id ? { id: entry.id } : {}), label: entry.label.trim(), baseQuantityPerPack: entry.baseQuantityPerPack, isActive: entry.isActive })) };
    const ok = await mutate(() => saveInventoryStockItem(editing?.id ?? null, { ...body, ...(editing ? { expectedVersion: editing.version } : {}) }));
    if (ok) reset();
  };
  return <div className="manager-grid inventory-stock-layout">
    {selected ? <InventoryStockDetail item={selected} onEdit={() => startEdit(selected)} /> : <ManagerCard title={editing ? "ویرایش کالای انبار" : "افزودن کالای انبار"} hint="مشخصات کالا، بسته‌ی خرید و موجودی اولیه را به‌ترتیب وارد کنید.">
      <form className="manager-form" onChangeCapture={() => setDirty(true)} onSubmit={(event) => void submit(event)}>
        <fieldset><legend>مشخصات کالا</legend>
          <div className="manager-fields inventory-stock-fields">
            <label><span>نام کالا</span><input ref={nameInputRef} required value={name} onChange={(event) => setName(event.target.value)} placeholder="مثلاً پودر هات چاکلت" /></label>
            <label><span>واحد مبنا</span><select aria-label="واحد مبنا" value={baseUnit} onChange={(event) => { const previousUnit = baseUnit; const nextUnit = event.target.value as Unit; setBaseUnit(nextUnit); if (packageUnit === previousUnit) setPackageUnit(nextUnit); if (!editing) { const defaults = nextUnit === "GRAM" ? [{ label: "کیلوگرم", baseQuantityPerPack: "1000", isActive: true }] : nextUnit === "MILLILITER" ? [{ label: "لیتر", baseQuantityPerPack: "1000", isActive: true }] : []; setConversions(defaults); setPackageUnit(defaults[0]?.label ?? nextUnit); setPackageQuantity(""); setPackagePrice(""); } }}>{Object.entries(unitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>این واحد برای دستورهای تهیه، شمارش و کسر موجودی استفاده می‌شود.</small></label>
          </div>
        </fieldset>
        <fieldset><legend>اطلاعات بسته خرید</legend>
          <div className="manager-fields inventory-stock-fields">
            <label><span>مقدار هر بسته</span><InventoryNumberInput required={!editing || !!editing.referencePurchase} value={packageQuantity} onValueChange={setPackageQuantity} placeholder="مثلاً ۲" /></label>
            <label><span>واحد بسته</span><select aria-label="واحد بسته" value={packageUnit} onChange={(event) => setPackageUnit(event.target.value)}><option value="">انتخاب کنید</option>{packageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>قیمت هر بسته (تومان)</span><InventoryNumberInput required={!editing || !!editing.referencePurchase} integer value={packagePrice} onValueChange={setPackagePrice} placeholder="مثلاً ۴۰۰٬۰۰۰" /></label>
          </div>
          <div className="inventory-summary" aria-live="polite">
            <div><span>اندازه‌ی بسته به {unitLabels[baseUnit]}</span><bdi>{packageBaseMicros === null ? "—" : inventoryQuantity(inventoryFromMicros(packageBaseMicros))}</bdi></div>
            <div><span>هزینه‌ی هر {unitLabels[baseUnit]}</span><bdi>{packageUnitCostMicros === null ? "—" : inventoryQuantity(inventoryFromMicros(packageUnitCostMicros))} تومان</bdi></div>
          </div>
          <details className="inventory-conversion-editor"><summary>تنظیم واحدهای خرید و تبدیل</summary>
          {conversions.map((conversion, index) => <div className="inventory-entry-row" key={conversion.id ?? index}>
            <label><span>نام واحد خرید</span><input value={conversion.label} onChange={(event) => { const label = event.target.value; setConversions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, label } : row)); if (packageUnit === conversion.label) setPackageUnit(label === baseUnit ? "" : label); }} placeholder="مثلاً کیلوگرم" /></label>
            <label><span>معادل یک واحد به {unitLabels[baseUnit]}</span><InventoryNumberInput value={conversion.baseQuantityPerPack} onValueChange={(value) => setConversions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, baseQuantityPerPack: value } : row))} placeholder="1000" /></label>
            <label><span>وضعیت</span><select value={conversion.isActive ? "active" : "inactive"} onChange={(event) => setConversions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, isActive: event.target.value === "active" } : row))}><option value="active">فعال</option><option value="inactive">غیرفعال</option></select></label>
            <button className="text-button" type="button" onClick={() => { setDirty(true); if (packageUnit === conversion.label) setPackageUnit(""); setConversions((current) => current.filter((_, rowIndex) => rowIndex !== index)); }}>حذف واحد</button>
          </div>)}
          <button className="secondary-button" type="button" onClick={() => { setDirty(true); setConversions((current) => [...current, { label: "", baseQuantityPerPack: "", isActive: true }]); }}>افزودن واحد خرید</button>
          </details>
        </fieldset>
        <fieldset><legend>موجودی اولیه</legend>
          {!editing || !editing.balance.trackingStartedAt ? <>
            <label><span>روش ثبت موجودی</span><select aria-label="روش ثبت موجودی" value={openingMethod} onChange={(event) => switchOpeningMethod(event.target.value as "PACKAGE_COUNT" | "TOTAL_QUANTITY")}><option value="PACKAGE_COUNT">تعداد بسته و مقدار باز</option><option value="TOTAL_QUANTITY">مقدار کل مستقیم</option></select><small>تعویض روش، مقدار کل واردشده را حفظ می‌کند.</small></label>
            {openingMethod === "PACKAGE_COUNT" ? <div className="manager-fields inventory-stock-fields">
              <label><span>تعداد بسته‌های کامل</span><InventoryNumberInput required integer value={openingPackages} onValueChange={setOpeningPackages} /></label>
              <label><span>مقدار باز ({unitLabels[baseUnit]})</span><InventoryNumberInput required value={openingLoose} onValueChange={setOpeningLoose} /></label>
            </div> : <label><span>مقدار کل ({unitLabels[baseUnit]})</span><InventoryNumberInput required value={openingTotal} onValueChange={setOpeningTotal} /></label>}
            <div className="inventory-summary" aria-live="polite">
              <div><span>موجودی کل ({unitLabels[baseUnit]})</span><bdi>{openingQuantityMicros === null ? "—" : inventoryQuantity(inventoryFromMicros(openingQuantityMicros))}</bdi></div>
              <div><span>ارزش موجودی برآوردی</span><bdi>{openingValueAmount === null ? "—" : `${inventoryNumber(formatToman(openingValueAmount))} تومان`}</bdi></div>
            </div>
          </> : <p className="inventory-inline-note">موجودی ثبت‌شده و گردش‌های قبلی حفظ می‌شوند. تغییر بسته‌ی مرجع روی موجودی یا خریدهای ثبت‌شده اثر ندارد.</p>}
        </fieldset>
        <label><span><input type="checkbox" checked={isPackagingMaterial} onChange={(event) => setIsPackagingMaterial(event.target.checked)} /> این کالا بسته‌بندی است</span><small>هزینه‌ی این کالا در دستورهای تهیه، برای گزارش هزینه‌ی بسته‌بندی جداگانه ثبت می‌شود. این تغییر روی سفارش‌های گذشته اثر ندارد.</small></label>
        <label><span>حد هشدار موجودی ({unitLabels[baseUnit]}) · اختیاری</span><InventoryNumberInput aria-label={`حد هشدار موجودی (${unitLabels[baseUnit]}) · اختیاری`} aria-describedby="stock-threshold-hint" value={threshold} onValueChange={value => setThreshold(value)} placeholder="بدون هشدار" /><small id="stock-threshold-hint">خالی بگذارید تا هشدار کمبود غیرفعال باشد؛ موجودی برابر یا کمتر از این عدد هشدار می‌گیرد.</small></label>
        {localError && <p className="form-error" role="alert">{localError}</p>}
        <div className="inventory-actions"><button type="submit">{editing ? "ذخیره تغییرات" : "ثبت کالا"}</button>{editing && <button className="secondary-button" type="button" onClick={reset}>انصراف از ویرایش</button>}</div>
      </form>
    </ManagerCard>}
    <ManagerCard title="اقلام موجودی" hint="موجودی آغازین در زمان ثبت کالا مشخص می‌شود؛ رسیدهای خرید و شمارش‌های فیزیکی آن را به‌روز می‌کنند.">
      <InventoryStockAlerts items={items} pending={pending} pendingHasMore={pendingHasMore} onNavigate={onNavigate} />
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
      </tr>)}</tbody></table></div>
      {shownItems.length === 0 && <InventoryEmptyState title={activeItems.length === 0 ? "هنوز کالای فعالی ثبت نشده است." : "کالایی با این فیلترها پیدا نشد."} detail={activeItems.length === 0 ? "اولین ماده‌ی اولیه یا بسته‌بندی را با واحد مبنا و موجودی آغازین ثبت کنید؛ سپس می‌توانید برای آن خرید و دستور تهیه تعریف کنید." : "نام کالا، واحد یا وضعیت موجودی را تغییر دهید تا اقلام دیگر را ببینید."} action={activeItems.length === 0 ? "تعریف اولین کالای انبار" : "نمایش همه‌ی کالاها"} onAction={() => { if (activeItems.length === 0) nameInputRef.current?.focus(); else { setSearch(""); setUnit(""); setStockStatus(""); } }} />}
    </ManagerCard>
  </div>;
}

function PurchasePanel({ refreshVersion, onNavigate, onDirtyChange, items, mutate, confirm, keyFor, clearKey }: { refreshVersion: number; onNavigate: (view: InventoryManagementView) => void; items: InventoryStockItem[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; confirm: (value: InventoryConfirm) => void; keyFor: (name: string) => string; clearKey: (name: string) => void } & DraftGuardProps) {
  const [returnDirty, setReturnDirty] = useState(false);
  const [dirty, setDirty] = useInventoryDraftGuard(onDirtyChange, returnDirty);
  const activeItems = items.filter((item) => item.isActive && !item.archivedAt);
  const [purchases, setPurchases] = useState<InventoryPurchase[]>([]);
  const [page, setPage] = useState({ limit: 20, nextCursor: null as string | null, hasMore: false });
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const currentPersianDate = currentPersianDateInput();
  const [filters, setFilters] = useState({ search: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "", status: "" });
  const [appliedFilters, setAppliedFilters] = useState({ search: "", from: "", to: "", status: "" });
  const [filterError, setFilterError] = useState<string | null>(null);
  const purchaseLineFor = (item?: InventoryStockItem): PurchaseLineDraft => ({
    stockItemId: item?.id ?? "",
    conversionId: item?.referencePurchase?.conversionId ?? "",
    purchaseUnitLabel: item?.referencePurchase?.conversionLabel ?? item?.baseUnit ?? "",
    purchaseQuantity: item?.referencePurchase?.packageQuantity ?? "1",
    directCostAmount: item?.referencePurchase ? String(item.referencePurchase.priceAmount) : "0",
    useCurrentConversion: true,
  });
  const emptyLine = (): PurchaseLineDraft => purchaseLineFor(activeItems.length === 1 ? activeItems[0] : undefined);
  const purchaseFormRef = useRef<HTMLFormElement>(null);
  const hasFilters = !!(appliedFilters.search || appliedFilters.from || appliedFilters.to || appliedFilters.status || cursor);
  const clearFilters = () => { setFilters({ search: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "", status: "" }); setAppliedFilters({ search: "", from: "", to: "", status: "" }); setFilterError(null); setCursor(null); setPreviousCursors([]); };
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
  }, [appliedFilters, cursor, page.limit, refreshVersion, retryVersion]);
  const mutateAndReload = async (action: () => Promise<ApiResult<unknown>>) => {
    const ok = await mutate(action);
    if (ok) { setCursor(null); setPreviousCursors([]); }
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
    const purchaseInput = { receivedAt: received.toISOString(), supplier: supplier.trim() || null, lines: lines.map((line) => ({ ...(line.id ? { id: line.id } : {}), stockItemId: line.stockItemId, conversionId: line.conversionId.startsWith("snapshot:") ? line.conversionId.slice("snapshot:".length) : line.conversionId || null, purchaseUnitLabel: line.purchaseUnitLabel, purchaseQuantity: line.purchaseQuantity, directCostAmount: Number(line.directCostAmount), ...(line.useCurrentConversion ? { useCurrentConversion: true } : {}) })) };
    const result = await mutateAndReload(() => editingPurchase ? updateInventoryPurchase(editingPurchase.id, { ...purchaseInput, expectedVersion: editingPurchase.version }) : createInventoryPurchase(purchaseInput));
    if (result) resetPurchase();
  };
  const startEditPurchase = (purchase: InventoryPurchase) => {
    if (dirty && !window.confirm("تغییرات خرید ذخیره نشده است. پیش‌نویس دیگری را باز می‌کنید؟")) return; setDirty(false);
    setLocalError(null);
    requestAnimationFrame(() => purchaseFormRef.current?.querySelector("input")?.focus());
    setEditingPurchase(purchase); setReceivedAt(localDateTime(new Date(purchase.receivedAt))); setSupplier(purchase.supplier ?? "");
    setLines(purchase.lines.map((line) => {
      const currentConversion = activeItems.find((item) => item.id === line.stockItemId)?.conversions.find((conversion) => conversion.id === line.conversionId && conversion.isActive);
      const staleConversion = !!line.conversionId && (!currentConversion
        || currentConversion.label !== line.purchaseUnitLabel
        || normalizeInventoryQuantity(currentConversion.baseQuantityPerPack) !== normalizeInventoryQuantity(line.baseQuantityPerPack));
      return {
        id: line.id,
        stockItemId: line.stockItemId,
        conversionId: staleConversion ? "snapshot:" + line.conversionId : line.conversionId ?? "",
        purchaseUnitLabel: line.purchaseUnitLabel,
        purchaseQuantity: line.purchaseQuantity,
        directCostAmount: String(line.directCostAmount),
        ...(staleConversion && line.conversionId ? { snapshotConversionId: line.conversionId, snapshotPurchaseUnitLabel: line.purchaseUnitLabel } : {}),
      };
    }));
  };
  const changeStock = (index: number, stockItemId: string) => {
    const item = activeItems.find((entry) => entry.id === stockItemId);
    setLines((current) => current.map((line, rowIndex) => rowIndex === index ? purchaseLineFor(item) : line));
  };
  const unitsFor = (line: PurchaseLineDraft) => {
    const item = activeItems.find((entry) => entry.id === line.stockItemId);
    if (!item) return [];
    const options = [{ id: "", label: item.baseUnit, title: unitLabels[item.baseUnit as Unit] }, ...item.conversions.filter((conversion) => conversion.isActive).map((conversion) => ({ id: conversion.id, label: conversion.label, title: conversion.label }))];
    if (line.snapshotConversionId) options.push({ id: "snapshot:" + line.snapshotConversionId, label: line.snapshotPurchaseUnitLabel ?? line.purchaseUnitLabel, title: (line.snapshotPurchaseUnitLabel ?? line.purchaseUnitLabel) + " · ثبت‌شده" });
    return options;
  };
  return <div className="manager-grid inventory-purchase-layout">
    <ManagerCard title={editingPurchase ? "ویرایش پیش‌نویس خرید" : "پیش‌نویس خرید"} hint="ابتدا خرید را به‌صورت پیش‌نویس ذخیره کنید. پس از بررسی ردیف‌ها، «ثبت رسید در موجودی» مقدار و ارزش موجودی را به‌روز می‌کند.">
      {activeItems.length === 0 ? <InventoryEmptyState title="ابتدا کالای خرید را تعریف کنید" detail="برای ثبت خرید، ابتدا یک قلم فعال به موجودی اضافه کنید." action="تعریف کالای خرید" onAction={() => onNavigate("stock")} /> : <form ref={purchaseFormRef} className="manager-form" onChange={() => setDirty(true)} onSubmit={(event) => void submit(event)}>
        {localError && <p className="form-error" role="alert">{localError}</p>}
        <div className="manager-fields"><label><span>زمان دریافت</span><input type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} required /></label><label><span>تأمین‌کننده (اختیاری)</span><input value={supplier} onChange={(event) => setSupplier(event.target.value)} /></label></div>
        {lines.map((line, index) => <div className="inventory-entry-row inventory-purchase-line" key={index}>
          <InventorySearchPicker label="کالا" options={activeItems} value={line.stockItemId} onChange={(id) => { setDirty(true); changeStock(index, id); }} placeholder="جست‌وجوی کالا" required acceptExactMatchOnBlur />
          <label><span>واحد خرید</span><select value={line.conversionId} onChange={(event) => { const selected = unitsFor(line).find((unit) => unit.id === event.target.value); setLines((current) => current.map((row, rowIndex) => { if (rowIndex !== index) return row; const snapshotId = row.snapshotConversionId; return { ...row, conversionId: selected?.id ?? "", purchaseUnitLabel: selected?.label ?? "", useCurrentConversion: row.id === undefined || (snapshotId !== undefined && selected?.id === snapshotId) ? true : undefined }; })); }}>{unitsFor(line).map((unit) => <option key={`${unit.id}-${unit.label}`} value={unit.id}>{unit.title}</option>)}</select></label>
          <label><span>مقدار خرید ({unitsFor(line).find((unit) => unit.id === line.conversionId)?.title ?? "واحد انتخابی"})</span><InventoryNumberInput required value={line.purchaseQuantity} onValueChange={(value) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, purchaseQuantity: value } : row))} /></label>
          <label><span>هزینه‌ی مستقیم (تومان)</span><InventoryNumberInput required integer aria-describedby="purchase-cost-help" value={line.directCostAmount} onValueChange={(value) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, directCostAmount: value } : row))} /></label>
          {lines.length > 1 && <button className="text-button" type="button" onClick={() => { setDirty(true); setLines((current) => current.filter((_, rowIndex) => rowIndex !== index)); }}>حذف ردیف</button>}
        </div>)}
        <p className="inventory-note" id="purchase-cost-help">هزینه‌ی مستقیم، مبلغ کل همان ردیف است؛ مثلاً برای ۲ کیلوگرم قهوه، هزینه‌ی هر ۲ کیلوگرم را وارد کنید.</p>
        <p className="inventory-invoice-total"><span>جمع هزینه‌ی مستقیم (تومان)</span><strong>{draftTotal === null ? "مبلغ ردیف‌ها را بررسی کنید" : <bdi>{inventoryQuantity(String(draftTotal))}</bdi>}</strong></p>
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
        <div className="inventory-actions"><button type="submit">اعمال فیلترها</button><button className="secondary-button" type="button" onClick={clearFilters}>پاک‌کردن فیلترها</button></div>
      </form>
      <p className="inventory-table-hint">برای دیدن همه‌ی ستون‌ها، جدول را به طرفین بکشید.</p>
      {pageError && <p className="form-error" role="alert">{pageError} <button type="button" onClick={() => setRetryVersion((current) => current + 1)}>بارگذاری دوباره</button></p>}
      {pageLoading ? <p className="manager-empty" role="status">در حال بارگذاری خریدها…</p> : !pageError && <div className="inventory-table-wrap" role="region" aria-label="جدول خریدها" tabIndex={0}><table className="inventory-table inventory-purchase-table"><thead><tr><th scope="col">تأمین‌کننده / دریافت</th><th scope="col">اقلام</th><th scope="col">هزینه‌ی مستقیم (تومان)</th><th scope="col">وضعیت</th><th scope="col">عملیات و جزئیات</th></tr></thead><tbody>{purchases.map((purchase) => <tr key={purchase.id}>
        <th scope="row">{purchase.supplier || "بدون نام تأمین‌کننده"}<small className="inventory-cell-note">{new Date(purchase.receivedAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran", dateStyle: "short", timeStyle: "short" })}</small></th>
        <td>{inventoryNumber(purchase.lines.length)} قلم</td><td><bdi>{inventoryAmountTotal(purchase.lines.map((line) => line.directCostAmount)) === null ? "خارج از محدوده‌ی نمایش" : inventoryNumber(formatToman(inventoryAmountTotal(purchase.lines.map((line) => line.directCostAmount))!))}</bdi></td><td><span className={`inventory-status${purchase.status === "POSTED" ? " inventory-status--success" : ""}`}>{purchase.status === "POSTED" ? "رسید ثبت‌شده" : "پیش‌نویس"}</span></td>
        <td><details className="inventory-purchase-details" open={returning?.purchase.id === purchase.id || undefined}><summary>اقلام خرید</summary><ul>{purchase.lines.map((line) => <li key={line.id}>{items.find((item) => item.id === line.stockItemId)?.name ?? "قلم بایگانی‌شده"}: {inventoryQuantity(line.baseQuantityReceived)} {unitLabels[(items.find((item) => item.id === line.stockItemId)?.baseUnit ?? "PIECE") as Unit]}، {inventoryNumber(formatToman(line.directCostAmount))} تومان</li>)}</ul></details>
        <div className="inventory-actions">{purchase.status === "DRAFT" ? <><button className="secondary-button" type="button" onClick={() => startEditPurchase(purchase)}>ویرایش پیش‌نویس</button><button type="button" onClick={() => confirm({ title: "بررسی رسید خرید", detail: "با ثبت رسید، مقدار و ارزش موجودی بر اساس این ردیف‌ها به‌روز می‌شود.", summary: [...purchase.lines.map((line) => { const item = items.find((entry) => entry.id === line.stockItemId); return `${item?.name ?? "قلم بایگانی‌شده"}: ${line.baseQuantityReceived} ${unitLabels[(item?.baseUnit ?? "PIECE") as Unit]}، ${formatToman(line.directCostAmount)}`; }), `جمع هزینه‌ی مستقیم: ${formatToman(purchase.lines.reduce((total, line) => total + line.directCostAmount, 0))}`], actionLabel: "ثبت رسید در موجودی", run: () => { const key = `purchase:post:${purchase.id}`; return mutateAndReload(async () => { const result = await postInventoryPurchase(purchase.id, purchase.version, keyFor(key)); if (result.ok) clearKey(key); return result; }); } })}>ثبت رسید در موجودی</button></> : <button className="secondary-button" type="button" onClick={() => { const line = purchase.lines[0]; if (line) { setReturning({ purchase, lineId: line.id }); setReturnQuantity(""); setReturnReason(""); } }}>ثبت برگشت خرید</button>}</div>
        {returning?.purchase.id === purchase.id && <form className="inventory-return-form" onChangeCapture={() => setReturnDirty(true)} onSubmit={(event) => { event.preventDefault(); const key = `purchase:return:${purchase.id}:${returning.lineId}`; void mutateAndReload(async () => { const result = await returnInventoryPurchase(purchase.id, { purchaseLineId: returning.lineId, baseQuantity: returnQuantity, occurredAt: new Date().toISOString(), reason: returnReason }, keyFor(key)); if (result.ok) { clearKey(key); setReturning(null); setReturnDirty(false); } return result; }); }}><label><span>ردیف خرید</span><select value={returning.lineId} onChange={(event) => { setReturning({ purchase, lineId: event.target.value }); setReturnQuantity(""); }}>{purchase.lines.map((line) => <option key={line.id} value={line.id}>{items.find((item) => item.id === line.stockItemId)?.name ?? "کالا"} · {line.baseQuantityReceived} {unitLabels[(items.find((item) => item.id === line.stockItemId)?.baseUnit ?? "PIECE") as Unit]}</option>)}</select></label><p>مقدار مرجوعی را با واحد مبنا وارد کنید.</p><label><span>مقدار برگشتی</span><InventoryNumberInput required value={returnQuantity} onValueChange={(value) => setReturnQuantity(value)} /></label><label><span>دلیل</span><input required value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></label><div className="inventory-actions"><button type="submit">ثبت مرجوعی</button><button className="secondary-button" type="button" onClick={() => { setReturning(null); setReturnDirty(false); }}>انصراف</button></div></form>}
      </td></tr>)}</tbody></table></div>}
      {!pageLoading && !pageError && purchases.length === 0 && <InventoryEmptyState title={hasFilters ? "خریدی با این فیلترها پیدا نشد." : "هنوز خریدی ثبت نشده است"} detail={hasFilters ? "فیلترها را پاک کنید تا همه‌ی خریدها و پیش‌نویس‌ها نمایش داده شوند." : "اولین خرید را پیش‌نویس کنید. پس از بررسی ردیف‌ها، با ثبت رسید، موجودی به‌روز می‌شود."} action={hasFilters ? "نمایش همه‌ی خریدها" : activeItems.length ? "شروع پیش‌نویس خرید" : "افزودن کالا برای اولین خرید"} onAction={() => { if (hasFilters) clearFilters(); else if (!activeItems.length) onNavigate("stock"); else purchaseFormRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }} />}
      <div className="inventory-actions inventory-history-pagination">
        <button className="secondary-button" type="button" disabled={pageLoading || !!pageError || previousCursors.length === 0} onClick={() => { const previous = previousCursors[previousCursors.length - 1] ?? null; setPreviousCursors((current) => current.slice(0, -1)); setCursor(previous); }}>صفحه‌ی قبل</button>
        <span>صفحه‌ی {previousCursors.length + 1}</span>
        <button className="secondary-button" type="button" disabled={pageLoading || !!pageError || !page.hasMore || !page.nextCursor} onClick={() => { if (!page.nextCursor) return; setPreviousCursors((current) => [...current, cursor]); setCursor(page.nextCursor); }}>صفحه‌ی بعد</button>
      </div>
    </ManagerCard>
  </div>;
}

type OptionIngredientDraft = { componentKey: string; sourceKind: "STOCK_ITEM" | "RECIPE"; sourceId: string; quantity: string };
type MenuOptionRecipeDraft = { channel?: "TABLE" | "TAKEAWAY"; optionId: string; optionName: string; groupName: string; recipeId: string; components: OptionIngredientDraft[] };
type ServedAlongsideSourceDraft = { sourceKind: "STOCK_ITEM" | "RECIPE"; sourceId: string; quantity: string };
type ServedAlongsideEstimateDraft = { name: string; estimatedCostAmount: string };
type ServedAlongsideDraft =
  | ({ key: string; mode: "RECIPE"; previousEstimate?: ServedAlongsideEstimateDraft } & ServedAlongsideSourceDraft)
  | ({ key: string; mode: "ESTIMATED_COST" } & ServedAlongsideEstimateDraft & { previousSource?: ServedAlongsideSourceDraft });

function ProductOptionRecipePanel({ onOpenStock, onDirtyChange, catalog, items, recipes, mutate, initialProductId, canViewCosts = true }: { onOpenStock: () => void; catalog: ManagerCatalog; items: InventoryStockItem[]; recipes: InventoryRecipe[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; initialProductId?: string; canViewCosts?: boolean } & DraftGuardProps) {
  const activeProducts = catalog.products.filter((product) => product.isActive && !product.archivedAt);
  const [productSearch, setProductSearch] = useState("");
  const matchingProducts = activeProducts.filter((item) => inventorySearchMatches(item.name, productSearch));
  const [dirty, setDirty] = useInventoryDraftGuard(onDirtyChange);
  const [saved, setSaved] = useState(false);
  const selectProduct = (id: string) => { if (id === productId) return; if (dirty && !window.confirm("تغییرات دستور تهیه ذخیره نشده است. بدون ذخیره به محصول دیگری می‌روید؟")) return; setProductId(id); setDirty(false); setSaved(false); };
  const [productId, setProductId] = useState(() => initialProductId
    ? activeProducts.some((item) => item.id === initialProductId) ? initialProductId : ""
    : activeProducts[0]?.id ?? "");
  const [configuration, setConfiguration] = useState<ProductCostingConfiguration>(null);
  const [entries, setEntries] = useState<MenuOptionRecipeDraft[]>([]);
  const [packaging, setPackaging] = useState<NonNullable<NonNullable<ProductCostingConfiguration>["takeawayPackaging"]>>([]);
  const [servedAlongside, setServedAlongside] = useState<ServedAlongsideDraft[]>([]);
  const [useEstimatedCost, setUseEstimatedCost] = useState(false);
  const [estimatedCostAmount, setEstimatedCostAmount] = useState("");
  const [recipeDraftChanged, setRecipeDraftChanged] = useState(false);
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
    setServedAlongside([]);
    setUseEstimatedCost(false);
    setEstimatedCostAmount("");
    setRecipeDraftChanged(false);
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
      setUseEstimatedCost(value?.useEstimatedCost ?? false);
      setEstimatedCostAmount(value?.estimatedCostAmount == null ? "" : String(value.estimatedCostAmount));
      setServedAlongside((value?.servedAlongside ?? []).map((entry) => {
        if (entry.sourceKind === "ESTIMATED_COST") return {
          key: crypto.randomUUID(), mode: "ESTIMATED_COST" as const,
          name: entry.name, estimatedCostAmount: String(entry.estimatedCostAmount),
          ...(entry.previousSource ? { previousSource: { sourceKind: entry.previousSource.sourceKind, sourceId: entry.previousSource.sourceKind === "STOCK_ITEM" ? entry.previousSource.stockItemId : entry.previousSource.recipeId, quantity: entry.previousSource.quantity } } : {}),
        };
        return { key: crypto.randomUUID(), mode: "RECIPE" as const, sourceKind: entry.sourceKind, sourceId: entry.sourceKind === "STOCK_ITEM" ? entry.stockItemId : entry.recipeId, quantity: entry.quantity, ...(entry.previousEstimatedCost ? { previousEstimate: { ...entry.previousEstimatedCost, estimatedCostAmount: String(entry.previousEstimatedCost.estimatedCostAmount) } } : {}) };
      }));
      const optionRecipes = value?.optionRecipes ?? [];
      const activeOptionGroupIds = new Set(catalog.optionGroups.map((group) => group.id));
      const productOptionGroups = (catalog.products.find((item) => item.id === productId)?.optionGroups ?? []).filter((group) => activeOptionGroupIds.has(group.optionGroupId));
      const allowed = productOptionGroups.flatMap((group) => group.options.map((entry) => entry.optionId));
      const options = catalog.optionGroups.flatMap((group) => group.options.filter((option) => allowed.includes(option.id) && option.isActive && !option.archivedAt).map((option) => ({ id: option.id, name: option.name, group: group.name })));
      const includesNoOption = productOptionGroups.length === 0 || productOptionGroups.every((group) => group.minSelections === 0);
      const baseRecipeIsSharedWithOption = value?.mode === "RECIPE" && optionRecipes.some((entry) => entry.recipeId === value.recipeId);
      const displayOptions = [...(includesNoOption ? [{ id: "", name: options.length ? "بدون افزودنی" : "مواد اصلی محصول", group: options.length ? "مواد اصلی محصول" : "بدون گزینه" }] : []), ...options];
      const normalEntries = displayOptions.map((option) => {
        const isBase = !option.id;
        const optionRecipe = optionRecipes.find((entry) => entry.optionId === option.id);
        const configuredRecipeId = isBase
          ? baseRecipeIsSharedWithOption ? undefined : value?.mode === "RECIPE" ? value.recipeId : undefined
          : optionRecipe?.recipeId;
        const recipeForComponents = recipes.find((candidate) => candidate.id === configuredRecipeId)
          ?? (isBase && baseRecipeIsSharedWithOption ? recipes.find((candidate) => candidate.id === value?.recipeId) : undefined);
        return { optionId: option.id, optionName: option.name, groupName: option.group, recipeId: configuredRecipeId ?? "", components: recipeForComponents?.components.map((component) => ({ componentKey: component.componentKey, sourceKind: component.sourceKind, sourceId: component.sourceKind === "STOCK_ITEM" ? component.stockItemId : component.nestedRecipeId, quantity: component.quantity })) ?? [{ componentKey: crypto.randomUUID(), sourceKind: "STOCK_ITEM", sourceId: items.find((item) => item.isActive && !item.archivedAt)?.id ?? "", quantity: "" }] };
      });
      setEntries(normalEntries);
      if (value?.takeawayRecipeId || value?.takeawayOptionRecipes?.length) {
        setTakeawayEntries(normalEntries.map((entry) => {
          const optionRecipe = entry.optionId ? value.takeawayOptionRecipes?.find((row) => row.optionId === entry.optionId) : undefined;
          const baseRecipeIsShared = !entry.optionId && !!value.takeawayRecipeId && value.takeawayOptionRecipes?.some((row) => row.recipeId === value.takeawayRecipeId);
          const configuredId = entry.optionId ? optionRecipe?.recipeId : baseRecipeIsShared ? undefined : value.takeawayRecipeId;
          const recipe = recipes.find((row) => row.id === configuredId) ?? (baseRecipeIsShared ? recipes.find((row) => row.id === value.takeawayRecipeId) : undefined);
          return { ...entry, channel: "TAKEAWAY", recipeId: configuredId ?? "", components: recipe?.components.map((row) => ({ componentKey: row.componentKey, sourceKind: row.sourceKind, sourceId: row.sourceKind === "STOCK_ITEM" ? row.stockItemId : row.nestedRecipeId, quantity: row.quantity })) ?? entry.components.map((row) => ({ ...row })) };
        }));
      }
      setLoadingConfig(false);
    });
    return () => { current = false; previewVersion.current += 1; };
  }, [productId, configRetryVersion]);

  const changeEntry = (optionId: string, patch: Partial<MenuOptionRecipeDraft>, channel = "TABLE") => { setDirty(true); setRecipeDraftChanged(true); setSaved(false); invalidatePreview(); (channel === "TAKEAWAY" ? setTakeawayEntries : setEntries)((current) => current.map((entry) => entry.optionId === optionId ? { ...entry, ...patch } : entry)); };
  const changeIngredient = (optionId: string, index: number, patch: Partial<OptionIngredientDraft>, channel = "TABLE") => { setDirty(true); setRecipeDraftChanged(true); setSaved(false); invalidatePreview(); (channel === "TAKEAWAY" ? setTakeawayEntries : setEntries)((current) => current.map((entry) => entry.optionId === optionId ? { ...entry, components: entry.components.map((component, i) => i === index ? { ...component, ...patch } : component) } : entry)); };
  const changeServedAlongside = (index: number, patch: Partial<ServedAlongsideDraft>) => { setDirty(true); setSaved(false); invalidatePreview(); setServedAlongside((current) => current.map((entry, i) => i === index ? { ...entry, ...patch } as ServedAlongsideDraft : entry)); };
  const validPreviewNumber = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const runOptionPreview = async (entry: MenuOptionRecipeDraft) => {
    if (!product || previewInFlight.current || dirty) return;
    if (!validPreviewNumber(previewQuantity) || (product.pricingMode === "WEIGHTED_PER_KG" && !validPreviewNumber(weightGrams))) {
      setError("تعداد و وزن هر واحد را به‌صورت عدد صحیح بزرگ‌تر از صفر وارد کنید.");
      return;
    }
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
  const isValidEstimatedAmount = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2_147_483_647;
  const isValidServedAlongsideQuantity = (value: string) => /^\d+(?:\.\d{1,6})?$/.test(value) && Number(value) > 0;
  const canReuseStoredRecipe = !useEstimatedCost && !recipeDraftChanged
    && configuration?.mode === "RECIPE"
    && Boolean(configuration.recipeId && configuration.recipeQuantity);
  const shouldValidateRecipeDraft = !useEstimatedCost && !canReuseStoredRecipe;
  const serializedServedAlongside = () => servedAlongside.map((entry) => entry.mode === "ESTIMATED_COST"
    ? {
      sourceKind: "ESTIMATED_COST" as const,
      name: entry.name.trim(),
      estimatedCostAmount: Number(entry.estimatedCostAmount),
      ...(entry.previousSource?.sourceId && isValidServedAlongsideQuantity(entry.previousSource.quantity) ? {
        previousSource: {
          sourceKind: entry.previousSource.sourceKind,
          ...(entry.previousSource.sourceKind === "STOCK_ITEM" ? { stockItemId: entry.previousSource.sourceId } : { recipeId: entry.previousSource.sourceId }),
          quantity: entry.previousSource.quantity,
        },
      } : {}),
    }
    : {
      sourceKind: entry.sourceKind,
      ...(entry.sourceKind === "STOCK_ITEM" ? { stockItemId: entry.sourceId } : { recipeId: entry.sourceId }),
      quantity: entry.quantity,
      ...(entry.previousEstimate?.name.trim() && isValidEstimatedAmount(entry.previousEstimate.estimatedCostAmount) ? {
        previousEstimatedCost: { name: entry.previousEstimate.name.trim(), estimatedCostAmount: Number(entry.previousEstimate.estimatedCostAmount) },
      } : {}),
    });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!product) { setError("محصول منو را انتخاب کنید."); return; }
    if (useEstimatedCost && recipeDraftChanged) { setError("تغییرهای دستور تهیه را ذخیره کنید، سپس حالت هزینه‌ی تخمینی را فعال کنید."); return; }
    if (useEstimatedCost && !isValidEstimatedAmount(estimatedCostAmount)) { setError("هزینه‌ی تخمینی را به‌صورت عدد صحیح تومان، از صفر تا ۲٬۱۴۷٬۴۸۳٬۶۴۷ وارد کنید."); return; }
    if (shouldValidateRecipeDraft && configuration?.mode !== "PURCHASED_ITEM" && !entries.length) { setError("این محصول منویی گزینه‌ای برای تنظیم دستور تهیه ندارد."); return; }
    if (shouldValidateRecipeDraft && configuration?.mode !== "PURCHASED_ITEM" && [...entries, ...takeawayEntries].some((entry) => !entry.components.length || entry.components.some((component) => !component.sourceId || !/^\d+(?:\.\d{1,6})?$/.test(component.quantity)))) { setError("برای هر گزینه، قلم یا دستور تهیه و مقدار آن را کامل کنید."); return; }
    if (!useEstimatedCost && configuration?.mode === "PURCHASED_ITEM" && !configuration.purchasedStockItemId) { setError("تنظیم کالای خریداری‌شده برای این محصول کامل نیست."); return; }
    if (servedAlongside.some((entry) => entry.mode === "RECIPE" ? !entry.sourceId || !/^\d+(?:\.\d{1,6})?$/.test(entry.quantity) || Number(entry.quantity) <= 0 : !entry.name.trim() || !isValidEstimatedAmount(entry.estimatedCostAmount))) { setError("نام و هزینه‌ی تخمینی یا قلم و مقدار افزودنی کنار محصول را کامل کنید."); return; }
    if (packaging.some((entry) => !entry.stockItemId || !/^\d+(?:\.\d{1,6})?$/.test(entry.quantity) || Number(entry.quantity) <= 0) || new Set(packaging.map((entry) => entry.stockItemId)).size !== packaging.length) { setError("قلم و مقدار بسته‌بندی را کامل کنید؛ هر قلم را فقط یک بار وارد کنید."); return; }
    if (packaging.some((entry) => (entry.mode === "PER_GROUP" && (!Number.isInteger(entry.groupSize) || entry.groupSize! < 2 || entry.groupSize! > 10000)) || (entry.minQuantity !== undefined && (!Number.isInteger(entry.minQuantity) || entry.minQuantity < 1)) || (entry.maxQuantity !== undefined && (!Number.isInteger(entry.maxQuantity) || entry.maxQuantity < (entry.minQuantity ?? 1))))) { setError("شرط تعداد بسته‌بندی را بررسی کنید؛ تعداد گروه و بازه باید معتبر باشند."); return; }
    setError(null);
    await mutate(async () => {
      const common = { servedAlongside: serializedServedAlongside(), takeawayPackaging: packaging };
      if (useEstimatedCost) {
        const result = await saveProductCosting(product.id, {
          mode: configuration?.mode ?? "RECIPE",
          useEstimatedCost: true,
          estimatedCostAmount: Number(estimatedCostAmount),
          ...common,
          optionRules: configuration?.optionRules ?? [],
          combinations: configuration?.combinations.map(({ name, optionIds, rules }) => ({ name, optionIds, rules })) ?? [],
          expectedVersion: configuration?.version ?? 1,
        });
        if (result.ok) { setConfiguration(result.data.data); setDirty(false); setSaved(true); setPreviews({}); }
        return result;
      }
      if (configuration?.mode === "PURCHASED_ITEM") {
        const result = await saveProductCosting(product.id, {
          mode: "PURCHASED_ITEM",
          purchasedStockItemId: configuration.purchasedStockItemId!,
          ...(configuration.purchasedQuantity === null ? {} : { purchasedQuantity: configuration.purchasedQuantity }),
          useEstimatedCost: false,
          ...(configuration.estimatedCostAmount === null ? {} : { estimatedCostAmount: configuration.estimatedCostAmount }),
          extrasRecipeId: configuration.extrasRecipeId,
          ...common,
          takeawayRecipeId: configuration.takeawayRecipeId,
          takeawayOptionRecipes: configuration.takeawayOptionRecipes,
          optionRules: configuration.optionRules,
          combinations: configuration.combinations.map(({ name, optionIds, rules }) => ({ name, optionIds, rules })),
          expectedVersion: configuration.version,
        });
        if (result.ok) { setConfiguration(result.data.data); setRecipeDraftChanged(false); setDirty(false); setSaved(true); setPreviews({}); }
        return result;
      }
      if (configuration?.mode === "RECIPE" && !recipeDraftChanged && configuration.recipeId && configuration.recipeQuantity) {
        const result = await saveProductCosting(product.id, {
          mode: "RECIPE",
          recipeId: configuration.recipeId,
          recipeQuantity: configuration.recipeQuantity,
          useEstimatedCost: false,
          ...(configuration.estimatedCostAmount === null ? {} : { estimatedCostAmount: configuration.estimatedCostAmount }),
          extrasRecipeId: configuration.extrasRecipeId,
          ...common,
          takeawayRecipeId: configuration.takeawayRecipeId,
          takeawayOptionRecipes: configuration.takeawayOptionRecipes,
          optionRules: configuration.optionRules,
          optionRecipes: configuration.optionRecipes ?? [],
          combinations: configuration.combinations.map(({ name, optionIds, rules }) => ({ name, optionIds, rules })),
          expectedVersion: configuration.version,
        });
        if (result.ok) { setConfiguration(result.data.data); setRecipeDraftChanged(false); setDirty(false); setSaved(true); setPreviews({}); }
        return result;
      }
      const optionRecipes: Array<{ optionId: string; recipeId: string; recipeQuantity: string }> = [];
      const takeawayOptionRecipes: typeof optionRecipes = [];
      let takeawayRecipeId: string | null = null;
      let baseRecipeId: string | undefined;
      for (const entry of [...entries, ...takeawayEntries]) {
        const weighted = product.pricingMode === "WEIGHTED_PER_KG";
        const name = `${product.name} ${entry.optionName} ${entry.optionId ? entry.optionId.slice(0, 6) : "base"}${entry.channel === "TAKEAWAY" ? " بیرون‌بر" : ""}`;
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
        else baseRecipeId = savedRecipe.id;
      }
      const firstRecipe = optionRecipes[0];
      const resolvedBaseRecipeId = baseRecipeId ?? firstRecipe?.recipeId ?? (configuration?.mode === "RECIPE" ? configuration.recipeId : undefined);
      if (!resolvedBaseRecipeId) { setError("برای محاسبه‌ی هزینه، یک دستور تهیه به محصول منو وصل کنید."); return { ok: false as const, error: { kind: "response" as const, status: 422, code: "BUSINESS_RULE_VIOLATION", message: "یک گزینه برای این محصول تنظیم نشده است." } }; }
      const result = await saveProductCosting(product.id, { mode: "RECIPE", recipeId: resolvedBaseRecipeId, recipeQuantity: product.pricingMode === "WEIGHTED_PER_KG" ? "1000" : "1", useEstimatedCost: false, ...(configuration?.estimatedCostAmount === null || configuration?.estimatedCostAmount === undefined ? {} : { estimatedCostAmount: configuration.estimatedCostAmount }), extrasRecipeId: configuration?.extrasRecipeId ?? null, servedAlongside: common.servedAlongside, takeawayPackaging: packaging, takeawayRecipeId, takeawayOptionRecipes, optionRules: configuration?.optionRules ?? [], optionRecipes, combinations: configuration?.combinations.map(({ name, optionIds, rules }) => ({ name, optionIds, rules })) ?? [], expectedVersion: configuration?.version ?? 1 });
      if (result.ok) { setConfiguration(result.data.data); setRecipeDraftChanged(false); setDirty(false); setSaved(true); setPreviews({}); }
      return result;
    });
  };

  return <div className="inventory-recipe-layout"><aside className="manager-card inventory-product-picker" aria-label="انتخاب محصول برای دستور تهیه"><header><h2>محصولات منو</h2><p>محصول را انتخاب کنید و مواد هر گزینه را تنظیم کنید.</p></header><label><span>جست‌وجوی محصول منو</span><input type="search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="نام محصول" /></label><div className="inventory-product-list">{matchingProducts.map((item) => <button className="secondary-button" type="button" key={item.id} aria-pressed={item.id === productId} onClick={() => selectProduct(item.id)}>{item.name}<small>{item.pricingMode === "WEIGHTED_PER_KG" ? "وزنی" : "واحدی"}</small></button>)}{activeProducts.length > 0 && matchingProducts.length === 0 && <p className="inventory-empty">محصولی با این نام پیدا نشد.</p>}</div></aside><ManagerCard title="دستور تهیه و هزینه" hint="محصول منو را انتخاب کنید و مواد لازم برای هر گزینه‌ی منو را ثبت کنید.">
    {activeProducts.length > 0 && <div className="inventory-compact-product-picker"><InventorySearchPicker label="محصول منو" options={activeProducts} value={productId} onChange={selectProduct} placeholder="جست‌وجوی محصول منو" /></div>}
    {activeProducts.length === 0 ? <InventoryEmptyState title="محصول فعالی برای دستور تهیه وجود ندارد" detail="برای شروع، ابتدا یک محصول فعال در بخش مدیریت منو بسازید. سپس به این صفحه برگردید و مواد مصرفی آن را مشخص کنید." /> : !product && initialProductId ? <p className="inventory-note" role="status">محصول تاریخی انتخاب‌شده دیگر فعال نیست؛ برای دیدن هزینه‌ی فعلی، محصول فعالی را از فهرست انتخاب کنید.</p> : <>
      {!useEstimatedCost && !items.some((item) => item.isActive && !item.archivedAt) && <InventoryEmptyState title="کالای فعالی در انبار نیست" detail="برای افزودن ماده‌ی اولیه، آن را در اقلام موجودی تعریف کنید. دستورهای مشترک ذخیره‌شده نیز از فهرست نوع ماده قابل انتخاب‌اند." action="تعریف مواد اولیه در انبار" onAction={onOpenStock} />}
      {dirty && <p className="inventory-note" role="status">تغییرات ذخیره نشده است. پس از تکمیل مواد، دستور تهیه را ذخیره کنید.</p>}{saved && <p className="inventory-success" role="status">دستور تهیه ذخیره شد.</p>}
      {loadingConfig ? <p className="manager-empty">در حال بارگذاری گزینه‌های منو…</p> : <>
      {error && <p className="form-error" role="alert">{error} {loadFailed && <button type="button" disabled={loadingConfig} onClick={() => setConfigRetryVersion((current) => current + 1)}>بارگذاری تنظیم هزینه</button>}</p>}
      <div className="inventory-selected-product"><div><strong>مواد لازم برای {product?.name}</strong><small className="inventory-cell-note">قیمت پایه‌ی منو: {product ? formatToman(product.priceAmount) : ""} تومان{product?.pricingMode === "WEIGHTED_PER_KG" ? " در هر کیلوگرم" : ""} · قیمت گزینه‌ها جداگانه محاسبه می‌شود.</small></div></div>
      <form className="manager-form" onSubmit={(event) => void submit(event)}>
        <label><input type="checkbox" checked={useEstimatedCost} onChange={(event) => { setUseEstimatedCost(event.target.checked); setDirty(true); setSaved(false); setError(null); invalidatePreview(); }} /> هزینه‌ی نهایی را به‌صورت تخمینی ثبت می‌کنم</label>
        {useEstimatedCost && <div className="manager-fields">
          <label><span>هزینه‌ی تخمینی {product?.pricingMode === "WEIGHTED_PER_KG" ? "هر کیلوگرم" : "هر واحد"} (تومان)</span><InventoryNumberInput integer min={0} max={2_147_483_647} required value={estimatedCostAmount} onValueChange={(value) => { setEstimatedCostAmount(value); setDirty(true); setSaved(false); setError(null); invalidatePreview(); }} /></label>
          <p className="inventory-note">این هزینه، بهای نهایی محصول را برای همه‌ی گزینه‌های منو پوشش می‌دهد. برای محصول وزنی مبلغ را برای یک کیلوگرم وارد کنید؛ صفر هم یک هزینه‌ی تنظیم‌شده محسوب می‌شود.</p>
        </div>}
        {!useEstimatedCost && entries.length === 0 && configuration?.mode !== "PURCHASED_ITEM" && <p className="inventory-note">برای تنظیم هزینه‌ی مواد، ابتدا برای محصول یک گزینه‌ی منو تعریف کنید؛ یا حالت هزینه‌ی تخمینی را روشن کنید.</p>}
        {!useEstimatedCost && configuration?.mode === "PURCHASED_ITEM" && <p className="inventory-note">هزینه‌ی این محصول از کالای خریداری‌شده‌ی ذخیره‌شده خوانده می‌شود. تغییر این حالت، تنظیم فعلی را حفظ می‌کند.</p>}
        {!useEstimatedCost && configuration?.mode !== "PURCHASED_ITEM" && <>
          <label><input type="checkbox" checked={takeawayEntries.length > 0} onChange={(event) => { setDirty(true); setRecipeDraftChanged(true); setSaved(false); invalidatePreview(); setTakeawayEntries(event.target.checked ? entries.map((entry) => ({ ...entry, channel: "TAKEAWAY", recipeId: "", components: entry.components.map((row) => ({ ...row })) })) : []); }} /> دستور مواد بیرون‌بر جداگانه</label>
          <p className="inventory-note">برای استفاده از کوکی بسته‌بندی‌شده، دستور «کوکی بیرون‌بر» را در دستورهای مشترک بسازید و در مواد بیرون‌بر انتخاب کنید. بدون دستور جداگانه، مواد داخل کافه استفاده می‌شود.</p>
          {[...entries, ...takeawayEntries].map((entry) => <fieldset className="inventory-option-recipe" key={`${entry.channel ?? "TABLE"}:${entry.optionId}`}>
            <legend>{entry.optionName}<small> · {entry.groupName}{entry.channel === "TAKEAWAY" ? " · بیرون‌بر" : " · داخل کافه"}</small></legend>
            {entry.components.map((component, index) => {
              const sourceItems = component.sourceKind === "STOCK_ITEM" ? items.filter((item) => item.isActive && !item.archivedAt) : recipes.filter((recipe) => recipe.isActive && !recipe.archivedAt && recipe.id !== entry.recipeId);
              const sourceUnit = component.sourceKind === "STOCK_ITEM" ? items.find((item) => item.id === component.sourceId)?.baseUnit : recipes.find((recipe) => recipe.id === component.sourceId)?.outputUnit;
              return <div className="inventory-entry-row" key={component.componentKey}>
                <label><span>نوع ماده</span><select value={component.sourceKind} onChange={(event) => { const sourceKind = event.target.value as OptionIngredientDraft["sourceKind"]; const sourceId = sourceKind === "STOCK_ITEM" ? items.find((item) => item.isActive && !item.archivedAt)?.id ?? "" : recipes.find((recipe) => recipe.isActive && !recipe.archivedAt && recipe.id !== entry.recipeId)?.id ?? ""; changeIngredient(entry.optionId, index, { sourceKind, sourceId }, entry.channel); }}><option value="STOCK_ITEM">قلم موجودی</option><option value="RECIPE">دستور تهیه‌ی موجود</option></select></label>
                <InventorySearchPicker label={component.sourceKind === "STOCK_ITEM" ? "قلم موجودی" : "دستور تهیه"} options={sourceItems.map((source) => ({ id: source.id, name: source.name }))} value={component.sourceId} onChange={(sourceId) => changeIngredient(entry.optionId, index, { sourceId }, entry.channel)} placeholder={component.sourceKind === "STOCK_ITEM" ? "جست‌وجوی قلم موجودی" : "جست‌وجوی دستور تهیه"} required={shouldValidateRecipeDraft} />
                <label><span>مقدار{sourceUnit ? ` (${unitLabels[sourceUnit as Unit]})` : ""}</span><InventoryNumberInput required={shouldValidateRecipeDraft} value={component.quantity} placeholder={sourceUnit ? `مقدار به ${unitLabels[sourceUnit as Unit]}` : "مقدار"} onValueChange={(value) => changeIngredient(entry.optionId, index, { quantity: value }, entry.channel)} /></label>
                {entry.components.length > 1 && <button className="text-button" type="button" onClick={() => changeEntry(entry.optionId, { components: entry.components.filter((_, i) => i !== index) }, entry.channel)}>حذف ماده</button>}
              </div>;
            })}
            <button className="secondary-button" type="button" onClick={() => changeEntry(entry.optionId, { components: [...entry.components, { componentKey: crypto.randomUUID(), sourceKind: "STOCK_ITEM", sourceId: items.find((item) => item.isActive && !item.archivedAt)?.id ?? "", quantity: "" }] }, entry.channel)}>افزودن ماده به {entry.optionName}</button>
          </fieldset>)}
        </>}
        <fieldset className="inventory-option-recipe">
          <legend>افزودنی کنار محصول <small>· اختیاری</small></legend>
          <p className="inventory-note">چیزهایی را که همراه هر واحد محصول سرو می‌شوند اضافه کنید؛ مثلاً یک کوکی کنار اسپرسو. هر مورد می‌تواند هزینه‌ی مواد یا هزینه‌ی تخمینی مستقل داشته باشد. این افزودنی برای همه‌ی گزینه‌ها و سفارش‌های داخل کافه و بیرون‌بر محاسبه می‌شود و در دستور مشترک محصول دیگری کپی نمی‌شود.</p>
          {servedAlongside.map((entry, index) => {
            const estimated = entry.mode === "ESTIMATED_COST";
            const sourceKind = estimated ? entry.previousSource?.sourceKind ?? "STOCK_ITEM" : entry.sourceKind;
            const sourceId = estimated ? entry.previousSource?.sourceId ?? "" : entry.sourceId;
            const sourceUnit = sourceKind === "STOCK_ITEM"
              ? items.find((item) => item.id === sourceId)?.baseUnit
              : recipes.find((recipe) => recipe.id === sourceId)?.outputUnit;
            const sourceName = sourceKind === "STOCK_ITEM"
              ? items.find((item) => item.id === sourceId)?.name
              : recipes.find((recipe) => recipe.id === sourceId)?.name;
            const sourceOptions = sourceKind === "STOCK_ITEM"
              ? items.filter((item) => (item.isActive && !item.archivedAt) || item.id === sourceId).map((item) => ({ id: item.id, name: item.isActive && !item.archivedAt ? item.name : `${item.name} (بایگانی‌شده)` }))
              : recipes.filter((recipe) => (recipe.isActive && !recipe.archivedAt) || recipe.id === sourceId).map((recipe) => ({ id: recipe.id, name: recipe.isActive && !recipe.archivedAt ? recipe.name : `${recipe.name} (بایگانی‌شده)` }));
            return <div className="inventory-entry-row" key={entry.key}>
              <label><input type="checkbox" checked={estimated} onChange={(event) => {
                if (event.target.checked && entry.mode === "RECIPE") {
                  changeServedAlongside(index, { mode: "ESTIMATED_COST", name: entry.previousEstimate?.name ?? sourceName ?? "", estimatedCostAmount: entry.previousEstimate?.estimatedCostAmount ?? "", previousSource: { sourceKind: entry.sourceKind, sourceId: entry.sourceId, quantity: entry.quantity } });
                } else if (!event.target.checked && entry.mode === "ESTIMATED_COST") {
                  const previous = entry.previousSource;
                  changeServedAlongside(index, previous
                    ? { mode: "RECIPE", ...previous, previousEstimate: { name: entry.name, estimatedCostAmount: entry.estimatedCostAmount } }
                    : { mode: "RECIPE", sourceKind: "STOCK_ITEM", sourceId: items.find((item) => item.isActive && !item.archivedAt)?.id ?? "", quantity: "1", previousEstimate: { name: entry.name, estimatedCostAmount: entry.estimatedCostAmount } });
                }
              }} /> هزینه‌ی تخمینی برای افزودنی {index + 1}</label>
              {!estimated && <>
                <label><span>نوع افزودنی {index + 1}</span><select value={entry.sourceKind} onChange={(event) => {
                  const nextKind = event.target.value as ServedAlongsideSourceDraft["sourceKind"];
                  const nextId = nextKind === "STOCK_ITEM"
                    ? items.find((item) => item.isActive && !item.archivedAt)?.id ?? ""
                    : recipes.find((recipe) => recipe.isActive && !recipe.archivedAt)?.id ?? "";
                  changeServedAlongside(index, { sourceKind: nextKind, sourceId: nextId });
                }}><option value="STOCK_ITEM">قلم موجودی</option><option value="RECIPE">دستور تهیه‌ی موجود</option></select></label>
                <InventorySearchPicker label={entry.sourceKind === "STOCK_ITEM" ? "قلم افزودنی" : "دستور افزودنی"} options={sourceOptions} value={entry.sourceId} onChange={(nextId) => changeServedAlongside(index, { sourceId: nextId })} placeholder={entry.sourceKind === "STOCK_ITEM" ? "جست‌وجوی قلم موجودی" : "جست‌وجوی دستور تهیه"} required />
                <label><span>مقدار برای هر واحد{sourceUnit ? ` (${unitLabels[sourceUnit as Unit]})` : ""}</span><InventoryNumberInput required value={entry.quantity} placeholder={sourceUnit ? `مقدار به ${unitLabels[sourceUnit as Unit]}` : "مقدار"} onValueChange={(value) => changeServedAlongside(index, { quantity: value })} /></label>
              </>}
              {estimated && <>
                <label><span>نام افزودنی {index + 1}</span><input required maxLength={160} value={entry.name} onChange={(event) => changeServedAlongside(index, { name: event.target.value })} /></label>
                <label><span>هزینه‌ی تخمینی برای هر واحد محصول (تومان)</span><InventoryNumberInput integer required min={0} max={2_147_483_647} value={entry.estimatedCostAmount} onValueChange={(value) => changeServedAlongside(index, { estimatedCostAmount: value })} /></label>
              </>}
              <button className="text-button" type="button" onClick={() => { setServedAlongside((current) => current.filter((_, i) => i !== index)); setDirty(true); setSaved(false); invalidatePreview(); }}>حذف افزودنی {index + 1}</button>
            </div>;
          })}
          <button className="secondary-button" type="button" onClick={() => {
            const sourceId = items.find((item) => item.isActive && !item.archivedAt)?.id ?? "";
            setServedAlongside((current) => [...current, { key: crypto.randomUUID(), mode: "RECIPE", sourceKind: "STOCK_ITEM", sourceId, quantity: "1" }]);
            setDirty(true); setSaved(false); invalidatePreview();
          }}>افزودن مورد سرو در کنار محصول</button>
        </fieldset>
        <fieldset className="inventory-option-recipe">
          <legend>بسته‌بندی بیرون‌بر</legend>
          <p className="inventory-note">لیوان، ظرف یا هولدر را ابتدا در اقلام موجودی ثبت کنید. مقدار هر قلم برای یک واحد فروش است؛ برای محصول وزنی هم به تعداد واحدها محاسبه می‌شود. این هزینه فقط به سفارش بیرون‌بر اضافه می‌شود. گروه کامل با جمع تعداد همین محصول در سفارش محاسبه می‌شود؛ گروه ناقص بسته‌بندی نمی‌گیرد. حداقل و حداکثر اختیاری هستند.</p>
          {packaging.map((entry, index) => <div className="inventory-entry-row" key={index}>
            <InventorySearchPicker label={`قلم بسته‌بندی ${index + 1}`}
              options={items.filter((item) => (item.isActive && !item.archivedAt) || item.id === entry.stockItemId)
                .map((item) => ({ id: item.id, name: item.isActive && !item.archivedAt ? item.name : `${item.name} (بایگانی‌شده)` }))}
              value={entry.stockItemId} onChange={(id) => changePackaging(packaging.map((row, i) => i === index ? { ...row, stockItemId: id } : row))}
              placeholder="جست‌وجوی قلم بسته‌بندی" required />
            <label><span>مقدار بسته‌بندی {index + 1} ({unitLabels[(items.find((item) => item.id === entry.stockItemId)?.baseUnit ?? "PIECE") as Unit]})</span><InventoryNumberInput required value={entry.quantity} onValueChange={(value) => changePackaging(packaging.map((row, i) => i === index ? { ...row, quantity: value } : row))} /></label>
            <label><span>روش محاسبه‌ی بسته‌بندی {index + 1}</span><select value={entry.mode ?? "PER_UNIT"} onChange={(event) => changePackaging(packaging.map((row, i) => { if (i !== index) return row; const { groupSize, ...rest } = row; return { ...rest, mode: event.target.value as "PER_UNIT" | "PER_GROUP" | "PER_ORDER", ...(event.target.value === "PER_GROUP" ? { groupSize: 2 } : {}) }; }))}><option value="PER_UNIT">برای هر واحد محصول</option><option value="PER_GROUP">برای هر گروه کامل</option><option value="PER_ORDER">یک بار برای محصول در سفارش</option></select></label>
            {entry.mode === "PER_GROUP" && <label><span>تعداد واحد در هر گروه {index + 1}</span><input required type="number" min="2" max="10000" value={entry.groupSize ?? 2} onChange={(event) => changePackaging(packaging.map((row, i) => i === index ? { ...row, groupSize: Number(event.target.value) } : row))} /></label>}
            <label><span>حداقل تعداد محصول برای بسته‌بندی {index + 1}</span><input type="number" min="1" max="1000000" value={entry.minQuantity ?? ""} onChange={(event) => changePackaging(packaging.map((row, i) => { if (i !== index) return row; const { minQuantity, ...rest } = row; return event.target.value ? { ...rest, minQuantity: Number(event.target.value) } : rest; }))} /></label>
            <label><span>حداکثر تعداد محصول برای بسته‌بندی {index + 1}</span><input type="number" min="1" max="1000000" value={entry.maxQuantity ?? ""} onChange={(event) => changePackaging(packaging.map((row, i) => { if (i !== index) return row; const { maxQuantity, ...rest } = row; return event.target.value ? { ...rest, maxQuantity: Number(event.target.value) } : rest; }))} /></label>
            <button type="button" className="text-button" onClick={() => changePackaging(packaging.filter((_, i) => i !== index))}>حذف بسته‌بندی {index + 1}</button>
          </div>)}
          <button type="button" className="secondary-button" onClick={() => changePackaging([...packaging, { stockItemId: "", quantity: "1" }])}>افزودن بسته‌بندی بیرون‌بر</button>
        </fieldset>
        <button type="submit" disabled={loadingConfig || loadFailed}>ذخیره‌ی دستورهای تهیه</button>
      </form>
      {configuration && canViewCosts && <section className="inventory-option-previews">
        <label><span>نوع سفارش برای محاسبه‌ی هزینه</span><select value={previewChannel} disabled={previewing} onChange={(event) => { invalidatePreview(); setPreviewChannel(event.target.value as "TABLE" | "TAKEAWAY"); }}><option value="TABLE">داخل کافه</option><option value="TAKEAWAY">بیرون‌بر</option></select></label>
        <h3>هزینه‌ی دستور ذخیره‌شده</h3><p className="inventory-cell-note">این محاسبه از دستور ذخیره‌شده انجام می‌شود؛ تغییرات فرم را ابتدا ذخیره کنید.</p>
        <div className="manager-fields">
          <label><span>تعداد</span><InventoryNumberInput integer value={previewQuantity} disabled={previewing} onValueChange={(value) => { invalidatePreview(); setPreviewQuantity(value); }} /></label>
          {product?.pricingMode === "WEIGHTED_PER_KG" && <label><span>وزن هر واحد (گرم)</span><InventoryNumberInput integer value={weightGrams} disabled={previewing} onValueChange={(value) => { invalidatePreview(); setWeightGrams(value); }} /></label>}
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

function prettyMissingReason(reason: string) {
  if (reason.startsWith("missing-costing:")) return `هزینه‌ی ${reason.slice("missing-costing:".length)} تنظیم نشده است`;
  if (reason.startsWith("missing-recipe:")) return "دستور تهیه‌ی یکی از مواد موجود نیست";
  if (reason.startsWith("missing-stock:")) return "قلم موجودی یکی از مواد موجود نیست";
  if (reason.startsWith("missing-valuation:")) return "ارزش موجودی یکی از مواد هنوز ثبت نشده است";
  if (reason.startsWith("recipe-cycle:")) return "در دستورهای تهیه، ارجاع تکراری وجود دارد";
  return "برای تکمیل محاسبه، بخشی از اطلاعات لازم است";
}

function CountPanel({ refreshVersion, onOpenStock, onDirtyChange, items, pending, mutate, confirm, keyFor, clearKey }: { refreshVersion: number; onOpenStock: () => void; items: InventoryStockItem[]; pending: PendingInventoryConsumption[]; mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>; confirm: (value: InventoryConfirm) => void; keyFor: (name: string) => string; clearKey: (name: string) => void } & DraftGuardProps) {
  const [dirty, setDirty] = useInventoryDraftGuard(onDirtyChange);
  const activeItems = items.filter((item) => item.isActive && !item.archivedAt);
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [page, setPage] = useState({ limit: 20, nextCursor: null as string | null, hasMore: false });
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const currentPersianDate = currentPersianDateInput();
  const [filters, setFilters] = useState({ search: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "", status: "" });
  const [appliedFilters, setAppliedFilters] = useState({ search: "", from: "", to: "", status: "" });
  const [filterError, setFilterError] = useState<string | null>(null);
  const [editingCount, setEditingCount] = useState<InventoryCount | null>(null);
  const [draftLines, setDraftLines] = useState<Array<{ stockItemId: string; expectedQuantity: string; observedQuantity: string; observedValueAmount: string }> | null>(null);
  const countFormRef = useRef<HTMLFormElement>(null);
  const [itemSearch, setItemSearch] = useState("");
  const hasFilters = !!(appliedFilters.search || appliedFilters.from || appliedFilters.to || appliedFilters.status || cursor);
  const clearFilters = () => { setFilters({ search: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "", status: "" }); setAppliedFilters({ search: "", from: "", to: "", status: "" }); setFilterError(null); setCursor(null); setPreviousCursors([]); };
  const [reason, setReason] = useState("");
  const [reconcile, setReconcile] = useState<string[]>([]);
  const countOptions = activeItems.filter((item) => !!item.balance.trackingStartedAt).map((item) => ({ stockItemId: item.id, expectedQuantity: item.balance.quantityOnHand ?? "0", observedQuantity: item.balance.quantityOnHand ?? "0", observedValueAmount: String(item.balance.carryingValueAmount ?? 0) }));
  const lines = draftLines ?? countOptions;
  const activeItemsById = new Map(activeItems.map((item) => [item.id, item]));
  const matchingCountOptions = countOptions.filter((line) =>
    inventorySearchMatches(activeItemsById.get(line.stockItemId)?.name ?? "", itemSearch));
  const matchingCountIds = new Set(matchingCountOptions.map((line) => line.stockItemId));
  const orderedLines = itemSearch.trim()
    ? [...lines.filter((line) => matchingCountIds.has(line.stockItemId)), ...lines.filter((line) => !matchingCountIds.has(line.stockItemId))]
    : lines;
  const hasQuantityDifference = lines.some((line) => {
    const currentQuantity = activeItemsById.get(line.stockItemId)?.balance.quantityOnHand ?? line.expectedQuantity;
    return normalizeInventoryQuantity(line.observedQuantity) !== normalizeInventoryQuantity(currentQuantity);
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
  }, [appliedFilters, cursor, page.limit, refreshVersion, retryVersion]);
  const mutateAndReload = async (action: () => Promise<ApiResult<unknown>>) => {
    const ok = await mutate(action);
    if (ok) { setCursor(null); setPreviousCursors([]); }
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
  const startEdit = (count: InventoryCount) => { if (dirty && !window.confirm("تغییرات شمارش ذخیره نشده است. شمارش دیگری را باز می‌کنید؟")) return; setDirty(false); setItemSearch(""); requestAnimationFrame(() => countFormRef.current?.querySelector<HTMLInputElement>("[data-inventory-number]")?.focus()); setEditingCount(count); setReason(count.reason ?? ""); setDraftLines(count.lines.map((line) => ({ stockItemId: line.stockItemId, expectedQuantity: line.expectedQuantity ?? "0", observedQuantity: line.observedQuantity, observedValueAmount: String(line.observedValueAmount) }))); };
  const resetCountDraft = () => { setDirty(false); setEditingCount(null); setItemSearch(""); setReason(""); setDraftLines(null); };
  const submit = async (event: FormEvent) => { event.preventDefault(); const countLines = lines.map((line) => ({ stockItemId: line.stockItemId, observedQuantity: line.observedQuantity, observedValueAmount: Number(line.observedValueAmount) })); const countInput = { lines: countLines, ...(reason.trim() ? { reason: reason.trim() } : {}) }; const result = await mutateAndReload(() => editingCount ? updateInventoryCount(editingCount.id, { ...countInput, expectedVersion: editingCount.version }) : createInventoryCount({ ...countInput, kind: "PHYSICAL" })); if (result) resetCountDraft(); };
  return <div className="manager-grid">
    <ManagerCard title="شمارش فیزیکی موجودی" hint="مقدار و ارزش ثبت‌شده را با شمارش واقعی جایگزین کنید. اگر سفارشی هنوز از موجودی کم نشده، پیش از ثبت شمارش آن را انتخاب کنید.">
      <p className="inventory-note">مقدار واقعی و ارزش کل هر قلم را وارد کنید. برای به‌روزرسانی موجودی، پیش‌نویس را ذخیره کنید و سپس در فهرست پیش‌نویس‌ها «ثبت شمارش» را بزنید.</p>
      <form ref={countFormRef} className="manager-form inventory-count-form" onChange={() => setDirty(true)} onSubmit={(event) => void submit(event)}>
        {countOptions.length > 0 && <fieldset className="inventory-option-choices inventory-count-options">
          <legend>اقلام این شمارش</legend>
          <label className="inventory-count-search">
            <span>جست‌وجوی قلم برای شمارش</span>
            <input type="search" value={itemSearch} placeholder="نام قلم موجودی"
              onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }}
              onChange={(event) => { event.stopPropagation(); setItemSearch(event.target.value); }} />
          </label>
          <p className="inventory-cell-note" role="status">{inventoryNumber(lines.length)} قلم برای شمارش انتخاب شده است.</p>
          <div className="inventory-count-options__list">
            {matchingCountOptions.map((eligible) => <label key={eligible.stockItemId}>
              <input type="checkbox" checked={lines.some((line) => line.stockItemId === eligible.stockItemId)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setDraftLines((current) => checked ? [...(current ?? countOptions), eligible] : (current ?? countOptions).filter((line) => line.stockItemId !== eligible.stockItemId));
                }} />
              شمارش {activeItemsById.get(eligible.stockItemId)?.name}
            </label>)}
          </div>
          {matchingCountOptions.length === 0 && <p className="inventory-cell-note" role="status">قلمی با این نام پیدا نشد.</p>}
        </fieldset>}
        {orderedLines.map((line) => {
          const item = activeItemsById.get(line.stockItemId);
          const unitLabel = item ? unitLabels[item.baseUnit as Unit] : "";
          const changeLine = (patch: Partial<Pick<typeof line, "observedQuantity" | "observedValueAmount">>) =>
            setDraftLines((current) => (current ?? countOptions).map((row) => row.stockItemId === line.stockItemId ? { ...row, ...patch } : row));
          return <div className="inventory-count-line" role="group" aria-label={item?.name ?? "کالا"} key={line.stockItemId}>
            <div><strong>{item?.name ?? "کالا"}</strong><small className="inventory-cell-note">مقدار ثبت‌شده <bdi>{inventoryQuantity(item?.balance.quantityOnHand ?? line.expectedQuantity)}</bdi> {unitLabel}</small></div>
            <label><span>مقدار {unitLabel}</span><InventoryNumberInput required value={line.observedQuantity} onValueChange={(observedQuantity) => changeLine({ observedQuantity })} /></label>
            <label><span>ارزش موجودی (تومان)</span><InventoryNumberInput required integer value={line.observedValueAmount} onValueChange={(observedValueAmount) => changeLine({ observedValueAmount })} /></label>
          </div>;
        })}
        {lines.length === 0 && (countOptions.length === 0 ? <InventoryEmptyState title="هنوز کالایی آماده‌ی شمارش نیست" detail="ابتدا مقدار و ارزش آغازین یک کالای فعال را در اقلام موجودی ثبت کنید؛ سپس آن را اینجا بشمارید." action="تکمیل موجودی آغازین" onAction={onOpenStock} /> : <p className="inventory-note">برای ثبت شمارش، حداقل یک قلم را از فهرست «اقلام این شمارش» انتخاب کنید.</p>)}
        {hasQuantityDifference && <label><span>دلیل اختلاف موجودی (برای کل شمارش)</span><textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="علت تفاوت مقدار شمارش‌شده با موجودی ثبت‌شده را بنویسید" /></label>}
        <div className="inventory-actions"><button type="submit" disabled={!lines.length || (hasQuantityDifference && !reason.trim())}>{editingCount ? "ذخیره پیش‌نویس شمارش" : "ایجاد پیش‌نویس شمارش"}</button>{editingCount && <button className="secondary-button" type="button" onClick={resetCountDraft}>انصراف از ویرایش</button>}</div>
      </form>
    </ManagerCard>
    <ManagerCard title="پیش‌نویس و شمارش‌های ثبت‌شده" hint="شمارش ثبت‌شده و اختلاف آن با موجودی قبلی در سابقه می‌ماند.">
      <form className="manager-form inventory-history-filter" onSubmit={applyFilters}>
        <div className="manager-fields">
          <label><span>جست‌وجوی کالا</span><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="نام کالا" /></label>
          <label><span>وضعیت</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">همه‌ی وضعیت‌ها</option><option value="DRAFT">پیش‌نویس</option><option value="POSTED">ثبت‌شده</option></select></label>
          <label><span>از تاریخ شمسی</span><div className="inventory-date-input"><input inputMode="numeric" aria-label="ماه و روز آغاز" dir="ltr" value={filters.fromValue} onChange={(event) => setFilters((current) => ({ ...current, fromValue: event.target.value }))} placeholder="ماه/روز" /><input inputMode="numeric" aria-label="سال شروع" value={filters.fromYear} onChange={(event) => setFilters((current) => ({ ...current, fromYear: event.target.value }))} /></div></label>
          <label><span>تا تاریخ شمسی</span><div className="inventory-date-input"><input inputMode="numeric" aria-label="ماه و روز پایان" dir="ltr" value={filters.toValue} onChange={(event) => setFilters((current) => ({ ...current, toValue: event.target.value }))} placeholder="ماه/روز" /><input inputMode="numeric" aria-label="سال پایان" value={filters.toYear} onChange={(event) => setFilters((current) => ({ ...current, toYear: event.target.value }))} /></div></label>
        </div>
        {filterError && <p className="form-error" role="alert">{filterError}</p>}
        <div className="inventory-actions"><button type="submit">اعمال فیلترها</button><button className="secondary-button" type="button" onClick={clearFilters}>پاک‌کردن فیلترها</button></div>
      </form>
      {pageError && <p className="form-error" role="alert">{pageError} <button type="button" onClick={() => setRetryVersion((current) => current + 1)}>بارگذاری دوباره</button></p>}
      {pageLoading ? <p className="manager-empty" role="status">در حال بارگذاری شمارش‌ها…</p> : !pageError && <ul className="inventory-list">{counts.map((count) => <li key={count.id}><div><strong>شمارش فیزیکی · {count.status === "POSTED" ? "ثبت‌شده" : "پیش‌نویس"}</strong><small>{new Date(count.createdAt).toLocaleString("fa-IR-u-nu-latn")}</small><small>{count.lines.map((line) => { const item = items.find((entry) => entry.id === line.stockItemId); return `${item?.name ?? "کالا"}: ${line.observedQuantity}${line.differenceQuantity === null ? "" : ` (اختلاف ${line.differenceQuantity})`}`; }).join("، ")}</small>{count.reason && <small>دلیل اختلاف: {count.reason}</small>}</div>
        {count.status === "DRAFT" && <div className="inventory-count-actions">
          <button className="secondary-button" type="button" onClick={() => startEdit(count)}>ویرایش شمارش</button>
          {count.kind === "PHYSICAL" && pending.length > 0 && <fieldset><legend>سفارش‌هایی که هنوز از موجودی کم نشده‌اند</legend>{pending.map((entry) => <label key={entry.id}><input type="checkbox" checked={reconcile.includes(entry.id)} onChange={(event) => setReconcile((current) => event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} />سفارش {entry.orderNumber} · هزینه‌ی محاسبه‌شده {formatToman(entry.knownCogsAmount)}</label>)}</fieldset>}
          <button type="button" onClick={() => { const absorbedIds = count.kind === "PHYSICAL" ? reconcile.filter((id) => pending.some((entry) => entry.id === id)) : []; const absorbed = pending.filter((entry) => absorbedIds.includes(entry.id)); confirm({ title: "بررسی ثبت شمارش", detail: count.kind === "OPENING" ? "با ثبت موجودی آغازین، مقدار و ارزش این کالاها مبنای موجودی می‌شود." : "با ثبت شمارش فیزیکی، مقدار و ارزش ثبت‌شده با مقدار مشاهده‌شده جایگزین می‌شود.", summary: [...count.lines.map((line) => { const item = items.find((entry) => entry.id === line.stockItemId); return `${item?.name ?? "کالا"}: ${line.observedQuantity} ${unitLabels[(item?.baseUnit ?? "PIECE") as Unit]}، ارزش ${formatToman(line.observedValueAmount)}${line.differenceQuantity === null ? "" : `، اختلاف ${line.differenceQuantity}`}`; }), ...(count.kind === "PHYSICAL" ? [absorbed.length ? `سفارش‌های در انتظار کسر که در این شمارش لحاظ می‌شوند: ${absorbed.map((entry) => entry.orderNumber).join("، ")}` : "هیچ سفارش در انتظار کسر در این شمارش انتخاب نشده است."] : [])], actionLabel: "ثبت شمارش در موجودی", run: () => { const key = `count:post:${count.id}`; return mutateAndReload(async () => { const result = await postInventoryCount(count.id, { expectedVersion: count.version, absorbedOrderConsumptionIds: absorbedIds }, keyFor(key)); if (result.ok) { clearKey(key); setReconcile([]); } return result; }); } }); }}>ثبت شمارش</button>
        </div>}
      </li>)}</ul>}
      {!pageLoading && !pageError && counts.length === 0 && <InventoryEmptyState title={hasFilters ? "شمارشی با این فیلترها پیدا نشد." : "هنوز شمارش فیزیکی ثبت نشده است"} detail={hasFilters ? "فیلترها را پاک کنید تا پیش‌نویس‌ها و شمارش‌های ثبت‌شده را ببینید." : "کالاهای شمرده‌شده را در فرم انتخاب کنید و مقدار واقعی را وارد کنید. پیش‌نویس پس از ذخیره در این فهرست می‌آید."} action={hasFilters ? "نمایش همه‌ی شمارش‌ها" : "شروع شمارش"} onAction={() => { if (hasFilters) clearFilters(); else countFormRef.current?.querySelector<HTMLInputElement | HTMLButtonElement>("input, button")?.focus(); }} />}
      <div className="inventory-actions inventory-history-pagination"><button className="secondary-button" type="button" disabled={pageLoading || !!pageError || previousCursors.length === 0} onClick={() => { const previous = previousCursors[previousCursors.length - 1] ?? null; setPreviousCursors((current) => current.slice(0, -1)); setCursor(previous); }}>صفحه‌ی قبل</button><span>صفحه‌ی {previousCursors.length + 1}</span><button className="secondary-button" type="button" disabled={pageLoading || !!pageError || !page.hasMore || !page.nextCursor} onClick={() => { if (!page.nextCursor) return; setPreviousCursors((current) => [...current, cursor]); setCursor(page.nextCursor); }}>صفحه‌ی بعد</button></div>
    </ManagerCard>
  </div>;
}

function HistoryPanel({ pending, items, refreshVersion }: { pending: PendingInventoryConsumption[]; items: InventoryStockItem[]; refreshVersion: number }) {
  const inventoryItemsById = new Map(items.map((item) => [item.id, item]));
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
    setApplied({
      searchBy: filters.searchBy,
      search: filters.searchBy === "KIND" ? "" : filters.searchBy === "ORDER_NUMBER" ? normalizeDigits(filters.search.trim()).replace(/^#/, "") : filters.search.trim(),
      kind: filters.searchBy === "KIND" ? filters.kind : "",
      from: from ? tehranDayBoundary(from) : "",
      to: to ? tehranDayBoundary(to, true) : "",
    });
  };
  const clearFilters = () => {
    const empty = { searchBy: "PRODUCT" as const, search: "", kind: "", fromYear: currentPersianDate.year, fromValue: "", toYear: currentPersianDate.year, toValue: "" };
    setFilters(empty);
    setApplied({ searchBy: "PRODUCT", search: "", kind: "", from: "", to: "" });
    setFilterError(null);
    setCursor(null);
    setPreviousCursors([]);
  };

  const hasFilters = !!(applied.search || applied.kind || applied.from || applied.to || cursor);
  return <div className="manager-grid">
    <ManagerCard title="گردش موجودی" hint="شماره‌ی سفارش در تغییرهای ناشی از سفارش نمایش داده می‌شود. جست‌وجو را بر اساس کالا، شماره‌ی سفارش یا نوع تغییر انتخاب کنید.">
      <form className="manager-form inventory-history-filter" onSubmit={applyFilters}>
        <div className="manager-fields">
          <label><span>جست‌وجو بر اساس</span><select value={filters.searchBy} onChange={(event) => setFilters((current) => ({ ...current, searchBy: event.target.value as typeof current.searchBy, search: "", kind: "" }))}><option value="PRODUCT">نام کالا</option><option value="ORDER_NUMBER">شماره‌ی سفارش</option><option value="KIND">نوع تغییر</option></select></label>
          {filters.searchBy === "KIND" ? <label><span>نوع تغییر</span><select value={filters.kind} onChange={(event) => setFilters((current) => ({ ...current, kind: event.target.value }))}><option value="">همه‌ی انواع تغییر</option>{Object.entries(movementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <label><span>{filters.searchBy === "ORDER_NUMBER" ? "شماره‌ی سفارش" : "نام کالا"}</span><input type="search" inputMode={filters.searchBy === "ORDER_NUMBER" ? "numeric" : "search"} value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder={filters.searchBy === "ORDER_NUMBER" ? "مثلاً ۱۲۳۴" : "نام کالا"} /></label>}
          <label><span>از تاریخ شمسی</span><div className="inventory-date-input"><input inputMode="numeric" aria-label="ماه و روز آغاز" dir="ltr" value={filters.fromValue} onChange={(event) => setFilters((current) => ({ ...current, fromValue: event.target.value }))} placeholder="ماه/روز" /><input inputMode="numeric" aria-label="سال شروع" value={filters.fromYear} onChange={(event) => setFilters((current) => ({ ...current, fromYear: event.target.value }))} /></div></label>
          <label><span>تا تاریخ شمسی</span><div className="inventory-date-input"><input inputMode="numeric" aria-label="ماه و روز پایان" dir="ltr" value={filters.toValue} onChange={(event) => setFilters((current) => ({ ...current, toValue: event.target.value }))} placeholder="ماه/روز" /><input inputMode="numeric" aria-label="سال پایان" value={filters.toYear} onChange={(event) => setFilters((current) => ({ ...current, toYear: event.target.value }))} /></div></label>
        </div>
        {filterError && <p className="form-error" role="alert">{filterError}</p>}
        <div className="inventory-actions"><button type="submit">اعمال فیلترها</button><button className="secondary-button" type="button" onClick={clearFilters}>پاک‌کردن فیلترها</button></div>
      </form>
      {error && <p className="form-error" role="alert">{error} <button type="button" disabled={loading} onClick={() => setRetryVersion((current) => current + 1)}>بارگذاری دوباره</button></p>}
      <p className="inventory-table-hint">برای دیدن همه‌ی ستون‌ها، جدول را به طرفین بکشید.</p>
      <div className="inventory-table-wrap" role="region" aria-label="جدول گردش موجودی" tabIndex={0} aria-busy={loading}>
        <table className="inventory-table">
          <thead><tr><th scope="col">زمان تغییر</th><th scope="col">کالا</th><th scope="col">شماره‌ی سفارش</th><th scope="col">نوع تغییر</th><th scope="col">مقدار</th><th scope="col">تغییر ارزش موجودی (تومان)</th></tr></thead>
          <tbody>
            {!loading && !error && movements.map((movement) => {
              const item = inventoryItemsById.get(movement.stockItemId);
              return <tr key={movement.id}>
                <td>{new Date(movement.occurredAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran", dateStyle: "short", timeStyle: "short" })}</td>
                <td>{item?.name ?? "قلم بایگانی‌شده"}</td>
                <td>{movement.orderNumber ? <bdi>#{movement.orderNumber}</bdi> : "—"}</td>
                <td>{movementLabels[movement.kind] ?? movement.kind}</td>
                <td><bdi>{inventoryQuantity(movement.quantityDelta)}</bdi> {item ? unitLabels[item.baseUnit as Unit] : ""}</td>
                <td><bdi>{movement.valueDeltaAmount < 0 ? "−" : ""}{inventoryNumber(formatToman(Math.abs(movement.valueDeltaAmount)))}</bdi></td>
              </tr>;
            })}
            {loading && <tr><td colSpan={6}><span role="status">در حال بارگذاری گردش موجودی…</span></td></tr>}
          </tbody>
        </table>
      </div>
      {!loading && !error && movements.length === 0 && <InventoryEmptyState title={hasFilters ? "تغییری با این فیلترها پیدا نشد." : "هنوز گردشی ثبت نشده است"} detail={hasFilters ? "جست‌وجو یا بازه‌ی زمانی را تغییر دهید، یا فیلترها را پاک کنید." : "ثبت موجودی آغازین، رسید خرید، شمارش نهایی و مصرف سفارش‌ها در این جدول سابقه ایجاد می‌کند. پیش‌نویس‌ها تغییری در موجودی نمی‌دهند."} {...(hasFilters ? { action: "نمایش همه‌ی گردش‌ها", onAction: clearFilters } : {})} />}
      <div className="inventory-actions inventory-history-pagination"><button className="secondary-button" type="button" disabled={loading || !!error || previousCursors.length === 0} onClick={() => { const previous = previousCursors[previousCursors.length - 1] ?? null; setPreviousCursors((current) => current.slice(0, -1)); setCursor(previous); }}>صفحه‌ی قبل</button><span>صفحه‌ی {previousCursors.length + 1}</span><button className="secondary-button" type="button" disabled={loading || !!error || !page.hasMore || !page.nextCursor} onClick={() => { if (!page.nextCursor) return; setPreviousCursors((current) => [...current, cursor]); setCursor(page.nextCursor); }}>صفحه‌ی بعد</button></div>
    </ManagerCard>
    <ManagerCard title="سفارش‌های در انتظار کسر از موجودی" hint="هزینه‌ی سفارش تسویه‌شده فقط وقتی از موجودی کم می‌شود که همه‌ی مواد لازم موجود باشند.">
      <ul className="inventory-list">{pending.map((entry) => <li key={entry.id}><div><strong>سفارش #{entry.orderNumber}</strong><small>ثبت در {new Date(entry.recognizedAt).toLocaleString("fa-IR-u-nu-latn")} · هزینه‌ی محاسبه‌شده {formatToman(entry.knownCogsAmount)}</small><small>{entry.isCostComplete ? "هزینه‌ی مواد کامل محاسبه شده است" : "هزینه‌ی مواد به‌طور کامل محاسبه نشده است"} · اقلام ناموجود: {entry.missingStockItemIds.length}</small></div></li>)}{pending.length === 0 && <li>سفارشی در انتظار کسر از موجودی نیست.</li>}</ul>
    </ManagerCard>
  </div>;
}

function ManagerCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <section className="manager-card"><header><h2>{title}</h2><p>{hint}</p></header>{children}</section>;
}
