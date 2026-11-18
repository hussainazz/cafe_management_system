// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryPricingExperiments } from "./inventory-pricing-experiments";
import * as api from "../lib/api-client";
import { pricingExperimentReportFixture } from "./pricing-experiment-report.fixture";
import * as csv from "./pricing-experiment-csv";

vi.mock("../lib/api-client", () => ({
  createPricingExperiment: vi.fn(),
  readPricingExperiments: vi.fn(),
  readPricingExperimentReport: vi.fn(),
  simulatePricingScenario: vi.fn(),
}));

const productId = "11111111-1111-4111-8111-111111111111";
const experimentId = "22222222-2222-4222-8222-222222222222";
const managerCatalog = {
  categories: [], optionGroups: [], tables: [],
  products: [{ id: productId, name: "قهوه", priceAmount: 20_000, systemKey: null, archivedAt: null, optionGroups: [] }],
} as never;
const experiment = {
  id: experimentId, name: "افزایش قیمت قهوه", effectiveAt: "2026-11-02T08:30:00.000Z", expectedEvaluationDays: 14,
  comparisonDays: 7, notes: null, createdAt: "2026-11-02T08:30:00.000Z", createdBy: { id: productId, username: "manager" },
  targets: [{ id: "33333333-3333-4333-8333-333333333333", targetKey: `PRODUCT:${productId}:`, targetKind: "PRODUCT", productId,
    productNameSnapshot: "قهوه", optionId: null, optionNameSnapshot: null, previousPriceAmount: null, proposedPriceAmount: 20_000,
    priceHistory: { status: "MISSING", changeIds: [], effectiveAt: null, originalPriceMatches: null } }],
};
const ok = (data: unknown) => ({ ok: true, data });

