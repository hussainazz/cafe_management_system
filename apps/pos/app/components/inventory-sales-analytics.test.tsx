// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventorySalesAnalytics } from "./inventory-sales-analytics";
import * as api from "../lib/api-client";
import { persianDateToGregorianDate } from "../lib/tehran-date";

vi.mock("../lib/api-client", () => ({ readSalesAnalyticsReport: vi.fn() }));

const productId = "11111111-1111-4111-8111-111111111111";
const secondProductId = "44444444-4444-4444-8444-444444444444";
const categoryId = "22222222-2222-4222-8222-222222222222";
const optionId = "33333333-3333-4333-8333-333333333333";
const catalog = {
  products: [{ id: productId, name: "قهوه", archivedAt: null, systemKey: null }, { id: secondProductId, name: "لاته", archivedAt: null, systemKey: null }],
  categories: [{ id: categoryId, name: "نوشیدنی", kind: "SOURCE", archivedAt: null }],
  optionGroups: [{ id: "group-1", name: "اندازه", options: [{ id: optionId, name: "بزرگ", archivedAt: null }] }],
} as never;

const operationalBucket = {
  dayOfWeek: 3, hour: 10, minute: 0 as const, orderCount: 1, itemUnits: 2, netSalesAmount: 20_000,
  averageOrderValueAmount: 20_000, orderValueSumAmount: 20_000, hasSales: true, isScheduledOpen: true, closureKnown: true as const,
};
const financialBucket = {
  ...operationalBucket, knownCogsAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0,
  completeCostItemCount: 0, incompleteCostItemCount: 1, knownContributionAmount: 0,
  knownContributionMarginPercent: null, totalContributionAmount: null, totalContributionMarginPercent: null,
  costCoveragePercent: "0.00", isCostComplete: false,
};
const productRow = {
  date: "2026-11-11", hour: 10, minute: 0 as const, productId, productName: "قهوه", categoryId, categoryName: "نوشیدنی",
  channel: "TABLE" as const, options: [{ optionId, optionName: "بزرگ", quantity: 1 }], quantitySold: 2,
  uniqueOrdersContainingProduct: 1, netSalesAmount: 20_000,
};
const report = {
  data: {
    overview: {
      operationalDemand: { orderCount: 1, itemUnits: 2, netSalesAmount: 20_000, averageOrderValueAmount: 20_000, orderValueSumAmount: 20_000, itemEntryFallbackCount: 0 },
      financialRecognition: { orderCount: 1, itemUnits: 2, netSalesAmount: 20_000, averageOrderValueAmount: 20_000,
        knownCogsAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0, completeCostItemCount: 0,
        incompleteCostItemCount: 1, knownContributionAmount: 0, knownContributionMarginPercent: null,
        totalContributionAmount: null, totalContributionMarginPercent: null, costCoveragePercent: "0.00", isCostComplete: false },
    },
    operationalBuckets: [operationalBucket], financialBuckets: [financialBucket],
    productDemandSeries: [{ ...productRow, itemEntryFallbackCount: 0 }, { ...productRow, productId: secondProductId, productName: "لاته", options: [], quantitySold: 1, itemEntryFallbackCount: 0 }],
    productFinancialSeries: [{ ...productRow, knownCogsAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0,
      knownContributionAmount: 0, knownContributionMarginPercent: null, totalContributionAmount: null,
      totalContributionMarginPercent: null, costCoveragePercent: "0.00", isCostComplete: false },
    { ...productRow, productId: secondProductId, productName: "لاته", options: [], knownCogsAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0,
      knownContributionAmount: 0, knownContributionMarginPercent: null, totalContributionAmount: null,
      totalContributionMarginPercent: null, costCoveragePercent: "0.00", isCostComplete: false }],
    productPeaks: [{ productId, productName: "قهوه", totalQuantity: 2, uniqueOrdersContainingProduct: 1,
      highestVolume: { dayOfWeek: 3, hour: 10, minute: 0, quantity: 2 }, highestRevenue: { dayOfWeek: 3, hour: 10, minute: 0, amount: 20_000 },
      highestKnownContribution: null, weekdayDistribution: [{ dayOfWeek: 3, quantity: 2, uniqueOrdersContainingProduct: 1 }],
      channelDistribution: [{ channel: "TABLE", quantity: 2, uniqueOrdersContainingProduct: 1, netSalesAmount: 20_000 }] }],
    insights: { busiestPeriod: { dayOfWeek: 3, hour: 10, minute: 0, orderCount: 1 },
      highestRevenuePeriod: { dayOfWeek: 3, hour: 10, minute: 0, amount: 20_000 }, highestKnownContributionPeriod: null,
      highestAverageOrderValuePeriod: { dayOfWeek: 3, hour: 10, minute: 0, amount: 20_000 },
      strongestCategoriesByWindow: [{ window: "MORNING", categoryId, categoryName: "نوشیدنی", netSalesAmount: 20_000 }],
      contributionPerOperatingHourAmount: null, operatingHoursPerDay: 16, operatingHoursInRange: 16 },
    timeSemantics: { timezone: "Asia/Tehran", operatingSchedule: { opensAtHour: 8, closesAtHour: 0, hoursPerDay: 16 }, operationalTimeLabel: "ORDER_CREATED_OR_ITEM_FIRST_ENTERED",
      financialTimeLabel: "RECOGNIZED_CONSUMPTION", historicalItemEntryFallbackCount: 0,
      itemEntryDefinition: "زمان نخستین ورود", categoryDefinition: "CURRENT_CATALOG" },
  },
  meta: { requestId: "test", range: { from: "2026-11-10T20:30:00.000Z", to: "2026-11-12T20:30:00.000Z" }, intervalMinutes: 60 },
};
const ok = (data: unknown) => ({ ok: true, data });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readSalesAnalyticsReport).mockResolvedValue(ok(report) as never);
});
afterEach(() => cleanup());

