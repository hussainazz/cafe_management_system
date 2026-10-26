import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { hashPassword } from "../../src/auth/password.js";
import { env } from "../../src/config/env.js";
import { claimMessage, intentMessage, resultMessage, signTerminalMessage, verifyTerminalMessage } from "../../src/modules/terminal-payments/terminal-signatures.js";
import type { TerminalAttempt, TerminalClaim, TerminalResult } from "@cafe/contracts";

const app = buildApp();
const bridgeId = "7b150841-7a93-4e1c-8283-bbab396a7689";
const key = "ab".repeat(32); // Isolated fake installation, never a deployment key.
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(() => { Object.assign(env, { SEP_TERMINAL_ENABLED: true, SEP_BRIDGE_ID: bridgeId, SEP_TERMINAL_ID: "31187710", SEP_BRIDGE_HMAC_KEY: key }); });
async function fixture(role: "STAFF" | "MANAGER" = "STAFF") {
  const username = `terminal.${randomUUID()}`;
  await app.prisma.user.create({ data: { username, role, passwordHash: await hashPassword("CafePassword2026") } });
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  const cookies = Object.fromEntries(login.cookies.map(c => [c.name, c.value]));
  const category = await app.prisma.category.create({ data: { name: "Coffee", displayOrder: 1 } });
  const product = await app.prisma.product.create({ data: { categoryId: category.id, name: "Coffee", priceAmount: 10000, preparationDeadlineMinutes: 8, displayOrder: 1 } });
  const table = await app.prisma.cafeTable.create({ data: { name: `Terminal ${randomUUID()}`, displayOrder: 1 } });
  const created = await app.inject({ method: "POST", url: "/api/v1/orders", cookies, headers: { "idempotency-key": randomUUID() }, payload: { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 2, options: [] }] } });
  expect(created.statusCode).toBe(201);
  const order = created.json().data;
  const checkout = { expectedVersion: order.version, allocationMode: "AMOUNT", amount: 10000, payments: [{ method: "CARD_TERMINAL", amount: 7000 }, { method: "CASH", amount: 3000 }] };
  return { cookies, order, checkout, table };
}
async function prepare(f: Awaited<ReturnType<typeof fixture>>, idempotency = randomUUID(), payload = f.checkout) {
  return app.inject({ method: "POST", url: `/api/v1/orders/${f.order.id}/terminal-payment`, cookies: f.cookies, headers: { "idempotency-key": idempotency }, payload });
}
async function claim(attempt: TerminalAttempt) {
  const payload: TerminalClaim = { attemptId: attempt.id, bridgeId, nonce: attempt.authorization!.nonce, sentAtUnix: Math.floor(Date.now() / 1000) };
  return app.inject({ method: "POST", url: "/api/v1/terminal-payments/claim", headers: { "x-sep-signature": signTerminalMessage(claimMessage(payload), key) }, payload });
}
async function evidence(attempt: TerminalAttempt, code = "00") {
  const payload: TerminalResult = { attemptId: attempt.id, bridgeId, terminalId: "31187710", sentAtUnix: Math.floor(Date.now() / 1000), finishedAtUnix: Math.floor(new Date(attempt.createdAt).getTime() / 1000), responseCode: code, rrn: "123456789012", trace: "123456" };
  return app.inject({ method: "POST", url: "/api/v1/terminal-payments/result", headers: { "x-sep-signature": signTerminalMessage(resultMessage(payload), key) }, payload });
}
async function reconcile(f: Awaited<ReturnType<typeof fixture>>, attempt: TerminalAttempt, success = false) {
  return app.inject({ method: "POST", url: `/api/v1/terminal-payments/${attempt.id}/reconcile`, cookies: f.cookies, payload: success
    ? { expectedVersion: attempt.version, decision: "SUCCEEDED", basis: "TERMINAL_RECEIPT", receiptChecked: true, cardAmount: attempt.cardAmount }
    : { expectedVersion: attempt.version, decision: "FAILED", basis: "BANK_RECORD", terminalIdleConfirmed: true, bridgeStoppedConfirmed: true, noChargeConfirmed: true } });
}

