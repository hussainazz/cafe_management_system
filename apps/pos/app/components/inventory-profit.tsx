"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { roundDiscountedAmount } from "@cafe/contracts";
import { readGrossProfitReport, type GrossProfitReport, type ManagerCatalog } from "../lib/api-client";
import { inventoryErrorMessage } from "../lib/inventory-errors";
import { currentPersianDateInput, persianDateToGregorianDate } from "../lib/tehran-date";
import { formatToman } from "../lib/pos-utils";
import { InventoryProfitBreakdown } from "./inventory-profit-breakdown";
import { InventoryTrend, InventoryDailyMargin } from "./inventory-charts";
import { InventoryMetric, inventoryNumber } from "./inventory-dashboard";

const money = (amount: number | null) =>
  amount === null ? "محاسبه نشده" : inventoryNumber(formatToman(amount));
type Sort = "profit" | "sales" | "margin";

function currentMenuPrice(product: ManagerCatalog["products"][number]) {
  if (!product.saleDiscountKind || !product.saleDiscountValue) return product.priceAmount;
  const discount = product.saleDiscountKind === "FIXED"
    ? product.saleDiscountValue
    : Math.floor((product.priceAmount * product.saleDiscountValue) / 100);
  return roundDiscountedAmount(Math.max(0, product.priceAmount - discount));
}

