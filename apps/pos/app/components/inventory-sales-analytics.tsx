"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { readSalesAnalyticsReport, type ManagerCatalog, type SalesAnalyticsReport } from "../lib/api-client";
import { currentPersianDateInput, persianDateToGregorianDate } from "../lib/tehran-date";
import { inventoryErrorMessage } from "../lib/inventory-errors";

type Period = "today" | "last7" | "last30" | "custom";
type TimeBasis = "demand" | "recognition";
type Channel = "" | "TABLE" | "TAKEAWAY";
type Bucket = SalesAnalyticsReport["data"]["operationalBuckets"][number] | SalesAnalyticsReport["data"]["financialBuckets"][number];
type Metric = "orderCount" | "itemUnits" | "netSalesAmount" | "knownContributionAmount" | "knownContributionMarginPercent" | "costCoveragePercent" | "averageOrderValueAmount";
type ProductMetric = "quantitySold" | "netSalesAmount" | "knownCogsAmount" | "knownContributionAmount" | "knownContributionMarginPercent" | "costCoveragePercent";

const dayNames = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const faNumber = (value: number | string) => Number(value).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
const money = (value: number | null) => value === null ? "محاسبه نمی‌شود" : `${faNumber(value)} تومان`;
const percent = (value: string | null) => value === null ? "محاسبه نمی‌شود" : `${faNumber(value)}٪`;
const slotName = (hour: number, minute: number) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
const periodName = (row: { dayOfWeek: number; hour: number; minute: number }) => `${dayNames[row.dayOfWeek]}، ساعت ${slotName(row.hour, row.minute)}${row.hour < 8 ? " (طبق برنامه تعطیل)" : ""}`;

function tehranIsoDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${field("year")}-${field("month")}-${field("day")}`;
}

function presetRange(period: Exclude<Period, "custom">, now = new Date()) {
  const end = tehranIsoDate(now);
  const days = period === "today" ? 1 : period === "last7" ? 7 : 30;
  const start = new Date(`${end}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { fromDate: start.toISOString().slice(0, 10), toDate: end };
}

function valueFor(bucket: Bucket, metric: Metric): number {
  if (metric === "knownContributionMarginPercent" || metric === "costCoveragePercent") {
    return "knownContributionMarginPercent" in bucket ? Number(bucket[metric] ?? 0) : 0;
  }
  if (metric === "knownContributionAmount") return "knownContributionAmount" in bucket ? bucket.knownContributionAmount : 0;
  return bucket[metric] ?? 0;
}

function Heatmap({ rows, metric, interval, financial }: { rows: Bucket[]; metric: Metric; interval: number; financial: boolean }) {
  const maximum = Math.max(1, ...rows.map((row) => Math.abs(valueFor(row, metric))));
  const points = new Map(rows.map((row) => [`${row.dayOfWeek}:${row.hour}:${row.minute}`, row]));
  const slots = Array.from({ length: 24 * 60 / interval }, (_, index) => ({ hour: Math.floor(index * interval / 60), minute: (index * interval % 60) as 0 | 30 }));
  const metricLabel: Record<Metric, string> = {
    orderCount: "سفارش واجد شرایط",
    itemUnits: "واحد فروخته‌شده",
    netSalesAmount: financial ? "فروش خالص در زمان شناسایی" : "فروش سفارش بر مبنای زمان ثبت",
    knownContributionAmount: "مشارکت اقلام دارای بهای کامل",
    knownContributionMarginPercent: "حاشیه‌ی مشارکت اقلام دارای بهای کامل",
    costCoveragePercent: "پوشش هزینه",
    averageOrderValueAmount: "میانگین مبلغ سفارش",
  };
  const shown = (row: Bucket | undefined) => {
    if (!row) return "۰";
    if ((metric === "costCoveragePercent" || metric === "knownContributionMarginPercent") && metric in row && row[metric as keyof typeof row] === null) return "محاسبه نمی‌شود";
    if (metric === "averageOrderValueAmount" && row.averageOrderValueAmount === null) return "محاسبه نمی‌شود";
    const value = valueFor(row, metric);
    if (metric === "netSalesAmount" || metric === "knownContributionAmount" || metric === "averageOrderValueAmount") return faNumber(value);
    if (metric === "knownContributionMarginPercent" || metric === "costCoveragePercent") return `${faNumber(value)}٪`;
    return faNumber(value);
  };
  return <div className="sales-analytics-heatmap-wrap">
    <table className="sales-analytics-heatmap" aria-label={`نقشه‌ی گرمایی ${metricLabel[metric]} بر اساس روز هفته و ساعت`}>
      <thead><tr><th scope="col">روز هفته</th>{slots.map((slot) => <th scope="col" key={slotName(slot.hour, slot.minute)}>{slotName(slot.hour, slot.minute)}</th>)}</tr></thead>
      <tbody>{dayNames.map((name, day) => <tr key={name}><th scope="row">{name}</th>{slots.map((slot) => {
        const row = points.get(`${day}:${slot.hour}:${slot.minute}`);
        const value = row ? valueFor(row, metric) : 0;
        const strength = Math.min(1, Math.abs(value) / maximum);
        const scheduledOpen = row?.isScheduledOpen ?? slot.hour >= 8;
        const scheduleStatus = scheduledOpen ? "داخل ساعت کاری برنامه‌ریزی‌شده" : "طبق برنامه کافه بسته است";
        const activityStatus = row?.hasSales ? (scheduledOpen ? "فروش ثبت شده است" : "با وجود تعطیلی برنامه‌ای، فروش ثبت شده است") : (scheduledOpen ? "در ساعت کاری فروش ثبت نشده است" : "فروشی ثبت نشده و کافه طبق برنامه بسته است");
        const title = `${name}، ${slotName(slot.hour, slot.minute)}، ${metricLabel[metric]}: ${shown(row)}${metric === "netSalesAmount" || metric === "knownContributionAmount" || metric === "averageOrderValueAmount" ? " تومان" : ""}${financial && row && "costCoveragePercent" in row ? `، پوشش هزینه: ${percent(row.costCoveragePercent)}` : ""}، ${scheduleStatus}؛ ${activityStatus}`;
        return <td key={slotName(slot.hour, slot.minute)} title={title} data-empty={!row?.hasSales} data-scheduled-open={scheduledOpen} style={{ backgroundColor: `color-mix(in srgb, var(--accent) ${8 + strength * 42}%, var(--surface-2))` }}>
          <span>{shown(row)}</span>
        </td>;
      })}</tr>)}</tbody>
    </table>
  </div>;
}

