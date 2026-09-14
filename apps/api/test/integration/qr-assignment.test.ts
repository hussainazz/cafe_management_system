import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserRole } from "../../generated/prisma/client.js";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";
import { createTableQrToken, hashTableQrToken } from "../../src/table-context/table-context.js";

const app = buildApp();

beforeAll(async () => app.ready());
afterAll(async () => app.close());

function cookies(response: { cookies: Array<{ name: string; value: string }> }) {
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

async function staffCookies() {
  await app.prisma.user.create({ data: { username: "qr-assignment.staff", passwordHash: await hashPassword("CafePassword2026"), role: UserRole.STAFF } });
  return cookies(await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "qr-assignment.staff", password: "CafePassword2026" } }));
}

async function sharedQr() {
  const family = await app.prisma.tableQrFamily.create({ data: { name: "shared-test-family" } });
  const tables = await Promise.all(["7", "8", "سوشال", "سوشال سوشال"].map((name, index) => app.prisma.cafeTable.create({ data: { name, displayOrder: index + 1, waiterCallEnabled: true, qrFamilyId: family.id } })));
  const token = createTableQrToken();
  await app.prisma.tableQrCredential.create({ data: { tableId: tables[0]!.id, qrFamilyId: family.id, tokenHash: hashTableQrToken(token) } });
  return { family, tables, token };
}

async function exchange(token: string, cookie?: Record<string, string>) {
  const response = await app.inject({ method: "POST", url: "/api/v1/public/table-context/exchange", ...(cookie ? { cookies: cookie } : {}), payload: { token } });
  expect(response.statusCode, response.body).toBe(200);
  return { name: response.json().data.tableName as string, cookies: { ...cookie, ...cookies(response) } };
}

