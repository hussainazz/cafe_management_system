"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CreatePricingExperimentRequest, PricingScenarioRequest } from "@cafe/contracts";
import {
  createPricingExperiment,
  readPricingExperiments,
  readPricingExperimentReport,
  simulatePricingScenario,
  type ManagerCatalog,
  type PricingExperimentReport,
  type PricingScenarioReport,
} from "../lib/api-client";
import { currentPersianDateInput, persianDateToGregorianDate } from "../lib/tehran-date";
import { formatToman } from "../lib/pos-utils";
import { inventoryErrorMessage } from "../lib/inventory-errors";
import { inventoryNumber } from "./inventory-dashboard";
import { pricingExperimentCsv } from "./pricing-experiment-csv";

type ExperimentList = Awaited<ReturnType<typeof readPricingExperiments>>;
type Experiment = Extract<ExperimentList, { ok: true }> extends { data: infer Data } ? Data extends { data: { experiments: Array<infer Row> } } ? Row : never : never;
type TargetKind = "PRODUCT" | "OPTION" | "PACKAGING";
type TargetDraft = { targetKind: TargetKind; productId: string; optionId: string; previousPriceAmount: string; proposedPriceAmount: string };
type ScenarioKind = "PRODUCT" | "CATEGORY" | "OPTION" | "PACKAGING";
type ScenarioDraft = { targetKind: ScenarioKind; productId: string; categoryId: string; optionId: string; adjustmentAmount: string };
type PersianDate = { year: string; value: string };

const money = (value: number | null) => value === null ? "محاسبه نشده" : `${inventoryNumber(formatToman(value))} تومان`;
const percent = (value: string | null) => value === null ? "محاسبه نشده" : `${inventoryNumber(value)}٪`;
const signed = (value: number | null) => value === null ? "محاسبه نشده" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;
const dayNames = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const outcomeLabels = { IMPROVED: "مشارکت مشاهده‌شده افزایش یافته", DECLINED: "مشارکت مشاهده‌شده کاهش یافته", INCONCLUSIVE: "نتیجه نامشخص" } as const;
const outcomeClass = { IMPROVED: "is-positive", DECLINED: "is-negative", INCONCLUSIVE: "is-neutral" } as const;
const historyLabel = { MATCHED: "تطبیق‌شده", MISSING: "تاریخچه پیدا نشد", MISMATCHED: "مقادیر یا زمان تطبیق ندارند", AMBIGUOUS: "چند رویداد منطبق" } as const;

function shiftedPersianDate(days: number): PersianDate {
  return currentPersianDateInput(new Date(Date.now() + days * 86_400_000));
}
function fromPersianDate(value: PersianDate) { return persianDateToGregorianDate(value.year, value.value); }
function tehranDateTime(date: PersianDate, time: string) {
  const gregorian = fromPersianDate(date);
  return gregorian ? new Date(`${gregorian}T${time}:00+03:30`).toISOString() : null;
}
function optionsForProduct(catalog: ManagerCatalog, productId: string) {
  const product = catalog.products.find((row) => row.id === productId);
  const optionNames = new Map(catalog.optionGroups.flatMap((group) => group.options.map((option) => [option.id, option.name] as const)));
  return product?.optionGroups.flatMap((group) => group.options.map((option) => ({ id: option.optionId, name: optionNames.get(option.optionId) ?? "گزینه‌ی نامشخص" }))) ?? [];
}
function defaultTarget(catalog: ManagerCatalog): TargetDraft {
  const product = catalog.products.find((row) => row.systemKey !== "PACKING" && row.archivedAt === null);
  return { targetKind: "PRODUCT", productId: product?.id ?? "", optionId: "", previousPriceAmount: "", proposedPriceAmount: "" };
}
function defaultScenario(catalog: ManagerCatalog): ScenarioDraft {
  const product = catalog.products.find((row) => row.systemKey !== "PACKING" && row.archivedAt === null);
  const category = catalog.categories.find((row) => row.kind === "SOURCE" && row.archivedAt === null);
  return { targetKind: "PRODUCT", productId: product?.id ?? "", categoryId: category?.id ?? "", optionId: "", adjustmentAmount: "" };
}
function numberValue(value: string) { return /^-?\d+$/.test(value) ? Number(value) : null; }

function PersianDateFields({ label, date, setDate }: { label: string; date: PersianDate; setDate: (next: PersianDate) => void }) {
  return <fieldset className="pricing-date-fields"><legend>{label}</legend>
    <label><span>سال شمسی</span><input aria-label={`سال ${label}`} inputMode="numeric" value={date.year} onChange={(event) => setDate({ ...date, year: event.target.value })} /></label>
    <label><span>ماه/روز</span><input aria-label={`ماه و روز ${label}`} dir="ltr" placeholder="08/24" value={date.value} onChange={(event) => setDate({ ...date, value: event.target.value })} /></label>
  </fieldset>;
}

