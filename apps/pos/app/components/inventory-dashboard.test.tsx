// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryOverview } from "./inventory-dashboard";
import { InventoryProfitPanel } from "./inventory-profit";
import * as api from "../lib/api-client";
import { persianDateToGregorianDate } from "../lib/tehran-date";

vi.mock("../lib/api-client", () => ({
  readInventoryMovements: vi.fn(),
  readGrossProfitReport: vi.fn(),
}));
const item = {
  id: "coffee",
  name: "قهوه",
  isActive: true,
  archivedAt: null,
  balance: { quantityOnHand: "0.000000", carryingValueAmount: 0, trackingStartedAt: "2026-11-01" },
};
const report = {
  data: {
    totals: {
      netSalesAmount: 1500,
      theoreticalCogsAmount: null,
      knownCogsAmount: 800,
      grossProfitAmount: null,
      grossMarginPercent: null,
    },
    products: [
      {
        productId: "unknown",
        channel: "TABLE",
        productName: "هزینه‌ی نامشخص",
        netSalesAmount: 900,
        completeCostRevenueAmount: 0,
        incompleteCostRevenueAmount: 900,
        coveragePercent: "0.00",
        incompleteCostRevenueOfTotalSalesPercent: "60.00",
        incompleteCostRevenueSharePercent: "100.00",
        theoreticalCogsAmount: null,
        knownCogsAmount: 0,
        grossProfitAmount: null,
        grossMarginPercent: null,
        completeOrderItemCount: 0,
        incompleteOrderItemCount: 1,
      },
      {
        productId: "loss",
        channel: "TAKEAWAY",
        productName: "محصول زیان‌ده",
        netSalesAmount: 100,
        completeCostRevenueAmount: 100,
        incompleteCostRevenueAmount: 0,
        coveragePercent: "100.00",
        incompleteCostRevenueOfTotalSalesPercent: "0.00",
        incompleteCostRevenueSharePercent: "0.00",
        theoreticalCogsAmount: 300,
        knownCogsAmount: 300,
        grossProfitAmount: -200,
        grossMarginPercent: "-200.00",
        completeOrderItemCount: 1,
        incompleteOrderItemCount: 0,
      },
      {
        productId: "profit",
        channel: "TAKEAWAY",
        productName: "محصول سودآور",
        netSalesAmount: 500,
        completeCostRevenueAmount: 500,
        incompleteCostRevenueAmount: 0,
        coveragePercent: "100.00",
        incompleteCostRevenueOfTotalSalesPercent: "0.00",
        incompleteCostRevenueSharePercent: "0.00",
        theoreticalCogsAmount: 500,
        knownCogsAmount: 500,
        grossProfitAmount: 0,
        grossMarginPercent: "0.00",
        completeOrderItemCount: 1,
        incompleteOrderItemCount: 0,
      },
    ],
    costCoverage: {
      totalEligibleNetSalesAmount: 1500,
      completeCostRevenueAmount: 600,
      incompleteCostRevenueAmount: 900,
      coveragePercent: "40.00",
      incompleteCoveragePercent: "60.00",
      completeOrderItemCount: 2,
      incompleteOrderItemCount: 1,
      channels: [
        { channel: "TABLE", netSalesAmount: 900, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 900, coveragePercent: "0.00", completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
        { channel: "TAKEAWAY", netSalesAmount: 600, completeCostRevenueAmount: 600, incompleteCostRevenueAmount: 0, coveragePercent: "100.00", completeOrderItemCount: 2, incompleteOrderItemCount: 0 },
      ],
    },
    pendingConsumptionCount: 1,
    inventoryConsumption: {
      amount: null,
      varianceAmount: null,
      isEstimate: true,
      missingValuationCount: 1,
    },
  },
  meta: { range: { from: "2026-11-10T20:30:00.000Z", to: "2026-11-11T20:30:00.000Z" } },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.readInventoryMovements).mockResolvedValue({
    ok: true,
    data: { data: { movements: [] } },
  } as never);
  vi.mocked(api.readGrossProfitReport).mockResolvedValue({ ok: true, data: report } as never);
});
afterEach(cleanup);

