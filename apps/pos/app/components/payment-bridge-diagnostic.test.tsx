// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PaymentBridgeDiagnostic } from "./payment-bridge-diagnostic";
import { currentSession } from "../lib/api-client";
import { probeBridge } from "../lib/sep-bridge-diagnostic";

vi.mock("../lib/api-client", () => ({ currentSession: vi.fn() }));
vi.mock("../lib/sep-bridge-diagnostic", () => ({ bridgeHealthUrl: () => "http://127.0.0.1:18711/health", probeBridge: vi.fn() }));
beforeEach(() => {
  vi.mocked(currentSession).mockResolvedValue({ ok: true, replayed: false, data: { id: "staff", username: "staff", role: "STAFF" } });
  vi.mocked(probeBridge).mockImplementation(async (_, kind) => ({ kind, ok: true, status: 200 }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

it("requires explicit action and performs only two health probes, including on repeated clicks", async () => {
  render(<PaymentBridgeDiagnostic port={18711} />);
  const button = screen.getByRole("button", { name: "شروع بررسی ارتباط" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(probeBridge).not.toHaveBeenCalled();
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(probeBridge).toHaveBeenCalledTimes(2));
  expect(vi.mocked(probeBridge).mock.calls.map(call => call[1])).toEqual(["simple", "preflight"]);
  expect(screen.getByText("موفقیت این بررسی، اتصال یا آمادگی کارت‌خوان برای پرداخت را تأیید نمی‌کند.")).toBeTruthy();
});

it("keeps diagnostics unavailable without a valid POS session", async () => {
  vi.mocked(currentSession).mockResolvedValue({ ok: false, error: { kind: "response", message: "Sign in", status: 401 } });
  render(<PaymentBridgeDiagnostic port={18711} />);
  await screen.findByRole("alert");
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  expect(probeBridge).not.toHaveBeenCalled();
});

it("aborts a read when leaving the page and never starts another probe", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(probeBridge).mockImplementation((_, kind, suppliedSignal) => new Promise(resolve => {
    signal = suppliedSignal;
    suppliedSignal.addEventListener("abort", () => resolve({ kind, ok: false, error: "network-or-policy" }));
  }));
  const view = render(<PaymentBridgeDiagnostic port={18711} />);
  const button = screen.getByRole("button", { name: "شروع بررسی ارتباط" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  expect(probeBridge).toHaveBeenCalledTimes(1);
});

it("ends a stalled check with a timeout message and no second probe", async () => {
  vi.useFakeTimers();
  vi.mocked(probeBridge).mockImplementation((_, kind, signal) => new Promise(resolve => {
    signal.addEventListener("abort", () => resolve({ kind, ok: false, error: "network-or-policy" }));
  }));
  render(<PaymentBridgeDiagnostic port={18711} />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "شروع بررسی ارتباط" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(screen.getByRole("alert").textContent).toContain("مهلت بررسی تمام شد");
  expect(probeBridge).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("button", { name: "شروع بررسی ارتباط" }) as HTMLButtonElement).disabled).toBe(false);
});
