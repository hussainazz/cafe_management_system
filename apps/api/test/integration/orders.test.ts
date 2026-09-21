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

let sellableProductNumber = 0;
async function sellableProduct() {
  const sequence = ++sellableProductNumber;
  const category = await app.prisma.category.create({ data: { name: `Coffee ${sequence}`, displayOrder: sequence } });
  const optionGroup = await app.prisma.optionGroup.create({ data: { name: `Milk ${sequence}` } });
  const option = await app.prisma.option.create({
    data: { optionGroupId: optionGroup.id, name: "Oat milk", priceAmount: 5_000, displayOrder: 1 },
  });
  const product = await app.prisma.product.create({
    data: {
      categoryId: category.id,
      name: "Latte",
      priceAmount: 50_000,
      preparationDeadlineMinutes: 8,
      displayOrder: sequence,
      productOptionGroups: {
        create: {
          optionGroupId: optionGroup.id,
          displayOrder: 1,
          minSelections: 0,
          maxSelections: 1,
          allowedOptions: { create: { optionId: option.id, displayOrder: 1 } },
        },
      },
    },
  });
  return { product, option };
}

async function createOrderRequest(
  cookies: Record<string, string>,
  payload: unknown,
  key: string,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/orders",
    cookies,
    headers: { "idempotency-key": key, ...headers },
    payload: payload as never,
  });
}