beforeEach(() => {
  vi.clearAllMocks();
  let listReads = 0;
  vi.mocked(api.readPricingExperiments).mockImplementation(async () => ok({ data: { experiments: ++listReads === 1 ? [] : [experiment] }, meta: { requestId: "test" } }) as never);
  vi.mocked(api.createPricingExperiment).mockResolvedValue(ok({ data: { experiment }, meta: { requestId: "test" } }) as never);
  vi.mocked(api.readPricingExperimentReport).mockResolvedValue({ ok: false, error: { kind: "response", status: 404, message: "no report" } } as never);
  vi.mocked(api.simulatePricingScenario).mockResolvedValue(ok({ data: {
    source: { netRevenueAmount: 0, contributionAmount: null, fixedCostCoveragePercent: null },
    rules: [{ targetKind: "PRODUCT", label: "قهوه", currentPriceAmount: 20_000, proposedPriceAmount: 21_000, affectedItemUnits: 0 }],
    scenarios: [{ volumeChangePercent: "0.00", netRevenueAmount: 0, contributionAmount: null, packagingDeficitAmount: null,
      monthlyEquivalentContributionAmount: null, fixedCostCoveragePercent: null, operatingSurplusAmount: null, breakEvenVolumeDeclinePercent: null, costsComplete: false }],
    assumptions: ["قیمت‌های منو تغییر نکرده‌اند."],
  }, meta: { requestId: "test" } }) as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Developer pricing experiment workflow", () => {
  it("retries a failed report when the Manager refreshes the same experiment", async () => {
    const report = pricingExperimentReportFixture();
    vi.mocked(api.readPricingExperiments).mockResolvedValue(ok({ data: { experiments: [report.data.experiment] }, meta: { requestId: "test" } }) as never);
    vi.mocked(api.readPricingExperimentReport).mockResolvedValueOnce({ ok: false, error: { kind: "response", status: 503, message: "Unavailable" } } as never).mockResolvedValue(ok(report) as never);
    render(<InventoryPricingExperiments catalog={managerCatalog} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "تازه‌سازی" }));
    await screen.findByText("داده‌ها آماده‌اند");
    expect(api.readPricingExperimentReport).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["READY", "داده‌ها آماده‌اند"],
    ["IN_PROGRESS", "در حال ارزیابی"],
    ["INCONCLUSIVE", "نیازمند داده‌ی بیشتر"],
  ] as const)("renders a successful %s report, including negative amounts and unavailable metrics", async (status, label) => {
    const report = pricingExperimentReportFixture(status);
    vi.mocked(api.readPricingExperiments).mockResolvedValue(ok({ data: { experiments: [report.data.experiment] }, meta: { requestId: "test" } }) as never);
    vi.mocked(api.readPricingExperimentReport).mockResolvedValue(ok(report) as never);
    const { container } = render(<InventoryPricingExperiments catalog={managerCatalog} />);
    await screen.findByText(label);
    expect(container.querySelector(".pricing-experiment-dashboard")).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(5);
    expect(container.querySelectorAll("table").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('قهوه، "بزرگ"')).toBeTruthy();
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("undefined");
    if (status === "INCONCLUSIVE") {
      expect(screen.getByText("بهای کامل ثبت نشده است.")).toBeTruthy();
      expect(screen.getAllByText("محاسبه نشده").length).toBeGreaterThan(5);
      expect(screen.getByText(/قیمت پیش از آزمایش را با تاریخچه‌ی قیمت تطبیق دهید/)).toBeTruthy();
    } else {
      expect(container.querySelector(status === "READY" ? ".pricing-assessment.is-negative" : ".pricing-assessment.is-neutral")).toBeTruthy();
      expect(container.textContent).toContain("−");
    }
    fireEvent.change(screen.getByLabelText("طول هر دوره‌ی مقایسه"), { target: { value: "7" } });
    await waitFor(() => expect(api.readPricingExperimentReport).toHaveBeenLastCalledWith(experimentId, 7));
  });

  it("exports a loaded report with real product rows and CSV quoting", async () => {
    const report = pricingExperimentReportFixture();
    vi.mocked(api.readPricingExperiments).mockResolvedValue(ok({ data: { experiments: [report.data.experiment] }, meta: { requestId: "test" } }) as never);
    vi.mocked(api.readPricingExperimentReport).mockResolvedValue(ok(report) as never);
    const createObjectURL = vi.fn(() => "blob:pricing-test"), revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const exportCsv = vi.spyOn(csv, "pricingExperimentCsv");
    render(<InventoryPricingExperiments catalog={managerCatalog} />);
    fireEvent.click(await screen.findByRole("button", { name: "دریافت گزارش CSV" }));
    expect(exportCsv).toHaveBeenCalledWith(report);
    expect(exportCsv.mock.results[0]?.value).toContain('قهوه، ""بزرگ""');
    expect(download).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pricing-test");
  });

  it("submits the selected category-specific packaging product for experiments and simulations", async () => {
    const packA = "44444444-4444-4444-8444-444444444444", packB = "55555555-5555-4555-8555-555555555555";
    const catalog = { categories: [{ id: "a", name: "نوشیدنی", kind: "SOURCE", archivedAt: null }, { id: "b", name: "خوراک", kind: "SOURCE", archivedAt: null }], optionGroups: [], tables: [],
      products: [{ id: productId, name: "قهوه", categoryId: "a", systemKey: null, archivedAt: null, optionGroups: [] },
        { id: packA, name: "بسته‌بندی", categoryId: "a", systemKey: "PACKING", archivedAt: null }, { id: packB, name: "بسته‌بندی", categoryId: "b", systemKey: "PACKING", archivedAt: null }] } as never;
    render(<InventoryPricingExperiments catalog={catalog} />);
    await screen.findByText("آزمایش قیمت‌گذاری");
    fireEvent.change(screen.getByLabelText("نوع هدف"), { target: { value: "PACKAGING" } });
    fireEvent.change(screen.getByLabelText("قلم بسته‌بندی"), { target: { value: packB } });
    fireEvent.change(screen.getByLabelText("نام آزمایش"), { target: { value: "بسته‌بندی خوراک" } });
    fireEvent.change(screen.getByLabelText("قیمت پیشنهادی (تومان)"), { target: { value: "20000" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی اطلاعات آزمایش" }));
    await waitFor(() => expect(api.createPricingExperiment).toHaveBeenCalledWith(expect.objectContaining({ targets: [expect.objectContaining({ targetKind: "PACKAGING", productId: packB })] })));
    fireEvent.change(screen.getByLabelText("نوع سیاست"), { target: { value: "PACKAGING" } });
    fireEvent.change(screen.getAllByLabelText("قلم بسته‌بندی")[1]!, { target: { value: packB } });
    fireEvent.change(screen.getByLabelText("تغییر قیمت هر واحد (تومان)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "محاسبه‌ی سناریو" }));
    await waitFor(() => expect(api.simulatePricingScenario).toHaveBeenCalledWith(expect.objectContaining({ rules: [{ targetKind: "PACKAGING", productId: packB, adjustmentAmount: 1_000 }] })));
  });

  it("creates analysis metadata and runs a hypothetical scenario without catalog price writes", async () => {
    const { container } = render(<InventoryPricingExperiments catalog={managerCatalog} />);
    await screen.findByText("آزمایش قیمت‌گذاری");
    fireEvent.change(screen.getByLabelText("نام آزمایش"), { target: { value: "افزایش قیمت قهوه" } });
    fireEvent.change(screen.getByLabelText("محصول هدف و دسته‌بندی آن"), { target: { value: productId } });
    fireEvent.change(screen.getByLabelText("قیمت پیشنهادی (تومان)"), { target: { value: "20000" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره‌ی اطلاعات آزمایش" }));

    await waitFor(() => expect(api.createPricingExperiment).toHaveBeenCalledTimes(1));
    expect(api.createPricingExperiment).toHaveBeenCalledWith(expect.objectContaining({
      name: "افزایش قیمت قهوه", comparisonDays: 14, targets: [expect.objectContaining({ targetKind: "PRODUCT", productId, previousPriceAmount: null, proposedPriceAmount: 20_000 })],
    }));
    await screen.findByText(/زمان مؤثر آزمایش/);

    fireEvent.click(screen.getByText("شبیه‌سازی قیمت و حساسیت حجم"));
    fireEvent.change(screen.getByLabelText("محصول سیاست و دسته‌بندی آن"), { target: { value: productId } });
    fireEvent.change(screen.getByLabelText("تغییر قیمت هر واحد (تومان)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "محاسبه‌ی سناریو" }));
    await waitFor(() => expect(api.simulatePricingScenario).toHaveBeenCalledTimes(1));
    const submitted = vi.mocked(api.simulatePricingScenario).mock.calls[0]![0];
    expect(submitted.rules).toEqual([expect.objectContaining({ targetKind: "PRODUCT", productId, adjustmentAmount: 1_000 })]);
    expect(submitted.fromDate < submitted.toDate).toBe(true);
    expect(api.createPricingExperiment).toHaveBeenCalledTimes(1);
    expect(api.readPricingExperiments).toHaveBeenCalled();
    expect(container.querySelector(".pricing-scenario-results")).toBeTruthy();
    expect(screen.getByText("قیمت‌های جدید روی منو ذخیره نشده‌اند.")).toBeTruthy();
  });
});
