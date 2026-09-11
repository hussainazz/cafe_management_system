// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagerWorkspace } from "./manager-workspace";

const catalog = { categories: [], products: [], optionGroups: [], tables: [] };

const api = vi.hoisted(() => ({
  readManagerCatalog: vi.fn(), readManagerStaff: vi.fn(), readManagerSettings: vi.fn(),
  readPaymentHistory: vi.fn(), readDailyReport: vi.fn(), readAuditLog: vi.fn(), readOrder: vi.fn(),
  archiveCategory: vi.fn(), archiveOption: vi.fn(), archiveProduct: vi.fn(), archiveProductImage: vi.fn(), archiveTable: vi.fn(), deactivateStaff: vi.fn(), reactivateStaff: vi.fn(), reverseSettlement: vi.fn(), saveCategory: vi.fn(), saveOption: vi.fn(), saveOptionGroup: vi.fn(), saveProduct: vi.fn(), saveSettings: vi.fn(), saveStaff: vi.fn(), saveTable: vi.fn(), uploadProductImage: vi.fn(),
}));

vi.mock("../lib/api-client", () => api);

describe("ManagerWorkspace", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    api.readManagerCatalog.mockResolvedValue({ ok: true, data: catalog });
    api.readManagerStaff.mockResolvedValue({ ok: true, data: [] });
    api.readManagerSettings.mockResolvedValue({ ok: true, data: { id: "00000000-0000-4000-8000-000000000001", tableSeatingLimitMinutes: null, updatedAt: new Date().toISOString() } });
    api.readPaymentHistory.mockResolvedValue({ ok: true, data: { payments: [], page: { nextCursor: null } } });
    api.readDailyReport.mockResolvedValue({ ok: true, data: null });
    api.readAuditLog.mockResolvedValue({ ok: true, data: { data: { entries: [] }, meta: { page: { nextCursor: null } } } });
  });

  it("keeps a partial initial-load failure visible after sibling reads succeed", async () => {
    api.readManagerStaff.mockResolvedValue({ ok: false, error: { kind: "response", message: "Staff unavailable" } });
    render(<ManagerWorkspace menuOpen={false} onOpenMenu={() => undefined} />);
    expect(await screen.findByText("داده زنده ناقص است.")).toBeTruthy();
    expect(screen.getByText("Staff unavailable")).toBeTruthy();
    expect(screen.getByText("کاتالوگ و میزها")).toBeTruthy();
  });

  it("does not refetch finance data while audit filters are being typed", async () => {
    render(<ManagerWorkspace menuOpen={false} onOpenMenu={() => undefined} />);
    await waitFor(() => expect(screen.getByText("کاتالوگ و میزها")).toBeTruthy());
    fireEvent.click(screen.getByText("حسابداری"));
    await waitFor(() => expect(api.readAuditLog).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("عملیات"), { target: { value: "UPDATE_PRODUCT" } });
    expect(api.readAuditLog).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("اعمال فیلتر"));
    await waitFor(() => expect(api.readAuditLog).toHaveBeenCalledTimes(2));
  });

  it("keeps a settlement reversal open until its required reason is entered", async () => {
    api.readPaymentHistory.mockResolvedValue({ ok: true, data: { payments: [{ id: "settlement-1", orderId: "order-1", orderNumber: "1001", totalAmount: 25_000, reversedAt: null }], page: { nextCursor: null } } });
    api.readOrder.mockResolvedValue({ ok: true, data: { version: 3 } });
    api.reverseSettlement.mockResolvedValue({ ok: true });
    render(<ManagerWorkspace menuOpen={false} onOpenMenu={() => undefined} />);
    await waitFor(() => expect(screen.getByText("کاتالوگ و میزها")).toBeTruthy());
    fireEvent.click(screen.getByText("حسابداری"));
    expect(await screen.findByText("برگشت تسویه")).toBeTruthy();
    fireEvent.click(screen.getByText("برگشت تسویه"));
    fireEvent.click(screen.getByText("تأیید"));
    expect(await screen.findByText("ثبت دلیل برای این عملیات الزامی است.")).toBeTruthy();
    expect(api.reverseSettlement).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("دلیل برگشت تسویه"), { target: { value: "ثبت اشتباه" } });
    fireEvent.click(screen.getByText("تأیید"));
    await waitFor(() =>
      expect(api.reverseSettlement).toHaveBeenCalledWith("settlement-1", {
        expectedVersion: 3,
        reason: "ثبت اشتباه",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("برگشت تسویه"));
    fireEvent.click(screen.getByText("انصراف"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows upload progress while an item image is being sent", async () => {
    let finishUpload: (() => void) | undefined;
    api.readManagerCatalog.mockResolvedValue({
      ok: true,
      data: {
        ...catalog,
        products: [{
          id: "product-1",
          name: "ترک",
          priceAmount: 185_000,
          isAvailable: true,
          image: null,
        }],
      },
    });
    api.uploadProductImage.mockImplementation(
      () => new Promise((resolve) => { finishUpload = () => resolve({ ok: true }); }),
    );
    render(<ManagerWorkspace menuOpen={false} onOpenMenu={() => undefined} />);
    await screen.findByText("ترک");
    fireEvent.click(screen.getByText("ترک"));
    const file = new File(["image"], "turkish.webp", { type: "image/webp" });
    const imageInput = screen.getByLabelText("تصویر JPEG/PNG/WebP") as HTMLInputElement;
    Object.defineProperty(imageInput, "files", { value: [file] });
    fireEvent.change(imageInput);
    fireEvent.change(screen.getByLabelText("متن جایگزین"), { target: { value: "فنجان ترک" } });
    fireEvent.submit(imageInput.closest("form")!);
    expect(await screen.findByRole("progressbar", { name: "پیشرفت بارگذاری تصویر" })).toBeTruthy();
    expect(screen.getByText("0٪")).toBeTruthy();
    finishUpload?.();
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
  });
});