function IntervalBars({ title, unit, values, moneyValue = false }: { title: string; unit: string; values: Array<{ label: string; value: number }>; moneyValue?: boolean }) {
  const minimum = Math.min(0, ...values.map((row) => row.value));
  const maximum = Math.max(1, ...values.map((row) => row.value));
  const span = Math.max(1, maximum - minimum);
  const width = 860;
  const height = 210;
  const step = width / Math.max(1, values.length);
  const top = 22;
  const area = 132;
  const valueY = (value: number) => top + (maximum - value) / span * area;
  const baseline = valueY(0);
  return <section className="sales-analytics-interval-chart">
    <h4>{title}</h4>
    <p>محور عمودی: {unit} · دامنه: {moneyValue ? money(minimum) : faNumber(minimum)} تا {moneyValue ? money(maximum) : faNumber(maximum)}</p>
    <div className="sales-analytics-svg-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}، بر حسب ${unit}`}>
      <line x1="0" x2={width} y1={baseline} y2={baseline} className="sales-analytics-axis" />
      {[0, 0.5, 1].map((ratio) => { const value = minimum + span * ratio; const y = valueY(value); return <g key={ratio}><line x1="0" x2={width} y1={y} y2={y} className="sales-analytics-gridline" /><text x="4" y={y - 4}>{faNumber(Math.round(value))}</text></g>; })}
      {values.map((row, index) => {
        const barWidth = Math.max(4, step * 0.62);
        const rowY = valueY(row.value);
        const barHeight = Math.max(1, Math.abs(baseline - rowY));
        const x = index * step + (step - barWidth) / 2;
        const labelVisible = values.length <= 36 || index % 2 === 0;
        return <g key={row.label}><title>{`${row.label}: ${moneyValue ? money(row.value) : `${faNumber(row.value)} ${unit}`}`}</title><rect x={x} y={Math.min(baseline, rowY)} width={barWidth} height={barHeight} rx="3" className="sales-analytics-bar" /><text x={x + barWidth / 2} y="186" textAnchor="middle">{labelVisible ? row.label : ""}</text></g>;
      })}
    </svg></div>
  </section>;
}

