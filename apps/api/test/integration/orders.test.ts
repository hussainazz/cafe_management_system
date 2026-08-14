import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserRole } from "../../generated/prisma/client.js";
import { hashPassword } from "../../src/auth/password.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function cookieJar(response: {
  cookies: Array<{ name: string; value: string }>;
}): Record<string, string> {
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

async function userSession(role: UserRole, username: string) {
  await app.prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword("CafePassword2026"),
      role,
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username, password: "CafePassword2026" },
  });
  expect(response.statusCode).toBe(200);
  return cookieJar(response);
}

async function staffSession() {
  return userSession(UserRole.STAFF, "order.staff");
}

async function sellableProduct() {
  const category = await app.prisma.category.create({ data: { name: "Coffee", displayOrder: 1 } });
  const optionGroup = await app.prisma.optionGroup.create({ data: { name: "Milk" } });
  const product = await app.prisma.product.create({
    data: {
      categoryId: category.id,
      name: "Latte",
      priceAmount: 50_000,
      preparationDeadlineMinutes: 8,
      displayOrder: 1,
      productOptionGroups: { create: { optionGroupId: optionGroup.id, displayOrder: 1 } },
    },
  });
  const option = await app.prisma.option.create({
    data: { optionGroupId: optionGroup.id, name: "Oat milk", priceAmount: 5_000, displayOrder: 1 },
  });
  return { product, option };
}

async function createOrderRequest(cookies: Record<string, string>, payload: unknown, key: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/orders",
    cookies,
    headers: { "idempotency-key": key },
    payload: payload as never,
  });
}

describe("Staff order creation", () => {
  it("creates a table order from authoritative catalog snapshots and timing", async () => {
    const cookies = await staffSession();
    const { product, option } = await sellableProduct();
    const table = await app.prisma.cafeTable.create({
      data: { name: "Table 4", seatingLimitMinutes: 45, displayOrder: 4 },
    });

    const response = await createOrderRequest(
      cookies,
      {
        channel: "TABLE",
        tableId: table.id,
        items: [
          {
            productId: product.id,
            quantity: 2,
            note: "Less foam",
            options: [{ optionId: option.id, quantity: 2 }],
          },
        ],
      },
      "create-table-order-0001",
    );

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data).toMatchObject({
      channel: "TABLE",
      tableId: table.id,
      state: "OPEN",
      paymentStatus: "UNPAID",
      version: 1,
      subtotalAmount: 110_000,
      totalAmount: 110_000,
      paidAmount: 0,
      balanceAmount: 110_000,
      estimatedPreparationMinutes: 8,
      tableSeatingLimitSnapshotMinutes: 45,
      items: [
        {
          productId: product.id,
          productNameSnapshot: "Latte",
          basePriceSnapshot: 50_000,
          preparationDeadlineSnapshotMinutes: 8,
          quantity: 2,
          note: "Less foam",
          lineTotalAmount: 110_000,
          options: [
            {
              optionId: option.id,
              optionNameSnapshot: "Oat milk",
              priceSnapshot: 5_000,
              quantity: 2,
            },
          ],
        },
      ],
    });
    expect(body.data.orderNumber).toMatch(/^ORD-[A-Z0-9]+-[A-F0-9]{8}$/);
    expect(new Date(body.data.estimatedTableReleaseAt).getTime()).toBe(
      new Date(body.data.createdAt).getTime() + 53 * 60_000,
    );

    await app.prisma.product.update({
      where: { id: product.id },
      data: { name: "Renamed latte", priceAmount: 70_000, preparationDeadlineMinutes: 15 },
    });
    const stored = await app.prisma.order.findUniqueOrThrow({
      where: { id: body.data.id },
      include: { items: { include: { options: true } } },
    });
    expect(stored.items[0]!).toMatchObject({
      productNameSnapshot: "Latte",
      basePriceSnapshot: 50_000,
      preparationDeadlineSnapshotMinutes: 8,
      lineTotalAmount: 110_000,
    });
    expect(stored.items[0]!.options[0]).toMatchObject({
      optionNameSnapshot: "Oat milk",
      priceSnapshot: 5_000,
    });
    expect(
      await app.prisma.auditLog.count({
        where: { entityId: stored.id, operation: "CREATE_ORDER" },
      }),
    ).toBe(1);
  });

  it("creates takeaway orders without a table timing snapshot", async () => {
    const cookies = await staffSession();
    const { product } = await sellableProduct();

    const response = await createOrderRequest(
      cookies,
      { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] },
      "create-takeaway-order-1",
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      channel: "TAKEAWAY",
      tableId: null,
      estimatedPreparationMinutes: 8,
      tableSeatingLimitSnapshotMinutes: null,
      estimatedTableReleaseAt: null,
      subtotalAmount: 50_000,
      totalAmount: 50_000,
    });
  });

  it("replays a same-key retry without duplicate order, audit, or idempotency writes", async () => {
    const cookies = await staffSession();
    const { product } = await sellableProduct();
    const payload = {
      channel: "TAKEAWAY",
      items: [{ productId: product.id, quantity: 1, options: [] }],
    };
    const key = "idempotent-order-create-1";

    const [first, second] = await Promise.all([
      createOrderRequest(cookies, payload, key),
      createOrderRequest(cookies, payload, key),
    ]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(second.json().data.id).toBe(first.json().data.id);
    expect(await app.prisma.order.count()).toBe(1);
    expect(await app.prisma.auditLog.count({ where: { operation: "CREATE_ORDER" } })).toBe(1);
    expect(await app.prisma.idempotencyRecord.count()).toBe(1);

    const conflicting = await createOrderRequest(
      cookies,
      { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 2, options: [] }] },
      key,
    );
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("rejects unavailable products and rolls back all order records", async () => {
    const cookies = await staffSession();
    const { product } = await sellableProduct();
    await app.prisma.product.update({ where: { id: product.id }, data: { isAvailable: false } });

    const response = await createOrderRequest(
      cookies,
      { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] },
      "unavailable-product-order-1",
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("UNAVAILABLE_PRODUCT");
    expect(await app.prisma.order.count()).toBe(0);
    expect(await app.prisma.orderItem.count()).toBe(0);
    expect(await app.prisma.auditLog.count()).toBe(0);
    expect(await app.prisma.idempotencyRecord.count()).toBe(0);
  });
});