describe("temporary shared physical-table QR assignment", () => {
  it("routes new devices for the window, preserves existing sessions, and cancels", async () => {
    const staff = await staffCookies();
    const { tables, token } = await sharedQr();
    const original = await exchange(token);
    expect(original.name).toBe("7");

    const assigned = await app.inject({ method: "POST", url: `/api/v1/tables/${tables[0]!.id}/qr-assignment`, cookies: staff, payload: { targetTableId: tables[2]!.id } });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().data.qrAssignment).toMatchObject({ targetTableId: tables[2]!.id, targetTableName: "سوشال" });

    const routed = await exchange(token);
    expect(routed.name).toBe("سوشال");
    const identified = await app.inject({ method: "POST", url: "/api/v1/public/customer-auth/identify", cookies: routed.cookies, payload: { phoneNumber: "09121234567" } });
    expect(identified.statusCode).toBe(200);
    const call = await app.inject({ method: "POST", url: "/api/v1/public/waiter-calls", cookies: { ...routed.cookies, ...cookies(identified) } });
    expect(call.statusCode).toBe(201);
    await expect(app.prisma.waiterCall.findFirstOrThrow()).resolves.toMatchObject({ tableId: tables[2]!.id });
    expect((await exchange(token)).name).toBe("سوشال");
    expect((await exchange(token, original.cookies)).name).toBe("7");

    const cancelled = await app.inject({ method: "DELETE", url: `/api/v1/tables/${tables[0]!.id}/qr-assignment`, cookies: staff });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().data.qrAssignment).toBeNull();
    expect((await exchange(token)).name).toBe("7");
  });

  it("serializes concurrent new scans and rejects a target outside the family", async () => {
    const staff = await staffCookies();
    const { tables, token } = await sharedQr();
    const unrelated = await app.prisma.cafeTable.create({ data: { name: "unrelated", displayOrder: 99, waiterCallEnabled: true } });
    const activate = await app.inject({ method: "POST", url: `/api/v1/tables/${tables[0]!.id}/qr-assignment`, cookies: staff, payload: { targetTableId: tables[3]!.id } });
    expect(activate.statusCode).toBe(200);
    const scans = await Promise.all(Array.from({ length: 5 }, () => exchange(token)));
    expect(scans.map((scan) => scan.name)).toEqual(["سوشال سوشال", "سوشال سوشال", "سوشال سوشال", "سوشال سوشال", "سوشال سوشال"]);
    const rejected = await app.inject({ method: "POST", url: `/api/v1/tables/${tables[0]!.id}/qr-assignment`, cookies: staff, payload: { targetTableId: unrelated.id } });
    expect(rejected.statusCode).toBe(409);
    await app.prisma.tableQrFamily.update({ where: { id: (await app.prisma.cafeTable.findUniqueOrThrow({ where: { id: tables[0]!.id } })).qrFamilyId! }, data: { assignmentExpiresAt: new Date(Date.now() - 1_000) } });
    expect((await exchange(token)).name).toBe("7");
  });

  it("invalidates a routed logical-table context when that table is cleared", async () => {
    const staff = await staffCookies();
    const { tables, token } = await sharedQr();
    await app.inject({ method: "POST", url: `/api/v1/tables/${tables[0]!.id}/qr-assignment`, cookies: staff, payload: { targetTableId: tables[2]!.id } });
    const routed = await exchange(token);
    const identified = await app.inject({ method: "POST", url: "/api/v1/public/customer-auth/identify", cookies: routed.cookies, payload: { phoneNumber: "09121234567" } });
    const customerCookies = { ...routed.cookies, ...cookies(identified) };

    await app.inject({ method: "POST", url: `/api/v1/tables/${tables[2]!.id}/occupy`, cookies: staff, payload: {} });
    const cleared = await app.inject({ method: "POST", url: `/api/v1/tables/${tables[2]!.id}/make-available`, cookies: staff, payload: {} });
    expect(cleared.statusCode).toBe(200);

    const context = await app.inject({ method: "GET", url: "/api/v1/public/table-context", cookies: customerCookies });
    expect(context.statusCode).toBe(200);
    expect(context.json().data.active).toBe(false);
    const call = await app.inject({ method: "POST", url: "/api/v1/public/waiter-calls", cookies: customerCookies });
    expect(call.statusCode).toBe(401);
  });

  it("does not report a visit from another logical member as active", async () => {
    const staff = await staffCookies();
    const { tables, token } = await sharedQr();
    const original = await exchange(token);
    const identified = await app.inject({ method: "POST", url: "/api/v1/public/customer-auth/identify", cookies: original.cookies, payload: { phoneNumber: "09121234567" } });
    const authCookies = cookies(identified);

    await app.inject({ method: "POST", url: `/api/v1/tables/${tables[0]!.id}/qr-assignment`, cookies: staff, payload: { targetTableId: tables[2]!.id } });
    const routed = await exchange(token, authCookies);
    const routedVisit = await app.prisma.customerTableVisit.findFirstOrThrow({ where: { tableId: tables[2]!.id, invalidatedAt: null } });
    await app.prisma.customerTableVisit.updateMany({
      where: { tableId: tables[2]!.id, invalidatedAt: null },
      data: { invalidatedAt: new Date() },
    });
    await app.prisma.customerTableVisit.create({
      data: {
        customerId: routedVisit.customerId,
        tableId: tables[0]!.id,
        tableCredentialId: routedVisit.tableCredentialId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const authState = await app.inject({ method: "GET", url: "/api/v1/public/customer-auth", cookies: { ...authCookies, ...routed.cookies } });
    expect(authState.statusCode).toBe(200);
    expect(authState.json().data).toMatchObject({ authenticated: true, visitActive: false, visitExpiresAt: null });
  });

  it("supports the second configured family and keeps assignment mutations authorized", async () => {
    const family = await app.prisma.tableQrFamily.create({ data: { name: "counter-test-family" } });
    const tables = await Promise.all(["3", "4", "کانتر وسط"].map((name, index) => app.prisma.cafeTable.create({ data: { name, displayOrder: index + 1, waiterCallEnabled: true, qrFamilyId: family.id } })));
    const token = createTableQrToken();
    await app.prisma.tableQrCredential.create({ data: { tableId: tables[0]!.id, qrFamilyId: family.id, tokenHash: hashTableQrToken(token) } });

    const unauthorized = await app.inject({ method: "POST", url: `/api/v1/tables/${tables[0]!.id}/qr-assignment`, payload: { targetTableId: tables[2]!.id } });
    expect(unauthorized.statusCode).toBe(401);
    const staff = await staffCookies();
    const activated = await app.inject({ method: "POST", url: `/api/v1/tables/${tables[0]!.id}/qr-assignment`, cookies: staff, payload: { targetTableId: tables[2]!.id } });
    expect(activated.statusCode).toBe(200);
    expect((await exchange(token)).name).toBe("کانتر وسط");
  });
});
