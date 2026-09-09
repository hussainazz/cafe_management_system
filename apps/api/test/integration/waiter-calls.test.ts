import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserRole } from "../../generated/prisma/client.js";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";
import {
  createTableContextCookieValue,
  createTableQrToken,
  hashTableQrToken,
  tableContextCookieName,
} from "../../src/table-context/table-context.js";

const app = buildApp();

beforeAll(async () => app.ready());
afterAll(async () => app.close());

function cookies(response: { cookies: Array<{ name: string; value: string }> }) {
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

async function staffCookies() {
  await app.prisma.user.create({
    data: {
      username: "waiter.staff",
      passwordHash: await hashPassword("CafePassword2026"),
      role: UserRole.STAFF,
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username: "waiter.staff", password: "CafePassword2026" },
  });
  return cookies(response);
}

async function tableCredential(name = "1") {
  const table = await app.prisma.cafeTable.create({
    data: { name, displayOrder: 1, waiterCallEnabled: true },
  });
  const token = createTableQrToken();
  const credential = await app.prisma.tableQrCredential.create({
    data: { tableId: table.id, tokenHash: hashTableQrToken(token) },
  });
  return { table, token, credential };
}

async function authenticateTableCustomer(contextCookies: Record<string, string>) {
  const requested = await app.inject({ method: "POST", url: "/api/v1/public/customer-otp/request", cookies: contextCookies, payload: { fullName: "مینا رضایی", phoneNumber: "09121234567" } });
  expect(requested.statusCode).toBe(200);
  const verified = await app.inject({ method: "POST", url: "/api/v1/public/customer-otp/verify", cookies: contextCookies, payload: { challengeId: requested.json().data.challengeId, code: "111111" } });
  expect(verified.statusCode).toBe(200);
  return { ...contextCookies, ...cookies(verified) };
}

describe("public table context and waiter-calls", () => {
  it("records a scan reminder, requires an authenticated visit, deduplicates calls, and resolves on table open", async () => {
    const staff = await staffCookies();
    const { table, token } = await tableCredential();
    const exchange = await app.inject({
      method: "POST",
      url: "/api/v1/public/table-context/exchange",
      payload: { token },
    });
    expect(exchange.statusCode).toBe(200);
    expect(exchange.body).not.toContain(token);
    const contextCookies = cookies(exchange);
    expect(contextCookies[tableContextCookieName]).toBeTruthy();
    await expect(app.prisma.cafeTable.findUniqueOrThrow({ where: { id: table.id } })).resolves.toMatchObject({
      occupancyState: "AVAILABLE",
      occupancyReminderAt: expect.any(Date),
    });
    expect(await app.prisma.waiterCall.count()).toBe(0);

    const availableContext = await app.inject({ method: "GET", url: "/api/v1/public/table-context", cookies: contextCookies });
    expect(availableContext.json().data).toMatchObject({ active: true, tableName: "1", occupancyState: "AVAILABLE", waiterCallStatus: null, canCallWaiter: false, authenticationRequired: true });
    const prematureCall = await app.inject({ method: "POST", url: "/api/v1/public/waiter-calls", cookies: contextCookies });
    expect(prematureCall.statusCode).toBe(401);
    expect(prematureCall.json().error.code).toBe("CUSTOMER_AUTH_REQUIRED");
    const customer = await authenticateTableCustomer(contextCookies);
    await expect(app.prisma.customer.findFirstOrThrow()).resolves.toMatchObject({ fullName: "مینا رضایی" });

    const [firstCall, secondCall] = await Promise.all([
      app.inject({ method: "POST", url: "/api/v1/public/waiter-calls", cookies: customer }),
      app.inject({ method: "POST", url: "/api/v1/public/waiter-calls", cookies: customer }),
    ]);
    expect(firstCall.statusCode).toBe(201);
    expect(secondCall.statusCode).toBe(201);
    expect(await app.prisma.waiterCall.count()).toBe(1);

    const pending = await app.inject({ method: "GET", url: "/api/v1/waiter-calls", cookies: staff });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().data.calls).toEqual([expect.objectContaining({ tableId: table.id, tableName: "1", version: 1 })]);
    const staleOpen = await app.inject({
      method: "POST",
      url: `/api/v1/tables/${table.id}/acknowledge-waiter-call`,
      cookies: staff,
      payload: { expectedVersion: 2 },
    });
    expect(staleOpen.statusCode).toBe(409);
    expect(staleOpen.json().error.code).toBe("STALE_VERSION");
    const resolved = await app.inject({
      method: "POST",
      url: `/api/v1/tables/${table.id}/acknowledge-waiter-call`,
      cookies: staff,
      payload: { expectedVersion: 1 },
    });
    expect(resolved.statusCode).toBe(200);
    expect(await app.prisma.waiterCall.findFirstOrThrow()).toMatchObject({ status: "RESOLVED", version: 2, acknowledgedAt: expect.any(Date), resolvedAt: expect.any(Date) });
  });

  it("rejects malformed, unknown, inactive, and noneligible credentials without exposing tokens", async () => {
    const malformed = await app.inject({ method: "POST", url: "/api/v1/public/table-context/exchange", payload: { token: "bad" } });
    expect(malformed.statusCode).toBe(400);
    const unknownToken = createTableQrToken();
    const unknown = await app.inject({ method: "POST", url: "/api/v1/public/table-context/exchange", payload: { token: unknownToken } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.body).not.toContain(unknownToken);

    const disabledTable = await app.prisma.cafeTable.create({ data: { name: "کانتر وسط", displayOrder: 2, waiterCallEnabled: false } });
    const disabledToken = createTableQrToken();
    await app.prisma.tableQrCredential.create({ data: { tableId: disabledTable.id, tokenHash: hashTableQrToken(disabledToken) } });
    const disabled = await app.inject({ method: "POST", url: "/api/v1/public/table-context/exchange", payload: { token: disabledToken } });
    expect(disabled.statusCode).toBe(401);
  });

  it("invalidates contexts after rotation, table clearing, expiration, and tampering", async () => {
    const staff = await staffCookies();
    const { table, token, credential } = await tableCredential();
    const exchange = await app.inject({ method: "POST", url: "/api/v1/public/table-context/exchange", payload: { token } });
    const originalCookies = cookies(exchange);

    await app.inject({ method: "POST", url: `/api/v1/tables/${table.id}/occupy`, cookies: staff, payload: {} });
    await app.inject({ method: "POST", url: `/api/v1/tables/${table.id}/make-available`, cookies: staff, payload: {} });
    const cleared = await app.inject({ method: "GET", url: "/api/v1/public/table-context", cookies: originalCookies });
    expect(cleared.json().data.active).toBe(false);

    const expiredValue = createTableContextCookieValue(credential.id, new Date(Date.now() - 13 * 60 * 60 * 1_000));
    const expired = await app.inject({ method: "GET", url: "/api/v1/public/table-context", cookies: { [tableContextCookieName]: expiredValue } });
    expect(expired.json().data.active).toBe(false);
    const tampered = await app.inject({ method: "GET", url: "/api/v1/public/table-context", cookies: { [tableContextCookieName]: `${originalCookies[tableContextCookieName]}x` } });
    expect(tampered.json().data.active).toBe(false);

    await app.prisma.tableQrCredential.update({ where: { id: credential.id }, data: { isActive: false, rotatedAt: new Date() } });
    const rotated = await app.inject({ method: "GET", url: "/api/v1/public/table-context", cookies: originalCookies });
    expect(rotated.json().data.active).toBe(false);
  });

  it("allows repeated QR exchanges without creating extra database records", async () => {
    const { token } = await tableCredential("2");
    for (let index = 0; index < 31; index += 1) {
      const response = await app.inject({ method: "POST", url: "/api/v1/public/table-context/exchange", payload: { token } });
      expect(response.statusCode).toBe(200);
    }
    expect(await app.prisma.tableQrCredential.count()).toBe(1);
    expect(await app.prisma.waiterCall.count()).toBe(0);
  });
});
