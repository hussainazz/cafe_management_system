// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { lowInventoryItem } from "./inventory-dashboard";
import { InventoryStockTable } from "./inventory-stock-table";
import { InventoryStockDetail } from "./inventory-stock-detail";
import { InventoryTrend, InventoryDailyMargin } from "./inventory-charts";
import * as api from "../lib/api-client";
vi.mock("../lib/api-client", () => ({
  readInventoryMovements: vi.fn(),
  readGrossProfitReport: vi.fn(),
}));
const item = {
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  id: "beans",
  name: "قهوه",
  category: "مواد اولیه",
  baseUnit: "GRAM",
  lowStockThreshold: "12.125001",
  version: 1,
  isActive: true,
  archivedAt: null,
  conversions: [],
  balance: {
    trackingStartedAt: "2026-11-01",
    quantityOnHand: "12.125001",
    carryingValueAmount: 100,
    movingAverageCostPerBaseUnit: "8.247421",
  },
} as api.InventoryStockItem;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.readInventoryMovements).mockResolvedValue({
    ok: true,
    data: { data: { movements: [] } },
  } as never);
});
afterEach(cleanup);
it("compares optional thresholds exactly and leaves unknown balances unknown", () => {
  expect(lowInventoryItem(item)).toBe(true);
  expect(
    lowInventoryItem({ ...item, balance: { ...item.balance, quantityOnHand: "12.125002" } }),
  ).toBe(false);
  expect(lowInventoryItem({ ...item, lowStockThreshold: null })).toBe(false);
  expect(
    lowInventoryItem({
      ...item,
      balance: { ...item.balance, quantityOnHand: null, trackingStartedAt: null },
    }),
  ).toBe(false);
  expect(
    lowInventoryItem({
      ...item,
      lowStockThreshold: "99999999999999.999998",
      balance: { ...item.balance, quantityOnHand: "99999999999999.999999" },
    }),
  ).toBe(false);
});
it("paginates the overview and resets its page when filtering", () => {
  const onOpen = vi.fn();
  render(
    <InventoryStockTable
      items={Array.from({ length: 12 }, (_, i) => ({
        ...item,
        id: `item-${i}`,
        name: `ماده ${i}`,
      }))}
      onOpen={onOpen}
    />,
  );
  const region = screen.getByRole("region", { name: "جدول موجودی نمای کلی" });
  expect(within(region).getAllByRole("row")).toHaveLength(11);
  fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
  expect(within(region).getAllByRole("row")).toHaveLength(3);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ماده 0" } });
  fireEvent.click(screen.getByRole("button", { name: "ماده 0" }));
  expect(onOpen).toHaveBeenCalledWith("item-0");
  expect(screen.getByRole("button", { name: "قبلی" }).hasAttribute("disabled")).toBe(true);
});
it("loads only the selected item's movements and exposes its optional warning setting", async () => {
  render(<InventoryStockDetail item={item} onEdit={vi.fn()} />);
  expect(screen.getByText("حد هشدار مدیر")).toBeTruthy();
  await waitFor(() =>
    expect(api.readInventoryMovements).toHaveBeenCalledWith({ stockItemId: "beans", limit: "6" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "گردش موجودی" }));
  await screen.findByText("گردشی برای این کالا ثبت نشده است.");
});
it("leaves a gap for missing daily costs and provides keyboard day selection", () => {
  render(
    <InventoryTrend
      daily={[
        {
          date: "2026-11-08",
          netSalesAmount: 100,
          theoreticalCogsAmount: 50,
          grossProfitAmount: 50,
          grossMarginPercent: "50.00",
          incompleteOrderItemCount: 0,
        },
        {
          date: "2026-11-09",
          netSalesAmount: 100,
          theoreticalCogsAmount: null,
          grossProfitAmount: null,
          grossMarginPercent: null,
          incompleteOrderItemCount: 1,
        },
        {
          date: "2026-11-10",
          netSalesAmount: 100,
          theoreticalCogsAmount: 200,
          grossProfitAmount: -100,
          grossMarginPercent: "-100.00",
          incompleteOrderItemCount: 0,
        },
      ]}
    />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "روز نمودار" }), {
    target: { value: "2026-11-09" },
  });
  expect(screen.getByText("سود محاسبه نشده")).toBeTruthy();
  expect(screen.getByText(/روزهای با هزینه‌ی ناقص/)).toBeTruthy();
  expect(document.querySelectorAll('path[stroke="#7ed4ac"]')).toHaveLength(2);
});

it("shows isolated positive and negative margin observations without bridging a missing day", () => {
  render(<InventoryDailyMargin daily={[
    {date:"2026-11-08",netSalesAmount:100,theoreticalCogsAmount:50,grossProfitAmount:50,grossMarginPercent:"50.00",incompleteOrderItemCount:0},
    {date:"2026-11-09",netSalesAmount:100,theoreticalCogsAmount:null,grossProfitAmount:null,grossMarginPercent:null,incompleteOrderItemCount:1},
    {date:"2026-11-10",netSalesAmount:100,theoreticalCogsAmount:200,grossProfitAmount:-100,grossMarginPercent:"-100.00",incompleteOrderItemCount:0},
  ]}/>);
  const chart = screen.getByRole("img", {name:"سود ناخالص روزانه به تومان و حاشیه‌ی سود به درصد"});
  expect(chart.querySelectorAll("circle")).toHaveLength(2);
  expect(chart.querySelectorAll('path[stroke="#7ed4ac"]')).toHaveLength(2);
  fireEvent.change(screen.getByRole("combobox",{name:"روز حاشیه‌ی سود"}),{target:{value:"2026-11-09"}});
  expect(screen.getByText("سود محاسبه نشده")).toBeTruthy();
});