describe("Staff order creation", () => {
  it("rejects a second open table order for the same physical table", async () => {
    const cookies = await userSession(UserRole.STAFF, "single-order.staff");
    const { product } = await sellableProduct();
    const table = await app.prisma.cafeTable.create({ data: { name: "Single order table", displayOrder: 91 } });
    const first = await createOrderRequest(cookies, { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "single-table-first-0001");
    expect(first.statusCode).toBe(201);
    const second = await createOrderRequest(cookies, { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "single-table-second-0001");
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("INVALID_STATE");
  });

  it("creates a table order from authoritative catalog snapshots without persisted timing", async () => {
    const cookies = await staffSession();
    const { product, option } = await sellableProduct();
    const table = await app.prisma.cafeTable.create({
      data: {
        id: "40000000-0000-4000-8000-000000000004",
        name: "Table 4",
        displayOrder: 4,
      },
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
      { "x-request-id": "pos-table-trace-0001", "x-pos-table-name": "Table 4 displayed" },
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
      items: [
        {
          productId: product.id,
          productNameSnapshot: "Latte",
          basePriceSnapshot: 50_000,
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
    expect(body.data.orderNumber).toMatch(/^\d{4}-\d{2}-\d{2}-\d+$/);
    expect(body.data.dailyOrderNumber).toBeGreaterThan(0);
    expect(body.data).not.toHaveProperty("estimatedPreparationMinutes");
    expect(body.data).not.toHaveProperty("tableSeatingLimitSnapshotMinutes");
    expect(body.data).not.toHaveProperty("estimatedTableReleaseAt");
    const settled = await app.inject({
      method: "POST", url: `/api/v1/orders/${body.data.id}/record-settlement`, cookies,
      headers: { "idempotency-key": "close-table-order-0001" },
      payload: { expectedVersion: 1, allocations: [{ orderItemId: body.data.items[0].id, quantity: 2 }], payments: [{ method: "CASH", amount: 110_000 }] },
    });
    expect(settled.statusCode).toBe(201);
    expect(settled.json().data).toMatchObject({ state: "CLOSED", paymentStatus: "PAID", balanceAmount: 0 });
    await expect(app.prisma.cafeTable.findUniqueOrThrow({ where: { id: table.id } })).resolves.toMatchObject({ occupancyState: "AVAILABLE", occupiedAt: null });

    await app.prisma.product.update({
      where: { id: product.id },
      data: { name: "Renamed latte", priceAmount: 70_000, preparationDeadlineMinutes: 15 },
    });
    await app.prisma.option.update({
      where: { id: option.id },
      data: { name: "Renamed oat milk", priceAmount: 9_000 },
    });
    const stored = await app.prisma.order.findUniqueOrThrow({
      where: { id: body.data.id },
      include: { items: { include: { options: true } } },
    });
    expect(stored.items[0]!).toMatchObject({
      productNameSnapshot: "Latte",
      basePriceSnapshot: 50_000,
      lineTotalAmount: 110_000,
    });
    expect(stored.items[0]!.options[0]).toMatchObject({
      optionNameSnapshot: "Oat milk",
      priceSnapshot: 5_000,
    });

    const historical = await app.inject({
      method: "GET",
      url: `/api/v1/orders/${body.data.id}`,
      cookies,
    });
    expect(historical.statusCode).toBe(200);
    expect(historical.json().data.items[0]).toMatchObject({
      productNameSnapshot: "Latte",
      basePriceSnapshot: 50_000,
      options: [{ optionNameSnapshot: "Oat milk", priceSnapshot: 5_000 }],
    });

    const barTicket = await app.inject({
      method: "GET",
      url: `/api/v1/orders/${body.data.id}/bar-ticket`,
      cookies,
    });
    expect(barTicket.statusCode).toBe(200);
    expect(barTicket.json().data).toMatchObject({
      context: `میز ${table.name}`,
      items: [{ productName: "Latte", options: [{ name: "Oat milk" }] }],
    });
    expect(barTicket.json().data).not.toHaveProperty("orderNumber");
    expect(barTicket.json().data).not.toHaveProperty("displayTime");
    expect(barTicket.json().data).not.toHaveProperty("estimatedPreparationMinutes");

    const receipt = await app.inject({
      method: "GET",
      url: `/api/v1/orders/${body.data.id}/receipt`,
      cookies,
    });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json().data).toMatchObject({
      totalAmount: 110_000,
      items: [{ productName: "Latte", lineTotalAmount: 110_000 }],
    });
    expect(receipt.json().data).not.toHaveProperty("payments");
    expect(receipt.json().data).not.toHaveProperty("subtotalAmount");
    expect(
      await app.prisma.auditLog.count({
        where: { entityId: stored.id, operation: "CREATE_ORDER" },
      }),
    ).toBe(1);
    const audit = await app.prisma.auditLog.findFirstOrThrow({
      where: { entityId: stored.id, operation: "CREATE_ORDER" },
    });
    expect(audit.requestId).toBe("pos-table-trace-0001");
    expect(audit.afterSnapshot).toMatchObject({
      tableId: table.id,
      clientTableName: "Table 4 displayed",
      resolvedTableName: "Table 4",
    });
  });

  it("creates takeaway orders without persisted timing", async () => {
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
  it("replaces an unpaid option-bearing order without violating option snapshot foreign keys", async () => {
    const cookies = await userSession(UserRole.STAFF, "replace-options.staff");
    const { product, option } = await sellableProduct();
    const created = await createOrderRequest(
      cookies,
      {
        channel: "TAKEAWAY",
        items: [{ productId: product.id, quantity: 1, options: [{ optionId: option.id, quantity: 1 }] }],
      },
      "replace-options-create-0001",
    );
    expect(created.statusCode).toBe(201);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/orders/${created.json().data.id}`,
      cookies,
      payload: {
        expectedVersion: created.json().data.version,
        items: [{ productId: product.id, quantity: 2, options: [{ optionId: option.id, quantity: 2 }] }],
      },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ version: 2, items: [{ quantity: 2, options: [{ optionId: option.id, quantity: 2 }] }] });
    expect(await app.prisma.orderItemOption.count({ where: { orderItem: { orderId: created.json().data.id } } })).toBe(1);
  });

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

  it("rolls back a product sale discount when its audit write fails", async () => {
    const managerCookies = await userSession(UserRole.MANAGER, "discount-atomic.manager");
    const { product } = await sellableProduct();
    await app.prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_discount_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW."operation" = 'UPDATE_PRODUCT_SALE_DISCOUNT' THEN
          RAISE EXCEPTION 'forced discount audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_discount_audit_trigger
      BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION fail_discount_audit();
    `);
    try {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${product.id}/sale-discount`,
        cookies: managerCookies,
        payload: { saleDiscount: { kind: "FIXED", value: 5_000 } },
      });
      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe("INTERNAL_ERROR");
      await expect(app.prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
        .resolves.toMatchObject({ saleDiscountKind: null, saleDiscountValue: null });
    } finally {
      await app.prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS fail_discount_audit_trigger ON "audit_logs";
        DROP FUNCTION IF EXISTS fail_discount_audit();
      `);
    }
  });

  it("moves a table order to an empty table, frees its source context, and rejects a stale edit", async () => {
    const cookies = await userSession(UserRole.STAFF, "transfer.staff");
    const { product } = await sellableProduct();
    const firstTable = await app.prisma.cafeTable.create({ data: { name: "Table 1", displayOrder: 1 } });
    const secondTable = await app.prisma.cafeTable.create({ data: { name: "Table 2", displayOrder: 2 } });
    const created = await createOrderRequest(cookies, { channel: "TABLE", tableId: firstTable.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "transfer-order-create-1");
    const order = created.json().data;
    const transferred = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/transfer-table`, cookies, payload: { expectedVersion: order.version, tableId: secondTable.id } });
    expect(transferred.statusCode).toBe(200);
    expect(transferred.json().data).toMatchObject({ tableId: secondTable.id, version: 2 });
    expect(await app.prisma.cafeTable.findUniqueOrThrow({ where: { id: firstTable.id } })).toMatchObject({ occupancyState: "AVAILABLE", occupiedAt: null });
    expect(await app.prisma.cafeTable.findUniqueOrThrow({ where: { id: secondTable.id } })).toMatchObject({ occupancyState: "OCCUPIED" });
    const stale = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies, payload: { expectedVersion: order.version, itemUpdates: [{ orderItemId: order.items[0].id, note: "Stale edit" }] } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("STALE_VERSION");
    const current = await app.prisma.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } });
    expect(current.note).toBeNull();
  });

  it("swaps two open table orders without introducing persisted timing", async () => {
    const cookies = await userSession(UserRole.MANAGER, "swap.manager");
    const { product } = await sellableProduct();
    const firstTable = await app.prisma.cafeTable.create({ data: { name: "Swap 1", displayOrder: 101 } });
    const secondTable = await app.prisma.cafeTable.create({ data: { name: "Swap 2", displayOrder: 102 } });
    const first = await createOrderRequest(cookies, { channel: "TABLE", tableId: firstTable.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "swap-first-order-0001");
    expect(first.statusCode).toBe(201);
    expect(first.json().data.tableId).toBe(firstTable.id);
    expect(await app.prisma.order.findFirst({ where: { tableId: secondTable.id, state: "OPEN" } })).toBeNull();
    const second = await createOrderRequest(cookies, { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] }, "swap-second-order-0001");
    expect(second.statusCode).toBe(201);
    await app.prisma.order.update({
      where: { id: second.json().data.id },
      data: {
        channel: "TABLE",
        tableId: secondTable.id,
      },
    });
    const moved = await app.inject({ method: "POST", url: `/api/v1/orders/${first.json().data.id}/transfer-table`, cookies, payload: { expectedVersion: first.json().data.version, tableId: secondTable.id } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().data).toMatchObject({ tableId: secondTable.id, version: 2 });
    const displaced = await app.prisma.order.findUniqueOrThrow({ where: { id: second.json().data.id } });
    expect(displaced).toMatchObject({ tableId: firstTable.id, version: 2 });
    await expect(app.prisma.cafeTable.findUniqueOrThrow({ where: { id: firstTable.id } })).resolves.toMatchObject({ occupancyState: "OCCUPIED" });
    await expect(app.prisma.cafeTable.findUniqueOrThrow({ where: { id: secondTable.id } })).resolves.toMatchObject({ occupancyState: "OCCUPIED" });
  });
});

describe("logical order deletion", () => {
  it("lets Staff logically delete an open order, preserves history, and removes it from active views", async () => {
    const cookies = await userSession(UserRole.STAFF, "delete.staff");
    const { product } = await sellableProduct();
    const created = await createOrderRequest(
      cookies,
      { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] },
      "delete-order-create-0001",
    );
    const order = created.json().data;

    const deleted = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/delete`,
      cookies,
      payload: { expectedVersion: order.version },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toMatchObject({ id: order.id, state: "DELETED", version: 2 });

    const stored = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(stored).toMatchObject({ state: "DELETED", deletedById: expect.any(String), deletionReason: null, version: 2 });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.items).toHaveLength(1);
    expect(await app.prisma.auditLog.count({ where: { entityId: order.id, operation: "DELETE_ORDER" } })).toBe(1);

    const active = await app.inject({ method: "GET", url: "/api/v1/orders?state=OPEN", cookies });
    expect(active.json().data.orders).toHaveLength(0);
    const history = await app.inject({ method: "GET", url: "/api/v1/orders?state=DELETED", cookies });
    expect(history.json().data.orders).toHaveLength(1);
    const retry = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/delete`, cookies, payload: { expectedVersion: 2, reason: "Duplicate request" } });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe("INVALID_STATE");

    const settleDeleted = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies,
      headers: { "idempotency-key": "settle-deleted-order-1" },
      payload: {
        expectedVersion: 2,
        allocations: [{ orderItemId: order.items[0].id, quantity: 1 }],
        payments: [{ method: "CASH", amount: 50_000 }],
      },
    });
    expect(settleDeleted.statusCode).toBe(409);
    expect(settleDeleted.json().error.code).toBe("INVALID_STATE");
    expect(await app.prisma.paymentSettlement.count()).toBe(0);
    expect(await app.prisma.idempotencyRecord.count({ where: { operation: "RECORD_SETTLEMENT" } })).toBe(0);
  });

  it("lets Staff logically delete a fully paid order while retaining settlement history", async () => {
    const cookies = await userSession(UserRole.STAFF, "delete-paid.staff");
    const { product } = await sellableProduct();
    const created = await createOrderRequest(
      cookies,
      { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] },
      "delete-paid-order-create-0001",
    );
    const order = created.json().data;
    const settled = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies,
      headers: { "idempotency-key": "delete-paid-order-settlement-0001" },
      payload: {
        expectedVersion: order.version,
        allocations: [{ orderItemId: order.items[0].id, quantity: 1 }],
        payments: [{ method: "CASH", amount: 50_000 }],
      },
    });
    expect(settled.statusCode).toBe(201);
    expect(settled.json().data).toMatchObject({ state: "CLOSED", paymentStatus: "PAID", version: 2 });

    const deleted = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/delete`,
      cookies,
      payload: { expectedVersion: 2 },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toMatchObject({ state: "DELETED", paymentStatus: "PAID", version: 3 });
    await expect(app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({ state: "DELETED", version: 3 });
    await expect(app.prisma.paymentSettlement.findMany({ where: { orderId: order.id }, include: { allocations: true, payments: true } })).resolves.toMatchObject([
      { orderId: order.id, totalAmount: 50_000, allocations: [{ orderItemId: order.items[0].id, quantity: 1, amount: 50_000 }], payments: [{ amount: 50_000, method: "CASH" }] },
    ]);
    expect(await app.prisma.auditLog.count({ where: { entityId: order.id, operation: "DELETE_ORDER" } })).toBe(1);
  });

  it("removes every active settlement of a deleted order from the accounting report", async () => {
    const staffCookies = await userSession(UserRole.STAFF, "delete-report.staff");
    const managerCookies = await userSession(UserRole.MANAGER, "delete-report.manager");
    const { product } = await sellableProduct();
    const created = await createOrderRequest(
      staffCookies,
      { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 2, options: [] }] },
      "delete-report-order-create-0001",
    );
    const order = created.json().data;
    const firstSettlement = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies: staffCookies,
      headers: { "idempotency-key": "delete-report-settlement-0001" },
      payload: { expectedVersion: 1, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 50_000 }] },
    });
    expect(firstSettlement.statusCode).toBe(201);
    const secondSettlement = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies: staffCookies,
      headers: { "idempotency-key": "delete-report-settlement-0002" },
      payload: { expectedVersion: 2, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CARD_TERMINAL", amount: 50_000 }] },
    });
    expect(secondSettlement.statusCode).toBe(201);
    expect(secondSettlement.json().data).toMatchObject({ state: "CLOSED", paymentStatus: "PAID", version: 3 });

    const deleted = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/delete`, cookies: staffCookies, payload: { expectedVersion: 3 } });
    expect(deleted.statusCode).toBe(200);
    const dateParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    const fromDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    const report = await app.inject({ method: "GET", url: `/api/v1/admin/reports/daily?fromDate=${fromDate}&toDate=${fromDate}`, cookies: managerCookies });
    expect(report.statusCode).toBe(200);
    expect(report.json().data).toMatchObject({ paidAmount: 0, paymentMethodTotals: { cashAmount: 0, cardTerminalAmount: 0, cardTransferAmount: 0 }, deletedOrders: { count: 1, totalAmount: 100_000, paidAmount: 100_000 } });
    expect(await app.prisma.paymentSettlement.count({ where: { orderId: order.id } })).toBe(2);
  });
});

describe("settlement recording", () => {
  it("allocates an entered partial amount in display order, retains item settlement, and closes with the remaining amount", async () => {
    const cookies = await userSession(UserRole.STAFF, "settlement.amount.staff");
    const { product: first } = await sellableProduct();
    const { product: second } = await sellableProduct();
    const created = await createOrderRequest(
      cookies,
      { channel: "TAKEAWAY", items: [{ productId: first.id, quantity: 1, options: [] }, { productId: second.id, quantity: 1, options: [] }] },
      "settlement-amount-order-create-1",
    );
    const order = created.json().data;

    const firstPayment = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies,
      headers: { "idempotency-key": "settlement-amount-record-0001" },
      payload: { expectedVersion: order.version, allocationMode: "AMOUNT", amount: 75_000, payments: [{ method: "CASH", amount: 75_000 }] },
    });
    expect(firstPayment.statusCode).toBe(201);
    expect(firstPayment.json().data).toMatchObject({
      paymentStatus: "PARTIALLY_PAID",
      paidAmount: 75_000,
      balanceAmount: 25_000,
      settlements: [{ allocations: [
        { orderItemId: order.items[0].id, quantity: 1, amount: 50_000 },
        { orderItemId: order.items[1].id, quantity: 0, amount: 25_000 },
      ] }],
    });

    const receipt = await app.inject({ method: "GET", url: `/api/v1/orders/${order.id}/receipt`, cookies });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json().data.items).toMatchObject([
      { productName: "Latte", paidAmount: 50_000, isPaid: true },
      { productName: "Latte", paidAmount: 25_000, isPaid: false },
    ]);

    const finalPayment = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies,
      headers: { "idempotency-key": "settlement-amount-record-0002" },
      payload: { expectedVersion: 2, allocationMode: "AMOUNT", amount: 25_000, payments: [{ method: "CARD_TERMINAL", amount: 25_000 }] },
    });
    expect(finalPayment.statusCode).toBe(201);
    expect(finalPayment.json().data).toMatchObject({ state: "CLOSED", paymentStatus: "PAID", paidAmount: 100_000, balanceAmount: 0 });
  });

  it("protects an item with an amount-based allocation from quantity, note, and discount edits", async () => {
    const cookies = await userSession(UserRole.STAFF, "settlement.amount-edit.staff");
    const { product } = await sellableProduct();
    const created = await createOrderRequest(
      cookies,
      { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 2, options: [] }] },
      "settlement-amount-edit-order-create-1",
    );
    const order = created.json().data;
    const item = order.items[0];

    const partialPayment = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies,
      headers: { "idempotency-key": "settlement-amount-edit-record-0001" },
      payload: { expectedVersion: order.version, allocationMode: "AMOUNT", amount: 25_000, payments: [{ method: "CASH", amount: 25_000 }] },
    });
    expect(partialPayment.statusCode).toBe(201);
    expect(partialPayment.json().data.settlements[0].allocations).toEqual([{ orderItemId: item.id, quantity: 0, amount: 25_000 }]);

    const beforeEdit = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    const attempts = [
      { quantity: 1 },
      { note: "Changed after payment" },
      { discount: { kind: "FIXED", value: 1_000, reason: "Post-payment edit" } },
    ];

    for (const [index, itemUpdate] of attempts.entries()) {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/orders/${order.id}`,
        cookies,
        payload: { expectedVersion: partialPayment.json().data.version, itemUpdates: [{ orderItemId: item.id, ...itemUpdate }] },
      });
      expect(response.statusCode, `attempt ${index + 1}`).toBe(409);
      expect(response.json().error.code, `attempt ${index + 1}`).toBe("INVALID_STATE");
    }

    const afterEdits = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(afterEdits).toMatchObject({ version: beforeEdit.version, subtotalAmount: beforeEdit.subtotalAmount, totalAmount: beforeEdit.totalAmount, paidAmount: beforeEdit.paidAmount, balanceAmount: beforeEdit.balanceAmount });
    expect(afterEdits.items).toEqual(beforeEdit.items);
  });

  it("commits only one of two simultaneous settlements for the same order version", async () => {
    const cookies = await userSession(UserRole.STAFF, "settlement.race.staff");
    const { product } = await sellableProduct();
    const created = await createOrderRequest(
      cookies,
      { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] },
      "settlement-race-order-create-1",
    );
    const order = created.json().data;
    const payload = {
      expectedVersion: 1,
      allocations: [{ orderItemId: order.items[0].id, quantity: 1 }],
      payments: [{ method: "CASH", amount: 50_000 }],
    };

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/orders/${order.id}/record-settlement`,
        cookies,
        headers: { "idempotency-key": "settlement-race-key-1" },
        payload,
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/orders/${order.id}/record-settlement`,
        cookies,
        headers: { "idempotency-key": "settlement-race-key-2" },
        payload,
      }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.statusCode === 409)?.json().error.code).toBe("STALE_VERSION");
    expect(await app.prisma.paymentSettlement.count()).toBe(1);
    expect(await app.prisma.settlementAllocation.count()).toBe(1);
    expect(await app.prisma.payment.count()).toBe(1);
    expect(await app.prisma.idempotencyRecord.count({ where: { operation: "RECORD_SETTLEMENT" } })).toBe(1);
    expect(await app.prisma.auditLog.count({ where: { operation: "RECORD_SETTLEMENT" } })).toBe(1);
    await expect(app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({
      paymentStatus: "PAID",
      version: 2,
      paidAmount: 50_000,
      balanceAmount: 0,
    });
  });

  it("records selected quantities with mixed tenders, is retry-safe, and updates payment status", async () => {
    const cookies = await userSession(UserRole.STAFF, "settlement.staff");
    const { product: first } = await sellableProduct();
    const { product: second } = await sellableProduct();
    const created = await createOrderRequest(cookies, { channel: "TAKEAWAY", items: [{ productId: first.id, quantity: 1, options: [] }, { productId: second.id, quantity: 1, options: [] }] }, "settlement-order-create-1");
    const order = created.json().data;
    const firstPayload = { expectedVersion: order.version, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 50_000 }] };
    const firstSettlement = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies, headers: { "idempotency-key": "settlement-record-0001" }, payload: firstPayload });
    expect(firstSettlement.statusCode).toBe(201);
    expect(firstSettlement.json().data).toMatchObject({ paymentStatus: "PARTIALLY_PAID", paidAmount: 50_000, balanceAmount: 50_000, version: 2, settlements: [{ totalAmount: 50_000, allocations: [{ orderItemId: order.items[0].id, quantity: 1, amount: 50_000 }] }] });
    const replay = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies, headers: { "idempotency-key": "settlement-record-0001" }, payload: firstPayload });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(await app.prisma.paymentSettlement.count()).toBe(1);

    const { product: partiallyPaidAddition } = await sellableProduct();
    const addedWhilePartiallyPaid = await app.inject({
      method: "PATCH",
      url: `/api/v1/orders/${order.id}`,
      cookies,
      payload: {
        expectedVersion: 2,
        addItems: [{ productId: partiallyPaidAddition.id, quantity: 1, options: [] }],
      },
    });
    expect(addedWhilePartiallyPaid.statusCode).toBe(200);
    expect(addedWhilePartiallyPaid.json().data).toMatchObject({
      paymentStatus: "PARTIALLY_PAID",
      paidAmount: 50_000,
      balanceAmount: 100_000,
      version: 3,
    });
    const addedItem = addedWhilePartiallyPaid.json().data.items[2];

    const secondSettlement = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies, headers: { "idempotency-key": "settlement-record-0002" }, payload: { expectedVersion: 3, allocations: [{ orderItemId: order.items[1].id, quantity: 1 }, { orderItemId: addedItem.id, quantity: 1 }], payments: [{ method: "CASH", amount: 20_000 }, { method: "CARD_TRANSFER", amount: 80_000, reference: "TRX-123" }] } });
    expect(secondSettlement.statusCode).toBe(201);
    expect(secondSettlement.json().data).toMatchObject({ state: "CLOSED", paymentStatus: "PAID", paidAmount: 150_000, balanceAmount: 0, version: 4 });
    expect(await app.prisma.payment.count()).toBe(3);
    expect(await app.prisma.auditLog.count({ where: { operation: "RECORD_SETTLEMENT" } })).toBe(2);

    const { product: addedProduct } = await sellableProduct();
    const added = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies, payload: { expectedVersion: 4, addItems: [{ productId: addedProduct.id, quantity: 1, options: [] }] } });
    expect(added.statusCode).toBe(409);
    expect(added.json().error.code).toBe("INVALID_STATE");
  });

  it("closes a fully paid order and preserves its posted data from later edits", async () => {
    const cookies = await userSession(UserRole.STAFF, "settled.edit.staff");
    const { product } = await sellableProduct();
    const created = await createOrderRequest(
      cookies,
      { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 2, note: "Original note", options: [] }] },
      "settled-edit-create-1",
    );
    const order = created.json().data;
    const settled = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies,
      headers: { "idempotency-key": "settled-edit-payment-1" },
      payload: {
        expectedVersion: 1,
        allocations: [{ orderItemId: order.items[0].id, quantity: 2 }],
        payments: [{ method: "CARD_TRANSFER", amount: 100_000 }],
      },
    });
    expect(settled.statusCode).toBe(201);
    expect(settled.json().data).toMatchObject({
      paymentStatus: "PAID",
      version: 2,
      settlements: [{ payments: [{ method: "CARD_TRANSFER", amount: 100_000, reference: null }] }],
    });

    const rewrite = await app.inject({
      method: "PATCH",
      url: `/api/v1/orders/${order.id}`,
      cookies,
      payload: {
        expectedVersion: 2,
        itemUpdates: [{ orderItemId: order.items[0].id, quantity: 1, note: "Rewritten note" }],
      },
    });
    expect(rewrite.statusCode).toBe(409);
    expect(rewrite.json().error.code).toBe("INVALID_STATE");

    const replacement = await app.inject({
      method: "PATCH",
      url: `/api/v1/orders/${order.id}`,
      cookies,
      payload: {
        expectedVersion: 2,
        items: [{ productId: product.id, quantity: 1, options: [] }],
      },
    });
    expect(replacement.statusCode).toBe(409);
    expect(replacement.json().error.code).toBe("INVALID_STATE");

    const unchanged = await app.inject({ method: "GET", url: `/api/v1/orders/${order.id}`, cookies });
    expect(unchanged.statusCode).toBe(200);
    expect(unchanged.json().data).toMatchObject({
      paymentStatus: "PAID",
      totalAmount: 100_000,
      paidAmount: 100_000,
      balanceAmount: 0,
      version: 2,
      items: [{ quantity: 2, note: "Original note" }],
      settlements: [{
        totalAmount: 100_000,
        allocations: [{ quantity: 2, amount: 100_000 }],
        payments: [{ method: "CARD_TRANSFER", amount: 100_000, reference: null }],
      }],
    });
    expect(await app.prisma.auditLog.count({ where: { operation: "UPDATE_ORDER" } })).toBe(0);

    const increased = await app.inject({
      method: "PATCH",
      url: `/api/v1/orders/${order.id}`,
      cookies,
      payload: {
        expectedVersion: 2,
        itemUpdates: [{ orderItemId: order.items[0].id, quantity: 3 }],
      },
    });
    expect(increased.statusCode).toBe(409);
    expect(increased.json().error.code).toBe("INVALID_STATE");
  });

  it("rejects over-allocation and tender mismatches without partial writes", async () => {
    const cookies = await userSession(UserRole.STAFF, "settlement.reject.staff");
    const { product } = await sellableProduct();
    const created = await createOrderRequest(cookies, { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] }, "settlement-reject-create-1");
    const order = created.json().data;
    const mismatch = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies, headers: { "idempotency-key": "settlement-reject-0001" }, payload: { expectedVersion: 1, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 49_999 }] } });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error.code).toBe("PAYMENT_RECONCILIATION_FAILED");
    expect(await app.prisma.paymentSettlement.count()).toBe(0);
    const over = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies, headers: { "idempotency-key": "settlement-reject-0002" }, payload: { expectedVersion: 1, allocations: [{ orderItemId: order.items[0].id, quantity: 2 }], payments: [{ method: "CASH", amount: 100_000 }] } });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe("SETTLEMENT_ALLOCATION_CONFLICT");
    expect(await app.prisma.paymentSettlement.count()).toBe(0);
  });

  it("rejects duplicate allocation IDs without any settlement side effects", async () => {
    const cookies = await userSession(UserRole.STAFF, "duplicate-allocation.staff");
    const first = await sellableProduct();
    const second = await sellableProduct();
    const created = await createOrderRequest(
      cookies,
      {
        channel: "TAKEAWAY",
        items: [
          { productId: first.product.id, quantity: 1, options: [] },
          { productId: second.product.id, quantity: 1, options: [] },
        ],
      },
      "duplicate-allocation-order-0001",
    );
    expect(created.statusCode).toBe(201);
    const order = created.json().data;

    const settlement = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies,
      headers: { "idempotency-key": "duplicate-allocation-settlement-0001" },
      payload: {
        expectedVersion: 1,
        allocations: [
          { orderItemId: order.items[0].id, quantity: 1 },
          { orderItemId: order.items[0].id, quantity: 1 },
        ],
        payments: [{ method: "CASH", amount: 100_000 }],
      },
    });

    expect(settlement.statusCode).toBe(400);

    const stored = await app.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true, paymentSettlements: { include: { allocations: true, payments: true } } },
    });
    expect(stored.items).toHaveLength(2);
    expect(stored.state).toBe("OPEN");
    expect(stored.paymentStatus).toBe("UNPAID");
    expect(stored.paidAmount).toBe(0);
    expect(stored.balanceAmount).toBe(100_000);
    expect(stored.paymentSettlements).toHaveLength(0);
    await expect(app.prisma.idempotencyRecord.findFirst({ where: { key: "duplicate-allocation-settlement-0001" } })).resolves.toBeNull();
    const settlementAudits = await app.prisma.auditLog.findMany({ where: { entityType: "PAYMENT_SETTLEMENT", operation: "RECORD_SETTLEMENT" } });
    expect(settlementAudits.some((audit) => (audit.afterSnapshot as { orderId?: string } | null)?.orderId === order.id)).toBe(false);
  });
});