describe("inventory overview", () => {
  it("labels a paginated pending list as a lower bound rather than a complete total", async () => {
    render(
      <InventoryOverview
        items={[]}
        pending={[{ id: "pending-1" }] as never}
        pendingHasMore
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("در انتظار کسر موجودی").closest("div")!.textContent).toContain(
      "دست‌کم ۱",
    );
    expect(
      screen.getByText("فهرست بارگذاری‌شده همه‌ی سفارش‌های در انتظار را شامل نمی‌شود"),
    ).toBeTruthy();
    await screen.findByText("هنوز تغییری در موجودی ثبت نشده است.");
  });
  it("identifies the kind, unit and currency of recent movements", async () => {
    vi.mocked(api.readInventoryMovements).mockResolvedValueOnce({
      ok: true,
      data: {
        data: {
          movements: [
            {
              id: "movement-1",
              stockItemId: "coffee",
              kind: "ORDER_CONSUMPTION",
              quantityDelta: "-500.125000",
              valueDeltaAmount: -12500,
              occurredAt: "2026-11-11T08:00:00.000Z",
            },
          ],
        },
      },
    } as never);
    render(
      <InventoryOverview
        items={[{ ...item, baseUnit: "GRAM" }] as never}
        pending={[]}
        onNavigate={vi.fn()}
      />,
    );
    const activity = screen
      .getByRole("heading", { name: "آخرین تغییرهای موجودی" })
      .closest("section")!;
    await within(activity).findByText(/مصرف سفارش/);
    expect(activity.textContent).toContain("-۵۰۰٫۱۲۵");
    expect(activity.textContent).toContain("گرم");
    expect(activity.textContent).toContain("تومان");
  });
  it("distinguishes zero balances from unknown stock and excludes archived items", async () => {
    const unknown = {
      ...item,
      id: "milk",
      name: "شیر",
      balance: { quantityOnHand: null, carryingValueAmount: null, trackingStartedAt: null },
    };
    const archived = { ...item, id: "old", name: "قدیمی", archivedAt: "2026-11-01" };
    const navigate = vi.fn();
    render(
      <InventoryOverview
        items={[item, unknown, archived] as never}
        pending={[]}
        onNavigate={navigate}
      />,
    );
    expect(screen.getByText("ارزش‌گذاری ناقص")).toBeTruthy();
    expect(screen.getByText("۱ قلم بدون ارزش‌گذاری کامل")).toBeTruthy();
    const list = screen.getByRole("heading", { name: "هشدارهای موجودی" }).closest("section")!;
    expect(within(list).getByText("مقدار آغازین ثبت نشده")).toBeTruthy();
    expect(within(list).getByText("موجودی صفر")).toBeTruthy();
    expect(screen.queryByText("قدیمی")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "بررسی اقلام موجودی" }));
    expect(navigate).toHaveBeenCalledWith("stock");
    await screen.findByText("هنوز تغییری در موجودی ثبت نشده است.");
    expect(api.readInventoryMovements).toHaveBeenCalledWith({ limit: "6" });
  });

  it("does not display an unsafe rounded valuation total", async () => {
    render(
      <InventoryOverview
        items={
          [
            { ...item, balance: { ...item.balance, carryingValueAmount: Number.MAX_SAFE_INTEGER } },
            { ...item, id: "second", balance: { ...item.balance, carryingValueAmount: 1 } },
          ] as never
        }
        pending={[]}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("خارج از محدوده‌ی نمایش")).toBeTruthy();
    await screen.findByText("هنوز تغییری در موجودی ثبت نشده است.");
  });

  it("retries a movement read without navigating or issuing a write", async () => {
    vi.mocked(api.readInventoryMovements).mockResolvedValueOnce({
      ok: false,
      error: { kind: "response", code: "SERVICE_UNAVAILABLE", message: "Database unavailable" },
    } as never);
    render(<InventoryOverview items={[]} pending={[]} onNavigate={vi.fn()} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "بارگذاری دوباره" }));
    await screen.findByText("هنوز تغییری در موجودی ثبت نشده است.");
    expect(api.readInventoryMovements).toHaveBeenCalledTimes(2);
  });
});