describe("Manager sales analytics panel", () => {
  it("renders the financial disclosure, accessible heatmap, and responsive chart containers", async () => {
    const { container } = render(<InventorySalesAnalytics catalog={catalog} />);
    await screen.findByText("فروش، مشارکت و ساعت‌های اوج");
    expect(container.textContent).not.toContain("ناعدد");
    expect(container.textContent).not.toContain("NaN");
    expect(screen.getAllByText(/۲۰٬۰۰۰ تومان/).length).toBeGreaterThan(0);
    expect(screen.getByText("هزینه‌ی بخشی از فروش ثبت نشده است.", { exact: false })).toBeTruthy();
    expect(screen.getByRole("table", { name: /نقشه‌ی گرمایی/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /مقایسه‌ی روند فروش محصولات/ })).toBeTruthy();
    expect(document.querySelector(".sales-analytics-heatmap-wrap")).toBeTruthy();
    expect(document.querySelectorAll(".sales-analytics-svg-wrap").length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector(".sales-analytics-heatmap")?.className).toBe("sales-analytics-heatmap");
    expect(screen.getByText("مشارکت شناخته‌شده در هر ساعت کاری")).toBeTruthy();
    expect(screen.getByText(/برنامه‌ی کاری هر روز از ۰۸:۰۰ تا ۰۰:۰۰/)).toBeTruthy();
    expect(container.querySelector('td[data-scheduled-open="false"]')?.getAttribute("title")).toContain("طبق برنامه کافه بسته است");
    expect(container.querySelector('td[data-scheduled-open="true"]')?.getAttribute("title")).toContain("داخل ساعت کاری برنامه‌ریزی‌شده");

    fireEvent.change(screen.getByLabelText("پایه‌ی زمانی نقشه‌ی فروش"), { target: { value: "recognition" } });
    expect(screen.getByRole("table", { name: /فروش خالص در زمان شناسایی/ })).toBeTruthy();
    expect(screen.getByText(/زمان شناسایی مصرف و فروش/)).toBeTruthy();
  });

  it("submits product, category, option, channel, weekday and interval filters together", async () => {
    render(<InventorySalesAnalytics catalog={catalog} />);
    await screen.findByText("فروش، مشارکت و ساعت‌های اوج");
    const selectMany = (label: string, values: string[]) => {
      const select = screen.getByLabelText(label) as HTMLSelectElement;
      for (const option of Array.from(select.options)) option.selected = values.includes(option.value);
      fireEvent.change(select);
    };
    selectMany("انتخاب محصول‌ها", [productId, secondProductId]);
    selectMany("انتخاب دسته‌ها", [categoryId]);
    selectMany("انتخاب گزینه‌ها و واریانت‌ها", [optionId]);
    fireEvent.change(screen.getByLabelText("کانال فروش تحلیل فروش"), { target: { value: "TABLE" } });
    fireEvent.change(screen.getByLabelText("تفکیک زمانی"), { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText("چهارشنبه"));
    fireEvent.change(screen.getByLabelText("بازه‌ی گزارش تحلیل فروش"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("از تاریخ شمسی تحلیل فروش"), { target: { value: "08/19" } });
    fireEvent.change(screen.getByLabelText("سال آغاز تحلیل فروش"), { target: { value: "1405" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ شمسی تحلیل فروش"), { target: { value: "08/20" } });
    fireEvent.change(screen.getByLabelText("سال پایان تحلیل فروش"), { target: { value: "1405" } });
    fireEvent.click(screen.getByRole("button", { name: "نمایش تحلیل" }));
    await waitFor(() => expect(api.readSalesAnalyticsReport).toHaveBeenCalledTimes(2));
    expect(api.readSalesAnalyticsReport).toHaveBeenLastCalledWith(expect.objectContaining({
      fromDate: persianDateToGregorianDate("1405", "08/19"), toDate: persianDateToGregorianDate("1405", "08/20"),
      intervalMinutes: 30, productIds: [productId, secondProductId], categoryIds: [categoryId], optionIds: [optionId],
      channel: "TABLE", daysOfWeek: [4],
    }));
    expect(screen.getByRole("img", { name: /توزیع واحدهای محصول بر اساس ساعت ثبت قلم/ })).toBeTruthy();
  });
});