describe("settlement reversal and print data", () => {
  it("lets only a Manager reverse a settlement and returns safe print data", async () => {
    const staffCookies = await userSession(UserRole.STAFF, "print.staff");
    const managerCookies = await userSession(UserRole.MANAGER, "print.manager");
    const { product, option } = await sellableProduct();
    const created = await createOrderRequest(staffCookies, { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, note: "No foam", options: [{ optionId: option.id, quantity: 1 }] }] }, "print-order-create-1");
    const order = created.json().data;
    const settled = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staffCookies, headers: { "idempotency-key": "print-settlement-001" }, payload: { expectedVersion: 1, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CARD_TRANSFER", amount: 55_000, reference: "REF-55" }] } });
    expect(settled.statusCode).toBe(201);
    const settlementId = settled.json().data.settlements[0].id;
    const bar = await app.inject({ method: "GET", url: `/api/v1/orders/${order.id}/bar-ticket`, cookies: staffCookies });
    expect(bar.statusCode).toBe(200);
    expect(bar.json().data).toMatchObject({ context: "بیرون‌بر", items: [{ productName: "Latte", note: "No foam" }] });
    expect(JSON.stringify(bar.json().data)).not.toContain("price");
    expect(JSON.stringify(bar.json().data)).not.toContain("payment");
    expect(JSON.stringify(bar.json().data)).not.toContain(order.orderNumber);
    const receipt = await app.inject({ method: "GET", url: `/api/v1/orders/${order.id}/receipt`, cookies: staffCookies });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json().data).toMatchObject({ totalAmount: 55_000 });
    expect(receipt.json().data).not.toHaveProperty("payments");
    expect(JSON.stringify(receipt.json().data)).not.toContain("REF-55");
    const forbidden = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/reverse`, cookies: staffCookies, payload: { expectedVersion: 2, reason: "Wrong tender" } });
    expect(forbidden.statusCode).toBe(403);
    const reversed = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/reverse`, cookies: managerCookies, payload: { expectedVersion: 2, reason: "Wrong tender" } });
    expect(reversed.statusCode).toBe(409);
    expect(reversed.json().error.code).toBe("INVALID_STATE");
    expect(await app.prisma.settlementReversal.count()).toBe(0);
    expect(await app.prisma.payment.count()).toBe(1);
    const payerReceipt = await app.inject({ method: "GET", url: `/api/v1/orders/${order.id}/settlements/${settlementId}/receipt`, cookies: staffCookies });
    expect(payerReceipt.statusCode).toBe(200);
    expect(payerReceipt.json().data).toMatchObject({ totalAmount: 55_000, items: [{ productName: "Latte", quantity: 1, lineTotalAmount: 55_000 }] });
    expect(payerReceipt.json().data).not.toHaveProperty("payments");
    expect(JSON.stringify(payerReceipt.json().data)).not.toContain("REF-55");
  });

  it("reopens a fully settled table order atomically without rewriting the posted settlement", async () => {
    const staffCookies = await userSession(UserRole.STAFF, "reverse.table.staff");
    const managerCookies = await userSession(UserRole.MANAGER, "reverse.table.manager");
    const { product } = await sellableProduct();
    const table = await app.prisma.cafeTable.create({ data: { name: "Reverse table", displayOrder: 101 } });
    const created = await createOrderRequest(staffCookies, { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "reverse-table-order-001");
    expect(created.statusCode).toBe(201);
    const order = created.json().data;
    const settled = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${order.id}/record-settlement`,
      cookies: staffCookies,
      headers: { "idempotency-key": "reverse-table-settlement-001" },
      payload: { expectedVersion: order.version, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 50_000 }] },
    });
    expect(settled.statusCode).toBe(201);
    const settlementId = settled.json().data.settlements[0].id;
    expect((await app.prisma.cafeTable.findUniqueOrThrow({ where: { id: table.id } })).occupancyState).toBe("AVAILABLE");
    const reversed = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/reverse`, cookies: managerCookies, payload: { expectedVersion: 2, reason: "Cash entry was incorrect" } });
    expect(reversed.statusCode).toBe(409);
    expect(reversed.json().error.code).toBe("INVALID_STATE");
    expect(await app.prisma.settlementReversal.count({ where: { settlementId } })).toBe(0);
  });

  it("rejects reversal of an old table settlement after the table has been reused", async () => {
    const staffCookies = await userSession(UserRole.STAFF, "reverse.reuse.staff");
    const managerCookies = await userSession(UserRole.MANAGER, "reverse.reuse.manager");
    const { product } = await sellableProduct();
    const table = await app.prisma.cafeTable.create({ data: { name: "Reversal reuse", displayOrder: 155 } });
    const first = await createOrderRequest(staffCookies, { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "reverse-reuse-first-0001");
    const original = first.json().data;
    const settled = await app.inject({ method: "POST", url: `/api/v1/orders/${original.id}/record-settlement`, cookies: staffCookies, headers: { "idempotency-key": "reverse-reuse-settlement-1" }, payload: { expectedVersion: original.version, allocations: [{ orderItemId: original.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 50_000 }] } });
    expect(settled.statusCode).toBe(201);
    expect((await createOrderRequest(staffCookies, { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "reverse-reuse-second-0001")).statusCode).toBe(201);
    const settlementId = settled.json().data.settlements[0].id;
    const reversed = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/reverse`, cookies: managerCookies, payload: { expectedVersion: settled.json().data.version, reason: "Original table has been reused" } });
    expect(reversed.statusCode).toBe(409);
    expect(await app.prisma.order.count({ where: { tableId: table.id, channel: "TABLE", state: "OPEN" } })).toBe(1);
    expect(await app.prisma.settlementReversal.count({ where: { settlementId } })).toBe(0);
  });

  it("keeps one open table order when reversal races table reuse", async () => {
    const staffCookies = await userSession(UserRole.STAFF, "reverse.race.staff");
    const managerCookies = await userSession(UserRole.MANAGER, "reverse.race.manager");
    const { product } = await sellableProduct();
    const table = await app.prisma.cafeTable.create({ data: { name: "Reversal race", displayOrder: 156 } });
    const original = await createOrderRequest(staffCookies, { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "reverse-race-original-001");
    const order = original.json().data;
    const settled = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staffCookies, headers: { "idempotency-key": "reverse-race-settlement-1" }, payload: { expectedVersion: order.version, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 50_000 }] } });
    const settlementId = settled.json().data.settlements[0].id;
    const [reversal, reuse] = await Promise.all([
      app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/reverse`, cookies: managerCookies, payload: { expectedVersion: settled.json().data.version, reason: "Concurrent correction" } }),
      createOrderRequest(staffCookies, { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "reverse-race-reuse-0001"),
    ]);
    expect([[200, 409], [409, 201]]).toContainEqual([reversal.statusCode, reuse.statusCode]);
    expect(await app.prisma.order.count({ where: { tableId: table.id, channel: "TABLE", state: "OPEN" } })).toBe(1);
  });

  it("edits a historical table settlement without touching the reused table order", async () => {
    const staffCookies = await userSession(UserRole.STAFF, "edit-payment.reuse.staff");
    const managerCookies = await userSession(UserRole.MANAGER, "edit-payment.reuse.manager");
    const { product } = await sellableProduct();
    const table = await app.prisma.cafeTable.create({ data: { name: "Edit payment reuse", displayOrder: 157 } });
    const first = await createOrderRequest(staffCookies, { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "edit-payment-reuse-first");
    const original = first.json().data;
    const settled = await app.inject({ method: "POST", url: `/api/v1/orders/${original.id}/record-settlement`, cookies: staffCookies, headers: { "idempotency-key": "edit-payment-reuse-settlement" }, payload: { expectedVersion: original.version, allocations: [{ orderItemId: original.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 50_000 }] } });
    const second = await createOrderRequest(staffCookies, { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "edit-payment-reuse-second");
    const liveOrder = second.json().data;
    await app.prisma.cafeTable.update({ where: { id: table.id }, data: { occupancyState: "OCCUPIED", occupiedAt: new Date() } });
    const edited = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settled.json().data.settlements[0].id}/edit`, cookies: managerCookies, headers: { "idempotency-key": "edit-payment-reuse-correction" }, payload: { expectedVersion: settled.json().data.version, reason: "اصلاح روش پرداخت", payments: [{ method: "CARD_TERMINAL", amount: 50_000 }] } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data).toMatchObject({ id: original.id, state: "CLOSED", paymentStatus: "PAID", paidAmount: 50_000, balanceAmount: 0, version: 3 });
    expect(await app.prisma.order.findUniqueOrThrow({ where: { id: liveOrder.id }, select: { state: true, tableId: true, version: true } })).toEqual({ state: "OPEN", tableId: table.id, version: 1 });
    expect(await app.prisma.cafeTable.findUniqueOrThrow({ where: { id: table.id }, select: { occupancyState: true } })).toEqual({ occupancyState: "OCCUPIED" });
    expect(await app.prisma.payment.findMany({ where: { settlement: { orderId: original.id } }, orderBy: { recordedAt: "asc" }, select: { method: true, amount: true } })).toEqual([{ method: "CASH", amount: 50_000 }, { method: "CARD_TERMINAL", amount: 50_000 }]);
    expect(await app.prisma.auditLog.count({ where: { operation: "EDIT_SETTLEMENT", entityType: "PAYMENT_SETTLEMENT" } })).toBeGreaterThan(0);
  });

  it("edits a historical settlement while its old table remains empty", async () => {
    const staffCookies = await userSession(UserRole.STAFF, "edit-payment.empty.staff");
    const managerCookies = await userSession(UserRole.MANAGER, "edit-payment.empty.manager");
    const { product } = await sellableProduct();
    const table = await app.prisma.cafeTable.create({ data: { name: "Edit payment empty", displayOrder: 158 } });
    const created = await createOrderRequest(staffCookies, { channel: "TABLE", tableId: table.id, items: [{ productId: product.id, quantity: 1, options: [] }] }, "edit-payment-empty-order");
    const order = created.json().data;
    const settled = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staffCookies, headers: { "idempotency-key": "edit-payment-empty-settlement" }, payload: { expectedVersion: order.version, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 50_000 }] } });
    const settlementId = settled.json().data.settlements[0].id;
    const edited = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/edit`, cookies: managerCookies, headers: { "idempotency-key": "edit-payment-empty-correction" }, payload: { expectedVersion: settled.json().data.version, reason: "اصلاح کارتخوان", payments: [{ method: "CARD_TERMINAL", amount: 50_000 }] } });
    expect(edited.statusCode).toBe(200);
    expect(await app.prisma.order.count({ where: { tableId: table.id, state: "OPEN" } })).toBe(0);
    expect(await app.prisma.cafeTable.findUniqueOrThrow({ where: { id: table.id }, select: { occupancyState: true } })).toEqual({ occupancyState: "AVAILABLE" });
    expect(await app.prisma.settlementReversal.count({ where: { settlementId } })).toBe(1);
  });

  it("edits takeaway tender history and leaves the original state intact on a failed correction", async () => {
    const staffCookies = await userSession(UserRole.STAFF, "edit-payment.takeaway.staff");
    const managerCookies = await userSession(UserRole.MANAGER, "edit-payment.takeaway.manager");
    const { product } = await sellableProduct();
    const created = await createOrderRequest(staffCookies, { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, options: [] }] }, "edit-payment-takeaway-order");
    const order = created.json().data;
    const settled = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies: staffCookies, headers: { "idempotency-key": "edit-payment-takeaway-settlement" }, payload: { expectedVersion: order.version, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 50_000 }] } });
    const settlementId = settled.json().data.settlements[0].id;
    const failed = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/edit`, cookies: managerCookies, headers: { "idempotency-key": "edit-payment-takeaway-failed" }, payload: { expectedVersion: settled.json().data.version, reason: "مبلغ اشتباه", payments: [{ method: "CARD_TRANSFER", amount: 49_999 }] } });
    expect(failed.statusCode).toBe(422);
    expect(await app.prisma.settlementReversal.count({ where: { settlementId } })).toBe(0);
    const edited = await app.inject({ method: "POST", url: `/api/v1/admin/settlements/${settlementId}/edit`, cookies: managerCookies, headers: { "idempotency-key": "edit-payment-takeaway-success" }, payload: { expectedVersion: settled.json().data.version, reason: "اصلاح روش پرداخت", payments: [{ method: "CARD_TRANSFER", amount: 50_000, reference: "NEW-REF" }] } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data).toMatchObject({ channel: "TAKEAWAY", state: "CLOSED", paymentStatus: "PAID", version: 3 });
    expect(await app.prisma.payment.findMany({ where: { settlement: { orderId: order.id }, method: "CARD_TRANSFER" }, select: { amount: true, reference: true } })).toEqual([{ amount: 50_000, reference: "NEW-REF" }]);
  });

  it("calculates weighted items from grams while keeping quantity as bag count", async () => {
    const cookies = await userSession(UserRole.STAFF, "weighted.basic.staff");
    const category = await app.prisma.category.create({ data: { name: "Weighted coffee", displayOrder: 300 } });
    const product = await app.prisma.product.create({ data: { categoryId: category.id, name: "Ground coffee", priceAmount: 2_000_000, pricingMode: "WEIGHTED_PER_KG", preparationDeadlineMinutes: 5, displayOrder: 1 } });
    const response = await createOrderRequest(cookies, { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 2, weightGrams: 250, options: [] }] }, "weighted-basic-order-0001");
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ totalAmount: 1_000_000, items: [{ quantity: 2, weightGrams: 250, pricingModeSnapshot: "WEIGHTED_PER_KG", basePriceSnapshot: 2_000_000, lineTotalAmount: 1_000_000 }] });
  });

  it("requires weight only for weighted products and rejects it for fixed products", async () => {
    const cookies = await userSession(UserRole.STAFF, "weighted.validation.staff");
    const category = await app.prisma.category.create({ data: { name: "Weight validation", displayOrder: 301 } });
    const weighted = await app.prisma.product.create({ data: { categoryId: category.id, name: "Weighted", priceAmount: 1_000_000, pricingMode: "WEIGHTED_PER_KG", preparationDeadlineMinutes: 5, displayOrder: 1 } });
    const fixed = await app.prisma.product.create({ data: { categoryId: category.id, name: "Fixed", priceAmount: 100_000, preparationDeadlineMinutes: 5, displayOrder: 2 } });
    expect((await createOrderRequest(cookies, { channel: "TAKEAWAY", items: [{ productId: weighted.id, quantity: 1, options: [] }] }, "weighted-missing-weight-0001")).statusCode).toBe(422);
    expect((await createOrderRequest(cookies, { channel: "TAKEAWAY", items: [{ productId: fixed.id, quantity: 1, weightGrams: 250, options: [] }] }, "fixed-with-weight-0001")).statusCode).toBe(422);
  });

  it("keeps weighted snapshots immutable and protects allocated weight edits", async () => {
    const cookies = await userSession(UserRole.STAFF, "weighted.edit.staff");
    const category = await app.prisma.category.create({ data: { name: "Weighted edit", displayOrder: 302 } });
    const product = await app.prisma.product.create({ data: { categoryId: category.id, name: "Weighted edit coffee", priceAmount: 1_800_000, pricingMode: "WEIGHTED_PER_KG", preparationDeadlineMinutes: 5, displayOrder: 1 } });
    const created = await createOrderRequest(cookies, { channel: "TAKEAWAY", items: [{ productId: product.id, quantity: 1, weightGrams: 250, options: [] }] }, "weighted-edit-order-0001");
    const order = created.json().data;
    await app.prisma.product.update({ where: { id: product.id }, data: { priceAmount: 2_000_000 } });
    const changed = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies, payload: { expectedVersion: order.version, itemUpdates: [{ orderItemId: order.items[0].id, weightGrams: 300 }] } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.items[0]).toMatchObject({ weightGrams: 300, basePriceSnapshot: 1_800_000, lineTotalAmount: 540_000 });
    const settled = await app.inject({ method: "POST", url: `/api/v1/orders/${order.id}/record-settlement`, cookies, headers: { "idempotency-key": "weighted-edit-settle-0001" }, payload: { expectedVersion: changed.json().data.version, allocations: [{ orderItemId: order.items[0].id, quantity: 1 }], payments: [{ method: "CASH", amount: 540_000 }] } });
    expect(settled.statusCode).toBe(201);
    const rejected = await app.inject({ method: "PATCH", url: `/api/v1/orders/${order.id}`, cookies, payload: { expectedVersion: settled.json().data.version, itemUpdates: [{ orderItemId: order.items[0].id, weightGrams: 400 }] } });
    expect(rejected.statusCode).toBe(409);
  });
});
