// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryOverview } from "./inventory-dashboard";
import { InventoryProfitPanel } from "./inventory-profit";
import * as api from "../lib/api-client";

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
        productName: "هزینه‌ی نامشخص",
        netSalesAmount: 900,
        theoreticalCogsAmount: null,
        knownCogsAmount: 0,
        grossProfitAmount: null,
        grossMarginPercent: null,
        completeOrderItemCount: 0,
        incompleteOrderItemCount: 1,
      },
      {
        productId: "loss",
        productName: "محصول زیان‌ده",
        netSalesAmount: 100,
        theoreticalCogsAmount: 300,
        knownCogsAmount: 300,
        grossProfitAmount: -200,
        grossMarginPercent: "-200.00",
        completeOrderItemCount: 1,
        incompleteOrderItemCount: 0,
      },
      {
        productId: "profit",
        productName: "محصول سودآور",
        netSalesAmount: 500,
        theoreticalCogsAmount: 500,
        knownCogsAmount: 500,
        grossProfitAmount: 0,
        grossMarginPercent: "0.00",
        completeOrderItemCount: 1,
        incompleteOrderItemCount: 0,
      },
    ],
    costCoverage: { completeOrderItemCount: 2, incompleteOrderItemCount: 1 },
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
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual([
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
    const table = await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("جست‌وجوی محصول"), { target: { value: "سودآور" } });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("فروش خالص (تومان)").closest("div")!.textContent).toContain("۱,۵۰۰");
    expect(api.readGrossProfitReport).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("جست‌وجوی محصول"), { target: { value: "ناشناخته" } });
    expect(within(table).getByText("محصولی با این نام پیدا نشد.")).toBeTruthy();
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
    await screen.findByRole("table");
    expect([from.value, to.value]).toEqual(values);
    expect(vi.mocked(api.readGrossProfitReport).mock.calls[1]).toEqual(firstRange);
  });

  it("rejects an invalid range without issuing a report request", async () => {
    render(<InventoryProfitPanel />);
    await screen.findByRole("table");
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
          costCoverage: { completeOrderItemCount: 0, incompleteOrderItemCount: 0 },
        },
      },
    } as never);
    render(<InventoryProfitPanel />);
    await screen.findByRole("table");
    expect(screen.getByText("حاشیه‌ی سود ناخالص").closest("div")!.textContent).toContain(
      "محاسبه نشده",
    );
    expect(screen.getAllByText("در این بازه سفارشی تسویه‌ی کامل نشده است.")).toHaveLength(2);
  });
});
