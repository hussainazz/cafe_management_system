"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { readGrossProfitReport, type GrossProfitReport } from "../lib/api-client";
import { inventoryErrorMessage } from "../lib/inventory-errors";

type Day = NonNullable<GrossProfitReport["data"]["daily"]>[number];
const number = (value: number) => value.toLocaleString("fa-IR");
const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00+03:30`).toLocaleDateString("fa-IR", {
    timeZone: "Asia/Tehran",
    month: "short",
    day: "numeric",
  });
export function recentInventoryRange(days = 30) {
  const end = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return {
    from: new Date(Date.parse(`${end}T12:00:00Z`) - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10),
    to: end,
  };
}

export function InventoryTrend({
  daily,
  compact = false,
  overview = false,
  rangeControl,
}: {
  daily: Day[];
  compact?: boolean;
  overview?: boolean;
  rangeControl?: ReactNode;
}) {
  const gradient = useId().replace(/:/g, "");
  const [selected, setSelected] = useState(Math.max(0, daily.length - 1));
  const current = daily[Math.min(selected, daily.length - 1)];
  if (!daily.length)
    return <p className="inventory-empty">روند روزانه برای این گزارش در دسترس نیست.</p>;
  const series = compact
    ? (["grossProfitAmount"] as const)
    : (["netSalesAmount", "theoreticalCogsAmount", "grossProfitAmount"] as const);
  const colors = ["#efb35d", "#aaa0dc", "#7ed4ac"];
  const values = daily.flatMap((day) =>
    series.map((key) => day[key]).filter((v): v is number => v !== null),
  );
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    span = max - min;
  const x = (i: number) => 60 + (i * 590) / Math.max(daily.length - 1, 1);
  const y = (v: number) => 186 - ((v - min) / span) * 158;
  const paths = (key: (typeof series)[number]) => {
    const segments: string[] = [];
    let segment = "";
    daily.forEach((day, i) => {
      const value = day[key];
      if (value === null) {
        if (segment) segments.push(segment);
        segment = "";
      } else segment += `${segment ? " L" : "M"}${x(i)},${y(value)}`;
    });
    if (segment) segments.push(segment);
    return segments;
  };
  return (
    <div className="inventory-chart">
      <div className="inventory-chart-readout" aria-live="polite">
        <span>{current ? dateLabel(current.date) : ""}</span>
        <strong>
          {current?.grossProfitAmount == null
            ? "سود محاسبه نشده"
            : `${number(current.grossProfitAmount)} تومان سود ناخالص`}
        </strong>
        <small>
          {current?.grossMarginPercent == null
            ? "حاشیه‌ی سود در دسترس نیست"
            : `حاشیه‌ی سود ${number(Number(current.grossMarginPercent))}٪`}
        </small>
      </div>
      <svg
        viewBox="0 0 680 225"
        role="img"
        aria-label={
          compact
            ? "روند روزانه سود ناخالص به تومان"
            : "روند روزانه فروش، بهای تمام‌شده و سود ناخالص به تومان"
        }
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#efb35d" stopOpacity=".32" />
            <stop offset="1" stopColor="#efb35d" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => {
          const value = min + (span * i) / 4;
          return (
            <g key={i}>
              <line x1="60" x2="650" y1={y(value)} y2={y(value)} stroke="#ffffff18" />
              <text x="48" y={y(value) + 4} textAnchor="end">
                {number(Math.round(value / (max >= 1e6 ? 1e6 : max >= 1000 ? 1000 : 1)))}
                {max >= 1e6 ? "M" : max >= 1000 ? "K" : ""}
              </text>
            </g>
          );
        })}
        {series.map((key, s) => (
          <g key={key}>
            {paths(key).map((path, i) => (
              <g key={i}>
                {s === 0 && (
                  <path
                    d={`${path} L${path.match(/([\d.]+),[-\d.]+$/)?.[1] ?? 60},${y(0)} L${path.match(/^M([\d.]+)/)?.[1] ?? 60},${y(0)} Z`}
                    fill={`url(#${gradient})`}
                  />
                )}
                <path
                  d={path}
                  fill="none"
                  stroke={compact ? colors[0] : colors[s]}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
              </g>
            ))}
          </g>
        ))}
        {daily.map((day, i) => (
          <g key={day.date} onMouseEnter={() => setSelected(i)}>
            <rect
              x={x(i) - Math.max(5, 295 / daily.length)}
              y="20"
              width={Math.max(10, 590 / daily.length)}
              height="175"
              fill="transparent"
            />
            {day.grossProfitAmount !== null && (daily.length < 35 || i === selected) && (
              <circle
                cx={x(i)}
                cy={y(day.grossProfitAmount)}
                r={i === selected ? 4.5 : 2.5}
                fill="#7ed4ac"
                stroke="#14251d"
              />
            )}
            {(i === 0 ||
              i === daily.length - 1 ||
              i % Math.max(1, Math.ceil(daily.length / 6)) === 0) && (
              <text
                x={x(i)}
                y="214"
                textAnchor="middle"
                className={
                  i === 0 || i === daily.length - 1
                    ? "inventory-chart-edge"
                    : "inventory-chart-interior"
                }
              >
                {dateLabel(day.date)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="inventory-chart-footer">
        <div className="inventory-chart-legend">
          {!compact && (
            <>
              <span style={{ color: colors[0] }}>
                <i />
                فروش خالص
              </span>
              <span style={{ color: colors[1] }}>
                <i />
                بهای تمام‌شده
              </span>
            </>
          )}
          <span style={{ color: compact ? colors[0] : colors[2] }}>
            <i />
            سود ناخالص
          </span>
        </div>
        <label>
          <span className="sr-only">روز نمودار</span>
          <select
            aria-label="روز نمودار"
            value={current?.date}
            onChange={(e) => setSelected(daily.findIndex((day) => day.date === e.target.value))}
          >
            {daily.map((day) => (
              <option key={day.date} value={day.date}>
                {dateLabel(day.date)}
              </option>
            ))}
          </select>
        </label>
        {rangeControl}
      </div>
      {!overview && daily.some((day) => day.incompleteOrderItemCount > 0) && (
        <p className="inventory-note">
          روزهای با هزینه‌ی ناقص، سود و بهای تمام‌شده ندارند و در نمودار فاصله می‌افتد.
        </p>
      )}
    </div>
  );
}

export function InventoryOverviewTrends() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<GrossProfitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setReport(null);
    setError(null);
    const range = recentInventoryRange(days);
    void readGrossProfitReport(range.from, range.to)
      .then((result) => {
        if (!active) return;
        if (result.ok) setReport(result.data);
        else setError(inventoryErrorMessage(result.error));
      })
      .catch(() => {
        if (active) setError("گزارش دریافت نشد. دوباره تلاش کنید.");
      });
    return () => {
      active = false;
    };
  }, [days, retry]);
  const totals = report?.data.totals;
  const rangeControl = (
    <select
      aria-label="بازه‌ی روند انبار"
      value={days}
      onChange={(e) => setDays(Number(e.target.value))}
    >
      <option value={7}>۷ روز گذشته</option>
      <option value={30}>۳۰ روز گذشته</option>
    </select>
  );
  const count = report
    ? report.data.costCoverage.completeOrderItemCount +
      report.data.costCoverage.incompleteOrderItemCount
    : 0;
  const complete = report?.data.costCoverage.completeOrderItemCount ?? 0;
  return (
    <section className="inventory-overview-trends">
      {(error || !report) && <div className="inventory-overview-range">{rangeControl}</div>}
      {error ? (
        <p className="form-error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            تلاش دوباره
          </button>
        </p>
      ) : !report ? (
        <p role="status" className="inventory-empty">
          در حال دریافت روند فروش…
        </p>
      ) : (
        <div className="inventory-overview-chart-grid">
          <article className="manager-card">
            <header className="inventory-section-heading">
              <h3>فروش خالص و هزینه‌ی مواد</h3>
              <strong>
                {number(totals!.netSalesAmount)} <small>تومان فروش</small>
              </strong>
            </header>
            <InventoryTrend daily={report.data.daily ?? []} overview rangeControl={rangeControl} />
          </article>
          <article className="manager-card inventory-overview-coverage">
            <header>
              <h3>پوشش هزینه‌ی فروش</h3>
            </header>
            <div className="inventory-donut">
              <svg viewBox="0 0 200 200" role="img" aria-label="نسبت اقلام فروش با هزینه‌ی کامل">
                <circle cx="100" cy="100" r="76" fill="none" stroke="#555466" strokeWidth="24" />
                {count > 0 && (
                  <circle
                    cx="100"
                    cy="100"
                    r="76"
                    fill="none"
                    stroke="#efb35d"
                    strokeWidth="24"
                    pathLength="100"
                    strokeDasharray={`${(complete / count) * 100} ${100 - (complete / count) * 100}`}
                    transform="rotate(-90 100 100)"
                  />
                )}
              </svg>
              <div>
                <strong>
                  {count ? `${number(Math.round((complete / count) * 100))}٪` : "بدون فروش"}
                </strong>
                <span>هزینه‌ی کامل</span>
              </div>
            </div>
            <p>
              {number(complete)} قلم کامل · {number(count - complete)} قلم ناقص
            </p>
          </article>
          <article className="manager-card">
            <header className="inventory-section-heading">
              <h3>سود ناخالص</h3>
              <strong
                className={
                  totals!.grossProfitAmount === null
                    ? undefined
                    : totals!.grossProfitAmount < 0
                      ? "inventory-negative"
                      : "inventory-positive"
                }
              >
                {totals!.grossProfitAmount === null
                  ? "محاسبه نشده"
                  : `${number(totals!.grossProfitAmount)} تومان`}
              </strong>
            </header>
            <InventoryTrend daily={report.data.daily ?? []} compact overview />
          </article>
        </div>
      )}
      {report?.data.daily?.some((day) => day.incompleteOrderItemCount > 0) && (
        <p className="inventory-overview-gap-note">
          روزهای با هزینه‌ی ناقص، سود و بهای تمام‌شده ندارند؛ فاصله‌های نمودار نشان‌دهنده‌ی این
          روزهاست.
        </p>
      )}
    </section>
  );
}

export function InventoryDailyMargin({ daily }: { daily: Day[] }) {
  const [selected, setSelected] = useState(Math.max(0, daily.length - 1));
  const day = daily[Math.min(selected, daily.length - 1)];
  if (!day) return <p className="inventory-empty">روند روزانه برای این گزارش در دسترس نیست.</p>;
  const minimum = Math.min(0, ...daily.map((d) => d.grossProfitAmount ?? 0));
  const maximum = Math.max(1, ...daily.map((d) => d.grossProfitAmount ?? 0));
  const y = (v: number) => 182 - ((v - minimum) / (maximum - minimum)) * 152;
  const width = 580 / daily.length;
  const margins = daily.flatMap((day) =>
    day.grossMarginPercent === null ? [] : [Number(day.grossMarginPercent)],
  );
  const minMargin = Math.min(0, ...margins),
    maxMargin = Math.max(100, ...margins);
  const marginY = (value: number) => 182 - ((value - minMargin) / (maxMargin - minMargin)) * 152;
  const marginPaths: string[] = [];
  let segment = "";
  daily.forEach((day, i) => {
    if (day.grossMarginPercent === null) {
      if (segment) marginPaths.push(segment);
      segment = "";
    } else
      segment += `${segment ? " L" : "M"}${60 + i * width + width / 2},${marginY(Number(day.grossMarginPercent))}`;
  });
  if (segment) marginPaths.push(segment);

  return (
    <div className="inventory-chart">
      <div className="inventory-chart-readout" aria-live="polite">
        <span>{dateLabel(day.date)}</span>
        <strong>
          {day.grossProfitAmount === null
            ? "سود محاسبه نشده"
            : `${number(day.grossProfitAmount)} تومان`}
        </strong>
        <small>
          حاشیه‌ی سود{" "}
          {day.grossMarginPercent === null
            ? "محاسبه نشده"
            : `${number(Number(day.grossMarginPercent))}٪`}
        </small>
      </div>
      <svg
        viewBox="0 0 680 225"
        role="img"
        aria-label="سود ناخالص روزانه به تومان و حاشیه‌ی سود به درصد"
      >
        <line x1="60" x2="650" y1={y(0)} y2={y(0)} stroke="#b7b5ad" />
        {[0, 1, 2, 3].map((i) => {
          const value = minimum + ((maximum - minimum) * i) / 3;
          return (
            <g key={i}>
              <line x1="60" x2="650" y1={y(value)} y2={y(value)} stroke="#ffffff18" />
              <text x="48" y={y(value) + 4} textAnchor="end">
                {number(Math.round(value / 1000))}K
              </text>
            </g>
          );
        })}
        {[0, 1, 2].map((i) => {
          const value = minMargin + ((maxMargin - minMargin) * i) / 2;
          return (
            <text key={i} x="675" y={marginY(value) + 4} textAnchor="end" fill="#7ed4ac">
              {number(Math.round(value))}٪
            </text>
          );
        })}
        {daily.map((d, i) => (
          <g key={d.date} onMouseEnter={() => setSelected(i)}>
            {d.grossProfitAmount !== null && (
              <rect
                x={60 + i * width + width * 0.16}
                y={Math.min(y(0), y(d.grossProfitAmount))}
                width={width * 0.68}
                height={Math.max(1, Math.abs(y(d.grossProfitAmount) - y(0)))}
                rx="2"
                fill={d.grossProfitAmount < 0 ? "#db857b" : "#cb944d"}
              />
            )}
            <rect x={60 + i * width} y="20" width={width} height="175" fill="transparent" />
            {(i === 0 || i === daily.length - 1 || i % Math.ceil(daily.length / 5) === 0) && (
              <text
                x={60 + i * width + width / 2}
                y="214"
                textAnchor="middle"
                className={
                  i === 0 || i === daily.length - 1
                    ? "inventory-chart-edge"
                    : "inventory-chart-interior"
                }
              >
                {dateLabel(d.date)}
              </text>
            )}
          </g>
        ))}
        {marginPaths.map((path, i) => (
          <path key={i} d={path} fill="none" stroke="#7ed4ac" strokeWidth="2.5" />
        ))}
        {daily.map((observation, i) =>
          observation.grossMarginPercent === null ? null : (
            <circle
              key={observation.date}
              className="inventory-margin-observation"
              cx={60 + i * width + width / 2}
              cy={marginY(Number(observation.grossMarginPercent))}
              r="4"
              fill="#7ed4ac"
              stroke="#20372b"
              strokeWidth="1.5"
              onMouseEnter={() => setSelected(i)}
            />
          ),
        )}
      </svg>
      <div className="inventory-chart-footer">
        <span className="inventory-note">ستون‌ها: سود (تومان) · خط: حاشیه‌ی سود (٪)</span>
        <label>
          <span className="sr-only">روز حاشیه‌ی سود</span>
          <select
            value={day.date}
            onChange={(e) => setSelected(daily.findIndex((d) => d.date === e.target.value))}
          >
            {daily.map((d) => (
              <option key={d.date} value={d.date}>
                {dateLabel(d.date)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
