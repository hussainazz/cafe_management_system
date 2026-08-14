import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserRole, type UserRole as UserRoleType } from "../../generated/prisma/client.js";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";
import { deactivateAccount } from "../../src/modules/auth/auth.service.js";
import { requireManagerRoute, requireStaff } from "../../src/modules/auth/authorization.js";

const app = buildApp();

app.register(
  async (testRoutes) => {
    testRoutes.get("/staff", { preHandler: requireStaff }, async (request) => ({
      username: request.authenticatedUser!.username,
    }));
    testRoutes.get("/manager", { preHandler: requireManagerRoute }, async (request) => ({
      username: request.authenticatedUser!.username,
    }));
  },
  { prefix: "/__test/authorization" },
);

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function createUser(username: string, role: UserRoleType = UserRole.STAFF) {
  return app.prisma.user.create({
    data: { username, passwordHash: await hashPassword("CafePassword2026"), role },
  });
}

function cookieJar(response: {
  cookies: Array<{ name: string; value: string }>;
}): Record<string, string> {
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

async function loginAs(username: string): Promise<Record<string, string>> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username, password: "CafePassword2026" },
  });
  expect(response.statusCode).toBe(200);
  return cookieJar(response);
}

describe("authentication endpoints", () => {
  it("authenticates active Staff and Manager accounts without exposing credentials", async () => {
    await createUser("staff.one");
    await createUser("manager.one", UserRole.MANAGER);

    for (const username of ["staff.one", "manager.one"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username, password: "CafePassword2026" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ username });
      expect(response.body).not.toContain("CafePassword2026");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(cookieJar(response)).toHaveProperty("cafe_access");
      expect(cookieJar(response)).toHaveProperty("cafe_refresh");
    }
  });

  it("rotates refresh sessions and rejects the replaced token", async () => {
    await createUser("refresh.user");
    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "refresh.user", password: "CafePassword2026" },
    });
    const oldCookies = cookieJar(loginResponse);

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: oldCookies,
    });
    expect(refreshResponse.statusCode).toBe(200);

    const oldRefreshResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: oldCookies,
    });
    expect(oldRefreshResponse.statusCode).toBe(401);
    expect(oldRefreshResponse.json().error.code).toBe("SESSION_EXPIRED");

    const newCookies = cookieJar(refreshResponse);
    const meResponse = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      cookies: newCookies,
    });
    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().data.username).toBe("refresh.user");
  });

  it("revokes refresh sessions on logout and logout-all", async () => {
    await createUser("logout.user");
    const firstLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "logout.user", password: "CafePassword2026" },
    });
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "logout.user", password: "CafePassword2026" },
    });
    const firstCookies = cookieJar(firstLogin);
    const secondCookies = cookieJar(secondLogin);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: firstCookies,
    });
    expect(logoutResponse.statusCode).toBe(204);
    const firstRefresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: firstCookies,
    });
    expect(firstRefresh.statusCode).toBe(401);

    const logoutAllResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout-all",
      cookies: secondCookies,
    });
    expect(logoutAllResponse.statusCode).toBe(204);
    const secondRefresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: secondCookies,
    });
    expect(secondRefresh.statusCode).toBe(401);
  });

  it("rejects deactivated accounts for login and refresh, and records safe audit events", async () => {
    const user = await createUser("inactive.user");
    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "inactive.user", password: "CafePassword2026" },
    });
    const activeCookies = cookieJar(loginResponse);

    await deactivateAccount(
      app.prisma,
      { id: user.id, username: user.username, role: UserRole.MANAGER },
      user.id,
      "deactivate-test-request",
    );

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: activeCookies,
    });
    expect(refreshResponse.statusCode).toBe(401);
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "inactive.user", password: "CafePassword2026" },
    });
    expect(secondLogin.statusCode).toBe(401);

    const events = await app.prisma.authEvent.findMany({
      where: { userId: user.id },
      select: { eventType: true, requestId: true },
    });
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["LOGIN_SUCCEEDED", "ACCOUNT_DEACTIVATED", "LOGIN_DENIED_INACTIVE"]),
    );
    expect(JSON.stringify(events)).not.toContain("CafePassword2026");
  });

  it("permits Staff and Manager on Staff routes, while Manager routes reject Staff", async () => {
    await createUser("authorized.staff");
    await createUser("authorized.manager", UserRole.MANAGER);
    const staffCookies = await loginAs("authorized.staff");
    const managerCookies = await loginAs("authorized.manager");

    const anonymous = await app.inject({ method: "GET", url: "/__test/authorization/staff" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("AUTHENTICATION_REQUIRED");

    const staffRoute = await app.inject({
      method: "GET",
      url: "/__test/authorization/staff",
      cookies: staffCookies,
    });
    expect(staffRoute.statusCode).toBe(200);

    const managerOnStaffRoute = await app.inject({
      method: "GET",
      url: "/__test/authorization/staff",
      cookies: managerCookies,
    });
    expect(managerOnStaffRoute.statusCode).toBe(200);

    const staffOnManagerRoute = await app.inject({
      method: "GET",
      url: "/__test/authorization/manager",
      cookies: staffCookies,
    });
    expect(staffOnManagerRoute.statusCode).toBe(403);
    expect(staffOnManagerRoute.json().error.code).toBe("FORBIDDEN");

    const managerRoute = await app.inject({
      method: "GET",
      url: "/__test/authorization/manager",
      cookies: managerCookies,
    });
    expect(managerRoute.statusCode).toBe(200);
  });

  it("enforces the Manager check inside account-deactivation service commands", async () => {
    const staff = await createUser("service.staff");
    const target = await createUser("service.target");

    await expect(
      deactivateAccount(
        app.prisma,
        { id: staff.id, username: staff.username, role: UserRole.STAFF },
        target.id,
        "service-authorization-request",
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isActive).toBe(
      true,
    );
  });
});