function ProductTrend({ rows, metric, productNames }: { rows: Array<SalesAnalyticsReport["data"]["productDemandSeries"][number] | SalesAnalyticsReport["data"]["productFinancialSeries"][number]>; metric: ProductMetric; productNames: Map<string, string> }) {
  const toValue = (row: typeof rows[number]) => {
    const value = metric === "quantitySold" ? row.quantitySold
      : metric === "netSalesAmount" ? row.netSalesAmount
      : metric in row ? (row as SalesAnalyticsReport["data"]["productFinancialSeries"][number])[metric]
      : null;
    if (typeof value === "string") return Number(value);
    return value ?? null;
  };
  const grouped = new Map<string, Map<string, { date: string; value: number | null; name: string }>>();
  for (const row of rows) {
    const variant = `${row.productId}|${row.channel}|${row.options.map((option) => `${option.optionId}:${option.quantity}`).join(",")}`;
    const variantName = [productNames.get(row.productId) ?? row.productName, ...row.options.map((option) => `${option.optionName} ×${faNumber(option.quantity)}`), row.channel === "TABLE" ? "داخل کافه" : row.channel === "TAKEAWAY" ? "بیرون‌بر" : "نامشخص"].join(" · ");
    const series = grouped.get(variant) ?? new Map<string, { date: string; value: number | null; name: string }>();
    const previous = series.get(row.date);
    const next = toValue(row);
    series.set(row.date, { date: row.date, value: previous?.value === null || next === null ? null : (previous?.value ?? 0) + next, name: variantName });
    grouped.set(variant, series);
  }
  const allDates = [...new Set(rows.map((row) => row.date))].sort();
  const series = [...grouped.entries()].map(([id, values]) => ({ id, name: values.values().next().value?.name ?? "محصول", values: allDates.map((date) => values.has(date) ? values.get(date)!.value : 0), total: [...values.values()].reduce((sum, row) => sum + Math.abs(row.value ?? 0), 0) })).sort((a, b) => b.total - a.total).slice(0, 5);
  if (!allDates.length) return <p className="inventory-empty">برای این انتخاب، روندی ثبت نشده است.</p>;
  const width = 860, height = 260, left = 60, right = 12, top = 18, bottom = 34;
  const numeric = series.flatMap((line) => line.values.filter((value): value is number => value !== null));
  const min = Math.min(0, ...numeric), max = Math.max(1, ...numeric), span = max - min;
  const x = (index: number) => left + index * (width - left - right) / Math.max(1, allDates.length - 1);
  const y = (value: number) => height - bottom - (value - min) / span * (height - bottom - top);
  const colors = ["#efb35d", "#aaa0dc", "#7ed4ac", "#75b8d8", "#df8292"];
  return <div className="sales-analytics-product-chart">
    <p>محور عمودی: {metric === "quantitySold" ? "تعداد واحد" : metric.includes("Percent") ? "درصد" : "تومان"} · حداکثر ۵ خط در نمودار</p>
    <div className="sales-analytics-svg-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="مقایسه‌ی روند فروش محصولات در بازه‌ی انتخاب‌شده">
      {[0, 0.5, 1].map((ratio) => { const value = min + span * ratio; return <g key={ratio}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="sales-analytics-gridline" /><text x={left - 5} y={y(value) - 4} textAnchor="end">{faNumber(value)}</text></g>; })}
      {series.map((line, index) => <g key={line.id}><path d={line.values.map((value, point) => value === null ? "" : `${point === 0 || line.values[point - 1] === null ? "M" : "L"}${x(point)},${y(value)}`).filter(Boolean).join(" ")} fill="none" stroke={colors[index]} strokeWidth="2.5" />{line.values.map((value, point) => value === null ? null : <circle key={allDates[point]} cx={x(point)} cy={y(value)} r="3.2" fill={colors[index]}><title>{`${line.name}، ${allDates[point]}: ${faNumber(value)}`}</title></circle>)}</g>)}
    </svg></div>
    <ul className="sales-analytics-legend">{series.map((line, index) => <li key={line.id}><span style={{ backgroundColor: colors[index] }} />{line.name}</li>)}</ul>
    {grouped.size > 5 && <p className="inventory-note">۵ سری با بیشترین مقدار در نمودار دیده می‌شوند. فهرست محصول‌ها و واریانت‌ها در فیلترها قابل محدودکردن است.</p>}
  </div>;
}