describe("order reads, edits, and discounts", () => {
  it("lists and reads orders, then adds items and applies reasoned item and order discounts", async () => {
    const cookies = await userSession(UserRole.STAFF, "edit.staff");
    const { product: first } = await sellableProduct();
    const { product: second } = await sellableProduct();
    await app.prisma.product.update({ where: { id: second.id }, data: { name: "Mocha" } });
    const created = await createOrderRequest(
      cookies,
      { channel: "TAKEAWAY", items: [{ productId: first.id, quantity: 1, options: [] }] },
      "edit-order-create-0001",
    );
    expect(created.statusCode).toBe(201);
    const order = created.json().data;

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/v1/orders/${order.id}`,
      cookies,
      payload: {
        expectedVersion: order.version,
        addItems: [{ productId: second.id, quantity: 1, options: [] }],
        itemUpdates: [{ orderItemId: order.items[0].id, discount: { kind: "PERCENTAGE", value: 10, reason: "Staff promotion" } }],
        orderDiscount: { kind: "FIXED", value: 1_000, reason: "Rounding" },
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data).toMatchObject({ version: 2, subtotalAmount: 95_000, discountAmount: 1_000, totalAmount: 94_000, balanceAmount: 94_000 });
    expect(edited.json().data.items[0]).toMatchObject({ discountAmount: 5_000, discountReason: "Staff promotion" });

    const read = await app.inject({ method: "GET", url: `/api/v1/orders/${order.id}`, cookies });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.items).toHaveLength(2);
    const list = await app.inject({ method: "GET", url: "/api/v1/orders?channel=TAKEAWAY", cookies });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.orders).toHaveLength(1);
  });

  it("allows only a Manager to configure a future product sale discount and snapshots it on a new order", async () => {
    const managerCookies = await userSession(UserRole.MANAGER, "discount.manager");
    const staffCookies = await userSession(UserRole.STAFF, "discount.staff");
    const { product } = await sellableProduct();
    const forbidden = await app.inject({ method: "PATCH", url: `/api/v1/admin/products/${product.id}/sale-discount`, cookies: staffCookies, payload: { saleDiscount: { kind: "PERCENTAGE", value: 20 } } });
    expect(forbidden.statusCode).toBe(403);
    const configured = await app.inject({ method: "PATCH", url: `/api/v1/admin/products/${product.id}/sale-discount`, cookies: managerCookies, payload: { saleDiscount: { kind: "PERCENTAGE", value: 20 } } });
    expect(configured.statusCode).toBe(200);
    const order = await createOrderRequest(staffCookies, { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] }, "discount-order-create-1");
    expect(order.statusCode).toBe(201);
    expect(order.json().data).toMatchObject({ subtotalAmount: 40_000, totalAmount: 40_000, items: [{ discountKind: "PERCENTAGE", discountValue: 20, discountAmount: 10_000, lineTotalAmount: 40_000 }] });
    const removed = await app.inject({ method: "PATCH", url: `/api/v1/admin/products/${product.id}/sale-discount`, cookies: managerCookies, payload: { saleDiscount: null } });
    expect(removed.statusCode).toBe(200);
    const historical = await app.inject({ method: "GET", url: `/api/v1/orders/${order.json().data.id}`, cookies: staffCookies });
    expect(historical.json().data.items[0]).toMatchObject({ discountKind: "PERCENTAGE", discountValue: 20, discountAmount: 10_000, lineTotalAmount: 40_000 });
  });

  it("transfers a table order and rejects a stale edit without changing it", async () => {
    const cookies = await userSession(UserRole.STAFF, "transfer.staff");
    const { product } = await sellableProduct();
    const firstTable = await app.prisma.cafeTable.create({ data: { name: "Table 1", seatingLimitMinutes: 45, displayOrder: 1 } });
    const secondTable = await app.prisma.cafeTable.create({ data: { name: "Table 2", seatingLimitMinutes: 60, displayOrder: 2 } });
    const created = await createOrderRequest(cookies, { channel: "TABLE", tableId: firstTable.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "transfer-order-create-1");
    const order = created.json().data;
    const transferred = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/transfer-table`, cookies, payload: { expectedVersion: order.version, tableId: secondTable.id } });
    expect(transferred.statusCode).toBe(200);
    expect(transferred.json().data).toMatchObject({ tableId: secondTable.id, tableSeatingLimitSnapshotMinutes: 60, version: 2 });
    const stale = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies, payload: { expectedVersion: order.version, itemUpdates: [{ orderItemId: order.items[0].id, note: "Stale edit" }] } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("STALE_VERSION");
    const current = await app.prisma.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } });
    expect(current.note).toBeNull();
  });
});
