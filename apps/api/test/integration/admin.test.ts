import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserRole } from "../../generated/prisma/client.js";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();
beforeAll(async () => app.ready());
afterAll(async () => app.close());

async function session(role: UserRole, username: string) {
  await app.prisma.user.create({ data: { username, passwordHash: await hashPassword("CafePassword2026"), role } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

describe("Manager administration", () => {
  it("rejects anonymous and Staff catalog writes, then audits Manager catalog lifecycle", async () => {
    const payload = { name: "مدیریت", displayOrder: 1 };
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/categories", payload })).statusCode).toBe(401);
    const staff = await session(UserRole.STAFF, "admin.staff");
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/categories", cookies: staff, payload })).statusCode).toBe(403);
    const manager = await session(UserRole.MANAGER, "admin.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/categories", cookies: manager, payload });
    expect(created.statusCode).toBe(200);
    const categoryId = created.json().data.id;
    const archived = await app.inject({ method: "POST", url: `/api/v1/admin/categories/${categoryId}/archive`, cookies: manager });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data).toMatchObject({ isActive: false });
    await expect(app.prisma.auditLog.findFirstOrThrow({ where: { entityId: categoryId, operation: "ARCHIVE_CATEGORY" } })).resolves.toBeDefined();
  });

  it("manages Staff accounts only and revokes sessions on deactivation", async () => {
    const manager = await session(UserRole.MANAGER, "accounts.manager");
    const created = await app.inject({ method: "POST", url: "/api/v1/admin/users", cookies: manager, payload: { username: "new.staff", password: "CafePassword2026" } });
    expect(created.statusCode).toBe(200);
    const userId = created.json().data.id;
    expect(created.json().data).not.toHaveProperty("passwordHash");
    const active = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "new.staff", password: "CafePassword2026" } });
    const cookies = Object.fromEntries(active.cookies.map((cookie) => [cookie.name, cookie.value]));
    expect((await app.inject({ method: "POST", url: `/api/v1/admin/users/${userId}/deactivate`, cookies: manager })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/me", cookies })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/v1/admin/users/${userId}/reactivate`, cookies: manager })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "new.staff", password: "CafePassword2026" } })).statusCode).toBe(200);
  });

  it("configures products, option groups, tables, and settings through Manager-only routes", async () => {
    const manager = await session(UserRole.MANAGER, "catalog.manager");
    await app.prisma.cafeSettings.create({ data: { defaultTableSeatingLimitMinutes: 45 } });
    const category = await app.inject({ method: "POST", url: "/api/v1/admin/categories", cookies: manager, payload: { name: "نوشیدنی", displayOrder: 2 } });
    const group = await app.inject({ method: "POST", url: "/api/v1/admin/option-groups", cookies: manager, payload: { name: "سایز" } });
    const groupId = group.json().data.id;
    const option = await app.inject({ method: "POST", url: `/api/v1/admin/option-groups/${groupId}/options`, cookies: manager, payload: { name: "بزرگ", priceAmount: 5_000, displayOrder: 1 } });
    expect(option.statusCode).toBe(200);
    const product = await app.inject({ method: "POST", url: "/api/v1/admin/products", cookies: manager, payload: { categoryId: category.json().data.id, name: "لاته", priceAmount: 10_000, preparationDeadlineMinutes: 5, displayOrder: 1, optionGroupIds: [groupId] } });
    expect(product.statusCode).toBe(200);
    const productId = product.json().data.id;
    expect((await app.prisma.productOptionGroup.findUnique({ where: { productId_optionGroupId: { productId, optionGroupId: groupId } } }))).not.toBeNull();
    const table = await app.inject({ method: "POST", url: "/api/v1/admin/tables", cookies: manager, payload: { name: "۱۴", seatingLimitMinutes: 55, displayOrder: 14 } });
    expect(table.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/admin/tables/${table.json().data.id}/archive`, cookies: manager })).json().data).toMatchObject({ isActive: false });
    const setting = await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", cookies: manager, payload: { defaultTableSeatingLimitMinutes: 60 } });
    expect(setting.statusCode).toBe(200);
    expect(setting.json().data.defaultTableSeatingLimitMinutes).toBe(60);
  });
});
