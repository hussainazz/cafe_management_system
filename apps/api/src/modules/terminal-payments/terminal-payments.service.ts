import { randomUUID } from "node:crypto";
import { RecordSettlementRequestSchema, type RecordSettlementRequest, type TerminalAttempt, type TerminalClaim, type TerminalIntent, type TerminalReconcile, type TerminalResult } from "@cafe/contracts";
import { Prisma, type PrismaClient, type TerminalPaymentAttempt } from "../../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import type { AuthenticatedUser } from "../auth/auth.service.js";
import { requireRole } from "../auth/permissions.js";
import { planSettlementInTransaction, postSettlementInTransaction } from "../orders/orders.service.js";
import { claimMessage, intentMessage, resultMessage, signTerminalMessage, terminalFingerprint, verifyTerminalMessage } from "./terminal-signatures.js";

const unresolved = ["PENDING", "UNKNOWN"] as const;
const fail = (message: string) => new ApplicationError(409, ErrorCodes.INVALID_STATE, message);
function enabled() {
  if (!env.SEP_TERMINAL_ENABLED || !env.SEP_BRIDGE_ID || !env.SEP_TERMINAL_ID || !env.SEP_BRIDGE_HMAC_KEY)
    throw new ApplicationError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Terminal-assisted payments are disabled.");
}
async function orderLocks(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { tableId: true, channel: true } });
  const keys = [`order:${orderId}`, ...(order?.channel === "TABLE" && order.tableId ? [`table:${order.tableId}`] : [])].sort();
  for (const key of keys) await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}::text))`);
}
async function lockedAttempt(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "terminal_payment_attempts" WHERE "id" = ${id} FOR UPDATE`);
  const attempt = await tx.terminalPaymentAttempt.findUnique({ where: { id } });
  if (!attempt) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The terminal attempt was not found.");
  return attempt;
}
function dto(attempt: TerminalPaymentAttempt): TerminalAttempt {
  const checkout = RecordSettlementRequestSchema.parse(attempt.checkoutSnapshot);
  let authorization: TerminalIntent | null = null;
  if (env.SEP_TERMINAL_ENABLED && env.SEP_BRIDGE_HMAC_KEY && attempt.bridgeId === env.SEP_BRIDGE_ID && attempt.terminalId === env.SEP_TERMINAL_ID && attempt.status === "PENDING" && !attempt.dispatchedAt && attempt.authorizationExpiresAt.getTime() > Date.now()) {
    const intent: Omit<TerminalIntent, "signature"> = {
      attemptId: attempt.id, bridgeId: attempt.bridgeId, terminalId: attempt.terminalId, orderId: attempt.orderId,
      orderVersion: attempt.expectedOrderVersion, cardAmount: attempt.cardAmount, unit: "TOMAN", checkoutHash: attempt.fingerprint,
      nonce: attempt.nonce, issuedAtUnix: Math.floor(attempt.createdAt.getTime() / 1000), expiresAtUnix: Math.floor(attempt.authorizationExpiresAt.getTime() / 1000),
    };
    authorization = { ...intent, signature: signTerminalMessage(intentMessage(intent), env.SEP_BRIDGE_HMAC_KEY) };
  }
  return {
    id: attempt.id, orderId: attempt.orderId, bridgeId: attempt.bridgeId, terminalId: attempt.terminalId,
    cardAmount: attempt.cardAmount, settlementAmount: checkout.payments.reduce((sum, payment) => sum + payment.amount, 0), payments: checkout.payments.map(({ method, amount }) => ({ method, amount })), orderVersion: attempt.expectedOrderVersion, version: attempt.version, status: attempt.status,
    createdAt: attempt.createdAt.toISOString(), dispatchedAt: attempt.dispatchedAt?.toISOString() ?? null,
    resultReceivedAt: attempt.resultReceivedAt?.toISOString() ?? null, responseCode: attempt.responseCode, rrn: attempt.rrn,
    trace: attempt.trace, settlementId: attempt.settlementId, resolvedAt: attempt.resolvedAt?.toISOString() ?? null,
    manualVerificationRequired: true, authorization,
  };
}

