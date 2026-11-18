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
    soldProducts: [
      { productId: "unknown", productName: "هزینه‌ی نامشخص", channel: "TABLE", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 900 },
      { productId: "loss", productName: "محصول زیان‌ده", channel: "TAKEAWAY", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 100 },
      { productId: "profit", productName: "محصول سودآور", channel: "TAKEAWAY", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 500 },
    ],
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
        soldQuantity: 1,
        soldWeightGrams: 0,
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
        soldQuantity: 1,
        soldWeightGrams: 0,
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
        soldQuantity: 1,
        soldWeightGrams: 0,
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
    packagingEconomics: {
      totals: { packagingChargeRevenueAmount: 4_000, knownMaterialCostAmount: 5_000, unclassifiedKnownCostAmount: 100, netRecoveryAmount: -1_000, recoveryRatePercent: "80.00", unattributedOrderLevelChargeRevenueAmount: 500, packagingRelevantProductRevenueAmount: 600, completeAttributionRevenueAmount: 400, incompleteAttributionRevenueAmount: 200, attributionCoveragePercent: "66.67", completeOrderItemCount: 1, incompleteOrderItemCount: 1, ambiguousOrderItemCount: 1, missingMaterialValuationCount: 0, theoreticalPackagingCostAmount: null, postedPackagingMovementAmount: null, packagingMovementVarianceAmount: null, packagingMovementReconciliationAvailable: false, isCostComplete: false },
      products: [{ productId: "packaging-product", productName: "محصول بسته‌بندی", categoryId: null, categoryName: null, channel: "TAKEAWAY", options: [], assignedPackaging: [], soldQuantity: 1, soldWeightGrams: 0, productNetSalesAmount: 600, packagingChargeRevenueAmount: 0, nonPackagingKnownCostAmount: 300, packagingKnownCostAmount: 200, unclassifiedKnownCostAmount: 100, netRecoveryAmount: null, packagingRecoveryRatePercent: null, productContributionBeforePackagingAmount: null, combinedContributionAfterPackagingAmount: null, isCostComplete: false, isPackagingAttributionComplete: false }],
      categories: [{ categoryId: null, categoryName: "نامشخص", channel: "TAKEAWAY", productNetSalesAmount: 600, packagingChargeRevenueAmount: 0, knownMaterialCostAmount: 200, unclassifiedKnownCostAmount: 100, netRecoveryAmount: null, recoveryRatePercent: null, isCostComplete: false }],
      daily: [{ date: "2026-11-11", packagingChargeRevenueAmount: 4_000, knownMaterialCostAmount: 5_000, unclassifiedKnownCostAmount: 100, netRecoveryAmount: -1_000, isCostComplete: false, incompleteOrderItemCount: 1 }],
    },
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
  it("shows packaging deficits, incomplete attribution, product/category tables and a daily trend", async () => {
    vi.mocked(api.readGrossProfitReport).mockResolvedValue({
      ok: true,
      data: { ...report, data: { ...report.data, packagingEconomics: { ...report.data.packagingEconomics, products: [{ ...report.data.packagingEconomics.products[0]!, options: [{ optionId: "option-large", optionName: "گزینه‌ی بزرگ", quantity: 1 }] }] } } },
    } as never);
    render(<InventoryProfitPanel />);
    await screen.findByRole("heading", { name: "اقتصاد بسته‌بندی" });
    expect(screen.getByText("کسری بازیافت هزینه")).toBeTruthy();
    expect(screen.getByText(/در سطح سفارش باقی مانده است/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "تفکیک بسته‌بندی بر اساس محصول" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "تفکیک بسته‌بندی بر اساس دسته‌بندی" })).toBeTruthy();
    expect(screen.getByRole("img", { name: /روند روزانه درآمد بسته‌بندی/ })).toBeTruthy();
    expect(screen.getByText("گزینه‌ی بزرگ")).toBeTruthy();
  });

  it("shows the current discounted menu price while preserving historical net sales and updating with catalog changes", async () => {
    const catalogForPrice = (priceAmount: number) => ({
      categories: [{ id: "coffee-category", archivedAt: null }],
      products: [{
        id: "unknown",
        categoryId: "coffee-category",
        priceAmount,
        pricingMode: "FIXED",
        saleDiscountKind: "PERCENTAGE",
        saleDiscountValue: 7,
        isPublic: true,
        isActive: true,
        archivedAt: null,
        optionGroups: [],
      }],
      optionGroups: [],
      tables: [],
    }) as never;
    const { rerender } = render(<InventoryProfitPanel catalog={catalogForPrice(190_000)} />);
    const table = within(await screen.findByRole("region", { name: "جدول سود محصولات" })).getByRole("table");
    const row = within(table).getByRole("rowheader", { name: /هزینه‌ی نامشخص/ }).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]!.textContent).toContain("۱۷۷,۰۰۰");
    expect(cells[1]!.textContent).toContain("۹۰۰");

    rerender(<InventoryProfitPanel catalog={catalogForPrice(250_000)} />);
    const updatedRow = within(table).getByRole("rowheader", { name: /هزینه‌ی نامشخص/ }).closest("tr")!;
    const updatedCells = within(updatedRow).getAllByRole("cell");
    expect(updatedCells[0]!.textContent).toContain("۲۳۳,۰۰۰");
    expect(updatedCells[1]!.textContent).toContain("۹۰۰");
    expect(api.readGrossProfitReport).toHaveBeenCalledTimes(1);
  });

  it("uses the fixed menu discount for weighted products, notes option fees, and excludes products outside the current menu", async () => {
    const catalog = {
      categories: [
        { id: "current-category", archivedAt: null },
        { id: "archived-category", archivedAt: "2026-11-01T00:00:00.000Z" },
      ],
      products: [
        {
          id: "unknown",
          categoryId: "current-category",
          priceAmount: 205_000,
          pricingMode: "WEIGHTED_PER_KG",
          saleDiscountKind: "FIXED",
          saleDiscountValue: 10_400,
          isPublic: true,
          isActive: true,
          isAvailable: false,
          archivedAt: null,
          optionGroups: [{ optionGroupId: "size" }],
        },
        {
          id: "loss",
          categoryId: "current-category",
          priceAmount: 100_000,
          pricingMode: "FIXED",
          saleDiscountKind: null,
          saleDiscountValue: null,
          isPublic: false,
          isActive: true,
          archivedAt: null,
          optionGroups: [],
        },
        {
          id: "profit",
          categoryId: "archived-category",
          priceAmount: 500_000,
          pricingMode: "FIXED",
          saleDiscountKind: null,
          saleDiscountValue: null,
          isPublic: true,
          isActive: true,
          archivedAt: null,
          optionGroups: [],
        },
      ],
      optionGroups: [],
      tables: [],
    } as never;
    render(<InventoryProfitPanel catalog={catalog} />);
    const table = within(await screen.findByRole("region", { name: "جدول سود محصولات" })).getByRole("table");
    const weightedRow = within(table).getByRole("rowheader", { name: /هزینه‌ی نامشخص/ }).closest("tr")!;
    const weightedCell = within(weightedRow).getAllByRole("cell")[0]!;
    expect(weightedCell.textContent).toContain("۱۹۵,۰۰۰");
    expect(weightedCell.textContent).toContain("تومان برای هر کیلوگرم");
    expect(weightedCell.textContent).toContain("قیمت پایه؛ هزینه‌ی گزینه‌ها جداست");
    for (const productName of ["محصول زیان‌ده", "محصول سودآور"]) {
      const row = within(table).getByRole("rowheader", { name: new RegExp(productName) }).closest("tr")!;
      expect(within(row).getAllByRole("cell")[0]!.textContent).toContain("در منوی فعلی نیست");
    }
  });

  it("summarizes sold products across channels and sorts by current price, quantity, dine-in and takeaway sales", async () => {
    const productRows = [
      { ...report.data.products[0]!, productId: "a", productName: "قهوه الف", channel: "TABLE" as const, soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 100, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 100 },
      { ...report.data.products[0]!, productId: "a", productName: "قهوه الف", channel: "TAKEAWAY" as const, soldQuantity: 3, soldWeightGrams: 750, netSalesAmount: 500, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 500 },
      { ...report.data.products[1]!, productId: "b", productName: "قهوه ب", channel: "TABLE" as const, soldQuantity: 2, soldWeightGrams: 0, netSalesAmount: 610, completeCostRevenueAmount: 610, incompleteCostRevenueAmount: 0 },
      { ...report.data.products[2]!, productId: "c", productName: "قهوه ج", channel: "TAKEAWAY" as const, soldQuantity: 6, soldWeightGrams: 0, netSalesAmount: 820, completeCostRevenueAmount: 820, incompleteCostRevenueAmount: 0 },
    ];
    const catalog = {
      categories: [{ id: "coffee-category", archivedAt: null }],
      products: [
        { id: "a", categoryId: "coffee-category", priceAmount: 10_000, pricingMode: "FIXED", saleDiscountKind: null, saleDiscountValue: null, isPublic: true, isActive: true, archivedAt: null, optionGroups: [] },
        { id: "b", categoryId: "coffee-category", priceAmount: 20_000, pricingMode: "FIXED", saleDiscountKind: null, saleDiscountValue: null, isPublic: true, isActive: true, archivedAt: null, optionGroups: [] },
        { id: "c", categoryId: "coffee-category", priceAmount: 15_000, pricingMode: "FIXED", saleDiscountKind: null, saleDiscountValue: null, isPublic: true, isActive: true, archivedAt: null, optionGroups: [] },
      ],
      optionGroups: [],
      tables: [],
    } as never;
    vi.mocked(api.readGrossProfitReport).mockResolvedValue({
      ok: true,
      data: { ...report, data: {
        ...report.data,
        totals: { ...report.data.totals, netSalesAmount: 2_030, knownCogsAmount: 800, theoreticalCogsAmount: null, grossProfitAmount: null, grossMarginPercent: null },
        products: productRows,
        soldProducts: productRows,
        costCoverage: { ...report.data.costCoverage, totalEligibleNetSalesAmount: 2_030, completeCostRevenueAmount: 1_430, incompleteCostRevenueAmount: 600, coveragePercent: "70.44", incompleteCoveragePercent: "29.56", completeOrderItemCount: 2, incompleteOrderItemCount: 2, channels: [
          { channel: "TABLE", netSalesAmount: 710, completeCostRevenueAmount: 610, incompleteCostRevenueAmount: 100, coveragePercent: "85.92", completeOrderItemCount: 1, incompleteOrderItemCount: 1 },
          { channel: "TAKEAWAY", netSalesAmount: 1_320, completeCostRevenueAmount: 820, incompleteCostRevenueAmount: 500, coveragePercent: "62.12", completeOrderItemCount: 1, incompleteOrderItemCount: 1 },
        ] },
      } },
    } as never);
    render(<InventoryProfitPanel catalog={catalog} />);

    const region = await screen.findByRole("region", { name: "جدول محصولات فروخته‌شده" });
    const table = within(region).getByRole("table");
    const names = () => within(table).getAllByRole("row").slice(1).map((row) => within(row).getByRole("rowheader").textContent?.trim());
    const rowA = within(table).getByRole("rowheader", { name: /قهوه الف/ }).closest("tr")!;
    const cellsA = within(rowA).getAllByRole("cell");
    expect(cellsA[1]!.textContent).toContain("۴");
    expect(cellsA[1]!.textContent).toContain("۷۵۰ گرم");
    expect(cellsA[2]!.textContent).toContain("۱۰۰");
    expect(cellsA[3]!.textContent).toContain("۵۰۰");
    expect(cellsA[4]!.textContent).toContain("۰");
    expect(cellsA[5]!.textContent).toContain("۶۰۰");

    const sort = screen.getByLabelText("مرتب‌سازی فروش محصولات");
    fireEvent.change(sort, { target: { value: "price" } });
    expect(names()).toEqual(["قهوه ب", "قهوه ج", "قهوه الف"]);
    fireEvent.change(sort, { target: { value: "quantity" } });
    expect(names()).toEqual(["قهوه ج", "قهوه الف", "قهوه ب"]);
    fireEvent.change(sort, { target: { value: "table" } });
    expect(names()).toEqual(["قهوه ب", "قهوه الف", "قهوه ج"]);
    fireEvent.change(sort, { target: { value: "takeaway" } });
    expect(names()).toEqual(["قهوه ج", "قهوه الف", "قهوه ب"]);
  });

  it("keeps legacy channel sales visible, sorts products without a current price last, and omits the packing service row", async () => {
    const ordinary = { ...report.data.products[1]!, productId: "ordinary", productName: "محصول منو", channel: "TABLE" as const, soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 1_000 };
    const legacy = { ...report.data.products[0]!, productId: "legacy", productName: "محصول تاریخی", channel: undefined, soldQuantity: 2, soldWeightGrams: 0, netSalesAmount: 500 };
    const packing = { ...report.data.products[2]!, productId: "packing", productName: "بسته‌بندی", channel: "TAKEAWAY" as const, soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 250 };
    vi.mocked(api.readGrossProfitReport).mockResolvedValue({
      ok: true,
      data: { ...report, data: { ...report.data, products: [ordinary, legacy, packing], soldProducts: [ordinary, legacy, packing], totals: { ...report.data.totals, netSalesAmount: 1_750 } } },
    } as never);
    const catalog = {
      categories: [{ id: "coffee-category", archivedAt: null }],
      products: [
        { id: "ordinary", categoryId: "coffee-category", priceAmount: 1_000, pricingMode: "FIXED", saleDiscountKind: null, saleDiscountValue: null, isPublic: true, systemKey: null, isActive: true, archivedAt: null, optionGroups: [] },
        { id: "packing", categoryId: "coffee-category", priceAmount: 250, pricingMode: "FIXED", saleDiscountKind: null, saleDiscountValue: null, isPublic: false, systemKey: "PACKING", isActive: true, archivedAt: null, optionGroups: [] },
      ],
      optionGroups: [],
      tables: [],
    } as never;
    render(<InventoryProfitPanel catalog={catalog} />);

    const region = await screen.findByRole("region", { name: "جدول محصولات فروخته‌شده" });
    const table = within(region).getByRole("table");
    expect(within(table).queryByRole("rowheader", { name: "بسته‌بندی" })).toBeNull();
    expect(within(region).getByText(/کانال نامشخص/)).toBeTruthy();
    const legacyRow = within(table).getByRole("rowheader", { name: "محصول تاریخی" }).closest("tr")!;
    expect(within(legacyRow).getAllByRole("cell")[4]!.textContent).toContain("۵۰۰");

    fireEvent.change(screen.getByLabelText("مرتب‌سازی فروش محصولات"), { target: { value: "price" } });
    const names = within(table).getAllByRole("row").slice(1).map((row) => within(row).getByRole("rowheader").textContent?.trim());
    expect(names).toEqual(["محصول منو", "محصول تاریخی"]);
  });

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
        soldProducts: [{ productId: "before-range", productName: "اولویت بازه‌ی قبلی", channel: "TABLE", soldQuantity: 1, soldWeightGrams: 0, netSalesAmount: 1_000 }],
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
        soldProducts: [{ productId: "after-range", productName: "اولویت بازه‌ی جدید", channel: "TAKEAWAY", soldQuantity: 2, soldWeightGrams: 0, netSalesAmount: 2_000 }],
        costCoverage: { ...report.data.costCoverage, totalEligibleNetSalesAmount: 2_000, completeCostRevenueAmount: 500, incompleteCostRevenueAmount: 1_500, coveragePercent: "25.00", incompleteCoveragePercent: "75.00", channels: [
          { channel: "TABLE", netSalesAmount: 1_000, completeCostRevenueAmount: 500, incompleteCostRevenueAmount: 500, coveragePercent: "50.00", completeOrderItemCount: 1, incompleteOrderItemCount: 1 },
          { channel: "TAKEAWAY", netSalesAmount: 1_000, completeCostRevenueAmount: 0, incompleteCostRevenueAmount: 1_000, coveragePercent: "0.00", completeOrderItemCount: 0, incompleteOrderItemCount: 1 },
        ] },
      } },
    };
    vi.mocked(api.readGrossProfitReport).mockResolvedValueOnce(firstReport as never).mockResolvedValueOnce(nextReport as never);
    render(<InventoryProfitPanel />);
    await screen.findByRole("region", { name: "جدول سود محصولات" });
    const soldProductsRegion = screen.getByRole("region", { name: "جدول محصولات فروخته‌شده" });
    expect(within(soldProductsRegion).getByRole("rowheader", { name: /اولویت بازه‌ی قبلی/ })).toBeTruthy();
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
    const refreshedSoldProductsRegion = screen.getByRole("region", { name: "جدول محصولات فروخته‌شده" });
    expect(within(refreshedSoldProductsRegion).getByRole("rowheader", { name: /اولویت بازه‌ی جدید/ })).toBeTruthy();
    expect(within(refreshedSoldProductsRegion).queryByRole("rowheader", { name: /اولویت بازه‌ی قبلی/ })).toBeNull();
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
    const table = within(await screen.findByRole("region", { name: "جدول سود محصولات" })).getByRole("table");
    expect(within(table).getByText("در این بازه سفارشی تسویه‌ی کامل نشده است.").closest("td")?.getAttribute("colspan")).toBe("7");
    expect(screen.getByText("حاشیه‌ی سود ناخالص").closest("div")!.textContent).toContain(
      "محاسبه نشده",
    );
    expect(screen.getAllByText("در این بازه سفارشی تسویه‌ی کامل نشده است.")).toHaveLength(2);
  });
});
