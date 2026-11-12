"use client";
import type { GrossProfitReport, ManagerCatalog } from "../lib/api-client";
import { formatToman } from "../lib/pos-utils";
const palette = ["#eab05d", "#7ec6a4", "#aaa0d6", "#d7927e", "#94a4ad"];
export function InventoryProfitBreakdown({
  report,
  catalog,
}: {
  report: GrossProfitReport;
  catalog?: ManagerCatalog;
}) {
  const groups = new Map<string, { name: string; profit: number; incomplete: boolean }>();
  for (const product of report.data.products) {
    const categoryId = catalog?.products.find((p) => p.id === product.productId)?.categoryId;
    const name = catalog?.categories.find((c) => c.id === categoryId)?.name ?? "دسته‌بندی نامشخص";
    const group = groups.get(name) ?? { name, profit: 0, incomplete: false };
    group.profit += product.grossProfitAmount ?? 0;
    group.incomplete ||= product.grossProfitAmount === null;
    groups.set(name, group);
  }
  const rows = [...groups.values()].sort((a, b) => b.profit - a.profit);
  const sum = rows.reduce((total, row) => total + row.profit, 0);
  const canDraw = sum > 0 && rows.every((row) => !row.incomplete && row.profit >= 0);
  let offset = 0;
  return (
    <section className="manager-card inventory-category-profit">
      <header>
        <h2>سهم دسته‌بندی‌ها از سود ناخالص</h2>
        <p>بر اساس دسته‌بندی فعلی منو؛ مبالغ به تومان.</p>
      </header>
      {canDraw && (
        <div className="inventory-donut">
          <svg viewBox="0 0 200 200" role="img" aria-label="سهم دسته‌بندی‌های فعلی از سود ناخالص">
            <circle cx="100" cy="100" r="76" fill="none" stroke="#454640" strokeWidth="28" />
            {rows.map((row, i) => {
              const part = (row.profit / sum) * 100;
              const start = offset;
              offset += part;
              return (
                <circle
                  key={row.name}
                  cx="100"
                  cy="100"
                  r="76"
                  pathLength="100"
                  fill="none"
                  stroke={palette[i % palette.length]}
                  strokeWidth="28"
                  strokeDasharray={`${part} ${100 - part}`}
                  strokeDashoffset={-start}
                  transform="rotate(-90 100 100)"
                />
              );
            })}
          </svg>
          <div>
            <strong>{formatToman(sum)}</strong>
            <span>سود ناخالص · تومان</span>
          </div>
        </div>
      )}
      <ul className="inventory-category-legend">
        {rows.map((row, i) => (
          <li key={row.name}>
            <span>
              <i style={{ background: palette[i % palette.length] }} />
              {row.name}
            </span>
            <strong className={row.profit < 0 ? "inventory-negative" : undefined}>
              {row.incomplete ? "هزینه ناقص" : formatToman(row.profit)}
            </strong>
            {canDraw && (
              <small>
                {((row.profit / sum) * 100).toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪
              </small>
            )}
          </li>
        ))}
      </ul>
      {!rows.length && <p className="inventory-empty">فروش تسویه‌شده‌ای در این بازه وجود ندارد.</p>}
      {rows.some((row) => row.incomplete || row.profit < 0) && (
        <p className="inventory-note">
          با وجود زیان یا هزینه‌ی ناقص، نمودار سهم نمایش داده نمی‌شود.
        </p>
      )}
    </section>
  );
}
