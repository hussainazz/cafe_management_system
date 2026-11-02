import { expect, it, vi } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createTimingRecorder } from "../../src/modules/terminal-payments/terminal-timing.js";

it("queues telemetry without waiting for a slow database and reports persistence failure", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const transaction = vi.fn(async () => { await blocked; throw new Error("database unavailable"); });
  const app = { prisma: { $transaction: transaction } } as unknown as FastifyInstance;
  const log = { info: vi.fn(), warn: vi.fn() };
  const request = { id: "timing-test", log } as unknown as FastifyRequest;
  const record = createTimingRecorder(app);
  let settled = false;
  const persisted = record(request, "50000000-0000-4000-8000-000000000003", { stage: "prepare_api" }).then(value => { settled = true; return value; });
  expect(log.info).toHaveBeenCalledOnce();
  expect(transaction).not.toHaveBeenCalled();
  await new Promise(resolve => setImmediate(resolve));
  expect(transaction).toHaveBeenCalledOnce(); expect(settled).toBe(false);
  release(); expect(await persisted).toBe(false);
  expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "sep_terminal_timing_persistence_failed" }));
});

it("expires a queued telemetry write while another write is stalled", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const transaction = vi.fn(async () => { await blocked; });
    const app = { prisma: { $transaction: transaction } } as unknown as FastifyInstance;
    const request = { id: "queue-test", log: { info: vi.fn(), warn: vi.fn() } } as unknown as FastifyRequest;
    const record = createTimingRecorder(app);
    const first = record(request, "50000000-0000-4000-8000-000000000003", { stage: "prepare_api" });
    await new Promise(resolve => setImmediate(resolve));
    const second = record(request, "50000000-0000-4000-8000-000000000004", { stage: "prepare_api" });
    await vi.advanceTimersByTimeAsync(501);
    expect(await second).toBe(false);
    expect(transaction).toHaveBeenCalledOnce();
    release(); expect(await first).toBe(true);
  } finally { vi.useRealTimers(); }
});