describe("Terminal reservations and evidence", () => {
  it("defaults off, requires a session, and enforces exactly one bounded card tender", async () => {
    const f = await fixture();
    env.SEP_TERMINAL_ENABLED = false;
    expect((await prepare(f)).statusCode).toBe(503);
    env.SEP_TERMINAL_ENABLED = true;
    expect((await app.inject({ method: "GET", url: "/api/v1/terminal-payments/active" })).statusCode).toBe(401);
    expect((await prepare(f, randomUUID(), { ...f.checkout, payments: [{ method: "CARD_TERMINAL", amount: 5000 }, { method: "CARD_TERMINAL", amount: 5000 }] })).statusCode).toBe(422);
    expect((await prepare(f, randomUUID(), { ...f.checkout, payments: [{ method: "CARD_TERMINAL", amount: 9999 }] })).statusCode).toBe(422);
    expect(await app.prisma.terminalPaymentAttempt.count()).toBe(0);
  });
  it("freezes server-validated Toman checkout, returns one attempt for concurrent retries, and binds every authorization field", async () => {
    const f = await fixture(); const idempotency = randomUUID();
    const responses = await Promise.all([prepare(f, idempotency), prepare(f, idempotency)]);
    expect(responses.map(r => r.statusCode)).toEqual([201, 201]);
    const a = responses[0]!.json().data as TerminalAttempt;
    expect(responses[1]!.json().data.id).toBe(a.id);
    expect(a).toMatchObject({ cardAmount: 7000, status: "PENDING", orderVersion: 2, manualVerificationRequired: true });
    const { signature, ...intent } = a.authorization!;
    expect(verifyTerminalMessage(intentMessage(intent), signature, key)).toBe(true);
    expect(verifyTerminalMessage(intentMessage({ ...intent, cardAmount: 7001 }), signature, key)).toBe(false);
    expect(verifyTerminalMessage(claimMessage({ attemptId: a.id, bridgeId, nonce: intent.nonce, sentAtUnix: intent.issuedAtUnix }), signature, key)).toBe(false);
    expect((await prepare(f, idempotency, { ...f.checkout, amount: 9000 })).statusCode).toBe(409);
    expect(await app.prisma.payment.count()).toBe(0);
    await expect(app.prisma.terminalPaymentAttempt.update({ where: { id: a.id }, data: { cardAmount: 1 } })).rejects.toThrow();
  });
  it("reserves order mutations, manual settlement and terminal until explicit no-charge resolution, even disabled", async () => {
    const f = await fixture(); const a = (await prepare(f)).json().data;
    const requests = [
      { method: "POST" as const, url: `/api/v1/orders/${f.order.id}/delete`, payload: { expectedVersion: 2 } },
      { method: "PATCH" as const, url: `/api/v1/orders/${f.order.id}`, payload: { expectedVersion: 2, note: "reserved" } },
      { method: "POST" as const, url: `/api/v1/orders/${f.order.id}/record-settlement`, payload: { ...f.checkout, expectedVersion: 2 } },
    ];
    for (const request of requests) expect((await app.inject({ ...request, cookies: f.cookies, headers: { "idempotency-key": randomUUID() } })).statusCode).toBe(409);
    const other = await fixture();
    expect((await prepare(other)).statusCode).toBe(409);
    env.SEP_TERMINAL_ENABLED = false;
    expect((await app.inject({ method: "GET", url: `/api/v1/terminal-payments/active?orderId=${f.order.id}`, cookies: f.cookies })).json().data.id).toBe(a.id);
    expect((await reconcile(f, a)).statusCode).toBe(200);
    expect(await app.prisma.payment.count()).toBe(0);
    env.SEP_TERMINAL_ENABLED = true;
    expect((await prepare(other)).statusCode).toBe(201);
  });
  it("authenticates dispatch, claims only once and survives a fresh API instance without another dispatch", async () => {
    const f = await fixture(); const a = (await prepare(f)).json().data as TerminalAttempt;
    const payload = { attemptId: a.id, bridgeId, nonce: a.authorization!.nonce, sentAtUnix: Math.floor(Date.now() / 1000) };
    expect((await app.inject({ method: "POST", url: "/api/v1/terminal-payments/claim", payload, headers: { "x-sep-signature": "00".repeat(32) } })).statusCode).toBe(401);
    const claimed = await claim(a); expect(claimed.statusCode).toBe(200);
    expect((await claim(a)).statusCode).toBe(409);
    const restarted = buildApp(); await restarted.ready();
    try {
      const read = await restarted.inject({ method: "GET", url: `/api/v1/terminal-payments/${a.id}`, cookies: f.cookies });
      expect(read.json().data).toMatchObject({ id: a.id, authorization: null, dispatchedAt: expect.any(String) });
    } finally { await restarted.close(); }
  });
  it("never treats missing or approved responses as paid; late conflicting evidence is audited", async () => {
    const f = await fixture(); const a = (await prepare(f)).json().data as TerminalAttempt; await claim(a);
    await app.prisma.terminalPaymentAttempt.update({ where: { id: a.id }, data: { dispatchedAt: new Date(Date.now() - 60000) } });
    const read = await app.inject({ method: "GET", url: `/api/v1/terminal-payments/${a.id}`, cookies: f.cookies });
    expect(read.json().data.status).toBe("UNKNOWN");
    const result = await evidence(a); expect(result.statusCode).toBe(200); expect(result.json().data.status).toBe("UNKNOWN");
    expect((await evidence(a)).statusCode).toBe(200);
    expect((await evidence(a, "99")).statusCode).toBe(409);
    expect(await app.prisma.auditLog.count({ where: { operation: "CONFLICTING_TERMINAL_EVIDENCE" } })).toBe(1);
    expect(await app.prisma.payment.count()).toBe(0);
    expect(await app.prisma.order.findUnique({ where: { id: f.order.id } })).toMatchObject({ state: "OPEN", paymentStatus: "UNPAID", paidAmount: 0 });
  });
  it.each(["STAFF", "MANAGER"] as const)("lets %s reconcile the frozen mixed checkout once and preserve cash settlement afterward", async role => {
    const f = await fixture(role); const a = (await prepare(f)).json().data as TerminalAttempt; await claim(a);
    const recorded = (await evidence(a)).json().data;
    const [resolved, replay] = await Promise.all([reconcile(f, recorded, true), reconcile(f, recorded, true)]); expect(resolved.statusCode).toBe(200); expect(replay.statusCode).toBe(200);
    expect(resolved.json().data).toMatchObject({ status: "SUCCEEDED", settlementId: expect.any(String), authorization: null });
    expect(replay.json().data.settlementId).toBe(resolved.json().data.settlementId);
    expect(await app.prisma.paymentSettlement.count()).toBe(1);
    expect(await app.prisma.payment.findMany({ orderBy: { amount: "asc" }, select: { method: true, amount: true, reference: true } })).toEqual([{ method: "CASH", amount: 3000, reference: null }, { method: "CARD_TERMINAL", amount: 7000, reference: null }]);
    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: f.order.id } });
    expect(order).toMatchObject({ state: "OPEN", paymentStatus: "PARTIALLY_PAID", paidAmount: 10000 });
    const paid = await app.inject({ method: "POST", url: `/api/v1/orders/${f.order.id}/record-settlement`, cookies: f.cookies, headers: { "idempotency-key": randomUUID() }, payload: { expectedVersion: order.version, allocationMode: "AMOUNT", amount: 10000, payments: [{ method: "CASH", amount: 10000 }] } });
    expect(paid.statusCode).toBe(201); expect(paid.json().data).toMatchObject({ state: "CLOSED", paymentStatus: "PAID" });
    expect(await app.prisma.cafeTable.findUnique({ where: { id: f.table.id } })).toMatchObject({ occupancyState: "AVAILABLE" });
  });
  it("rejects stale reconciliation, mismatched amounts and success before dispatch without posting money", async () => {
    const f = await fixture(); const a = (await prepare(f)).json().data as TerminalAttempt;
    expect((await reconcile(f, a, true)).statusCode).toBe(422);
    await claim(a);
    expect((await reconcile(f, a)).statusCode).toBe(409);
    const current = (await app.inject({ method: "GET", url: `/api/v1/terminal-payments/${a.id}`, cookies: f.cookies })).json().data;
    expect((await reconcile(f, { ...current, cardAmount: 7001 }, true)).statusCode).toBe(422);
    expect(await app.prisma.payment.count()).toBe(0);
    expect((await reconcile(f, current)).statusCode).toBe(200);
    expect((await claim(a)).statusCode).toBe(409);
  });
  it("allows only one of competing terminal reservations or a manual settlement to commit", async () => {
    const f = await fixture();
    const [terminal, manual] = await Promise.all([
      prepare(f),
      app.inject({ method: "POST", url: `/api/v1/orders/${f.order.id}/record-settlement`, cookies: f.cookies, headers: { "idempotency-key": randomUUID() }, payload: f.checkout }),
    ]);
    expect([terminal.statusCode, manual.statusCode].sort()).toEqual([201, 409]);
    expect((await app.prisma.terminalPaymentAttempt.count()) + (await app.prisma.paymentSettlement.count())).toBe(1);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).version).toBe(2);
  });
  it("serializes different orders on one terminal and guards both sides of table transfers", async () => {
    const first = await fixture(); const second = await fixture();
    const responses = await Promise.all([prepare(first), prepare(second)]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([201, 409]);
    const index = responses[0]!.statusCode === 201 ? 0 : 1;
    const reserved = [first, second][index]!; const other = [second, first][index]!;
    const intoReserved = await app.inject({ method: "POST", url: `/api/v1/orders/${other.order.id}/transfer-table`, cookies: other.cookies, payload: { expectedVersion: 1, tableId: reserved.table.id } });
    expect(intoReserved.statusCode).toBe(409);
    const fromReserved = await app.inject({ method: "POST", url: `/api/v1/orders/${reserved.order.id}/transfer-table`, cookies: reserved.cookies, payload: { expectedVersion: 2, tableId: other.table.id } });
    expect(fromReserved.statusCode).toBe(409);
  });
  it("rolls back settlement, order and attempt together if reconciliation audit fails", async () => {
    const f = await fixture(); const a = (await prepare(f)).json().data as TerminalAttempt; await claim(a);
    const current = (await evidence(a)).json().data as TerminalAttempt;
    await app.prisma.$executeRawUnsafe(`CREATE FUNCTION fail_terminal_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."operation" = 'RECONCILE_TERMINAL_ATTEMPT' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_terminal_audit_trigger BEFORE INSERT ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION fail_terminal_audit();`);
    try {
      expect((await reconcile(f, current, true)).statusCode).toBe(500);
      expect(await app.prisma.paymentSettlement.count()).toBe(0);
      expect(await app.prisma.payment.count()).toBe(0);
      expect(await app.prisma.terminalPaymentAttempt.findUnique({ where: { id: a.id } })).toMatchObject({ status: "UNKNOWN", version: current.version, settlementId: null });
      expect(await app.prisma.order.findUnique({ where: { id: f.order.id } })).toMatchObject({ version: 2, paidAmount: 0, state: "OPEN" });
    } finally { await app.prisma.$executeRawUnsafe(`DROP TRIGGER fail_terminal_audit_trigger ON "audit_logs"; DROP FUNCTION fail_terminal_audit();`); }
  });
  it("rejects unsigned result evidence, invalid codes and unsolicited card data", async () => {
    const f = await fixture(); const a = (await prepare(f)).json().data as TerminalAttempt; await claim(a);
    const payload = { attemptId: a.id, bridgeId, terminalId: "31187710", sentAtUnix: Math.floor(Date.now()/1000), finishedAtUnix: Math.floor(Date.now()/1000), responseCode: "00", rrn: null, trace: null };
    expect((await app.inject({ method: "POST", url: "/api/v1/terminal-payments/result", payload, headers: { "x-sep-signature": "00".repeat(32) } })).statusCode).toBe(401);
    for (const patch of [{ responseCode: "malformed" }, { pan: "forbidden-card-field" }]) {
      expect((await app.inject({ method: "POST", url: "/api/v1/terminal-payments/result", payload: { ...payload, ...patch }, headers: { "x-sep-signature": "00".repeat(32) } })).statusCode).toBe(400);
    }
    expect(await app.prisma.payment.count()).toBe(0);
  });

});
