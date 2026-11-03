// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalConnectionMonitor } from "./terminal-connection-monitor";
const config = vi.hoisted(() => vi.fn());
vi.mock("../lib/api-client", () => ({ terminalConfig: config }));
beforeEach(() => { config.mockResolvedValue({ ok: true, data: { enabled: true } }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const response = (status: string, ageSeconds: number | null = 5) => ({ ok: true, json: async () => ({ service: "run-cafe-sep-bridge", terminalConnection: { status, ageSeconds, checking: false } }) });
it("shows the last successful check and age using only passive loopback health", async () => {
  const fetch = vi.fn().mockResolvedValue(response("connected")); vi.stubGlobal("fetch", fetch);
  render(<TerminalConnectionMonitor />);
  await screen.findByText(/آخرین بررسی ارتباط کارت‌خوان موفق بود/);
  expect(screen.getByText(/۵ ثانیه پیش/)).toBeTruthy();
  expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:18711/health");
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit", mode: "cors" });
  expect(screen.queryByRole("button")).toBeNull();
});
it("shows a persistent failure warning without payment actions", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("unavailable")));
  render(<TerminalConnectionMonitor />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("ارتباط با کارت‌خوان برقرار نشد"));
  expect(screen.queryByRole("button")).toBeNull();
});
it("marks old successful samples stale instead of claiming current connectivity", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("connected", 180)));
  render(<TerminalConnectionMonitor />);
  await screen.findByText(/وضعیت ارتباط کارت‌خوان به‌روز نیست/);
});
it("does not probe when terminal integration is disabled", async () => {
  config.mockResolvedValue({ ok: true, data: { enabled: false } });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);render(<TerminalConnectionMonitor />);
  await waitFor(() => expect(config).toHaveBeenCalled()); expect(fetch).not.toHaveBeenCalled();
});
it("polls health once per minute and clears the warning after recovery", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(response("unavailable")).mockResolvedValue(response("connected", 0)); vi.stubGlobal("fetch", fetch);
  render(<TerminalConnectionMonitor />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("alert")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetch).toHaveBeenCalledTimes(2); expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText(/آخرین بررسی ارتباط کارت‌خوان موفق بود/)).toBeTruthy();
});
