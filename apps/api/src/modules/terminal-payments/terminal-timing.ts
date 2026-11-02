import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "../../../generated/prisma/client.js";

// Telemetry never blocks a payment response. Bound memory and DB wait; the
// structured journal record remains available if persistence is unavailable.
export function createTimingRecorder(app: FastifyInstance) {
  const pending: Array<() => Promise<void>> = [];
  let active = false;
  const drain = async () => {
    if (active) return;
    active = true;
    try { while (pending.length) await pending.shift()!(); }
    finally { active = false; }
  };
  return (request: FastifyRequest, attemptId: string | null, snapshot: Prisma.InputJsonObject, reportId: string = randomUUID()) => {
    snapshot = { implementation: "sep-timing-20261101-v1", ...snapshot };
    request.log.info({ event: "sep_terminal_timing", reportId, attemptId, ...snapshot }, "SEP terminal timing");
    if (!attemptId) return Promise.resolve(true);
    if (pending.length >= 128) {
      request.log.warn({ event: "sep_terminal_timing_queue_full", reportId, attemptId });
      return Promise.resolve(false);
    }
    return new Promise<boolean>(resolve => {
      let expired = false;
      const waitTimer = setTimeout(() => {
        expired = true;
        request.log.warn({ event: "sep_terminal_timing_queue_expired", reportId, attemptId });
        resolve(false);
      }, 500);
      pending.push(async () => {
        clearTimeout(waitTimer);
        if (expired) return;
        try {
          await app.prisma.$transaction(async tx => {
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '1000ms'");
            await tx.auditLog.upsert({ where: { id: reportId }, update: {}, create: {
              id: reportId, requestId: request.id, operation: "TERMINAL_PAYMENT_TIMING",
              entityType: "TERMINAL_ATTEMPT", entityId: attemptId, afterSnapshot: snapshot,
            } });
          }, { maxWait: 250, timeout: 1500 });
          resolve(true);
        } catch {
          resolve(false);
          request.log.warn({ event: "sep_terminal_timing_persistence_failed", reportId, attemptId });
        }
      });
      setImmediate(() => { void drain(); });
    });
  };
}