export function InventorySalesAnalytics({ catalog }: { catalog: ManagerCatalog }) {
  const today = currentPersianDateInput();
  const start = currentPersianDateInput(new Date(Date.now() - 29 * 86_400_000));
  const [period, setPeriod] = useState<Period>("last30");
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(today);
  const [interval, setInterval] = useState<30 | 60>(60);
  const [basis, setBasis] = useState<TimeBasis>("demand");
  const [metric, setMetric] = useState<Metric>("orderCount");
  const [volumeMetric, setVolumeMetric] = useState<"orderCount" | "itemUnits">("orderCount");
  const [comparisonMetric, setComparisonMetric] = useState<Metric>("netSalesAmount");
  const [productBasis, setProductBasis] = useState<TimeBasis>("recognition");
  const [productMetric, setProductMetric] = useState<ProductMetric>("netSalesAmount");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [channel, setChannel] = useState<Channel>("");
  const [report, setReport] = useState<SalesAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const products = catalog.products.filter((product) => !product.archivedAt && product.systemKey !== "PACKING");
  const categories = catalog.categories.filter((category) => category.kind === "SOURCE" && !category.archivedAt);
  const options = catalog.optionGroups.flatMap((group) => group.options.map((option) => ({ ...option, groupName: group.name }))).filter((option) => !option.archivedAt);
  const productNames = new Map(products.map((product) => [product.id, product.name]));

  const load = async (range: { fromDate: string; toDate: string }, filters = { productIds, categoryIds, optionIds, daysOfWeek, channel }, resolution = interval) => {
    const id = ++request.current;
    setLoading(true); setError(null); setReport(null);
    try {
      const result = await readSalesAnalyticsReport({
        ...range, intervalMinutes: resolution,
        ...(filters.productIds.length ? { productIds: filters.productIds } : {}),
        ...(filters.categoryIds.length ? { categoryIds: filters.categoryIds } : {}),
        ...(filters.optionIds.length ? { optionIds: filters.optionIds } : {}),
        ...(filters.daysOfWeek.length ? { daysOfWeek: filters.daysOfWeek } : {}),
        ...(filters.channel ? { channel: filters.channel } : {}),
      });
      if (id !== request.current) return;
      if (result.ok) setReport(result.data);
      else setError(inventoryErrorMessage(result.error));
    } catch {
      if (id === request.current) setError("گزارش تحلیل فروش دریافت نشد. اتصال را بررسی کنید و دوباره تلاش کنید.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load(presetRange("last30"));
    return () => { request.current += 1; };
    // The initial report uses the default 30-day range and empty filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentRange = () => period === "custom" ? {
    fromDate: persianDateToGregorianDate(from.year, from.value),
    toDate: persianDateToGregorianDate(to.year, to.value),
  } : presetRange(period === "today" ? "today" : period === "last7" ? "last7" : "last30");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const range = currentRange();
    if (!range.fromDate || !range.toDate) { setError("تاریخ شروع و پایان را به شکل ماه/روز وارد کنید."); return; }
    if (range.fromDate > range.toDate) { setError("تاریخ شروع نباید بعد از تاریخ پایان باشد."); return; }
    void load({ fromDate: range.fromDate, toDate: range.toDate });
  };

  const selectPeriod = (next: Period) => {
    setPeriod(next);
    if (next !== "custom") void load(presetRange(next));
  };
  const data = report?.data;
  const demand = basis === "demand";
  const heatRows = demand ? data?.operationalBuckets ?? [] : data?.financialBuckets ?? [];
  const heatOptions: Array<[Metric, string]> = demand
    ? [["orderCount", "تعداد سفارش واجد شرایط"], ["itemUnits", "تعداد واحدهای فروخته‌شده"], ["netSalesAmount", "فروش خالص بر اساس زمان ثبت"], ["averageOrderValueAmount", "میانگین مبلغ سفارش"]]
    : [["orderCount", "تعداد سفارش بر اساس زمان شناسایی"], ["itemUnits", "تعداد واحد بر اساس زمان شناسایی"], ["netSalesAmount", "فروش خالص"], ["knownContributionAmount", "مشارکت اقلام دارای بهای کامل"], ["knownContributionMarginPercent", "حاشیه روی فروش دارای بهای کامل"], ["costCoveragePercent", "پوشش هزینه"], ["averageOrderValueAmount", "میانگین مبلغ سفارش"]];
  const comparisonOptions: Array<[Metric, string]> = demand
    ? [["netSalesAmount", "فروش سفارش بر مبنای زمان ثبت"], ["averageOrderValueAmount", "میانگین مبلغ سفارش"]]
    : [["netSalesAmount", "فروش خالص"], ["knownContributionAmount", "مشارکت اقلام دارای بهای کامل"], ["knownContributionMarginPercent", "حاشیه‌ی مشارکت با هزینه‌ی کامل"], ["averageOrderValueAmount", "میانگین مبلغ سفارش"]];
  const productRows = productBasis === "demand" ? data?.productDemandSeries ?? [] : data?.productFinancialSeries ?? [];
  const seriesMetricOptions: Array<[ProductMetric, string]> = productBasis === "demand"
    ? [["quantitySold", "تعداد واحد فروخته‌شده"], ["netSalesAmount", "فروش در زمان ثبت قلم"]]
    : [["quantitySold", "تعداد واحد در زمان شناسایی"], ["netSalesAmount", "فروش خالص"], ["knownCogsAmount", "بهای شناخته‌شده‌ی کالا"], ["knownContributionAmount", "مشارکت اقلام دارای بهای کامل"], ["knownContributionMarginPercent", "حاشیه‌ی مشارکت با هزینه‌ی کامل"], ["costCoveragePercent", "پوشش هزینه"]];
  const aggregateSlots = (rows: Bucket[], valueMetric: Metric) => {
    const grouped = new Map<string, { label: string; orderCount: number; itemUnits: number; sales: number; contribution: number; completeRevenue: number; totalRevenue: number; orderValueSum: number }>();
    for (const row of rows) {
      const label = slotName(row.hour, row.minute);
      const slot = grouped.get(label) ?? { label, orderCount: 0, itemUnits: 0, sales: 0, contribution: 0, completeRevenue: 0, totalRevenue: 0, orderValueSum: 0 };
      slot.orderCount += row.orderCount;
      slot.itemUnits += row.itemUnits;
      slot.sales += row.netSalesAmount;
      slot.orderValueSum += row.orderValueSumAmount;
      if ("knownContributionAmount" in row) {
        slot.contribution += row.knownContributionAmount;
        slot.completeRevenue += row.completeCostRevenueAmount;
        slot.totalRevenue += row.netSalesAmount;
      }
      grouped.set(label, slot);
    }
    return [...grouped.values()].map((row) => {
      const value = valueMetric === "orderCount" ? row.orderCount
        : valueMetric === "itemUnits" ? row.itemUnits
        : valueMetric === "netSalesAmount" ? row.sales
        : valueMetric === "knownContributionAmount" ? row.contribution
        : valueMetric === "knownContributionMarginPercent" ? row.completeRevenue ? row.contribution / row.completeRevenue * 100 : 0
        : valueMetric === "costCoveragePercent" ? row.totalRevenue ? row.completeRevenue / row.totalRevenue * 100 : 0
        : row.orderCount ? Math.round(row.orderValueSum / row.orderCount) : 0;
      return { label: row.label, value };
    });
  };
  const volumeRows = data ? (demand ? data.operationalBuckets : data.financialBuckets) : [];
  const volumeSlots = aggregateSlots(volumeRows, volumeMetric);
  const comparisonSlots = aggregateSlots(volumeRows, comparisonMetric);
  const operationalOverview = data?.overview.operationalDemand;
  const financialOverview = data?.overview.financialRecognition;
  const selectedPeak = data?.productPeaks.find((peak) => peak.productId === productIds[0]);
  const productDetailRows = productIds.length > 1 ? data?.productPeaks.filter((peak) => productIds.includes(peak.productId)) ?? [] : [];
  const selectedProductClock = new Map<string, number>();
  if (selectedPeak && data) for (const row of data.productDemandSeries) {
    if (row.productId !== selectedPeak.productId) continue;
    const key = slotName(row.hour, row.minute);
    selectedProductClock.set(key, (selectedProductClock.get(key) ?? 0) + row.quantitySold);
  }
  const selectedProductDayDistribution = Array.from({ length: 1_440 / interval }, (_, index) => {
    const hour = Math.floor(index * interval / 60);
    const minute = (index * interval % 60) as 0 | 30;
    const label = slotName(hour, minute);
    return { label, value: selectedProductClock.get(label) ?? 0 };
  });
  const advancedFilterSummary = [
    productIds.length ? `${faNumber(productIds.length)} محصول` : "",
    categoryIds.length ? `${faNumber(categoryIds.length)} دسته` : "",
    optionIds.length ? `${faNumber(optionIds.length)} گزینه` : "",
    daysOfWeek.length ? `${faNumber(daysOfWeek.length)} روز هفته` : "",
  ].filter(Boolean).join(" · ") || "همه‌ی موارد";

  return <div className="inventory-profit-layout sales-analytics-layout" aria-busy={loading}>
    <section className="manager-card inventory-report-filter sales-analytics-filter">
      <header className="inventory-section-heading"><div><h2>فروش، مشارکت و ساعت‌های اوج</h2><p>همه‌ی ساعت‌ها بر پایه‌ی تهران است. برنامه‌ی کاری هر روز از ۰۸:۰۰ تا ۰۰:۰۰ است؛ گزارش تا ۹۳ روز را پوشش می‌دهد.</p>
        <details className="sales-analytics-methodology"><summary>مبنای زمانی و ساعت کاری</summary><p>تحلیل تقاضا از زمان ثبت سفارش استفاده می‌کند و در سطح کالا، زمان نخستین ورود قلم را در نظر می‌گیرد. تحلیل مالی از زمان شناسایی فروش و مصرف استفاده می‌کند. ساعت‌های ۰۰:۰۰ تا پیش از ۰۸:۰۰ زمان تعطیلی برنامه هستند؛ فروش ثبت‌شده در این ساعت‌ها از گزارش حذف نمی‌شود. برای خطوط قدیمی که زمان ورود قلم ندارند، زمان ثبت سفارش به‌عنوان تقریب مشخص می‌شود.</p></details>
      </div></header>
      <form className="inventory-profit-filter" onSubmit={submit}>
        <div className="sales-analytics-primary-controls">
          <label><span>بازه‌ی گزارش</span><select aria-label="بازه‌ی گزارش تحلیل فروش" value={period} onChange={(event) => selectPeriod(event.target.value as Period)} disabled={loading}><option value="today">امروز</option><option value="last7">۷ روز گذشته</option><option value="last30">۳۰ روز گذشته</option><option value="custom">بازه‌ی دلخواه</option></select></label>
          {period === "custom" && <div className="inventory-date-fields"><label><span>از تاریخ شمسی</span><input aria-label="از تاریخ شمسی تحلیل فروش" inputMode="numeric" placeholder="ماه/روز" value={from.value} onChange={(event) => setFrom({ ...from, value: event.target.value })} /></label><label><span>سال</span><input aria-label="سال آغاز تحلیل فروش" inputMode="numeric" value={from.year} onChange={(event) => setFrom({ ...from, year: event.target.value })} /></label><label><span>تا تاریخ شمسی</span><input aria-label="تا تاریخ شمسی تحلیل فروش" inputMode="numeric" placeholder="ماه/روز" value={to.value} onChange={(event) => setTo({ ...to, value: event.target.value })} /></label><label><span>سال</span><input aria-label="سال پایان تحلیل فروش" inputMode="numeric" value={to.year} onChange={(event) => setTo({ ...to, year: event.target.value })} /></label></div>}
          <label><span>تفکیک زمانی</span><select aria-label="تفکیک زمانی" value={interval} onChange={(event) => setInterval(Number(event.target.value) as 30 | 60)}><option value={60}>ساعتی</option><option value={30}>نیم‌ساعتی</option></select></label>
          <label><span>کانال فروش</span><select aria-label="کانال فروش تحلیل فروش" value={channel} onChange={(event) => setChannel(event.target.value as Channel)}><option value="">همه‌ی کانال‌ها</option><option value="TABLE">داخل کافه</option><option value="TAKEAWAY">بیرون‌بر</option></select></label>
        </div>
        <details className="sales-analytics-advanced">
          <summary><span>فیلترهای دقیق</span><span className="sales-analytics-filter-summary">{advancedFilterSummary}</span></summary>
          <div className="sales-analytics-advanced-content">
            <div className="sales-analytics-multi-filter"><label><span>محصول‌ها</span><select aria-label="انتخاب محصول‌ها" multiple value={productIds} onChange={(event) => setProductIds(Array.from(event.target.selectedOptions, (option) => option.value).slice(0, 8))}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><small>برای مقایسه، حداکثر ۸ محصول را انتخاب کنید.</small></label>
              <label><span>دسته‌ها</span><select aria-label="انتخاب دسته‌ها" multiple value={categoryIds} onChange={(event) => setCategoryIds(Array.from(event.target.selectedOptions, (option) => option.value).slice(0, 20))}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label><span>گزینه‌ها و واریانت‌ها</span><select aria-label="انتخاب گزینه‌ها و واریانت‌ها" multiple value={optionIds} onChange={(event) => setOptionIds(Array.from(event.target.selectedOptions, (option) => option.value).slice(0, 30))}>{options.map((option) => <option key={option.id} value={option.id}>{option.groupName} · {option.name}</option>)}</select><small>فیلتر از شناسه‌ی ثبت‌شده‌ی گزینه استفاده می‌کند. ترکیب گزینه‌ها برای هر واحد محصول نمایش داده می‌شود.</small></label></div>
            <fieldset className="sales-analytics-weekdays"><legend>روزهای هفته</legend>{dayNames.map((name, day) => <label key={name}><input type="checkbox" checked={daysOfWeek.includes(day)} onChange={(event) => setDaysOfWeek((current) => event.target.checked ? [...current, day].sort() : current.filter((value) => value !== day))} /><span>{name}</span></label>)}</fieldset>
          </div>
        </details>
        <button className="primary-button" type="submit" disabled={loading}>{loading ? "در حال محاسبه…" : "نمایش تحلیل"}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}{!loading && <button type="button" className="text-button" onClick={() => { const range = currentRange(); if (range.fromDate && range.toDate) void load({ fromDate: range.fromDate, toDate: range.toDate }); }}>بارگذاری دوباره</button>}</p>}
    </section>

    {loading && <div className="inventory-loading" role="status"><span>در حال محاسبه‌ی تحلیل فروش…</span><div aria-hidden="true" /></div>}
    {data && operationalOverview && financialOverview && <>
      <section className="sales-analytics-section" aria-labelledby="sales-analytics-overview-title">
        <header className="inventory-section-heading"><div><h2 id="sales-analytics-overview-title">نمای کلی فروش</h2></div></header>
        <dl className="inventory-metrics">
          <div className="inventory-metric"><dt>سفارش‌های واجد شرایط</dt><dd>{faNumber(operationalOverview.orderCount)}</dd><small>بر اساس زمان ثبت سفارش</small></div>
          <div className="inventory-metric"><dt>واحدهای فروخته‌شده</dt><dd>{faNumber(operationalOverview.itemUnits)}</dd><small>واحد کالا؛ نه تعداد مراجعه‌کننده</small></div>
          <div className="inventory-metric"><dt>فروش شناسایی‌شده</dt><dd>{money(financialOverview.netSalesAmount)}</dd><small>بر اساس زمان شناسایی فروش</small></div>
          <div className="inventory-metric"><dt>مشارکت اقلام دارای بهای کامل</dt><dd>{money(financialOverview.knownContributionAmount)}</dd><small>پوشش هزینه: {percent(financialOverview.costCoveragePercent)}</small></div>
          <div className="inventory-metric"><dt>میانگین مبلغ سفارش</dt><dd>{money(financialOverview.averageOrderValueAmount)}</dd><small>در زمان شناسایی سفارش</small></div>
          <div className="inventory-metric"><dt>مشارکت شناخته‌شده در هر ساعت کاری</dt><dd>{money(data.insights.contributionPerOperatingHourAmount)}</dd><small>میانگین روی {faNumber(data.insights.operatingHoursInRange)} ساعت کاری روزهای انتخاب‌شده ({faNumber(data.insights.operatingHoursPerDay)} ساعت در هر روز)</small></div>
        </dl>
        {financialOverview.incompleteCostItemCount > 0 && <p className="inventory-note" role="status">هزینه‌ی بخشی از فروش ثبت نشده است. مشارکت و حاشیه‌ی کامل فقط برای {percent(financialOverview.costCoveragePercent)} از فروش محاسبه شده‌اند. سود کل نمایش داده نمی‌شود.</p>}
        {operationalOverview.itemEntryFallbackCount > 0 && <p className="inventory-note" role="status">زمان ورود {faNumber(operationalOverview.itemEntryFallbackCount)} خط کالای قدیمی موجود نیست؛ در تحلیل تقاضا از زمان ثبت سفارش به‌عنوان تقریب استفاده شده است.</p>}
        <div className="sales-analytics-insights"><h3>نقطه‌های برجسته‌ی بازه</h3><dl>
          <div><dt>بیشترین سفارش در یک بازه</dt><dd>{data.insights.busiestPeriod ? `${periodName(data.insights.busiestPeriod)} · ${faNumber(data.insights.busiestPeriod.orderCount)} سفارش` : "فروشی ندارد"}</dd></div>
          <div><dt>بیشترین فروش شناسایی‌شده</dt><dd>{data.insights.highestRevenuePeriod ? `${periodName(data.insights.highestRevenuePeriod)} · ${money(data.insights.highestRevenuePeriod.amount)}` : "فروشی ندارد"}</dd></div>
          <div><dt>بیشترین مشارکت شناخته‌شده</dt><dd>{data.insights.highestKnownContributionPeriod ? `${periodName(data.insights.highestKnownContributionPeriod)} · ${money(data.insights.highestKnownContributionPeriod.amount)} · پوشش ${percent(data.insights.highestKnownContributionPeriod.costCoveragePercent)}` : "هزینه‌ی کامل ثبت نشده است"}</dd></div>
          <div><dt>بیشترین میانگین سفارش</dt><dd>{data.insights.highestAverageOrderValuePeriod ? `${periodName(data.insights.highestAverageOrderValuePeriod)} · ${money(data.insights.highestAverageOrderValuePeriod.amount)}` : "فروشی ندارد"}</dd></div>
        </dl>{data.insights.strongestCategoriesByWindow.length > 0 && <div className="sales-analytics-window-categories"><h4>دسته‌ی پرفروش در بازه‌های روز</h4><ul>{data.insights.strongestCategoriesByWindow.map((row) => <li key={row.window}><span>{({ NIGHT: "شب", MORNING: "صبح", AFTERNOON: "بعدازظهر", EVENING: "عصر" } as const)[row.window]}</span><strong>{row.categoryName}</strong><bdi>{money(row.netSalesAmount)}</bdi></li>)}</ul></div>}</div>
      </section>

      <section className="sales-analytics-section" aria-labelledby="sales-analytics-peaks-title">
        <header className="inventory-section-heading"><div><h2 id="sales-analytics-peaks-title">ساعت‌های اوج</h2><p>{demand ? "نمای تقاضا براساس زمان ثبت سفارش و ورود قلم است." : "نمای مالی براساس زمان شناسایی مصرف و فروش است."}</p></div></header>
        <div className="sales-analytics-controls"><label><span>زمان مورد بررسی</span><select aria-label="پایه‌ی زمانی نقشه‌ی فروش" value={basis} onChange={(event) => { setBasis(event.target.value as TimeBasis); setMetric(event.target.value === "demand" ? "orderCount" : "netSalesAmount"); setComparisonMetric(event.target.value === "demand" ? "netSalesAmount" : "knownContributionAmount"); }}><option value="demand">زمان ثبت سفارش / ورود قلم</option><option value="recognition">زمان شناسایی فروش</option></select></label><label><span>معیار نقشه</span><select aria-label="معیار نقشه‌ی ساعت‌های اوج" value={metric} onChange={(event) => setMetric(event.target.value as Metric)}>{heatOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>معیار حجم</span><select aria-label="معیار حجم در نمودار مقایسه" value={volumeMetric} onChange={(event) => setVolumeMetric(event.target.value as "orderCount" | "itemUnits")}><option value="orderCount">تعداد سفارش</option><option value="itemUnits">تعداد واحد کالا</option></select></label><label><span>معیار مالی نمودار</span><select aria-label="معیار مالی مقایسه‌ی ساعت‌ها" value={comparisonMetric} onChange={(event) => setComparisonMetric(event.target.value as Metric)}>{comparisonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <div className="manager-card sales-analytics-card"><div className="sales-analytics-card-heading"><h3>نقشه‌ی روز هفته و ساعت</h3><span>{interval === 30 ? "بازه‌های نیم‌ساعته" : "بازه‌های ساعتی"}</span></div><Heatmap rows={heatRows} metric={metric} interval={interval} financial={!demand} /><p className="sales-analytics-caption">خانه‌های ۰۰:۰۰ تا پیش از ۰۸:۰۰ ساعت‌های تعطیلی برنامه را نشان می‌دهند؛ خانه‌ی خالی در ساعت کاری یعنی در آن بازه فروشی ثبت نشده است.</p></div>
        <div className="sales-analytics-comparison"><IntervalBars title={demand ? "حجم بر اساس زمان ثبت" : "حجم بر اساس زمان شناسایی"} unit={volumeMetric === "itemUnits" ? "واحد کالا" : "سفارش"} values={volumeSlots} /><IntervalBars title={comparisonOptions.find(([value]) => value === comparisonMetric)?.[1] ?? "معیار مالی"} unit={comparisonMetric === "knownContributionMarginPercent" || comparisonMetric === "costCoveragePercent" ? "درصد" : comparisonMetric === "orderCount" || comparisonMetric === "itemUnits" ? "واحد" : "تومان"} moneyValue={comparisonMetric === "netSalesAmount" || comparisonMetric === "knownContributionAmount" || comparisonMetric === "averageOrderValueAmount"} values={comparisonSlots} /></div>
      </section>

      <section className="sales-analytics-section" aria-labelledby="sales-analytics-products-title">
        <header className="inventory-section-heading"><div><h2 id="sales-analytics-products-title">مقایسه‌ی محصول‌ها</h2><p>برای خوانایی، حداکثر پنج محصول یا واریانت در نمودار نمایش داده می‌شود.</p></div></header>
        <div className="sales-analytics-controls"><label><span>پایه‌ی زمانی محصول</span><select aria-label="پایه‌ی زمانی مقایسه‌ی محصول" value={productBasis} onChange={(event) => { setProductBasis(event.target.value as TimeBasis); setProductMetric(event.target.value === "demand" ? "quantitySold" : "netSalesAmount"); }}><option value="demand">زمان ورود قلم / زمان ثبت سفارش</option><option value="recognition">زمان شناسایی مالی</option></select></label><label><span>معیار مقایسه</span><select aria-label="معیار مقایسه‌ی محصول" value={productMetric} onChange={(event) => setProductMetric(event.target.value as ProductMetric)}>{seriesMetricOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <div className="manager-card sales-analytics-card"><ProductTrend rows={productRows} metric={productMetric} productNames={productNames} /></div>
      </section>

      <section className="sales-analytics-section" aria-labelledby="sales-analytics-detail-title">
        <header className="inventory-section-heading"><div><h2 id="sales-analytics-detail-title">اوج و جزئیات محصول</h2><p>تعداد واحد و تعداد سفارش یکتا جدا هستند. یک سفارش با چند واحد از یک کالا، یک سفارش و چند واحد شمرده می‌شود.</p></div></header>
        {selectedPeak ? <div className="manager-card sales-analytics-product-detail"><h3>{productNames.get(selectedPeak.productId) ?? selectedPeak.productName}</h3><dl className="sales-analytics-peak-grid"><div><dt>بیشترین حجم</dt><dd>{selectedPeak.highestVolume ? `${periodName(selectedPeak.highestVolume)} · ${faNumber(selectedPeak.highestVolume.quantity)} واحد` : "فروشی ندارد"}</dd></div><div><dt>بیشترین فروش</dt><dd>{selectedPeak.highestRevenue ? `${periodName(selectedPeak.highestRevenue)} · ${money(selectedPeak.highestRevenue.amount)}` : "فروشی ندارد"}</dd></div><div><dt>بیشترین مشارکت شناخته‌شده</dt><dd>{selectedPeak.highestKnownContribution ? `${periodName(selectedPeak.highestKnownContribution)} · ${money(selectedPeak.highestKnownContribution.amount)} · پوشش ${percent(selectedPeak.highestKnownContribution.costCoveragePercent)}` : "بهای کامل ثبت نشده است"}</dd></div><div><dt>سفارش‌های یکتا</dt><dd>{faNumber(selectedPeak.uniqueOrdersContainingProduct)}</dd></div></dl><IntervalBars title="توزیع واحدهای محصول بر اساس ساعت ثبت قلم؛ ۰۰:۰۰ تا پیش از ۰۸:۰۰ تعطیل برنامه‌ای" unit="واحد کالا" values={selectedProductDayDistribution} /><div className="sales-analytics-distributions"><section><h4>توزیع بر اساس روز</h4><ul>{selectedPeak.weekdayDistribution.map((row) => <li key={row.dayOfWeek}><span>{dayNames[row.dayOfWeek]}</span><b>{faNumber(row.quantity)} واحد</b><small>{faNumber(row.uniqueOrdersContainingProduct)} سفارش یکتا</small></li>)}</ul></section><section><h4>داخل کافه و بیرون‌بر</h4><ul>{selectedPeak.channelDistribution.map((row) => <li key={row.channel}><span>{row.channel === "TABLE" ? "داخل کافه" : row.channel === "TAKEAWAY" ? "بیرون‌بر" : "کانال نامشخص"}</span><b>{faNumber(row.quantity)} واحد</b><small>{faNumber(row.uniqueOrdersContainingProduct)} سفارش · {money(row.netSalesAmount)}</small></li>)}</ul></section></div></div> : productDetailRows.length ? <div className="sales-analytics-product-list">{productDetailRows.map((row) => <article className="manager-card" key={row.productId}><h3>{productNames.get(row.productId) ?? row.productName}</h3><p>{faNumber(row.totalQuantity)} واحد در {faNumber(row.uniqueOrdersContainingProduct)} سفارش یکتا</p><p>اوج حجم: {row.highestVolume ? periodName(row.highestVolume) : "ندارد"} · اوج فروش: {row.highestRevenue ? periodName(row.highestRevenue) : "ندارد"} · اوج مشارکت: {row.highestKnownContribution ? periodName(row.highestKnownContribution) : "بهای کامل ثبت نشده"}</p></article>)}</div> : <p className="inventory-empty">برای دیدن اوج محصول، یک محصول را در فیلترها انتخاب کنید.</p>}
      </section>
    </>}
  </div>;
}