export function InventoryProfitPanel({ catalog, onInspectProduct }: { catalog?: ManagerCatalog; onInspectProduct?: (productId: string) => void } = {}) {
  const initial = currentPersianDateInput();
  const start = currentPersianDateInput(new Date(Date.now() - 29 * 86400000));
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(initial);
  const [report, setReport] = useState<GrossProfitReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("profit");
  const [priorityLimit, setPriorityLimit] = useState(8);
  const request = useRef(0);
  const load = async (start: typeof from, end: typeof to) => {
    const fromDate = persianDateToGregorianDate(start.year, start.value);
    const toDate = persianDateToGregorianDate(end.year, end.value);
    if (!fromDate || !toDate || fromDate > toDate) {
      setError("تاریخ شروع و پایان را بررسی کنید.");
      return;
    }
    const id = ++request.current;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const result = await readGrossProfitReport(fromDate, toDate);
      if (id !== request.current) return;
      if (result.ok) setReport(result.data);
      else setError(inventoryErrorMessage(result.error));
    } catch {
      if (id === request.current)
        setError("گزارش دریافت نشد. اتصال را بررسی کنید و دوباره تلاش کنید.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load(start, initial);
    return () => {
      request.current += 1;
    };
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void load(from, to);
  };
  const valueFor = (product: GrossProfitReport["data"]["products"][number]) =>
    sort === "sales"
      ? product.netSalesAmount
      : sort === "margin"
        ? product.grossMarginPercent === null
          ? null
          : Number(product.grossMarginPercent)
        : product.grossProfitAmount;
  const products =
    report?.data.products
      .filter((product) => product.productName.includes(search.trim()))
      .sort((a, b) => {
        const left = valueFor(a),
          right = valueFor(b);
        return left === null
          ? right === null
            ? a.productName.localeCompare(b.productName, "fa")
            : 1
          : right === null
            ? -1
            : right - left || a.productName.localeCompare(b.productName, "fa");
      }) ?? [];
  const ranked =
    report?.data.products
      .filter((product) => product.grossProfitAmount !== null)
      .sort((a, b) => b.grossProfitAmount! - a.grossProfitAmount!)
      .slice(0, 5) ?? [];
  const priorityProducts = report?.data.products
    .filter((product) => product.incompleteCostRevenueAmount > 0)
    .sort((a, b) => b.incompleteCostRevenueAmount - a.incompleteCostRevenueAmount || a.productName.localeCompare(b.productName, "fa") || (a.channel ?? "").localeCompare(b.channel ?? "")) ?? [];
  const currentCostingProductIds = new Set(
    catalog?.products.filter((product) => product.isActive && !product.archivedAt).map((product) => product.id) ?? [],
  );
  const currentMenuCategoryIds = new Set(
    catalog?.categories.filter((category) => !category.archivedAt).map((category) => category.id) ?? [],
  );
  const currentMenuProducts = new Map(
    catalog?.products
      .filter((product) => product.isPublic && product.isActive && !product.archivedAt && currentMenuCategoryIds.has(product.categoryId))
      .map((product) => [product.id, product] as const) ?? [],
  );
  const renderCurrentMenuPrice = (productId: string) => {
    const menuProduct = currentMenuProducts.get(productId);
    if (!menuProduct) return <span>{catalog ? "در منوی فعلی نیست" : "منوی فعلی بارگذاری نشده"}</span>;
    return <>
      <bdi>{money(currentMenuPrice(menuProduct))}</bdi>
      <small className="inventory-cell-note">
        {menuProduct.pricingMode === "WEIGHTED_PER_KG" ? "تومان برای هر کیلوگرم" : "تومان"}
      </small>
      {menuProduct.optionGroups.length > 0 && (
        <small className="inventory-cell-note">قیمت پایه؛ هزینه‌ی گزینه‌ها جداست</small>
      )}
    </>;
  };
  const coverage = report?.data.costCoverage;
  const maxProfit = Math.max(1, ...ranked.map((product) => Math.abs(product.grossProfitAmount!)));
  const totals = report?.data.totals;
  return (
    <div className="inventory-profit-layout" aria-busy={loading}>
      <section className="manager-card inventory-report-filter">
        <header className="inventory-section-heading">
          <div>
            <h2>بررسی سود ناخالص</h2>
            <p>فروش خالص و هزینه از سفارش‌های تاریخی است؛ قیمت نهایی منو از قیمت فعلی محصول می‌آید.</p>
          </div>
        </header>
        <form className="inventory-profit-filter" onSubmit={submit}>
          <div className="inventory-date-fields">
            <label>
              <span>از تاریخ شمسی</span>
              <input
                aria-label="از تاریخ شمسی"
                inputMode="numeric"
                placeholder="ماه/روز"
                value={from.value}
                onChange={(event) => setFrom({ ...from, value: event.target.value })}
              />
            </label>
            <label>
              <span>سال</span>
              <input
                aria-label="سال آغاز"
                inputMode="numeric"
                value={from.year}
                onChange={(event) => setFrom({ ...from, year: event.target.value })}
              />
            </label>
            <label>
              <span>تا تاریخ شمسی</span>
              <input
                aria-label="تا تاریخ شمسی"
                inputMode="numeric"
                placeholder="ماه/روز"
                value={to.value}
                onChange={(event) => setTo({ ...to, value: event.target.value })}
              />
            </label>
            <label>
              <span>سال</span>
              <input
                aria-label="سال پایان"
                inputMode="numeric"
                value={to.year}
                onChange={(event) => setTo({ ...to, year: event.target.value })}
              />
            </label>
          </div>
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "در حال محاسبه…" : error ? "تلاش دوباره" : "نمایش گزارش"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={loading}
            onClick={() => {
              const today = currentPersianDateInput();
              setFrom(today);
              setTo(today);
              void load(today, today);
            }}
          >
            امروز
          </button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {loading && (
        <div className="inventory-loading" role="status">
          <span>در حال دریافت گزارش سود ناخالص…</span>
          <div aria-hidden="true" />
        </div>
      )}
      {report && totals && (
        <>
          <div className="inventory-section-heading">
            <div>
              <h2>جمع کل کافه</h2>
              <p>
                بازه‌ی گزارش:{" "}
                {new Date(report.meta.range.from).toLocaleDateString("fa-IR", {
                  timeZone: "Asia/Tehran",
                })}{" "}
                تا{" "}
                {new Date(new Date(report.meta.range.to).getTime() - 1).toLocaleDateString(
                  "fa-IR",
                  { timeZone: "Asia/Tehran" },
                )}
              </p>
            </div>
            <span
              className={`inventory-status${report.data.products.length === 0 ? "" : report.data.costCoverage.incompleteOrderItemCount ? " inventory-status--warning" : " inventory-status--success"}`}
            >
              {report.data.products.length === 0
                ? "فروش تسویه‌شده‌ای وجود ندارد"
                : report.data.costCoverage.incompleteOrderItemCount
                  ? "اطلاعات هزینه ناقص است"
                  : "اطلاعات هزینه کامل است"}
            </span>
          </div>
          <dl className="inventory-metrics">
            <InventoryMetric
              label="فروش خالص (تومان)"
              value={money(totals.netSalesAmount)}
              detail="پس از تخفیف‌های ثبت‌شده"
            />
            <InventoryMetric
              label="بهای تمام‌شده (تومان)"
              value={money(totals.theoreticalCogsAmount)}
              detail={
                totals.theoreticalCogsAmount === null
                  ? `هزینه‌ی مشخص‌شده: ${money(totals.knownCogsAmount)} تومان`
                  : "هزینه‌ی مواد در زمان تسویه‌ی کامل"
              }
            />
            <InventoryMetric
              label="سود ناخالص (تومان)"
              value={money(totals.grossProfitAmount)}
              detail="فروش خالص منهای بهای تمام‌شده"
              tone={
                totals.grossProfitAmount === null
                  ? undefined
                  : totals.grossProfitAmount < 0
                    ? "warning"
                    : "success"
              }
            />
            <InventoryMetric
              label="حاشیه‌ی سود ناخالص"
              value={
                totals.grossMarginPercent === null
                  ? "محاسبه نشده"
                  : `${inventoryNumber(totals.grossMarginPercent)}٪`
              }
              detail="سهم سود ناخالص از فروش خالص"
            />
          </dl>
          <section className="manager-card inventory-cost-coverage" aria-labelledby="inventory-cost-coverage-title">
            <header>
              <h2 id="inventory-cost-coverage-title">پوشش بهای تمام‌شده فروش</h2>
              <p>
                {coverage!.coveragePercent === null
                  ? "در این بازه فروش واجد شرایطی برای محاسبه‌ی پوشش وجود ندارد."
                  : `${inventoryNumber(coverage!.coveragePercent)}٪ از مبلغ فروش این بازه، بهای تمام‌شده‌ی کامل دارد.`}
              </p>
            </header>
            <div className="inventory-cost-coverage-primary">
              <strong>{coverage!.coveragePercent === null ? "محاسبه نشده" : `${inventoryNumber(coverage!.coveragePercent)}٪`}</strong>
              <div
                className="inventory-cost-coverage-track"
                role="progressbar"
                aria-label="درصد پوشش بهای تمام‌شده فروش"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={coverage!.coveragePercent === null ? 0 : Number(coverage!.coveragePercent)}
              >
                <span className="is-covered" style={{ width: `${coverage!.coveragePercent === null ? 0 : Math.min(100, Math.max(0, Number(coverage!.coveragePercent)))}%` }} />
                <span className="is-incomplete" style={{ width: `${coverage!.coveragePercent === null ? 0 : 100 - Math.min(100, Math.max(0, Number(coverage!.coveragePercent)))}%` }} />
              </div>
            </div>
            <div className="inventory-cost-coverage-legend">
              <div><span className="is-covered" /><span>فروش با هزینه‌ی کامل</span><strong><bdi>{money(coverage!.completeCostRevenueAmount)}</bdi> تومان</strong></div>
              <div><span className="is-incomplete" /><span>فروش با هزینه‌ی ناقص</span><strong><bdi>{money(coverage!.incompleteCostRevenueAmount)}</bdi> تومان</strong></div>
            </div>
            <p className="inventory-note">
              {inventoryNumber(coverage!.completeOrderItemCount)} قلم با هزینه‌ی کامل، {inventoryNumber(coverage!.incompleteOrderItemCount)} قلم با هزینه‌ی ناقص از {inventoryNumber(coverage!.totalEligibleNetSalesAmount)} تومان فروش خالص.
            </p>
            <p className="inventory-note">فروش ردیف «بسته‌بندی» در مخرج باقی می‌ماند؛ هزینه‌ی مواد بسته‌بندی از دستورها و نگاشت مواد بسته‌بندی محاسبه می‌شود. نبود هزینه برای ردیف خدمت به‌معنای هزینه‌ی صفر نیست.</p>
          </section>
          <section className="manager-card inventory-coverage-priority" aria-labelledby="inventory-coverage-priority-title">
            <header>
              <h2 id="inventory-coverage-priority-title">اولویت تکمیل بهای تمام‌شده</h2>
              <p>بیشترین فروش تاریخی با هزینه‌ی ناقص در ابتدای فهرست است. تغییر دستور تهیه، هزینه‌ی فروش‌های تاریخی را اصلاح نمی‌کند؛ برای بررسی تنظیم فعلی از بخش «دستور تهیه و هزینه» استفاده کنید.</p>
            </header>
            {priorityProducts.length ? (
              <>
                <div className="inventory-table-wrap" role="region" aria-label="محصولات با اولویت تکمیل هزینه" tabIndex={0}>
                  <table className="inventory-table">
                    <thead><tr><th scope="col">محصول</th><th scope="col">نوع فروش</th><th scope="col">فروش کل</th><th scope="col">فروش با هزینه‌ی ناقص</th><th scope="col">پوشش هزینه</th><th scope="col">سهم از فروش ناقص</th></tr></thead>
                    <tbody>{priorityProducts.slice(0, priorityLimit).map((product) => (
                      <tr key={`${product.productId}:${product.channel ?? "TABLE"}`}>
                        <th scope="row">{product.productName}{onInspectProduct && (currentCostingProductIds.has(product.productId)
                          ? <button className="text-button" type="button" onClick={() => onInspectProduct(product.productId)}>بررسی هزینه‌ی فعلی</button>
                          : <small className="inventory-cell-note">تنظیم فعلی این محصول در دسترس نیست</small>)}</th>
                        <td>{product.channel === "TAKEAWAY" ? "بیرون‌بر" : "داخل کافه"}</td>
                        <td><bdi>{money(product.netSalesAmount)}</bdi></td>
                        <td><bdi>{money(product.incompleteCostRevenueAmount)}</bdi></td>
                        <td>{product.coveragePercent === null ? "محاسبه نشده" : `${inventoryNumber(product.coveragePercent)}٪`}</td>
                        <td>{product.incompleteCostRevenueSharePercent === null ? "محاسبه نشده" : `${inventoryNumber(product.incompleteCostRevenueSharePercent)}٪`}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                {priorityProducts.length > 8 && (
                  <button className="secondary-button" type="button" onClick={() => setPriorityLimit((limit) => limit >= priorityProducts.length ? 8 : Math.min(priorityProducts.length, limit + 8))}>
                    {priorityLimit >= priorityProducts.length ? "نمایش موارد کمتر" : `نمایش ${inventoryNumber(Math.min(8, priorityProducts.length - priorityLimit))} مورد دیگر`}
                  </button>
                )}
              </>
            ) : <p className="inventory-empty">در این بازه فروش تاریخی با هزینه‌ی ناقص ثبت نشده است.</p>}
          </section>
          <section className="manager-card inventory-channel-coverage" aria-labelledby="inventory-channel-coverage-title">
            <header><h2 id="inventory-channel-coverage-title">پوشش هزینه بر اساس نوع فروش</h2><p>کانال از snapshot هزینه‌ی هر ردیف پیروی می‌کند و هزینه‌ی مواد بسته‌بندی بیرون‌بر را در همان کانال نگه می‌دارد. گزارش آمار فروش، سفارش میزی دارای ردیف سیستمی «بسته‌بندی» را بیرون‌بر طبقه‌بندی می‌کند؛ این دو تعریف با هم ترکیب نشده‌اند.</p></header>
            <div className="inventory-channel-coverage-grid">
              {coverage!.channels.map((channel) => {
                const percent = channel.coveragePercent === null ? 0 : Math.min(100, Math.max(0, Number(channel.coveragePercent)));
                return <article key={channel.channel} aria-label={channel.channel === "TABLE" ? "داخل کافه" : "بیرون‌بر"}>
                  <h3>{channel.channel === "TABLE" ? "داخل کافه" : "بیرون‌بر"}</h3>
                  <strong>{channel.coveragePercent === null ? "فروشی ثبت نشده" : `${inventoryNumber(channel.coveragePercent)}٪`}</strong>
                  <div className="inventory-cost-coverage-track" role="progressbar" aria-label={`پوشش بهای تمام‌شده ${channel.channel === "TABLE" ? "داخل کافه" : "بیرون‌بر"}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                    <span className="is-covered" style={{ width: `${percent}%` }} /><span className="is-incomplete" style={{ width: `${channel.coveragePercent === null ? 0 : 100 - percent}%` }} />
                  </div>
                  <p>فروش: <bdi>{money(channel.netSalesAmount)}</bdi> تومان</p>
                  <p>هزینه‌ی کامل: <bdi>{money(channel.completeCostRevenueAmount)}</bdi> تومان</p>
                  <p>هزینه‌ی ناقص: <bdi>{money(channel.incompleteCostRevenueAmount)}</bdi> تومان</p>
                </article>;
              })}
            </div>
          </section>
          <div className="inventory-profit-charts"><section className="manager-card"><header><h2>روند فروش، بهای تمام‌شده و سود ناخالص</h2><p>بر اساس روز تسویه‌ی کامل در تهران؛ مبالغ به تومان.</p></header><InventoryTrend daily={report.data.daily ?? []} /></section><section className="manager-card"><header><h2>سود و حاشیه‌ی سود ناخالص روزانه</h2><p>روز را انتخاب کنید تا حاشیه‌ی سود همان روز نمایش داده شود.</p></header><InventoryDailyMargin daily={report.data.daily ?? []} /></section></div>
          <div className="inventory-profit-bottom"><InventoryProfitBreakdown report={report} {...(catalog ? {catalog} : {})} />
            <section className="manager-card">
              <header>
                <h2>مقایسه‌ی سود محصولات</h2>
                <p>پنج محصول با بیشترین سود ناخالص در کل بازه؛ مبالغ به تومان.</p>
              </header>
              <ol className="inventory-profit-bars">
                {ranked.map((product) => (
                  <li key={`${product.productId}:${product.channel ?? "TABLE"}`}>
                    <div>
                      <strong>{product.productName}</strong><small>{product.channel === "TAKEAWAY" ? "بیرون‌بر" : product.channel === "TABLE" ? "داخل کافه" : ""}</small>
                      <span>
                        {product.grossProfitAmount! < 0 && "زیان: "}
                        <bdi>{money(product.grossProfitAmount)}</bdi>
                      </span>
                    </div>
                    <div
                      className={`inventory-profit-bar${product.grossProfitAmount! < 0 ? " is-negative" : ""}`}
                      aria-hidden="true"
                    >
                      <span
                        style={{
                          width: `${(Math.abs(product.grossProfitAmount!) / maxProfit) * 100}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
              {ranked.length === 0 && (
                <p className="inventory-empty">
                  {report.data.products.length
                    ? "برای مقایسه‌ی سود، اطلاعات هزینه‌ی محصولات را کامل کنید. این کار هزینه‌ی سفارش‌های قبلی را تغییر نمی‌دهد."
                    : "در این بازه سفارشی تسویه‌ی کامل نشده است."}
                </p>
              )}
            </section>
            <section className="manager-card">
              <header>
                <h2>پوشش محاسبه‌ی هزینه</h2>
                <p>هزینه‌ی نامشخص، صفر در نظر گرفته نمی‌شود.</p>
              </header>
              <dl className="inventory-coverage">
                <div>
                  <dt>اقلام با هزینه‌ی کامل</dt>
                  <dd>{inventoryNumber(report.data.costCoverage.completeOrderItemCount)}</dd>
                </div>
                <div>
                  <dt>اقلام با هزینه‌ی ناقص</dt>
                  <dd>{inventoryNumber(report.data.costCoverage.incompleteOrderItemCount)}</dd>
                </div>
                <div>
                  <dt>سفارش‌های در انتظار کسر موجودی</dt>
                  <dd>{inventoryNumber(report.data.pendingConsumptionCount)}</dd>
                </div>
                <div>
                  <dt>ارزش مصرف موجودی (برآوردی، تومان)</dt>
                  <dd>
                    {report.data.inventoryConsumption.amount === null
                      ? "برای این بازه در دسترس نیست"
                      : money(report.data.inventoryConsumption.amount)}
                  </dd>
                </div>
                <div>
                  <dt>اختلاف با هزینه‌ی مواد (تومان)</dt>
                  <dd>
                    {report.data.inventoryConsumption.varianceAmount === null
                      ? "در دسترس نیست"
                      : money(report.data.inventoryConsumption.varianceAmount)}
                  </dd>
                </div>
              </dl>
              <p className="inventory-note">
                {report.data.costCoverage.incompleteOrderItemCount > 0
                  ? "برای بعضی از اقلام، دستور تهیه یا ارزش‌گذاری کامل نیست؛ سود و حاشیه‌ی سود کل محاسبه نشده است. "
                  : ""}
                مصرف موجودی فقط با پوشش کامل گردش انبار و ارزش‌گذاری دوره قابل مقایسه است. اختلاف
                به‌تنهایی علت کسری یا ضایعات را مشخص نمی‌کند.
                {report.data.inventoryConsumption.missingValuationCount > 0
                  ? ` ${inventoryNumber(report.data.inventoryConsumption.missingValuationCount)} کالا ارزش‌گذاری کامل ندارد.`
                  : ""}
              </p>
            </section>
          </div>
          <section className="manager-card inventory-report-products">
            <header>
              <h2>سود هر کالا</h2>
              <p>
                جست‌وجو و مرتب‌سازی فقط این جدول را تغییر می‌دهد؛ ارقام بالای صفحه برای کل کافه است.
                فروش داخل کافه و بیرون‌بر در ردیف‌های جدا نمایش داده می‌شود. همه‌ی مبالغ به تومان هستند.
              </p>
            </header>
            <div className="inventory-toolbar">
              <label>
                <span>جست‌وجوی محصول</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="نام محصول منو"
                />
              </label>
              <label>
                <span>مرتب‌سازی محصولات</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                  <option value="profit">بیشترین سود ناخالص</option>
                  <option value="sales">بیشترین فروش خالص</option>
                  <option value="margin">بیشترین حاشیه‌ی سود</option>
                </select>
              </label>
            </div>
            <p className="inventory-table-hint">برای دیدن همه‌ی ستون‌ها، جدول را به طرفین بکشید.</p>
            <div
              className="inventory-table-wrap"
              role="region"
              aria-label="جدول سود محصولات"
              tabIndex={0}
            >
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th scope="col">کالا</th>
                    <th scope="col">قیمت نهایی منو</th>
                    <th scope="col">فروش خالص</th>
                    <th scope="col">هزینه‌ی مشخص‌شده</th>
                    <th scope="col">سود ناخالص</th>
                    <th scope="col">حاشیه‌ی سود</th>
                    <th scope="col">پوشش هزینه</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={`${product.productId}:${product.channel ?? "TABLE"}`}>
                      <th scope="row">{product.productName}<small className="inventory-cell-note">{product.channel === "TAKEAWAY" ? "بیرون‌بر" : product.channel === "TABLE" ? "داخل کافه" : ""}</small></th>
                      <td>{renderCurrentMenuPrice(product.productId)}</td>
                      <td>
                        <bdi>{money(product.netSalesAmount)}</bdi>
                      </td>
                      <td>
                        <bdi>{money(product.knownCogsAmount)}</bdi>
                      </td>
                      <td
                        className={
                          product.grossProfitAmount !== null && product.grossProfitAmount < 0
                            ? "inventory-negative"
                            : undefined
                        }
                      >
                        <bdi>{money(product.grossProfitAmount)}</bdi>
                      </td>
                      <td>
                        {product.grossMarginPercent === null
                          ? "محاسبه نشده"
                          : `${inventoryNumber(product.grossMarginPercent)}٪`}
                      </td>
                      <td>
                        <span
                          className={`inventory-status${product.incompleteOrderItemCount ? " inventory-status--warning" : ""}`}
                        >
                          {inventoryNumber(product.completeOrderItemCount)} قلم کامل،{" "}
                          {inventoryNumber(product.incompleteOrderItemCount)} قلم ناقص
                        </span>
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        {report.data.products.length
                          ? "محصولی با این نام پیدا نشد."
                          : "در این بازه سفارشی تسویه‌ی کامل نشده است."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
