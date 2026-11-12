"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { readSalesChannelReport, type SalesChannelReport } from "../lib/api-client";
import { inventoryErrorMessage } from "../lib/inventory-errors";
import { currentPersianDateInput, persianDateToGregorianDate } from "../lib/tehran-date";
import { formatToman } from "../lib/pos-utils";
import { InventoryMetric, inventoryNumber } from "./inventory-dashboard";

type Period = "today" | "last7" | "last30" | "custom";

function tehranIsoDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
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

const money = (amount: number | null) => amount === null ? "فروشی ندارد" : inventoryNumber(formatToman(amount));
const percent = (amount: string | null) => amount === null ? "محاسبه نمی‌شود" : `${inventoryNumber(amount)}٪`;

export function InventorySalesChannelsPanel() {
  const today = currentPersianDateInput();
  const start = currentPersianDateInput(new Date(Date.now() - 29 * 86_400_000));
  const [period, setPeriod] = useState<Period>("last30");
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<SalesChannelReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = async (fromDate: string, toDate: string) => {
    if (fromDate > toDate) {
      setError("تاریخ شروع نباید بعد از تاریخ پایان باشد.");
      return;
    }
    const id = ++request.current;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const result = await readSalesChannelReport(fromDate, toDate);
      if (id !== request.current) return;
      if (result.ok) setReport(result.data);
      else setError(inventoryErrorMessage(result.error));
    } catch {
      if (id === request.current) setError("گزارش فروش دریافت نشد. اتصال را بررسی کنید و دوباره تلاش کنید.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  };

  useEffect(() => {
    const range = presetRange("last30");
    void load(range.fromDate, range.toDate);
    return () => { request.current += 1; };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fromDate = persianDateToGregorianDate(from.year, from.value);
    const toDate = persianDateToGregorianDate(to.year, to.value);
    if (!fromDate || !toDate) {
      setError("تاریخ شروع و پایان را به شکل ماه/روز وارد کنید.");
      return;
    }
    void load(fromDate, toDate);
  };

  const selectPeriod = (value: Period) => {
    setPeriod(value);
    if (value !== "custom") {
      const range = presetRange(value);
      void load(range.fromDate, range.toDate);
    }
  };

  const data = report?.data;
  const orderDistribution = data?.orderDistribution;
  const averageOrderValue = data?.averageOrderValue;
  const revenue = data?.revenue;
  const takeawayOrigin = data?.takeawayOrigin;
  const maxAverage = Math.max(1, averageOrderValue?.takeawayAmount ?? 0, averageOrderValue?.dineInAmount ?? 0);

  return (
    <div className="inventory-profit-layout inventory-sales-channels" aria-busy={loading}>
      <section className="manager-card inventory-report-filter">
        <header className="inventory-section-heading">
          <div>
            <h2>فروش داخل کافه و بیرون‌بر</h2>
            <p>مبالغ پس از تخفیف، به تومان و بدون مالیات یا حق سرویس.</p>
          </div>
        </header>
        <form className="inventory-profit-filter" onSubmit={submit}>
          <label>
            <span>بازه‌ی گزارش</span>
            <select aria-label="بازه‌ی گزارش فروش" value={period} onChange={(event) => selectPeriod(event.target.value as Period)} disabled={loading}>
              <option value="today">امروز</option>
              <option value="last7">۷ روز گذشته</option>
              <option value="last30">۳۰ روز گذشته</option>
              <option value="custom">بازه‌ی دلخواه</option>
            </select>
          </label>
          {period === "custom" && <div className="inventory-date-fields">
            <label><span>از تاریخ شمسی</span><input aria-label="از تاریخ شمسی" inputMode="numeric" placeholder="ماه/روز" value={from.value} onChange={(event) => setFrom({ ...from, value: event.target.value })} /></label>
            <label><span>سال</span><input aria-label="سال آغاز" inputMode="numeric" value={from.year} onChange={(event) => setFrom({ ...from, year: event.target.value })} /></label>
            <label><span>تا تاریخ شمسی</span><input aria-label="تا تاریخ شمسی" inputMode="numeric" placeholder="ماه/روز" value={to.value} onChange={(event) => setTo({ ...to, value: event.target.value })} /></label>
            <label><span>سال</span><input aria-label="سال پایان" inputMode="numeric" value={to.year} onChange={(event) => setTo({ ...to, year: event.target.value })} /></label>
          </div>}
          {period === "custom" && <button className="primary-button" type="submit" disabled={loading}>{loading ? "در حال محاسبه…" : "نمایش گزارش"}</button>}
        </form>
        {error && <p className="form-error" role="alert">{error}{!loading && <button type="button" className="text-button" onClick={() => {
          if (period === "custom") {
            const fromDate = persianDateToGregorianDate(from.year, from.value);
            const toDate = persianDateToGregorianDate(to.year, to.value);
            if (fromDate && toDate) void load(fromDate, toDate);
          } else {
            const range = presetRange(period);
            void load(range.fromDate, range.toDate);
          }
        }}>بارگذاری دوباره</button>}</p>}
      </section>
      {loading && <div className="inventory-loading" role="status"><span>در حال دریافت آمار فروش…</span><div aria-hidden="true" /></div>}
      {data && orderDistribution && averageOrderValue && revenue && takeawayOrigin && <>
        <div className="inventory-section-heading">
          <div>
            <h2>جمع سفارش‌های تسویه‌شده</h2>
            <p>بازه‌ی گزارش بر اساس زمان آخرین پرداخت کامل در تهران محاسبه شده است.</p>
          </div>
          <span className="inventory-status">این گزارش فروش را نشان می‌دهد، نه سود.</span>
        </div>
        {data.unclassifiedHistoricalOrigin.count > 0 && <p className="inventory-note" role="status">
          نوع اولیه‌ی {inventoryNumber(data.unclassifiedHistoricalOrigin.count)} سفارش قدیمی مشخص نیست. فروش آن‌ها، به مبلغ {money(data.unclassifiedHistoricalOrigin.revenueAmount)} تومان، در جمع کانال‌ها نیامده است.
        </p>}
        <dl className="inventory-metrics">
          <InventoryMetric label="سهم سفارش‌های بیرون‌بر" value={percent(orderDistribution.takeawayPercent)} detail={`${inventoryNumber(orderDistribution.takeawayCount)} از ${inventoryNumber(orderDistribution.totalCount)} سفارش`} />
          <InventoryMetric label="میانگین سفارش بیرون‌بر (تومان)" value={money(averageOrderValue.takeawayAmount)} detail="مبلغ نهایی تقسیم بر تعداد سفارش‌ها" />
          <InventoryMetric label="میانگین سفارش داخل کافه (تومان)" value={money(averageOrderValue.dineInAmount)} detail="مبلغ نهایی تقسیم بر تعداد سفارش‌ها" />
          <InventoryMetric label="فروش بیرون‌بر (تومان)" value={money(revenue.takeawayAmount)} detail={`${percent(revenue.takeawayPercent)} از فروش کل`} />
        </dl>
        {orderDistribution.totalCount === 0 ? <p className="inventory-empty">در این بازه سفارش واجد شرایطی ثبت نشده است.</p> : <div className="inventory-profit-bottom">
          <section className="manager-card" aria-labelledby="sales-channel-distribution-title">
            <header><h3 id="sales-channel-distribution-title">توزیع تعداد سفارش‌ها</h3><p>جمع دسته‌ها برابر با کل سفارش‌های معتبر است.</p></header>
            <div className="inventory-coverage">
              <div><dt>بیرون‌بر</dt><dd>{inventoryNumber(orderDistribution.takeawayCount)} سفارش، {percent(orderDistribution.takeawayPercent)}</dd></div>
              <progress aria-label="سهم سفارش‌های بیرون‌بر" max={100} value={Number(orderDistribution.takeawayPercent ?? 0)} />
              <div><dt>داخل کافه</dt><dd>{inventoryNumber(orderDistribution.dineInCount)} سفارش، {percent(orderDistribution.dineInPercent)}</dd></div>
              <progress aria-label="سهم سفارش‌های داخل کافه" max={100} value={Number(orderDistribution.dineInPercent ?? 0)} />
              <p>جمع کل: {inventoryNumber(orderDistribution.totalCount)} سفارش</p>
            </div>
          </section>
          <section className="manager-card" aria-labelledby="sales-channel-aov-title">
            <header><h3 id="sales-channel-aov-title">مقایسه‌ی میانگین مبلغ سفارش</h3><p>میانگین از مبلغ نهایی سفارش، پس از تخفیف محاسبه شده است.</p></header>
            <div className="inventory-profit-bars">
              {[{ label: "بیرون‌بر", value: averageOrderValue.takeawayAmount }, { label: "داخل کافه", value: averageOrderValue.dineInAmount }].map((row) => <div key={row.label}>
                <div><strong>{row.label}</strong><bdi>{money(row.value)} تومان</bdi></div>
                <div className="inventory-profit-bar" aria-hidden="true"><span style={{ width: `${row.value === null ? 0 : row.value / maxAverage * 100}%` }} /></div>
              </div>)}
              <p>اختلاف میانگین: {money(averageOrderValue.absoluteDifferenceAmount)} تومان، {percent(averageOrderValue.differencePercent)} نسبت به داخل کافه</p>
            </div>
          </section>
          <section className="manager-card" aria-labelledby="sales-channel-origin-title">
            <header><h3 id="sales-channel-origin-title">منشأ سفارش‌های بیرون‌بر</h3><p>سفارش‌های مستقیم از سفارش‌های میزمحور با قلم بسته‌بندی جدا شده‌اند.</p></header>
            <dl className="inventory-coverage">
              <div><dt>بیرون‌بر مستقیم</dt><dd>{inventoryNumber(takeawayOrigin.directTakeawayCount)} سفارش، {money(takeawayOrigin.directTakeawayRevenueAmount)} تومان</dd></div>
              <div><dt>میز با بسته‌بندی</dt><dd>{inventoryNumber(takeawayOrigin.tableOriginatedTakeawayCount)} سفارش، {money(takeawayOrigin.tableOriginatedTakeawayRevenueAmount)} تومان</dd></div>
            </dl>
          </section>
          <section className="manager-card" aria-labelledby="sales-channel-revenue-title">
            <header><h3 id="sales-channel-revenue-title">درآمد فروش</h3><p>مبالغ، فروش خالص‌اند و هزینه یا سود را نشان نمی‌دهند.</p></header>
            <dl className="inventory-coverage">
              <div><dt>فروش کل</dt><dd>{money(revenue.totalAmount)} تومان</dd></div>
              <div><dt>بیرون‌بر</dt><dd>{money(revenue.takeawayAmount)} تومان، {percent(revenue.takeawayPercent)}</dd></div>
              <div><dt>داخل کافه</dt><dd>{money(revenue.dineInAmount)} تومان، {percent(revenue.dineInPercent)}</dd></div>
            </dl>
          </section>
        </div>}
      </>}
    </div>
  );
}