function TrendChart({ title, unit, points, valueOf, effectiveDate, moneyValue = false }: {
  title: string; unit: string; points: PricingExperimentReport["data"]["daily"]; valueOf: (point: PricingExperimentReport["data"]["daily"][number]) => number | null;
  effectiveDate: string; moneyValue?: boolean;
}) {
  const rows = points.filter((point) => point.phase !== "EFFECTIVE_DAY");
  const values = rows.map(valueOf).filter((value): value is number => value !== null);
  const min = Math.min(0, ...values); const max = Math.max(1, ...values); const span = max - min;
  const x = (date: string) => 34 + (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${rows[0]?.date ?? date}T00:00:00Z`)) /
    Math.max(1, Date.parse(`${rows.at(-1)?.date ?? date}T00:00:00Z`) - Date.parse(`${rows[0]?.date ?? date}T00:00:00Z`)) * 596;
  const y = (value: number) => 120 - ((value - min) / span) * 88;
  const segments: string[] = []; let segment = "";
  rows.forEach((point) => {
    const value = valueOf(point);
    if (value === null) { if (segment) segments.push(segment); segment = ""; return; }
    segment += `${segment ? " L" : "M"}${x(point.date)},${y(value)}`;
  });
  if (segment) segments.push(segment);
  const tick = (value: number) => moneyValue ? inventoryNumber(formatToman(Math.round(value))) : inventoryNumber(Math.round(value));
  return <article className="manager-card pricing-trend-card">
    <h3>{title}</h3><p className="pricing-trend-unit">{unit}</p>
    <div className="pricing-trend-svg-wrap"><svg viewBox="0 0 650 160" role="img" aria-label={`روند روزانه‌ی ${title}`}>
      {[0, 0.5, 1].map((ratio) => { const value = min + span * ratio; return <g key={ratio}><line x1="34" x2="630" y1={y(value)} y2={y(value)} className="pricing-trend-grid" /><text x="28" y={y(value) + 4} textAnchor="end">{tick(value)}</text></g>; })}
      {effectiveDate >= (rows[0]?.date ?? effectiveDate) && effectiveDate <= (rows.at(-1)?.date ?? effectiveDate) && <line x1={x(effectiveDate)} x2={x(effectiveDate)} y1="18" y2="132" className="pricing-trend-marker" />}
      {segments.map((path, index) => <path key={index} d={path} fill="none" stroke={index === 0 ? "#a58cf3" : "#62cca2"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}
      {rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 5) === 0).map((point) => <text key={point.date} x={x(point.date)} y="151" textAnchor="middle">{point.date.slice(5)}</text>)}
    </svg></div>
  </article>;
}

function reportCsvDownload(report: PricingExperimentReport) {
  const blob = new Blob([pricingExperimentCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pricing-experiment-${report.data.experiment.id}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function InventoryPricingExperiments({ catalog }: { catalog: ManagerCatalog }) {
  const products = useMemo(() => catalog.products.filter((product) => product.archivedAt === null), [catalog.products]);
  const menuProducts = products.filter((product) => product.systemKey !== "PACKING");
  const packagingProducts = products.filter((product) => product.systemKey === "PACKING");
  const packagingLabel = (product: ManagerCatalog["products"][number]) => `${catalog.categories.find((category) => category.id === product.categoryId)?.name ?? "دسته‌بندی نامشخص"} · ${product.name}`;
  const sourceCategories = catalog.categories.filter((category) => category.kind === "SOURCE" && category.archivedAt === null);
  const initialDate = currentPersianDateInput();
  const thirtyDaysAgo = shiftedPersianDate(-29);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [comparisonDays, setComparisonDays] = useState("14");
  const [customComparisonDays, setCustomComparisonDays] = useState("14");
  const [report, setReport] = useState<PricingExperimentReport | null>(null);
  const [reportRefresh, setReportRefresh] = useState(0);
  const [targetRows, setTargetRows] = useState<TargetDraft[]>([defaultTarget(catalog)]);
  const [experimentDate, setExperimentDate] = useState(initialDate);
  const [experimentTime, setExperimentTime] = useState("08:00");
  const [expectedDays, setExpectedDays] = useState("14");
  const [experimentComparisonDays, setExperimentComparisonDays] = useState("14");
  const [experimentCustomDays, setExperimentCustomDays] = useState("14");
  const [scenarioFrom, setScenarioFrom] = useState(thirtyDaysAgo);
  const [scenarioTo, setScenarioTo] = useState(() => shiftedPersianDate(-1));
  const [scenarioRows, setScenarioRows] = useState<ScenarioDraft[]>([defaultScenario(catalog)]);
  const [customVolume, setCustomVolume] = useState("");
  const [scenario, setScenario] = useState<PricingScenarioReport | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const listRequest = useRef(0); const reportRequest = useRef(0);

  const loadList = async () => {
    const id = ++listRequest.current;
    setLoadingList(true); setError(null);
    const result = await readPricingExperiments();
    if (id !== listRequest.current) return;
    if (result.ok) {
      setExperiments(result.data.data.experiments as Experiment[]);
      setSelectedId((current) => current && result.data.data.experiments.some((row) => row.id === current) ? current : result.data.data.experiments[0]?.id ?? "");
    } else setError(inventoryErrorMessage(result.error));
    setLoadingList(false);
  };
  useEffect(() => { void loadList(); return () => { listRequest.current += 1; reportRequest.current += 1; }; }, []);

  useEffect(() => {
    if (!selectedId) { setReport(null); setLoadingReport(false); return; }
    const id = ++reportRequest.current;
    setLoadingReport(true); setError(null);
    const days = comparisonDays === "custom" ? Number(customComparisonDays) : Number(comparisonDays);
    void readPricingExperimentReport(selectedId, days).then((result) => {
      if (id !== reportRequest.current) return;
      if (result.ok) setReport(result.data);
      else { setReport(null); setError(inventoryErrorMessage(result.error)); }
    }).catch(() => { if (id === reportRequest.current) { setReport(null); setError("گزارش آزمایش دریافت نشد."); } })
      .finally(() => { if (id === reportRequest.current) setLoadingReport(false); });
    return () => { reportRequest.current += 1; };
  }, [selectedId, comparisonDays, customComparisonDays, reportRefresh]);

  const addTarget = () => setTargetRows((rows) => [...rows, defaultTarget(catalog)]);
  const updateTarget = (index: number, update: Partial<TargetDraft>) => setTargetRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...update } : row));
  const createExperiment = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null);
    const effectiveAt = tehranDateTime(experimentDate, experimentTime);
    const comparison = experimentComparisonDays === "custom" ? Number(experimentCustomDays) : Number(experimentComparisonDays);
    if (!effectiveAt || !Number.isInteger(comparison) || comparison < 1 || comparison > 90) { setError("تاریخ و مدت مقایسه را بررسی کنید."); setBusy(false); return; }
    const targets = [] as CreatePricingExperimentRequest["targets"];
    for (const row of targetRows) {
      const proposed = numberValue(row.proposedPriceAmount); const previous = row.previousPriceAmount ? numberValue(row.previousPriceAmount) : null;
      if (!row.productId || proposed === null || proposed < 0 || (row.previousPriceAmount && (previous === null || previous < 0)) || (row.targetKind === "OPTION" && !row.optionId)) {
        setError("محصول، قیمت پیشنهادی و قیمت پیشینِ در دسترس را بررسی کنید. قیمت پیشین را می‌توانید خالی بگذارید."); setBusy(false); return;
      }
      targets.push({ targetKind: row.targetKind, productId: row.productId, ...(row.targetKind === "OPTION" ? { optionId: row.optionId } : {}), previousPriceAmount: previous, proposedPriceAmount: proposed });
    }
    const payload: CreatePricingExperimentRequest = {
      name: (event.currentTarget as HTMLFormElement).elements.namedItem("experiment-name") instanceof HTMLInputElement
        ? ((event.currentTarget as HTMLFormElement).elements.namedItem("experiment-name") as HTMLInputElement).value.trim() : "",
      effectiveAt, expectedEvaluationDays: Number(expectedDays), comparisonDays: comparison,
      notes: (event.currentTarget as HTMLFormElement).elements.namedItem("experiment-notes") instanceof HTMLTextAreaElement
        ? ((event.currentTarget as HTMLFormElement).elements.namedItem("experiment-notes") as HTMLTextAreaElement).value.trim() || null : null,
      targets,
    };
    if (!payload.name) { setError("نام آزمایش را وارد کنید."); setBusy(false); return; }
    const result = await createPricingExperiment(payload);
    if (result.ok) {
      setSuccess("اطلاعات آزمایش ذخیره شد. قیمت‌های منو تغییر نکردند.");
      setSelectedId(result.data.data.experiment.id);
      setComparisonDays("custom"); setCustomComparisonDays(String(comparison));
      await loadList();
    } else setError(inventoryErrorMessage(result.error));
    setBusy(false);
  };

  const runScenario = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null); setScenario(null);
    const fromDate = fromPersianDate(scenarioFrom); const toDate = fromPersianDate(scenarioTo);
    const yesterday = fromPersianDate(shiftedPersianDate(-1));
    if (!fromDate || !toDate || fromDate > toDate || !yesterday || toDate > yesterday) { setError("بازه‌ی شبیه‌سازی باید شامل روزهای کامل گذشته باشد."); setBusy(false); return; }
    const rules = [] as PricingScenarioRequest["rules"];
    for (const row of scenarioRows) {
      const delta = numberValue(row.adjustmentAmount);
      if (delta === null || Math.abs(delta) > 1_000_000 || (row.targetKind === "PRODUCT" && !row.productId) ||
        (row.targetKind === "CATEGORY" && !row.categoryId) || (row.targetKind === "OPTION" && (!row.productId || !row.optionId)) ||
        (row.targetKind === "PACKAGING" && !packagingProducts.some((product) => product.id === row.productId))) { setError("هدف و تغییر قیمت شبیه‌سازی را بررسی کنید."); setBusy(false); return; }
      rules.push({ targetKind: row.targetKind, adjustmentAmount: delta,
        ...(row.productId && row.targetKind !== "CATEGORY" ? { productId: row.productId } : {}),
        ...(row.categoryId && row.targetKind === "CATEGORY" ? { categoryId: row.categoryId } : {}),
        ...(row.optionId && row.targetKind === "OPTION" ? { optionId: row.optionId } : {}),
      });
    }
    const custom = customVolume.trim() === "" ? undefined : Number(customVolume);
    if (custom !== undefined && (!Number.isFinite(custom) || custom < -100 || custom > 100)) { setError("تغییر حجم باید بین منفی ۱۰۰ و مثبت ۱۰۰ درصد باشد."); setBusy(false); return; }
    const input: PricingScenarioRequest = { fromDate, toDate, rules, ...(custom === undefined ? {} : { customVolumeChangePercent: custom }) };
    const result = await simulatePricingScenario(input);
    if (result.ok) setScenario(result.data);
    else setError(inventoryErrorMessage(result.error));
    setBusy(false);
  };

  const selected = experiments.find((experiment) => experiment.id === selectedId);
  return <section className="inventory-pricing-experiments" aria-busy={loadingList || loadingReport || busy}>
    <header className="pricing-experiment-heading"><div><h2>آزمایش قیمت‌گذاری</h2><p>اثر تغییر قیمت را با فروش و هزینه‌ی ثبت‌شده مقایسه کنید. این گزارش آزمایشی است و قیمت‌های کاتالوگ را تغییر نمی‌دهد.</p></div>
      <button type="button" className="secondary-button" disabled={loadingList || busy} onClick={() => { setReportRefresh((value) => value + 1); void loadList(); }}>تازه‌سازی</button></header>
    {error && <p className="form-error" role="alert">{error}</p>}{success && <p className="inventory-success" role="status">{success}</p>}

    <details className="manager-card pricing-create-card"><summary>تعریف آزمایش تحلیلی</summary>
      <form className="pricing-experiment-form" onSubmit={(event) => void createExperiment(event)}>
        <label><span>نام آزمایش</span><input name="experiment-name" required maxLength={100} placeholder="برای نمونه: افزایش قیمت نوشیدنی‌ها" /></label>
        <PersianDateFields label="تاریخ مؤثر" date={experimentDate} setDate={setExperimentDate} />
        <label><span>ساعت مؤثر تهران</span><input type="time" value={experimentTime} onChange={(event) => setExperimentTime(event.target.value)} required /></label>
        <label><span>مدت ارزیابی مورد انتظار</span><select value={expectedDays} onChange={(event) => setExpectedDays(event.target.value)}><option value="7">۷ روز</option><option value="14">۱۴ روز</option><option value="30">۳۰ روز</option></select></label>
        <label><span>طول دوره‌ی مقایسه</span><select value={experimentComparisonDays} onChange={(event) => setExperimentComparisonDays(event.target.value)}><option value="7">۷ روز</option><option value="14">۱۴ روز</option><option value="30">۳۰ روز</option><option value="custom">سفارشی</option></select></label>
        {experimentComparisonDays === "custom" && <label><span>روزهای هر دوره</span><input type="number" min="1" max="90" value={experimentCustomDays} onChange={(event) => setExperimentCustomDays(event.target.value)} /></label>}
        <label className="pricing-notes-field"><span>یادداشت مدیر</span><textarea name="experiment-notes" maxLength={1000} rows={2} /></label>
        <div className="pricing-target-list"><div className="pricing-subheading"><h3>محصول‌ها، گزینه‌ها و هزینه‌ی بسته‌بندی</h3><button type="button" className="text-button" onClick={addTarget}>افزودن هدف</button></div>
          {targetRows.map((row, index) => <div className="pricing-target-row" key={index}>
            <label><span>نوع هدف</span><select value={row.targetKind} onChange={(event) => {
              const kind = event.target.value as TargetKind;
              const nextProduct = kind === "PACKAGING" ? packagingProducts[0]?.id ?? "" : menuProducts[0]?.id ?? "";
              updateTarget(index, { targetKind: kind, productId: nextProduct, optionId: "" });
            }}><option value="PRODUCT">محصول</option><option value="OPTION">محصول و گزینه</option><option value="PACKAGING">هزینه‌ی بسته‌بندی</option></select></label>
            {row.targetKind === "PACKAGING" ? <label><span>قلم بسته‌بندی</span><select value={row.productId} onChange={(event) => updateTarget(index, { productId: event.target.value })} disabled={!packagingProducts.length}><option value="">قلم بسته‌بندی در کاتالوگ نیست</option>{packagingProducts.map((product) => <option key={product.id} value={product.id}>{packagingLabel(product)}</option>)}</select></label>
              : <label><span>محصول</span><select value={row.productId} onChange={(event) => updateTarget(index, { productId: event.target.value, optionId: "" })}><option value="">انتخاب کنید</option>{menuProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>}
            {row.targetKind === "OPTION" && <label><span>گزینه</span><select value={row.optionId} onChange={(event) => updateTarget(index, { optionId: event.target.value })}><option value="">انتخاب کنید</option>{optionsForProduct(catalog, row.productId).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
            <label><span>قیمت پیشین، اگر معلوم است (تومان)</span><input inputMode="numeric" value={row.previousPriceAmount} onChange={(event) => updateTarget(index, { previousPriceAmount: event.target.value })} placeholder="خالی بگذارید تا نامشخص بماند" /></label>
            <label><span>قیمت پیشنهادی (تومان)</span><input required inputMode="numeric" value={row.proposedPriceAmount} onChange={(event) => updateTarget(index, { proposedPriceAmount: event.target.value })} /></label>
            {targetRows.length > 1 && <button type="button" className="text-button pricing-remove-target" onClick={() => setTargetRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>حذف هدف</button>}
          </div>)}
        </div>
        <p className="inventory-note">قیمت پیشین فقط از ورودی شما یا تاریخچه‌ی قیمت ثبت‌شده می‌آید. آزمایش، قیمت محصول یا گزینه را در منو تغییر نمی‌دهد.</p>
        <button type="submit" className="primary-button" disabled={busy || !menuProducts.length}>ذخیره‌ی اطلاعات آزمایش</button>
      </form>
    </details>

    <section className="manager-card pricing-experiment-selector" aria-label="انتخاب آزمایش">
      <label><span>آزمایش ثبت‌شده</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={loadingList || experiments.length === 0}>
        <option value="">{loadingList ? "در حال دریافت…" : "آزمایشی ثبت نشده است"}</option>{experiments.map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.name} · {new Date(experiment.effectiveAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}</option>)}
      </select></label>
      <label><span>طول هر دوره‌ی مقایسه</span><select value={comparisonDays} onChange={(event) => setComparisonDays(event.target.value)}><option value="7">۷ روز</option><option value="14">۱۴ روز</option><option value="30">۳۰ روز</option><option value="custom">سفارشی</option></select></label>
      {comparisonDays === "custom" && <label><span>روزهای سفارشی</span><input type="number" min="1" max="90" value={customComparisonDays} onChange={(event) => setCustomComparisonDays(event.target.value)} /></label>}
      {selected && <p className="pricing-effective-note">زمان مؤثر آزمایش: {new Date(selected.effectiveAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })} · روز مؤثر از مقایسه حذف می‌شود.</p>}
    </section>

    {loadingReport && <p className="inventory-loading" role="status">در حال محاسبه‌ی دوره‌های قابل مقایسه…</p>}
    {!loadingReport && report && <PricingExperimentDashboard report={report} onExport={() => reportCsvDownload(report)} />}

    <details className="manager-card pricing-scenario-card"><summary>شبیه‌سازی قیمت و حساسیت حجم</summary>
      <p className="inventory-note">تغییر قیمت در این فرم فقط روی داده‌ی دوره‌ی مبنا محاسبه می‌شود. مدل، قیمت تحقق‌یافته را به‌اندازه‌ی تغییر کاتالوگ جابه‌جا می‌کند و هزینه‌ی مواد را ثابت می‌گیرد.</p>
      <form className="pricing-scenario-form" onSubmit={(event) => void runScenario(event)}>
        <PersianDateFields label="از تاریخ مبنا" date={scenarioFrom} setDate={setScenarioFrom} />
        <PersianDateFields label="تا تاریخ مبنا" date={scenarioTo} setDate={setScenarioTo} />
        <label><span>افت یا افزایش سفارشی حجم (%)</span><input type="number" min="-100" max="100" step="0.1" placeholder="اختیاری" value={customVolume} onChange={(event) => setCustomVolume(event.target.value)} /></label>
        {scenarioRows.map((row, index) => <div className="pricing-scenario-row" key={index}>
          <label><span>نوع سیاست</span><select value={row.targetKind} onChange={(event) => setScenarioRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, targetKind: event.target.value as ScenarioKind, productId: event.target.value === "PACKAGING" ? packagingProducts[0]?.id ?? "" : menuProducts[0]?.id ?? "", optionId: "" } : item))}>
            <option value="PRODUCT">یک محصول</option><option value="CATEGORY">همه‌ی محصولات یک دسته</option><option value="OPTION">یک گزینه در محصول</option><option value="PACKAGING">هزینه‌ی بسته‌بندی</option>
          </select></label>
          {row.targetKind === "CATEGORY" ? <label><span>دسته‌ی منبع</span><select value={row.categoryId} onChange={(event) => setScenarioRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, categoryId: event.target.value } : item))}><option value="">انتخاب کنید</option>{sourceCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            : row.targetKind === "PACKAGING" ? <label><span>قلم بسته‌بندی</span><select value={row.productId} onChange={(event) => setScenarioRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, productId: event.target.value } : item))} disabled={!packagingProducts.length}><option value="">انتخاب کنید</option>{packagingProducts.map((product) => <option key={product.id} value={product.id}>{packagingLabel(product)}</option>)}</select></label>
              : <label><span>محصول</span><select value={row.productId} onChange={(event) => setScenarioRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, productId: event.target.value, optionId: "" } : item))}><option value="">انتخاب کنید</option>{menuProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>}
          {row.targetKind === "OPTION" && <label><span>گزینه</span><select value={row.optionId} onChange={(event) => setScenarioRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, optionId: event.target.value } : item))}><option value="">انتخاب کنید</option>{optionsForProduct(catalog, row.productId).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
          <label><span>تغییر قیمت هر واحد (تومان)</span><input required inputMode="numeric" value={row.adjustmentAmount} onChange={(event) => setScenarioRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, adjustmentAmount: event.target.value } : item))} placeholder="مثبت برای افزایش" /></label>
          {scenarioRows.length > 1 && <button type="button" className="text-button" onClick={() => setScenarioRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>حذف سیاست</button>}
        </div>)}
        <div className="pricing-scenario-actions"><button type="button" className="secondary-button" onClick={() => setScenarioRows((current) => [...current, defaultScenario(catalog)])}>افزودن سیاست</button><button type="submit" className="primary-button" disabled={busy}>محاسبه‌ی سناریو</button></div>
      </form>
      {scenario && <ScenarioResults scenario={scenario} />}
    </details>
  </section>;
}

function PricingExperimentDashboard({ report, onExport }: { report: PricingExperimentReport; onExport: () => void }) {
  const data = report.data; const changes = data.changes;
  const period = data.periods;
  const cards = [
    { label: "تغییر مشارکت معادل ماهانه", value: signed(changes.totalContributionAmount), detail: percent(changes.totalContributionPercent) },
    { label: "تغییر فروش خالص", value: signed(changes.netRevenueAmount), detail: percent(changes.netRevenuePercent) },
    { label: "تغییر واحدهای مشمول", value: `${changes.affectedQuantity > 0 ? "+" : ""}${inventoryNumber(changes.affectedQuantity)} واحد`, detail: percent(changes.affectedQuantityPercent) },
    { label: "تغییر میانگین مبلغ سفارش", value: signed(changes.averageOrderValueAmount), detail: percent(changes.averageOrderValuePercent) },
    { label: "تغییر کسری بسته‌بندی", value: signed(changes.packagingDeficitAmount), detail: percent(changes.packagingDeficitPercent) },
    { label: "تغییر پوشش هزینه‌ی ثابت", value: changes.fixedCostCoveragePercent === null ? "محاسبه نشده" : `${inventoryNumber(changes.fixedCostCoveragePercent)} واحد درصد`, detail: `پیش ${percent(period.before.fixedCostCoveragePercent)} · پس ${percent(period.after.fixedCostCoveragePercent)}` },
    { label: "تغییر حاشیه‌ی ایمنی", value: signed(changes.marginOfSafetyAmount), detail: changes.marginOfSafetyPercent === null ? "درصد محاسبه نشده" : `${inventoryNumber(changes.marginOfSafetyPercent)} واحد درصد` },
  ];
  return <div className="pricing-experiment-dashboard">
    <div className={`pricing-assessment ${outcomeClass[data.assessment.outcome]}`}><div><span className="pricing-status-chip">{data.status === "IN_PROGRESS" ? "در حال ارزیابی" : data.status === "READY" ? "داده‌ها آماده‌اند" : "نیازمند داده‌ی بیشتر"}</span><h2>{outcomeLabels[data.assessment.outcome]}</h2><p>{data.assessment.summaryFa}</p></div><button type="button" className="secondary-button" onClick={onExport}>دریافت گزارش CSV</button></div>
    <div className="pricing-period-summary"><span>پیش از تغییر: {period.before.fromDate ?? "—"} تا {period.before.toDate ?? "—"} · {inventoryNumber(period.before.includedDayCount)} روز هم‌روزِ هفته</span><span>پس از تغییر: {period.after.fromDate ?? "—"} تا {period.after.toDate ?? "—"} · {inventoryNumber(period.after.includedDayCount)} روز هم‌روزِ هفته</span><span>هزینه‌ی ثابت ماهانه: ۲۶۵٬۰۰۰٬۰۰۰ تومان · معادل ماه: ۳۰ روز</span></div>
    {!period.weekdayCompositionMatched && <p className="pricing-alert" role="status">ترکیب روزهای هفته میان دو نمونه برابر نیست؛ در بازه‌های کوتاه ممکن است روز همتا وجود نداشته باشد. این تفاوت را هنگام مقایسه در نظر بگیرید.</p>}
    <section className="pricing-kpis" aria-label="شاخص‌های کلیدی آزمایش">{cards.map((card) => <article className="manager-card pricing-kpi" key={card.label}><h3>{card.label}</h3><strong>{card.value}</strong><small>{card.detail}</small></article>)}</section>

    <section className="pricing-section"><header><h2>روند روزانه</h2><p>مقیاس هر نمودار جداست. خط‌چین محل تاریخ مؤثر را نشان می‌دهد؛ همان روز از جمع‌های پیش و پس کنار گذاشته شده است.</p></header>
      <div className="pricing-trends">
        <TrendChart title="تعداد سفارش" unit="سفارش در روز" points={data.daily} valueOf={(row) => row.orderCount} effectiveDate={data.experiment.effectiveAt.slice(0, 10)} />
        <TrendChart title="تعداد واحد کالا" unit="واحد در روز" points={data.daily} valueOf={(row) => row.itemUnits} effectiveDate={data.experiment.effectiveAt.slice(0, 10)} />
        <TrendChart title="فروش خالص" unit="تومان در روز" points={data.daily} valueOf={(row) => row.netRevenueAmount} effectiveDate={data.experiment.effectiveAt.slice(0, 10)} moneyValue />
        <TrendChart title="مشارکت" unit="تومان در روز، با بهای کامل" points={data.daily} valueOf={(row) => row.contributionAmount} effectiveDate={data.experiment.effectiveAt.slice(0, 10)} moneyValue />
        <TrendChart title="حاشیه‌ی مشارکت" unit="درصد روزانه، با بهای کامل" points={data.daily} valueOf={(row) => row.contributionMarginPercent === null ? null : Number(row.contributionMarginPercent)} effectiveDate={data.experiment.effectiveAt.slice(0, 10)} />
      </div>
    </section>

    <section className="pricing-section"><header><h2>دوره‌های پیش و پس</h2><p>تعداد سفارش از سفارش‌های کامل پرداخت‌شده و غیرپرسنلی می‌آید. قیمت تحقق‌یافته از تخصیص پرداخت و snapshot تاریخی محاسبه شده است.</p></header>
      <div className="pricing-period-grid">{(["before", "after"] as const).map((key) => { const row = period[key]; const label = key === "before" ? "پیش از تغییر" : "پس از تغییر"; return <article className="manager-card pricing-period-card" key={key}><h3>{label}</h3><dl>
        <div><dt>سفارش معتبر</dt><dd>{inventoryNumber(row.orderCount)}</dd></div><div><dt>واحد کالای مشمول</dt><dd>{inventoryNumber(row.affectedItemUnits)}</dd></div>
        <div><dt>فروش خالص</dt><dd>{money(row.netRevenueAmount)}</dd></div><div><dt>میانگین فروش هر واحد</dt><dd>{money(row.averageSellingPriceAmount)}</dd></div>
        <div><dt>میانگین مبلغ سفارش</dt><dd>{money(row.averageOrderValueAmount)}</dd></div><div><dt>بهای معلوم کالا</dt><dd>{money(row.ingredientCogsAmount)}</dd></div>
        <div><dt>درآمد دارای بهای کامل</dt><dd>{money(row.completeCostRevenueAmount)}</dd></div><div><dt>درآمد دارای بهای ناقص</dt><dd>{money(row.incompleteCostRevenueAmount)}</dd></div>
        <div><dt>مشارکت کل</dt><dd>{money(row.contributionAmount)}</dd></div><div><dt>حاشیه‌ی مشارکت</dt><dd>{percent(row.contributionMarginPercent)}</dd></div>
        <div><dt>هزینه‌ی متغیر</dt><dd>{money(row.variableCostAmount)}</dd></div><div><dt>پوشش هزینه</dt><dd>{percent(row.costCoveragePercent)}</dd></div>
        <div><dt>مشارکت معادل ۳۰ روز</dt><dd>{money(row.monthlyEquivalentContributionAmount)}</dd></div><div><dt>پوشش هزینه‌ی ثابت</dt><dd>{percent(row.fixedCostCoveragePercent)}</dd></div>
        <div><dt>مازاد/کسری شرطی پس از هزینه‌ی ثابت</dt><dd>{money(row.operatingSurplusAmount)}</dd></div><div><dt>نقطه‌ی سربه‌سر درآمد ماهانه</dt><dd>{money(row.breakEvenRevenueAmount)}</dd></div>
        <div><dt>سهم سفارش بیرون‌بر</dt><dd>{percent(row.takeawayMixPercent)}</dd></div><div><dt>تخفیف ثبت‌شده</dt><dd>{money(row.orderDiscountAmount + row.itemDiscountAmount)}</dd></div>
      </dl><p className="pricing-note">{row.variableCostAmount === null ? "هزینه‌ی متغیر ناقص است؛ مازاد عملیاتی و مشارکت کامل محاسبه نمی‌شود." : "مازاد پس از هزینه‌ی ثابت بر پایه‌ی فرض ثابت‌ماندن هزینه‌های ماهانه محاسبه شده و سود پس از مالیات نیست."}</p></article>; })}</div>
    </section>

    <section className="pricing-section"><header><h2>اثر محصول و گزینه</h2><p>گزینه‌ها برای هر واحد محصول نمایش داده می‌شوند. ترکیب فروش تجمیعی است و شناسه‌ی مشتری در این گزارش وجود ندارد؛ جابه‌جایی سهم محصول به‌تنهایی رفتار افراد را ثابت نمی‌کند.</p></header>
      <div className="inventory-table-wrap" role="region" aria-label="جدول اثر قیمت بر محصول و گزینه" tabIndex={0}><table className="inventory-table pricing-impact-table"><thead><tr><th>محصول، گزینه و کانال</th><th>قیمت پیشین / آزمایش / فعلی</th><th>میانگین تحقق‌یافته پیش / پس</th><th>تعداد پیش / پس · سهم واحد</th><th>درآمد پیش / پس · سهم فروش</th><th>هزینه‌ی هر واحد پیش / پس</th><th>مشارکت پیش / پس</th><th>تغییر مشارکت</th><th>پوشش هزینه</th></tr></thead><tbody>
        {data.products.map((row, index) => <tr key={`${row.productId}:${row.channel}:${row.options.map((option) => `${option.optionId}=${option.quantity}`).join("-")}:${index}`}>
          <th>{row.productName}<small>{row.categoryName ?? "دسته‌بندی نامشخص"} · {row.channel === "TABLE" ? "داخل کافه" : row.channel === "TAKEAWAY" ? "بیرون‌بر" : "کانال نامشخص"}</small><small>{row.options.map((option) => `${option.optionName}${option.quantity !== 1 ? ` × ${option.quantity.toLocaleString("fa-IR", { maximumFractionDigits: 3 })}` : ""}`).join("، ") || "بدون گزینه"}{row.affected ? " · مشمول آزمایش" : " · گروه مقایسه"}</small></th>
          <td>{money(row.previousPriceAmount)}<small>{money(row.experimentPriceAmount)}</small><small>{money(row.currentCatalogPriceAmount)}</small></td>
          <td>{money(row.averageRealizedPriceBeforeAmount)}<small>{money(row.averageRealizedPriceAfterAmount)}</small></td>
          <td>{inventoryNumber(row.quantityBefore)}<small>{inventoryNumber(row.quantityAfter)} · {percent(row.quantityChangePercent)}</small><small>سهم واحد: {percent(row.unitShareBeforePercent)} ← {percent(row.unitShareAfterPercent)}</small></td>
          <td>{money(row.revenueBeforeAmount)}<small>{money(row.revenueAfterAmount)}</small><small>سهم فروش: {percent(row.revenueShareBeforePercent)} ← {percent(row.revenueShareAfterPercent)}</small></td>
          <td>{money(row.unitCostBeforeAmount)}<small>{money(row.unitCostAfterAmount)}</small></td>
          <td>{money(row.contributionBeforeAmount)}<small>{money(row.contributionAfterAmount)}</small></td>
          <td>{signed(row.contributionChangeAmount)}</td><td>{percent(row.costCoveragePercent)}</td>
        </tr>)}{data.products.length === 0 && <tr><td colSpan={9} className="inventory-empty">در این دوره فروش محصولی ثبت نشده است.</td></tr>}
      </tbody></table></div>
      <div className="pricing-category-grid">{data.categories.map((row) => <article className="manager-card" key={row.categoryId ?? "unknown"}><h3>{row.categoryName}{row.affected ? " · دارای محصول مشمول" : " · گروه مقایسه"}</h3><p>سهم فروش: {percent(row.revenueShareBeforePercent)} ← {percent(row.revenueShareAfterPercent)}</p><p>درآمد: {money(row.netRevenueBeforeAmount)} ← {money(row.netRevenueAfterAmount)}</p><p>مشارکت: {money(row.contributionBeforeAmount)} ← {money(row.contributionAfterAmount)}</p></article>)}</div>
    </section>

    <section className="pricing-section"><header><h2>هزینه و بازیافت بسته‌بندی</h2><p>محاسبه‌ی بسته‌بندی از گزارش Phase 1 می‌آید؛ هزینه‌ی مواد دوباره به بهای کل افزوده نشده است.</p></header>
      <div className="pricing-period-grid">{(["before", "after"] as const).map((key) => { const row = period[key]; return <article className="manager-card pricing-period-card" key={key}><h3>{key === "before" ? "پیش از تغییر" : "پس از تغییر"}</h3><dl>
        <div><dt>دریافت بسته‌بندی</dt><dd>{money(row.packagingChargeRevenueAmount)}</dd></div><div><dt>هزینه‌ی معلوم مواد</dt><dd>{money(row.packagingMaterialCostAmount)}</dd></div>
        <div><dt>کسری بسته‌بندی</dt><dd>{money(row.packagingDeficitAmount)}</dd></div><div><dt>نرخ بازیافت</dt><dd>{percent(row.packagingRecoveryRatePercent)}</dd></div>
        <div><dt>پوشش انتساب هزینه‌ی بسته‌بندی</dt><dd>{percent(row.packagingCostCoveragePercent)}</dd></div><div><dt>ترکیب سفارش بیرون‌بر</dt><dd>{percent(row.takeawayMixPercent)}</dd></div>
      </dl><p className="pricing-note">کسری مثبت یعنی هزینه‌ی معلوم مواد از مبلغ دریافت‌شده بیشتر بوده است. هزینه‌ی صفر یا انتساب ناقص، نرخ بازیافت را نامشخص می‌کند.</p></article>; })}</div>
    </section>

    <section className="pricing-section"><header><h2>تجزیه‌ی تغییر مشارکت</h2><p>{data.decomposition.method}</p></header>
      <div className="pricing-effects">{[["اثر تحقق قیمت", data.decomposition.priceEffectAmount], ["اثر حجم کل", data.decomposition.volumeEffectAmount], ["اثر ترکیب", data.decomposition.mixEffectAmount], ["اثر هزینه‌ی واحد", data.decomposition.unitCostEffectAmount]].map(([label, value]) => <article className="manager-card" key={String(label)}><h3>{label}</h3><strong>{signed(value as number | null)}</strong></article>)}</div>
      <p className="pricing-note">تغییر مشارکت مشاهده‌شده: {signed(data.decomposition.observedContributionChangeAmount)} · باقی‌مانده: {signed(data.decomposition.residualAmount)} · {data.decomposition.reconciles ? "اجزا با جمع مشاهده‌شده سازگارند." : "به‌دلیل هزینه یا انتساب ناقص، تجزیه‌ی کامل در دسترس نیست."}</p>
      {data.decomposition.limitations.map((item) => <p className="pricing-alert" key={item}>{item}</p>)}
    </section>

    <section className="pricing-section"><header><h2>افت حجم تا رسیدن به مشارکت پیشین</h2><p>{data.breakEven.assumption}</p></header>
      <div className="inventory-table-wrap" role="region" aria-label="جدول نقطه‌ی سربه‌سر حجم" tabIndex={0}><table className="inventory-table"><thead><tr><th>محصول یا گزینه</th><th>مشارکت هر واحد پیش</th><th>مشارکت هر واحد پس</th><th>افزایش قیمت ثبت‌شده</th><th>افت حجمی قابل تحمل</th><th>تغییر مشارکت در حجم پس</th></tr></thead><tbody>
        {data.breakEven.products.map((row, index) => <tr key={`${row.productId}:${row.optionId}:${index}`}><th>{row.label}</th><td>{money(row.previousUnitContributionAmount)}</td><td>{money(row.newUnitContributionAmount)}</td><td>{money(row.priceIncreaseAmount)}</td><td>{percent(row.maximumTolerableUnitDeclinePercent)}</td><td>{money(row.contributionBenefitAtObservedVolumeAmount)}</td></tr>)}
        {data.breakEven.products.length === 0 && <tr><td colSpan={6} className="inventory-empty">برای محاسبه‌ی افت قابل تحمل، قیمت پیشین و بهای کامل هر واحد لازم است.</td></tr>}
      </tbody></table></div>
      <div className="pricing-break-even-summary"><article className="manager-card"><h3>افت واحدهای گروه مشمول</h3><strong>{percent(data.breakEven.wholeAffectedGroupDeclinePercent)}</strong><p>مشارکت پیشین با ترکیب فروش پس از تغییر مقایسه می‌شود؛ افزایش هزینه هم حساب می‌شود.</p></article><article className="manager-card"><h3>تغییر تعداد سفارش</h3><strong>{percent(data.breakEven.overallOrderCountChangePercent)}</strong><p>تعداد سفارش است، نه مشتری یکتا.</p></article><article className="manager-card"><h3>تغییر مشارکت کل</h3><strong>{signed(data.breakEven.totalContributionChangeAmount)}</strong><p>این تغییر مشاهده‌شده است و به‌تنهایی افت یا افزایش تقاضا را به قیمت نسبت نمی‌دهد.</p></article></div>
    </section>

    <section className="pricing-section"><header><h2>کنترل و محدودیت‌های نتیجه</h2><p>محصول‌های بدون تغییر قیمت گروه مقایسه‌ی مشاهده‌ای هستند و کنترل علّی محسوب نمی‌شوند.</p></header>
      <div className="pricing-period-grid"><article className="manager-card"><h3>مقایسه‌ی گروه‌ها</h3><p>تغییر مشارکت گروه مشمول: {percent(data.controls.affectedContributionChangePercent)}</p><p>تغییر مشارکت گروه بدون تغییر: {percent(data.controls.unaffectedContributionChangePercent)}</p><p>فاصله‌ی تغییر نسبی: {percent(data.controls.relativeContributionChangePercent)}</p></article>
        <article className="manager-card"><h3>عوامل شناخته‌شده یا نامعلوم</h3><p>تغییر سهم تخفیف: {data.confounders.discountsChanged === null ? "قابل مقایسه نیست" : data.confounders.discountsChanged ? "مشاهده شده" : "تغییر ثبت نشده"}</p><p>رویدادهای قیمت دیگر در بازه: {inventoryNumber(data.confounders.catalogPriceChanges)}</p><p>تعطیلات، آب‌وهوا، موجودی، تعطیلی و رویداد ویژه: نامعلوم</p><p>گزارش اطلاعات مشتری یکتا ندارد.</p></article></div>
      <ul className="pricing-quality-list">{data.dataQuality.flags.map((flag) => <li className={`is-${flag.severity.toLowerCase()}`} key={flag.code}><b>{flag.severity === "BLOCKER" ? "محدودیت" : flag.severity === "WARNING" ? "هشدار" : "یادداشت"}</b><span>{flag.messageFa}</span></li>)}</ul>
      {data.experiment.targets.map((target) => <p className="pricing-history-status" key={target.id}>{target.productNameSnapshot}{target.optionNameSnapshot ? ` · ${target.optionNameSnapshot}` : ""}: تاریخچه‌ی قیمت {historyLabel[target.priceHistory.status]}{target.priceHistory.originalPriceMatches === false ? "؛ قیمت پیشین هم اختلاف دارد" : ""}</p>)}
    </section>
  </div>;
}

function ScenarioResults({ scenario }: { scenario: PricingScenarioReport }) {
  return <section className="pricing-scenario-results" aria-live="polite"><header><h3>نتیجه‌ی سناریوی فرضی</h3><p>قیمت‌های جدید روی منو ذخیره نشده‌اند.</p></header>
    <div className="pricing-period-grid"><article className="manager-card"><h4>داده‌ی مبنا</h4><p>فروش: {money(scenario.data.source.netRevenueAmount)}</p><p>مشارکت: {money(scenario.data.source.contributionAmount)}</p><p>پوشش هزینه‌ی ثابت: {percent(scenario.data.source.fixedCostCoveragePercent)}</p></article>
      <article className="manager-card"><h4>سیاست‌های اعمال‌شده</h4>{scenario.data.rules.map((rule, index) => <p key={`${rule.label}:${index}`}>{rule.label}: {money(rule.currentPriceAmount)} ← {money(rule.proposedPriceAmount)} · {inventoryNumber(rule.affectedItemUnits)} واحد</p>)}</article></div>
    <div className="inventory-table-wrap" role="region" aria-label="حساسیت حجم برای شبیه‌سازی قیمت" tabIndex={0}><table className="inventory-table"><thead><tr><th>تغییر حجم مشمول</th><th>درآمد فرضی</th><th>مشارکت فرضی</th><th>کسری بسته‌بندی</th><th>مشارکت معادل ماهانه</th><th>پوشش هزینه‌ی ثابت</th><th>مازاد/کسری</th><th>افت سربه‌سر</th></tr></thead><tbody>{scenario.data.scenarios.map((row) => <tr key={row.volumeChangePercent}><th>{inventoryNumber(row.volumeChangePercent)}٪</th><td>{money(row.netRevenueAmount)}</td><td>{money(row.contributionAmount)}</td><td>{money(row.packagingDeficitAmount)}</td><td>{money(row.monthlyEquivalentContributionAmount)}</td><td>{percent(row.fixedCostCoveragePercent)}</td><td>{money(row.operatingSurplusAmount)}</td><td>{percent(row.breakEvenVolumeDeclinePercent)}</td></tr>)}</tbody></table></div>
    <ul className="pricing-quality-list">{scenario.data.assumptions.map((assumption) => <li className="is-info" key={assumption}><span>{assumption}</span></li>)}</ul>
  </section>;
}