describe("profit dashboard", () => {
  it("keeps incomplete total cost and margin unavailable and ranks null profit after losses", async () => {
    render(<InventoryProfitPanel />);
    const table = within(await screen.findByRole("region", { name: "جدول سود محصولات" })).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").childNodes[0]!.textContent)).toEqual([
      "محصول سودآور",
      "محصول زیان‌ده",
      "هزینه‌ی نامشخص",
    ]);
    expect(rows[1]!.textContent).toContain("-۲۰۰");
    expect(rows[2]!.textContent).toContain("محاسبه نشده");
    const metrics = screen.getByText("سود ناخالص (تومان)").closest("div")!;
    expect(within(metrics).getByText("محاسبه نشده")).toBeTruthy();
    expect(screen.getByText("بهای تمام‌شده (تومان)").closest("div")!.textContent).toContain(
      "هزینه‌ی مشخص‌شده: ۸۰۰ تومان",
    );
    fireEvent.change(screen.getByLabelText("مرتب‌سازی محصولات"), { target: { value: "sales" } });
    expect(within(table).getAllByRole("row")[1]!.textContent).toContain("هزینه‌ی نامشخص");
  });

  it("keeps café totals stable when searching only the product table", async () => {
    render(<InventoryProfitPanel />);
    const table = within(await screen.findByRole("region", { name: "جدول سود محصولات" })).getByRole("table");
    fireEvent.change(screen.getByLabelText("جست‌وجوی محصول"), { target: { value: "سودآور" } });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("فروش خالص (تومان)").closest("div")!.textContent).toContain("۱,۵۰۰");
    expect(api.readGrossProfitReport).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("جست‌وجوی محصول"), { target: { value: "ناشناخته" } });
    expect(within(table).getByText("محصولی با این نام پیدا نشد.")).toBeTruthy();
  });

  it("shows revenue-weighted coverage, channel indicators, and the highest incomplete-revenue priorities first", async () => {
    const lowPriority = { ...report.data.products[0]!, productId: "priority-low", productName: "کم‌فروش", netSalesAmount: 100, incompleteCostRevenueAmount: 100, incompleteCostRevenueOfTotalSalesPercent: "10.00", incompleteCostRevenueSharePercent: "10.00" };
    const highPriority = { ...report.data.products[0]!, productId: "priority-high", productName: "پرفروش", netSalesAmount: 900, incompleteCostRevenueAmount: 900, incompleteCostRevenueOfTotalSalesPercent: "90.00", incompleteCostRevenueSharePercent: "90.00" };
    vi.mocked(api.readGrossProfitReport).mockResolvedValue({
      ok: true,
      data: {
        ...report,
        data: { ...report.data, products: [lowPriority, highPriority], costCoverage: { ...report.data.costCoverage, totalEligibleNetSalesAmount: 1000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 1000, coveragePercent: "0.00", incompleteCoveragePercent: "100.00" } },
      },
    } as never);
    render(<InventoryProfitPanel />);
    const priorityRegion = await screen.findByRole("region", { name: "محصولات با اولویت تکمیل هزینه" });
    expect(screen.getByRole("heading", { name: "پوشش بهای تمام‌شده فروش" })).toBeTruthy();
    const coverageCard = screen.getByRole("heading", { name: "پوشش بهای تمام‌شده فروش" }).closest("section")!;
    expect(coverageCard.querySelector(".inventory-cost-coverage-primary > strong")?.textContent).toBe("۰.۰۰٪");
    expect(within(coverageCard).getByText("فروش با هزینه‌ی ناقص").parentElement!.textContent).toContain("۱,۰۰۰ تومان");
    expect(screen.getByRole("progressbar", { name: "پوشش بهای تمام‌شده داخل کافه" })).toBeTruthy();
    const priorityRows = within(within(priorityRegion).getByRole("table")).getAllByRole("row").slice(1);
    expect(priorityRows.map((row) => within(row).getByRole("rowheader").childNodes[0]!.textContent)).toEqual(["پرفروش", "کم‌فروش"]);
  });

  it("updates coverage from the same report after the Persian date range changes", async () => {
    const firstReport = {
      ok: true,
      data: { ...report, data: {
        ...report.data,
        products: [{ ...report.data.products[0]!, productId: "before-range", productName: "اولویت بازه‌ی قبلی", netSalesAmount: 1_000, completeCostRevenueAmount: 800, incompleteCostRevenueAmount: 200, coveragePercent: "80.00" }],
        costCoverage: { ...report.data.costCoverage, totalEligibleNetSalesAmount: 1_000, completeCostRevenueAmount: 800, incompleteCostRevenueAmount: 200, coveragePercent: "80.00", incompleteCoveragePercent: "20.00", channels: [
          { channel: "TABLE", netSalesAmount: 1_000, completeCostRevenueAmount: 800, incompleteCostRevenueAmount: 200, coveragePercent: "80.00", completeOrderItemCount: 1, incompleteOrderItemCount: 1 },
          { channel: "TAKEAWAY", netSalesAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0, coveragePercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 0 },
        ] },
      } },
    };
    const nextReport = {
      ok: true,
      data: { ...report, data: {
        ...report.data,
        products: [{ ...report.data.products[0]!, productId: "after-range", productName: "اولویت بازه‌ی جدید", netSalesAmount: 2_000, completeCostRevenueAmount: 500, incompleteCostRevenueAmount: 1_500, coveragePercent: "25.00" }],
        costCoverage: { ...report.data.costCoverage, totalEligibleNetSalesAmount: 2_000, completeCostRevenueAmount: 500, incompleteCostRevenueAmount: 1_500, coveragePercent: "25.00", incompleteCoveragePercent: "75.00", channels: [
          { channel: "TABLE", netSalesAmount: 1_000, completeCostRevenueAmount: 500, incompleteCostRevenueAmount: 500, coveragePercent: "50.00", completeOrderItemCount: 1, incompleteOrderItemCount: 1 },
          { channel: "TAKEAWAY", netSalesAmount: 1_000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 1_000, coveragePercent: "0.00", completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
        ] },
      } },
    };
    vi.mocked(api.readGrossProfitReport).mockResolvedValueOnce(firstReport as never).mockResolvedValueOnce(nextReport as never);
    render(<InventoryProfitPanel />);
    await screen.findByRole("region", { name: "جدول سود محصولات" });
    const coverageCard = screen.getByRole("heading", { name: "پوشش بهای تمام‌شده فروش" }).closest("section")!;
    expect(coverageCard.querySelector(".inventory-cost-coverage-primary > strong")?.textContent).toBe("۸۰.۰۰٪");
    expect(within(coverageCard).getByText("فروش با هزینه‌ی ناقص").parentElement!.textContent).toContain("۲۰۰ تومان");
    const priorityRegion = screen.getByRole("region", { name: "محصولات با اولویت تکمیل هزینه" });
    expect(within(priorityRegion).getByRole("rowheader", { name: /اولویت بازه‌ی قبلی/ })).toBeTruthy();
    const originalCalls = vi.mocked(api.readGrossProfitReport).mock.calls.length;
    fireEvent.change(screen.getByLabelText("از تاریخ شمسی"), { target: { value: "08/20" } });
    fireEvent.change(screen.getByLabelText("سال آغاز"), { target: { value: "1405" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ شمسی"), { target: { value: "08/21" } });
    fireEvent.change(screen.getByLabelText("سال پایان"), { target: { value: "1405" } });
    fireEvent.click(screen.getByRole("button", { name: "نمایش گزارش" }));
    await waitFor(() => expect(vi.mocked(api.readGrossProfitReport)).toHaveBeenCalledTimes(originalCalls + 1));
    expect(api.readGrossProfitReport).toHaveBeenLastCalledWith(
      persianDateToGregorianDate("1405", "08/20"),
      persianDateToGregorianDate("1405", "08/21"),
    );
    await waitFor(() => {
      const refreshedCard = screen.getByRole("heading", { name: "پوشش بهای تمام‌شده فروش" }).closest("section")!;
      expect(refreshedCard.querySelector(".inventory-cost-coverage-primary > strong")?.textContent).toBe("۲۵.۰۰٪");
    });
    const refreshedCard = screen.getByRole("heading", { name: "پوشش بهای تمام‌شده فروش" }).closest("section")!;
    expect(refreshedCard.querySelector('[role="progressbar"][aria-label="درصد پوشش بهای تمام‌شده فروش"]')?.getAttribute("aria-valuenow")).toBe("25");
    expect(within(refreshedCard).getByText("فروش با هزینه‌ی ناقص").parentElement!.textContent).toContain("۱,۵۰۰ تومان");
    const refreshedPriorityRegion = screen.getByRole("region", { name: "محصولات با اولویت تکمیل هزینه" });
    expect(within(refreshedPriorityRegion).getByRole("rowheader", { name: /اولویت بازه‌ی جدید/ })).toBeTruthy();
    expect(within(refreshedPriorityRegion).queryByRole("rowheader", { name: /اولویت بازه‌ی قبلی/ })).toBeNull();
    expect(screen.getByRole("progressbar", { name: "پوشش بهای تمام‌شده داخل کافه" }).getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByRole("progressbar", { name: "پوشش بهای تمام‌شده بیرون‌بر" }).getAttribute("aria-valuenow")).toBe("0");
  });

  it("preserves Jalali filter inputs after a failed report and retries the same range", async () => {
    vi.mocked(api.readGrossProfitReport).mockResolvedValueOnce({
      ok: false,
      error: { kind: "response", code: "SERVICE_UNAVAILABLE", message: "Database unavailable" },
    } as never);
    render(<InventoryProfitPanel />);
    await screen.findByRole("alert");
    const from = screen.getByLabelText("از تاریخ شمسی") as HTMLInputElement;
    const to = screen.getByLabelText("تا تاریخ شمسی") as HTMLInputElement;
    const values = [from.value, to.value];
    const firstRange = vi.mocked(api.readGrossProfitReport).mock.calls[0];
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    await screen.findByRole("region", { name: "جدول سود محصولات" });
    expect([from.value, to.value]).toEqual(values);
    expect(vi.mocked(api.readGrossProfitReport).mock.calls[1]).toEqual(firstRange);
  });

  it("rejects an invalid range without issuing a report request", async () => {
    render(<InventoryProfitPanel />);
    await screen.findByRole("region", { name: "جدول سود محصولات" });
    fireEvent.change(screen.getByLabelText("از تاریخ شمسی"), { target: { value: "99/99" } });
    fireEvent.click(screen.getByRole("button", { name: "نمایش گزارش" }));
    expect(screen.getByRole("alert").textContent).toContain("تاریخ شروع و پایان");
    expect(api.readGrossProfitReport).toHaveBeenCalledTimes(1);
  });

  it("renders zero sales without inventing a margin or product comparison", async () => {
    vi.mocked(api.readGrossProfitReport).mockResolvedValueOnce({
      ok: true,
      data: {
        ...report,
        data: {
          ...report.data,
          products: [],
          totals: {
            netSalesAmount: 0,
            knownCogsAmount: 0,
            theoreticalCogsAmount: 0,
            grossProfitAmount: 0,
            grossMarginPercent: null,
          },
          costCoverage: { ...report.data.costCoverage, totalEligibleNetSalesAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0, coveragePercent: null, incompleteCoveragePercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 0, channels: [{ channel: "TABLE", netSalesAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0, coveragePercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 0 }, { channel: "TAKEAWAY", netSalesAmount: 0, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 0, coveragePercent: null, completeOrderItemCount: 0, incompleteOrderItemCount: 0 }] },
        },
      },
    } as never);
    render(<InventoryProfitPanel />);
    await screen.findByRole("region", { name: "جدول سود محصولات" });
    expect(screen.getByText("حاشیه‌ی سود ناخالص").closest("div")!.textContent).toContain(
      "محاسبه نشده",
    );
    expect(screen.getAllByText("در این بازه سفارشی تسویه‌ی کامل نشده است.")).toHaveLength(2);
  });
});
