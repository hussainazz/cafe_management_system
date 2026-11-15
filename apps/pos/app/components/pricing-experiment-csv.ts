import type { PricingExperimentReport } from "../lib/api-client";

type Cell = string | number | boolean | null;
function escapeCsv(value: Cell) {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function pricingExperimentCsv(report: PricingExperimentReport) {
  const rows: Cell[][] = [["بخش", "شاخص", "دوره یا محصول", "مقدار", "واحد"]];
  const add = (section: string, metric: string, item: string, value: Cell, unit = "") => rows.push([section, metric, item, value, unit]);
  add("آزمایش", "نام", "", report.data.experiment.name);
  add("آزمایش", "زمان مؤثر", "", report.data.experiment.effectiveAt);
  add("آزمایش", "مدت مقایسه", "", report.data.periods.before.requestedDayCount, "روز");
  for (const [side, label] of [["before", "پیش از تغییر"], ["after", "پس از تغییر"]] as const) {
    const period = report.data.periods[side];
    add("بازه", "از تاریخ", label, period.fromDate);
    add("بازه", "تا تاریخ", label, period.toDate);
    add("فروش", "تعداد سفارش واجد شرایط", label, period.orderCount, "سفارش");
    add("فروش", "واحد کالا", label, period.itemUnits, "واحد");
    add("فروش", "واحد کالای مشمول", label, period.affectedItemUnits, "واحد");
    add("فروش", "فروش خالص", label, period.netRevenueAmount, "تومان");
    add("فروش", "میانگین قیمت تحقق‌یافته", label, period.averageSellingPriceAmount, "تومان / واحد");
    add("فروش", "میانگین ارزش سفارش", label, period.averageOrderValueAmount, "تومان / سفارش");
    add("هزینه", "بهای معلوم کالا", label, period.ingredientCogsAmount, "تومان");
    add("هزینه", "درآمد با بهای کامل", label, period.completeCostRevenueAmount, "تومان");
    add("هزینه", "درآمد با بهای ناقص", label, period.incompleteCostRevenueAmount, "تومان");
    add("مشارکت", "مشارکت شناخته‌شده", label, period.knownContributionAmount, "تومان");
    add("مشارکت", "مشارکت کل", label, period.contributionAmount, "تومان");
    add("مشارکت", "حاشیه‌ی مشارکت", label, period.contributionMarginPercent, "%");
    add("مشارکت", "پوشش هزینه", label, period.costCoveragePercent, "%");
    add("مشارکت", "مشارکت معادل ۳۰ روز", label, period.monthlyEquivalentContributionAmount, "تومان");
    add("ثابت", "درصد پوشش هزینه‌ی ثابت", label, period.fixedCostCoveragePercent, "%");
    add("ثابت", "حاشیه‌ی ایمنی درآمد ماهانه", label, period.marginOfSafetyAmount, "تومان");
    add("ثابت", "درصد حاشیه‌ی ایمنی", label, period.marginOfSafetyPercent, "%");
    add("بسته‌بندی", "درآمد بسته‌بندی", label, period.packagingChargeRevenueAmount, "تومان");
    add("بسته‌بندی", "هزینه‌ی معلوم مواد", label, period.packagingMaterialCostAmount, "تومان");
    add("بسته‌بندی", "کسری بسته‌بندی", label, period.packagingDeficitAmount, "تومان");
    add("بسته‌بندی", "نرخ بازیافت", label, period.packagingRecoveryRatePercent, "%");
    add("کانال", "سهم سفارش بیرون‌بر", label, period.takeawayMixPercent, "%");
  }
  for (const product of report.data.products) {
    const name = `${product.productName} · ${product.options.map((option) => option.optionName).join(" / ") || "بدون گزینه"} · ${product.channel}`;
    add("محصول", "مشمول آزمایش", name, product.affected);
    add("محصول", "قیمت پیش از تغییر", name, product.previousPriceAmount, "تومان");
    add("محصول", "قیمت آزمایش", name, product.experimentPriceAmount, "تومان");
    add("محصول", "قیمت فعلی کاتالوگ", name, product.currentCatalogPriceAmount, "تومان");
    add("محصول", "میانگین قیمت تحقق‌یافته پیش", name, product.averageRealizedPriceBeforeAmount, "تومان");
    add("محصول", "میانگین قیمت تحقق‌یافته پس", name, product.averageRealizedPriceAfterAmount, "تومان");
    add("محصول", "تعداد پیش", name, product.quantityBefore, "واحد");
    add("محصول", "تعداد پس", name, product.quantityAfter, "واحد");
    add("محصول", "سهم واحد پیش", name, product.unitShareBeforePercent, "%");
    add("محصول", "سهم واحد پس", name, product.unitShareAfterPercent, "%");
    add("محصول", "درآمد پیش", name, product.revenueBeforeAmount, "تومان");
    add("محصول", "درآمد پس", name, product.revenueAfterAmount, "تومان");
    add("محصول", "سهم فروش پیش", name, product.revenueShareBeforePercent, "%");
    add("محصول", "سهم فروش پس", name, product.revenueShareAfterPercent, "%");
    add("محصول", "هزینه‌ی هر واحد پس", name, product.unitCostAfterAmount, "تومان");
    add("محصول", "مشارکت پیش", name, product.contributionBeforeAmount, "تومان");
    add("محصول", "مشارکت پس", name, product.contributionAfterAmount, "تومان");
    add("محصول", "تغییر مشارکت", name, product.contributionChangeAmount, "تومان");
    add("محصول", "پوشش هزینه پس", name, product.costCoveragePercent, "%");
  }
  for (const category of report.data.categories) {
    add("دسته", "فروش خالص پیش", category.categoryName, category.netRevenueBeforeAmount, "تومان");
    add("دسته", "فروش خالص پس", category.categoryName, category.netRevenueAfterAmount, "تومان");
    add("دسته", "سهم فروش پیش", category.categoryName, category.revenueShareBeforePercent, "%");
    add("دسته", "سهم فروش پس", category.categoryName, category.revenueShareAfterPercent, "%");
    add("دسته", "مشارکت پیش", category.categoryName, category.contributionBeforeAmount, "تومان");
    add("دسته", "مشارکت پس", category.categoryName, category.contributionAfterAmount, "تومان");
  }
  for (const point of report.data.daily) {
    add("روزانه", "تعداد سفارش", point.date, point.orderCount, "سفارش");
    add("روزانه", "واحد کالا", point.date, point.itemUnits, "واحد");
    add("روزانه", "فروش خالص", point.date, point.netRevenueAmount, "تومان");
    add("روزانه", "مشارکت", point.date, point.contributionAmount, "تومان");
    add("روزانه", "حاشیه‌ی مشارکت", point.date, point.contributionMarginPercent, "%");
  }
  const decomposition = report.data.decomposition;
  add("تجزیه", "اثر قیمت", "", decomposition.priceEffectAmount, "تومان");
  add("تجزیه", "اثر حجم", "", decomposition.volumeEffectAmount, "تومان");
  add("تجزیه", "اثر ترکیب", "", decomposition.mixEffectAmount, "تومان");
  add("تجزیه", "اثر هزینه‌ی واحد", "", decomposition.unitCostEffectAmount, "تومان");
  add("تجزیه", "تغییر مشاهده‌شده", "", decomposition.observedContributionChangeAmount, "تومان");
  add("تجزیه", "باقی‌مانده", "", decomposition.residualAmount, "تومان");
  add("شاخص ثابت", "تغییر پوشش هزینه‌ی ثابت", "", report.data.changes.fixedCostCoveragePercent, "واحد درصد");
  add("شاخص ثابت", "تغییر حاشیه‌ی ایمنی", "", report.data.changes.marginOfSafetyAmount, "تومان");
  add("شاخص ثابت", "تغییر درصد حاشیه‌ی ایمنی", "", report.data.changes.marginOfSafetyPercent, "واحد درصد");
  for (const row of report.data.breakEven.products) {
    add("نقطه‌ی سربه‌سر", "محصول یا گزینه", row.label, row.maximumTolerableUnitDeclinePercent, "% افت واحد");
    add("نقطه‌ی سربه‌سر", "افزایش مشارکت در حجم مشاهده‌شده", row.label, row.contributionBenefitAtObservedVolumeAmount, "تومان");
  }
  add("نقطه‌ی سربه‌سر", "افت حجم کل مشمول", "", report.data.breakEven.wholeAffectedGroupDeclinePercent, "%");
  for (const flag of report.data.dataQuality.flags) add("کیفیت داده", flag.code, "", flag.messageFa, flag.severity);
  add("روش", "تجزیه‌ی مشارکت", "", decomposition.method);
  add("نتیجه", report.data.assessment.outcome, "", report.data.assessment.summaryFa);
  return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
}
