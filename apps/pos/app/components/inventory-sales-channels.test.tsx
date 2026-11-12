// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventorySalesChannelsPanel } from "./inventory-sales-channels";
import * as api from "../lib/api-client";
import { persianDateToGregorianDate } from "../lib/tehran-date";

vi.mock("../lib/api-client", () => ({ readSalesChannelReport: vi.fn() }));

const data = {
  orderDistribution: { totalCount: 4, takeawayCount: 2, dineInCount: 2, takeawayPercent: "50.00", dineInPercent: "50.00" },
  averageOrderValue: { takeawayAmount: 30_000, dineInAmount: 41_500, absoluteDifferenceAmount: 11_500, differencePercent: "27.71" },
  revenue: { totalAmount: 143_000, takeawayAmount: 60_000, dineInAmount: 83_000, takeawayPercent: "41.96", dineInPercent: "58.04" },
  takeawayOrigin: { directTakeawayCount: 1, tableOriginatedTakeawayCount: 1, directTakeawayRevenueAmount: 15_000, tableOriginatedTakeawayRevenueAmount: 45_000 },
  unclassifiedHistoricalOrigin: { count: 0, revenueAmount: 0 },
};
const response = { data, meta: { requestId: "test", range: { from: "2026-11-10T20:30:00.000Z", to: "2026-11-11T20:30:00.000Z" } } };
const ok = (value: unknown) => ({ ok: true, data: value });
const tehranDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readSalesChannelReport).mockResolvedValue(ok(response) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("inventory sales channel report", () => {
  it("shows order share, discounted average order values, revenue and the origin split", async () => {
    render(<InventorySalesChannelsPanel />);
    await screen.findByText("جمع سفارش‌های تسویه‌شده");
    expect(screen.getByText("سهم سفارش‌های بیرون‌بر").closest("div")!.textContent).toContain("۵۰.۰۰٪");
    expect(screen.getByText("میانگین سفارش بیرون‌بر (تومان)").closest("div")!.textContent).toContain("۳۰,۰۰۰");
    expect(screen.getByText("میانگین سفارش داخل کافه (تومان)").closest("div")!.textContent).toContain("۴۱,۵۰۰");
    expect(screen.getByText("فروش بیرون‌بر (تومان)").closest("div")!.textContent).toContain("۶۰,۰۰۰");
    expect(screen.getByText(/اختلاف میانگین/).textContent).toContain("۱۱,۵۰۰");
    expect(screen.getByText("بیرون‌بر مستقیم").parentElement?.textContent).toContain("۱ سفارش");
    expect(screen.getByText("میز با بسته‌بندی").parentElement?.textContent).toContain("۱ سفارش");
    expect(screen.getByText("این گزارش فروش را نشان می‌دهد، نه سود.")).toBeTruthy();
  });

  it("loads the exact 30-day default and refreshes every metric and chart for each preset", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T21:00:00.000Z"));
    const makeRangeReport = (fromDate: string, toDate: string, values: {
      totalCount: number; takeawayCount: number; dineInCount: number; takeawayAmount: number | null; dineInAmount: number | null;
      takeawayRevenue: number; dineInRevenue: number; directCount: number; tableCount: number; directRevenue: number; tableRevenue: number;
    }) => {
      const totalRevenue = values.takeawayRevenue + values.dineInRevenue;
      return ok({
        data: {
          orderDistribution: { totalCount: values.totalCount, takeawayCount: values.takeawayCount, dineInCount: values.dineInCount,
            takeawayPercent: values.totalCount ? ((values.takeawayCount / values.totalCount) * 100).toFixed(2) : null,
            dineInPercent: values.totalCount ? ((values.dineInCount / values.totalCount) * 100).toFixed(2) : null },
          averageOrderValue: { takeawayAmount: values.takeawayAmount, dineInAmount: values.dineInAmount,
            absoluteDifferenceAmount: values.takeawayAmount === null || values.dineInAmount === null ? null : Math.abs(values.takeawayAmount - values.dineInAmount),
            differencePercent: values.takeawayAmount === null || values.dineInAmount === null || values.dineInAmount === 0 ? null : (Math.abs(values.takeawayAmount - values.dineInAmount) / values.dineInAmount * 100).toFixed(2) },
          revenue: { totalAmount: totalRevenue, takeawayAmount: values.takeawayRevenue, dineInAmount: values.dineInRevenue,
            takeawayPercent: totalRevenue ? (values.takeawayRevenue / totalRevenue * 100).toFixed(2) : null,
            dineInPercent: totalRevenue ? (values.dineInRevenue / totalRevenue * 100).toFixed(2) : null },
          takeawayOrigin: { directTakeawayCount: values.directCount, tableOriginatedTakeawayCount: values.tableCount,
            directTakeawayRevenueAmount: values.directRevenue, tableOriginatedTakeawayRevenueAmount: values.tableRevenue },
          unclassifiedHistoricalOrigin: { count: 0, revenueAmount: 0 },
        },
        meta: { requestId: "test", range: { from: `${fromDate}T00:00:00.000Z`, to: `${toDate}T00:00:00.000Z` } },
      });
    };
    vi.mocked(api.readSalesChannelReport).mockImplementation(async (fromDate, toDate) => {
      const days = (Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) / 86_400_000 + 1;
      const values = days === 1
        ? { totalCount: 1, takeawayCount: 0, dineInCount: 1, takeawayAmount: null, dineInAmount: 8_000, takeawayRevenue: 0, dineInRevenue: 8_000, directCount: 0, tableCount: 0, directRevenue: 0, tableRevenue: 0 }
        : days === 7
          ? { totalCount: 2, takeawayCount: 1, dineInCount: 1, takeawayAmount: 9_000, dineInAmount: 6_000, takeawayRevenue: 9_000, dineInRevenue: 6_000, directCount: 1, tableCount: 0, directRevenue: 9_000, tableRevenue: 0 }
          : { totalCount: 4, takeawayCount: 3, dineInCount: 1, takeawayAmount: 10_000, dineInAmount: 5_000, takeawayRevenue: 30_000, dineInRevenue: 5_000, directCount: 2, tableCount: 1, directRevenue: 20_000, tableRevenue: 10_000 };
      return makeRangeReport(fromDate, toDate, values) as never;
    });

    render(<InventorySalesChannelsPanel />);
    await screen.findByText("جمع سفارش‌های تسویه‌شده");
    const today = tehranDate();
    const initial = vi.mocked(api.readSalesChannelReport).mock.calls[0]!;
    const expectedStart = new Date(`${today}T00:00:00.000Z`);
    expectedStart.setUTCDate(expectedStart.getUTCDate() - 29);
    expect(initial).toEqual([expectedStart.toISOString().slice(0, 10), today]);
    const channelCard = () => screen.getByRole("region", { name: "توزیع تعداد سفارش‌ها" }).textContent;
    expect(channelCard()).toContain("۴ سفارش");
    expect(channelCard()).toContain("۷۵.۰۰٪");
    expect(channelCard()).toContain("۲۵.۰۰٪");
    expect(screen.getByText("میانگین سفارش بیرون‌بر (تومان)").closest("div")!.textContent).toContain("۱۰,۰۰۰");
    expect(screen.getByText("میانگین سفارش داخل کافه (تومان)").closest("div")!.textContent).toContain("۵,۰۰۰");
    expect(screen.getByText("فروش بیرون‌بر (تومان)").closest("div")!.textContent).toContain("۳۰,۰۰۰");
    const aovCard = () => screen.getByRole("region", { name: "مقایسه‌ی میانگین مبلغ سفارش" }).textContent;
    const originCard = () => screen.getByRole("region", { name: "منشأ سفارش‌های بیرون‌بر" }).textContent;
    const revenueCard = () => screen.getByRole("region", { name: "درآمد فروش" }).textContent;
    const aovBarWidths = () => Array.from(screen.getByRole("region", { name: "مقایسه‌ی میانگین مبلغ سفارش" }).querySelectorAll(".inventory-profit-bar span"))
      .map((bar) => Number.parseFloat((bar as HTMLElement).style.width));
    expect((screen.getByLabelText("سهم سفارش‌های بیرون‌بر") as HTMLProgressElement).value).toBe(75);
    expect((screen.getByLabelText("سهم سفارش‌های بیرون‌بر") as HTMLProgressElement).max).toBe(100);
    expect((screen.getByLabelText("سهم سفارش‌های داخل کافه") as HTMLProgressElement).value).toBe(25);
    expect(aovBarWidths()).toEqual([100, 50]);
    expect(aovCard()).toContain("۱۰,۰۰۰");
    expect(aovCard()).toContain("۵,۰۰۰");
    expect(aovCard()).toContain("۵,۰۰۰ تومان، ۱۰۰.۰۰٪");
    expect(originCard()).toContain("۲ سفارش، ۲۰,۰۰۰ تومان");
    expect(originCard()).toContain("۱ سفارش، ۱۰,۰۰۰ تومان");
    expect(revenueCard()).toContain("۳۵,۰۰۰");
    expect(revenueCard()).toContain("۸۵.۷۱٪");
    expect(revenueCard()).toContain("۱۴.۲۹٪");

    const select = screen.getByLabelText("بازه‌ی گزارش فروش");
    fireEvent.change(select, { target: { value: "today" } });
    await waitFor(() => expect(api.readSalesChannelReport).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.readSalesChannelReport).mock.calls[1]).toEqual([today, today]);
    await screen.findByText("۸,۰۰۰");
    expect(channelCard()).toContain("۱ سفارش");
    expect(channelCard()).toContain("۱۰۰.۰۰٪");
    expect(screen.getByText("میانگین سفارش بیرون‌بر (تومان)").closest("div")!.textContent).toContain("فروشی ندارد");
    expect(screen.getByText("میانگین سفارش داخل کافه (تومان)").closest("div")!.textContent).toContain("۸,۰۰۰");
    expect(aovCard()).toContain("محاسبه نمی‌شود");
    expect(screen.getByText("فروش بیرون‌بر (تومان)").closest("div")!.textContent).toContain("۰۰.۰۰٪");
    expect(originCard()).toContain("۰ سفارش، ۰ تومان");
    expect(revenueCard()).toContain("۸,۰۰۰");
    expect(revenueCard()).toContain("۱۰۰.۰۰٪");
    expect((screen.getByLabelText("سهم سفارش‌های بیرون‌بر") as HTMLProgressElement).value).toBe(0);
    expect((screen.getByLabelText("سهم سفارش‌های داخل کافه") as HTMLProgressElement).value).toBe(100);
    expect(aovBarWidths()).toEqual([0, 100]);

    fireEvent.change(select, { target: { value: "last7" } });
    await waitFor(() => expect(api.readSalesChannelReport).toHaveBeenCalledTimes(3));
    const endDate = vi.mocked(api.readSalesChannelReport).mock.calls[2]![1];
    const expectedSevenDayStart = new Date(`${endDate}T00:00:00.000Z`);
    expectedSevenDayStart.setUTCDate(expectedSevenDayStart.getUTCDate() - 6);
    expect(vi.mocked(api.readSalesChannelReport).mock.calls[2]).toEqual([expectedSevenDayStart.toISOString().slice(0, 10), today]);
    await waitFor(() => expect(screen.getByText("میانگین سفارش بیرون‌بر (تومان)").closest("div")!.textContent).toContain("۹,۰۰۰"));
    expect(channelCard()).toContain("۲ سفارش");
    expect(channelCard()).toContain("۵۰.۰۰٪");
    expect(screen.getByText("میانگین سفارش داخل کافه (تومان)").closest("div")!.textContent).toContain("۶,۰۰۰");
    expect(aovCard()).toContain("۳,۰۰۰ تومان، ۵۰.۰۰٪");
    expect(originCard()).toContain("۱ سفارش، ۹,۰۰۰ تومان");
    expect(revenueCard()).toContain("۱۵,۰۰۰");
    expect(revenueCard()).toContain("۶۰.۰۰٪");
    expect(revenueCard()).toContain("۴۰.۰۰٪");
    expect((screen.getByLabelText("سهم سفارش‌های بیرون‌بر") as HTMLProgressElement).value).toBe(50);
    expect((screen.getByLabelText("سهم سفارش‌های داخل کافه") as HTMLProgressElement).value).toBe(50);
    expect(aovBarWidths()[0]).toBe(100);
    expect(aovBarWidths()[1]).toBeCloseTo(66.67, 2);
  });

  it("submits a custom Persian date range and rejects invalid or reversed input before requesting", async () => {
    render(<InventorySalesChannelsPanel />);
    await screen.findByText("جمع سفارش‌های تسویه‌شده");
    fireEvent.change(screen.getByLabelText("بازه‌ی گزارش فروش"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("از تاریخ شمسی"), { target: { value: "08/19" } });
    fireEvent.change(screen.getByLabelText("سال آغاز"), { target: { value: "1405" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ شمسی"), { target: { value: "08/20" } });
    fireEvent.change(screen.getByLabelText("سال پایان"), { target: { value: "1405" } });
    fireEvent.click(screen.getByRole("button", { name: "نمایش گزارش" }));
    const expectedFrom = persianDateToGregorianDate("1405", "08/19");
    const expectedTo = persianDateToGregorianDate("1405", "08/20");
    await waitFor(() => expect(api.readSalesChannelReport).toHaveBeenLastCalledWith(expectedFrom, expectedTo));

    fireEvent.change(screen.getByLabelText("از تاریخ شمسی"), { target: { value: "99/99" } });
    fireEvent.click(screen.getByRole("button", { name: "نمایش گزارش" }));
    expect(screen.getByRole("alert").textContent).toContain("ماه/روز");
    expect(api.readSalesChannelReport).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByLabelText("از تاریخ شمسی"), { target: { value: "08/21" } });
    fireEvent.click(screen.getByRole("button", { name: "نمایش گزارش" }));
    expect(screen.getByRole("alert").textContent).toContain("بعد از تاریخ پایان");
    expect(api.readSalesChannelReport).toHaveBeenCalledTimes(2);
  });

  it("shows safe empty-period values and discloses legacy orders without saved origin", async () => {
    vi.mocked(api.readSalesChannelReport).mockResolvedValueOnce(ok({
      ...response,
      data: {
        orderDistribution: { totalCount: 0, takeawayCount: 0, dineInCount: 0, takeawayPercent: null, dineInPercent: null },
        averageOrderValue: { takeawayAmount: null, dineInAmount: null, absoluteDifferenceAmount: null, differencePercent: null },
        revenue: { totalAmount: 0, takeawayAmount: 0, dineInAmount: 0, takeawayPercent: null, dineInPercent: null },
        takeawayOrigin: { directTakeawayCount: 0, tableOriginatedTakeawayCount: 0, directTakeawayRevenueAmount: 0, tableOriginatedTakeawayRevenueAmount: 0 },
        unclassifiedHistoricalOrigin: { count: 1, revenueAmount: 10_000 },
      },
    }) as never);
    render(<InventorySalesChannelsPanel />);
    expect(await screen.findByText("در این بازه سفارش واجد شرایطی ثبت نشده است.")).toBeTruthy();
    expect(screen.getByText("محاسبه نمی‌شود")).toBeTruthy();
    expect(screen.getByText(/محاسبه نمی‌شود از فروش کل/)).toBeTruthy();
    expect(screen.getAllByText("فروشی ندارد").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("status").textContent).toContain("نوع اولیه‌ی ۱ سفارش قدیمی مشخص نیست");
    expect(screen.getByRole("status").textContent).toContain("۱۰,۰۰۰ تومان");
  });

  it("keeps the requested period after a service error and retries it", async () => {
    vi.mocked(api.readSalesChannelReport).mockResolvedValueOnce({
      ok: false,
      error: { kind: "response", code: "SERVICE_UNAVAILABLE", message: "Database unavailable" },
    } as never);
    render(<InventorySalesChannelsPanel />);
    await screen.findByRole("alert");
    const range = vi.mocked(api.readSalesChannelReport).mock.calls[0]!;
    const retry = screen.getByRole("button", { name: "بارگذاری دوباره" });
    fireEvent.click(retry);
    await screen.findByText("جمع سفارش‌های تسویه‌شده");
    expect(vi.mocked(api.readSalesChannelReport).mock.calls[1]).toEqual(range);
  });
});