export async function prepareTerminalAttempt(prisma: PrismaClient, actor: AuthenticatedUser, orderId: string, body: RecordSettlementRequest, key: string, requestId: string) {
  requireRole(actor, ["STAFF", "MANAGER"]); enabled();
  const input = RecordSettlementRequestSchema.parse(body);
  const cards = input.payments.filter(payment => payment.method === "CARD_TERMINAL");
  if (cards.length !== 1 || input.payments.some(payment => !Number.isSafeInteger(payment.amount) || payment.amount > 2_147_483_647))
    throw new ApplicationError(422, ErrorCodes.BUSINESS_RULE_VIOLATION, "Use one terminal charge per assisted settlement, with bounded integer amounts.");
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw new ApplicationError(400, ErrorCodes.VALIDATION_ERROR, "A valid idempotency key is required.");
  const fingerprint = terminalFingerprint({ orderId, ...input });
  const replay = async () => {
    const prior = await prisma.terminalPaymentAttempt.findUnique({ where: { createdById_idempotencyKey: { createdById: actor.id, idempotencyKey: key } } });
    if (!prior) return null;
    if (prior.fingerprint !== fingerprint) throw new ApplicationError(409, ErrorCodes.IDEMPOTENCY_CONFLICT, "The key belongs to another terminal checkout.");
    return dto(prior);
  };
  const previous = await replay(); if (previous) return { attempt: previous, replayed: true };
  try {
    const attempt = await prisma.$transaction(async tx => {
      await orderLocks(tx, orderId);
      await planSettlementInTransaction(tx, orderId, input);
      const changed = await tx.order.updateMany({ where: { id: orderId, state: "OPEN", version: input.expectedVersion }, data: { version: { increment: 1 } } });
      if (changed.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed.");
      const now = new Date();
      const result = await tx.terminalPaymentAttempt.create({ data: {
        orderId, createdById: actor.id, idempotencyKey: key, fingerprint, bridgeId: env.SEP_BRIDGE_ID!, terminalId: env.SEP_TERMINAL_ID!,
        cardAmount: cards[0]!.amount, expectedOrderVersion: input.expectedVersion + 1,
        checkoutSnapshot: input as unknown as Prisma.InputJsonValue, nonce: randomUUID(), createdAt: now,
        authorizationExpiresAt: new Date(now.getTime() + 120000),
      } });
      await tx.auditLog.create({ data: { actorId: actor.id, requestId, operation: "PREPARE_TERMINAL_ATTEMPT", entityType: "TERMINAL_ATTEMPT", entityId: result.id, afterSnapshot: { orderId, cardAmount: result.cardAmount, orderVersion: result.expectedOrderVersion } } });
      return result;
    });
    return { attempt: dto(attempt), replayed: false };
  } catch (error) {
    // A concurrent identical request can lose the order CAS before the unique index.
    const prior = await replay(); if (prior) return { attempt: prior, replayed: true };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw fail("This terminal or order already has an unresolved attempt.");
    }
    throw error;
  }
}

export async function readTerminalAttempt(prisma: PrismaClient, actor: AuthenticatedUser, id: string) {
  requireRole(actor, ["STAFF", "MANAGER"]);
  // Monotonic uncertainty classification only; this read can never dispatch or settle.
  await prisma.terminalPaymentAttempt.updateMany({ where: { id, status: "PENDING", dispatchedAt: { lt: new Date(Date.now() - 45000) } }, data: { status: "UNKNOWN", version: { increment: 1 } } });
  const attempt = await prisma.terminalPaymentAttempt.findUnique({ where: { id } });
  if (!attempt) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The terminal attempt was not found.");
  return dto(attempt);
}
export async function activeTerminalAttempt(prisma: PrismaClient, actor: AuthenticatedUser, orderId?: string) {
  requireRole(actor, ["STAFF", "MANAGER"]);
  const attempt = await prisma.terminalPaymentAttempt.findFirst({ where: { ...(orderId ? { orderId } : {}), status: { in: [...unresolved] } }, orderBy: { createdAt: "asc" } });
  return attempt ? readTerminalAttempt(prisma, actor, attempt.id) : null;
}

