"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
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

export function InventoryProfitPanel({ catalog }: { catalog?: ManagerCatalog } = {}) {
  const initial = currentPersianDateInput();
  const start = currentPersianDateInput(new Date(Date.now() - 29 * 86400000));
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(initial);
  const [report, setReport] = useState<GrossProfitReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("profit");
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
  const maxProfit = Math.max(1, ...ranked.map((product) => Math.abs(product.grossProfitAmount!)));
  const totals = report?.data.totals;
  return (
    <div className="inventory-profit-layout" aria-busy={loading}>
      <section className="manager-card inventory-report-filter">
        <header className="inventory-section-heading">
          <div>
            <h2>بررسی سود ناخالص</h2>
            <p>فروش تسویه‌شده و هزینه‌ی ثبت‌شده‌ی سفارش‌ها.</p>
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
                      <td colSpan={6}>
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
