import type { GrossProfitReport } from "../lib/api-client";
import { formatToman } from "../lib/pos-utils";
import { InventoryMetric, inventoryNumber } from "./inventory-dashboard";

type PackagingEconomics = GrossProfitReport["data"]["packagingEconomics"];
const money = (value: number | null) => value === null ? "محاسبه نشده" : inventoryNumber(formatToman(value));
const channelLabel = (channel: "TABLE" | "TAKEAWAY") => channel === "TABLE" ? "داخل کافه" : "بیرون‌بر";
const dayLabel = (date: string) => new Date(`${date}T12:00:00+03:30`).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran", month: "short", day: "numeric" });

function PackagingTrend({ data }: { data: PackagingEconomics["daily"] }) {
  if (!data.length) return <p className="inventory-empty">روند بسته‌بندی برای این بازه در دسترس نیست.</p>;
  const values = data.flatMap((day) => [day.packagingChargeRevenueAmount, day.knownMaterialCostAmount, day.netRecoveryAmount ?? 0]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = max - min;
  const x = (index: number) => 42 + (index * 596) / Math.max(data.length - 1, 1);
  const y = (value: number) => 182 - ((value - min) / range) * 145;
  const path = (select: (day: PackagingEconomics["daily"][number]) => number | null) => {
    const segments: string[] = [];
    let segment = "";
    data.forEach((day, index) => {
      const value = select(day);
      if (value === null) {
        if (segment) segments.push(segment);
        segment = "";
      } else segment += `${segment ? " L" : "M"}${x(index)},${y(value)}`;
    });
    if (segment) segments.push(segment);
    return segments;
  };
  const series = [
    { label: "بهای مواد بسته‌بندی", color: "#aaa0dc", value: (day: PackagingEconomics["daily"][number]) => day.knownMaterialCostAmount },
    { label: "مبلغ ردیف بسته‌بندی", color: "#efb35d", value: (day: PackagingEconomics["daily"][number]) => day.packagingChargeRevenueAmount },
    { label: "مازاد یا کسری", color: "#7ed4ac", value: (day: PackagingEconomics["daily"][number]) => day.netRecoveryAmount },
  ];
  return <div className="inventory-chart">
    <div className="inventory-profit-bars" aria-label="راهنمای نمودار">
      {series.map((item) => <span key={item.label} style={{ color: item.color }}>{item.label}</span>)}
    </div>
    <svg viewBox="0 0 680 210" role="img" aria-label="روند روزانه درآمد بسته‌بندی، بهای مواد بسته‌بندی و مازاد یا کسری به تومان">
      {[0, 1, 2, 3, 4].map((line) => {
        const value = min + range * line / 4;
        return <g key={line}><line x1="38" x2="654" y1={y(value)} y2={y(value)} stroke="#ffffff18" /><text x="32" y={y(value) + 4} textAnchor="end">{inventoryNumber(Math.round(value / (max >= 1e6 ? 1e6 : max >= 1000 ? 1000 : 1)))}{max >= 1e6 ? "M" : max >= 1000 ? "K" : ""}</text></g>;
      })}
      {series.map((item) => <g key={item.label}>{path(item.value).map((d, index) => <path key={index} d={d} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" />)}</g>)}
      {data.filter((_, index) => index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 5) === 0).map((day) => {
        const index = data.indexOf(day);
        return <text key={day.date} x={x(index)} y="202" textAnchor="middle">{dayLabel(day.date)}</text>;
      })}
    </svg>
  </div>;
}

export function InventoryPackagingEconomics({ data }: { data: PackagingEconomics }) {
  const totals = data.totals;
  const coverage = totals.attributionCoveragePercent;
  return <section className="manager-card inventory-report-products" aria-labelledby="packaging-economics-title">
    <header>
      <h2 id="packaging-economics-title">اقتصاد بسته‌بندی</h2>
      <p>درآمد از ردیف سیستمی «بسته‌بندی» و بهای مواد از snapshot هزینه‌ی سفارش‌های تسویه‌شده محاسبه می‌شود. این تفکیک، سود ناخالص کل را تغییر نمی‌دهد.</p>
    </header>
    <dl className="inventory-metrics">
      <InventoryMetric label="درآمد بسته‌بندی (تومان)" value={money(totals.packagingChargeRevenueAmount)} detail="پس از برگشت‌های ثبت‌شده‌ی تسویه" />
      <InventoryMetric label="بهای معلوم مواد بسته‌بندی (تومان)" value={money(totals.knownMaterialCostAmount)} detail={`هزینه‌ی نامشخص: ${money(totals.unclassifiedKnownCostAmount)} تومان`} />
      <InventoryMetric label="مازاد یا کسری بسته‌بندی (تومان)" value={money(totals.netRecoveryAmount)} detail={totals.netRecoveryAmount === null ? "به‌دلیل پوشش ناکامل محاسبه نشده" : totals.netRecoveryAmount < 0 ? "کسری بازیافت هزینه" : "درآمد منهای بهای مواد معلوم"} tone={totals.netRecoveryAmount === null ? undefined : totals.netRecoveryAmount < 0 ? "warning" : "success"} />
      <InventoryMetric label="نرخ بازیافت" value={totals.recoveryRatePercent === null ? "محاسبه نشده" : `${inventoryNumber(totals.recoveryRatePercent)}٪`} detail="درآمد بسته‌بندی تقسیم بر بهای مواد معلوم؛ هزینه‌ی صفر یا پوشش ناکامل نرخ ندارد" />
      <InventoryMetric label="پوشش انتساب مواد" value={coverage === null ? "محاسبه نشده" : `${inventoryNumber(coverage)}٪`} detail={`${inventoryNumber(totals.completeOrderItemCount)} قلم کامل از ${inventoryNumber(totals.completeOrderItemCount + totals.incompleteOrderItemCount)} قلم مرتبط`} />
    </dl>
    <p className="inventory-note">{inventoryNumber(totals.unattributedOrderLevelChargeRevenueAmount)} تومان از درآمد در سطح سفارش باقی مانده است. مبلغ ردیف‌های بسته‌بندی که به کالاها اختصاص داده شده‌اند، بر اساس تعداد واحدهای اختصاص‌یافته میان محصولات تقسیم می‌شود. برای سفارش‌های قدیمی بدون این ارتباط، اگر فقط یک محصول منو داشته باشند درآمد بین گزینه‌های همان محصول بر اساس فروش خالص تقسیم می‌شود؛ سفارش چندمحصولی همچنان در سطح سفارش می‌ماند. هزینه‌های snapshot قدیمی که نقش مواد را ثبت نکرده‌اند، جداگانه و به‌صورت نامشخص نگه داشته می‌شوند.</p>
    {totals.missingMaterialValuationCount > 0 && <p className="inventory-note">برای {inventoryNumber(totals.missingMaterialValuationCount)} قلم، ارزش‌گذاری مواد بسته‌بندی کامل نیست. انتساب سفارش‌های دارای ردیف بسته‌بندی در میز نیز مبهم گزارش می‌شود.</p>}
    <div className="inventory-profit-charts"><section className="manager-card"><header><h3>روند درآمد و هزینه‌ی بسته‌بندی</h3><p>بر اساس روز ثبت تسویه‌ی کامل در منطقه‌ی زمانی تهران؛ مبالغ به تومان.</p></header><PackagingTrend data={data.daily} /></section></div>
    <div className="inventory-table-wrap" role="region" aria-label="تفکیک بسته‌بندی بر اساس محصول" tabIndex={0}>
      <table className="inventory-table">
        <thead><tr><th scope="col">محصول و گزینه‌ها</th><th scope="col">نوع فروش</th><th scope="col">تعداد</th><th scope="col">بسته‌بندی اختصاص‌یافته</th><th scope="col">درآمد محصول</th><th scope="col">سهم درآمد بسته‌بندی</th><th scope="col">بهای مواد بسته‌بندی</th><th scope="col">مازاد یا کسری</th><th scope="col">مشارکت پیش از بسته‌بندی</th><th scope="col">مشارکت پس از بسته‌بندی</th></tr></thead>
        <tbody>{data.products.map((product) => <tr key={`${product.productId}:${product.channel}:${product.options.map((option) => `${option.optionId}=${option.quantity}`).join(",")}`}>
          <th scope="row">{product.productName}<small className="inventory-cell-note">{product.categoryName ?? "دسته‌بندی نامشخص"}</small><small className="inventory-cell-note">{product.options.length ? product.options.map((option) => `${option.optionName}${option.quantity !== 1 ? ` × ${option.quantity.toLocaleString("fa-IR", { maximumFractionDigits: 3 })}` : ""}`).join("، ") : "بدون گزینه"}</small></th>
          <td>{channelLabel(product.channel)}</td><td>{inventoryNumber(product.soldQuantity)}</td>
          <td>{product.assignedPackaging.length ? product.assignedPackaging.map((packing) => <small className="inventory-cell-note" key={packing.packagingProductId}>{packing.packagingProductName} × {inventoryNumber(packing.quantity)}</small>) : "ثبت نشده"}</td>
          <td><bdi>{money(product.productNetSalesAmount)}</bdi></td><td><bdi>{money(product.packagingChargeRevenueAmount)}</bdi></td>
          <td><bdi>{money(product.packagingKnownCostAmount)}</bdi>{product.unclassifiedKnownCostAmount > 0 && <small className="inventory-cell-note">نامشخص: {money(product.unclassifiedKnownCostAmount)}</small>}</td>
          <td><bdi>{money(product.netRecoveryAmount)}</bdi></td><td><bdi>{money(product.productContributionBeforePackagingAmount)}</bdi></td><td><bdi>{money(product.combinedContributionAfterPackagingAmount)}</bdi></td>
        </tr>)}{data.products.length === 0 && <tr><td colSpan={10} className="inventory-empty">در این بازه فروش مرتبط با بسته‌بندی ثبت نشده است.</td></tr>}</tbody>
      </table>
    </div>
    <div className="inventory-table-wrap" role="region" aria-label="تفکیک بسته‌بندی بر اساس دسته‌بندی" tabIndex={0}>
      <table className="inventory-table"><thead><tr><th scope="col">دسته‌بندی فعلی</th><th scope="col">نوع فروش</th><th scope="col">درآمد محصول</th><th scope="col">درآمد بسته‌بندی</th><th scope="col">بهای مواد بسته‌بندی</th><th scope="col">مازاد یا کسری</th><th scope="col">نرخ بازیافت</th></tr></thead>
        <tbody>{data.categories.map((category) => <tr key={`${category.categoryId ?? "unknown"}:${category.channel}`}><th scope="row">{category.categoryName}</th><td>{channelLabel(category.channel)}</td><td><bdi>{money(category.productNetSalesAmount)}</bdi></td><td><bdi>{money(category.packagingChargeRevenueAmount)}</bdi></td><td><bdi>{money(category.knownMaterialCostAmount)}</bdi></td><td><bdi>{money(category.netRecoveryAmount)}</bdi></td><td>{category.recoveryRatePercent === null ? "محاسبه نشده" : `${inventoryNumber(category.recoveryRatePercent)}٪`}</td></tr>)}{data.categories.length === 0 && <tr><td colSpan={7} className="inventory-empty">دسته‌بندی مرتبطی برای نمایش وجود ندارد.</td></tr>}</tbody>
      </table>
    </div>
    <p className="inventory-note">دسته‌بندی از اطلاعات فعلی محصول می‌آید؛ دسته‌بندی تاریخی برای سفارش‌ها ذخیره نشده است. تطبیق با گردش انبار نمایش داده نمی‌شود، چون ثبت گردش فعلی نقش بسته‌بندی و مواد محصول را در سطح هر جزء نگه نمی‌دارد. اختلاف موجودی به‌تنهایی به‌معنای ضایعات نیست.</p>
  </section>;
}