function verifyBridge(message: string, signature: unknown, bridgeId: string, sentAtUnix: number) {
  if (!env.SEP_BRIDGE_HMAC_KEY || bridgeId !== env.SEP_BRIDGE_ID || Math.abs(Math.floor(Date.now() / 1000) - sentAtUnix) > 90 ||
      !verifyTerminalMessage(message, signature, env.SEP_BRIDGE_HMAC_KEY))
    throw new ApplicationError(401, ErrorCodes.AUTHENTICATION_REQUIRED, "Bridge authentication failed.");
}
export async function claimTerminalAttempt(prisma: PrismaClient, body: TerminalClaim, signature: unknown, requestId: string) {
  enabled(); verifyBridge(claimMessage(body), signature, body.bridgeId, body.sentAtUnix);
  const attempt = await prisma.$transaction(async tx => {
    const current = await lockedAttempt(tx, body.attemptId);
    if (current.bridgeId !== body.bridgeId || current.nonce !== body.nonce || current.status !== "PENDING" || current.dispatchedAt || current.authorizationExpiresAt.getTime() <= Date.now())
      throw fail("This authorization cannot dispatch. Do not repeat a purchase.");
    const result = await tx.terminalPaymentAttempt.update({ where: { id: current.id }, data: { dispatchedAt: new Date(), version: { increment: 1 } } });
    await tx.auditLog.create({ data: { requestId, operation: "CLAIM_TERMINAL_ATTEMPT", entityType: "TERMINAL_ATTEMPT", entityId: current.id, afterSnapshot: { orderId: current.orderId } } });
    return result;
  });
  return dto(attempt);
}
export async function reportTerminalResult(prisma: PrismaClient, body: TerminalResult, signature: unknown, requestId: string) {
  // Accept evidence with the configured key even if the feature was disabled after dispatch.
  verifyBridge(resultMessage(body), signature, body.bridgeId, body.sentAtUnix);
  const { sentAtUnix: _sent, ...evidence } = body;
  const fingerprint = terminalFingerprint(evidence);
  const result = await prisma.$transaction(async tx => {
    const current = await lockedAttempt(tx, body.attemptId);
    if (current.bridgeId !== body.bridgeId || current.terminalId !== body.terminalId || !current.dispatchedAt)
      throw fail("The result does not match a dispatched attempt.");
    if (current.resultFingerprint === fingerprint) return { attempt: current, conflict: false };
    if (!unresolved.includes(current.status as "PENDING" | "UNKNOWN") || current.resultFingerprint) {
      await tx.auditLog.create({ data: { requestId, operation: "CONFLICTING_TERMINAL_EVIDENCE", entityType: "TERMINAL_ATTEMPT", entityId: current.id, afterSnapshot: { orderId: current.orderId, responseCode: body.responseCode, rrn: body.rrn, trace: body.trace } } });
      return { attempt: current, conflict: true };
    }
    const attempt = await tx.terminalPaymentAttempt.update({ where: { id: current.id }, data: { status: "UNKNOWN", resultReceivedAt: new Date(), resultFingerprint: fingerprint, responseCode: body.responseCode, rrn: body.rrn, trace: body.trace, version: { increment: 1 } } });
    return { attempt, conflict: false };
  });
  if (result.conflict) throw fail("Conflicting or late terminal evidence was retained in audit. Reconcile the bank record; do not charge again.");
  return dto(result.attempt);
}

export async function reconcileTerminalAttempt(prisma: PrismaClient, actor: AuthenticatedUser, id: string, input: TerminalReconcile, requestId: string) {
  requireRole(actor, ["STAFF", "MANAGER"]);
  return prisma.$transaction(async tx => {
    const attempt = await lockedAttempt(tx, id);
    if (!unresolved.includes(attempt.status as "PENDING" | "UNKNOWN")) {
      if (attempt.status === input.decision) return dto(attempt);
      throw fail("The terminal attempt was already resolved differently.");
    }
    if (attempt.version !== input.expectedVersion) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The terminal evidence has changed. Read it again.");
    await orderLocks(tx, attempt.orderId);
    let settlementId: string | null = null;
    if (input.decision === "SUCCEEDED") {
      if (!attempt.dispatchedAt || input.cardAmount !== attempt.cardAmount)
        throw new ApplicationError(422, ErrorCodes.PAYMENT_RECONCILIATION_FAILED, "Verify the dispatched card amount against the receipt or bank record.");
      const checkout = RecordSettlementRequestSchema.parse(attempt.checkoutSnapshot);
      const posted = await postSettlementInTransaction(tx, actor, attempt.orderId, { ...checkout, expectedVersion: attempt.expectedOrderVersion }, `terminal:${attempt.id}`, requestId, attempt.id);
      settlementId = posted.settlementId;
    } else {
      const changed = await tx.order.updateMany({ where: { id: attempt.orderId, state: "OPEN", version: attempt.expectedOrderVersion }, data: { version: { increment: 1 } } });
      if (changed.count !== 1) throw new ApplicationError(409, ErrorCodes.STALE_VERSION, "The reserved order has changed.");
    }
    const updated = await tx.terminalPaymentAttempt.update({ where: { id }, data: {
      status: input.decision, resolvedById: actor.id, resolvedAt: new Date(), verificationBasis: input.basis, settlementId,
      ...(input.decision === "SUCCEEDED" ? { ...(input.rrn ? { rrn: input.rrn } : {}), ...(input.trace ? { trace: input.trace } : {}) } : {}),
      version: { increment: 1 },
    } });
    await tx.auditLog.create({ data: { actorId: actor.id, requestId, operation: "RECONCILE_TERMINAL_ATTEMPT", entityType: "TERMINAL_ATTEMPT", entityId: id,
      beforeSnapshot: { status: attempt.status }, afterSnapshot: { orderId: attempt.orderId, status: input.decision, basis: input.basis, settlementId, cardAmount: attempt.cardAmount, verification: input.decision === "SUCCEEDED" ? { receiptChecked: true } : { noChargeConfirmed: true, terminalIdleConfirmed: true, bridgeStoppedConfirmed: true } } } });
    return dto(updated);
  });
}
