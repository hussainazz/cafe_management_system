// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { recordTerminalTiming } from "./api-client";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
it("retains failed telemetry and retries the same report ID without a purchase request", async () => {
  localStorage.clear();
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetcher);
  const id = "50000000-0000-4000-8000-000000000003";
  recordTerminalTiming(id, "bridge_roundtrip", 5000, "timeout");
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await new Promise(resolve => setTimeout(resolve, 0));
  const firstId = JSON.parse(fetcher.mock.calls[0]![1].body).reportId;
  expect(JSON.parse(localStorage.getItem("run-cafe:terminal-timing-v1")!)).toHaveLength(1);
  recordTerminalTiming(id, "status_roundtrip", 30, "ok");
  await waitFor(() => expect(JSON.parse(localStorage.getItem("run-cafe:terminal-timing-v1")!)).toHaveLength(0));
  expect(JSON.parse(fetcher.mock.calls[1]![1].body).reportId).toBe(firstId);
  expect(fetcher.mock.calls.every(([url]) => String(url).endsWith("/timing"))).toBe(true);
});
