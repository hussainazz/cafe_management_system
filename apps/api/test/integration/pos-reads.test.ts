import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrderChannel, OrderState, PaymentStatus, UserRole } from "../../generated/prisma/client.js";
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

async function createStaffSession() {
  await app.prisma.user.create({
    data: {
      username: "pos.reader",
      passwordHash: await hashPassword("CafePassword2026"),
      role: UserRole.STAFF,
    },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username: "pos.reader", password: "CafePassword2026" },
  });
  expect(login.statusCode).toBe(200);
  return cookieJar(login);
}

describe("POS catalog and table reads", () => {
  it("returns only current POS catalog data and its safe sellable fields", async () => {
    const cookies = await createStaffSession();
    const category = await app.prisma.category.create({
      data: { name: "Coffee", displayOrder: 1 },
    });
    const hiddenCategory = await app.prisma.category.create({
      data: { name: "Archived", displayOrder: 2, isActive: false, archivedAt: new Date() },
    });
    const optionGroup = await app.prisma.optionGroup.create({ data: { name: "Milk" } });
    const product = await app.prisma.product.create({
      data: {
        categoryId: category.id,
        name: "Latte",
        priceAmount: 85_000,
        preparationDeadlineMinutes: 8,
        displayOrder: 1,
        isAvailable: false,
        image: { create: { storageKey: "products/latte.webp", altText: "Latte" } },
        productOptionGroups: { create: { optionGroupId: optionGroup.id, displayOrder: 1 } },
      },
    });
    await app.prisma.option.createMany({
      data: [
        { optionGroupId: optionGroup.id, name: "Oat", priceAmount: 12_000, displayOrder: 1 },
        {
          optionGroupId: optionGroup.id,
          name: "Unavailable soy",
          priceAmount: 10_000,
          displayOrder: 2,
          isAvailable: false,
        },
        {
          optionGroupId: optionGroup.id,
          name: "Archived option",
          priceAmount: 10_000,
          displayOrder: 3,
          isActive: false,
          archivedAt: new Date(),
        },
      ],
    });
    await app.prisma.product.create({
      data: {
        categoryId: hiddenCategory.id,
        name: "Hidden product",
        priceAmount: 1,
        preparationDeadlineMinutes: 1,
        displayOrder: 1,
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/pos/catalog", cookies });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.categories).toEqual([
      {
        id: category.id,
        name: "Coffee",
        products: [
          {
            id: product.id,
            name: "Latte",
            priceAmount: 85_000,
            preparationDeadlineMinutes: 8,
            isAvailable: false,
            image: { storageKey: "products/latte.webp", altText: "Latte" },
            optionGroups: [
              {
                id: optionGroup.id,
                name: "Milk",
                options: [
                  { id: expect.any(String), name: "Oat", priceAmount: 12_000, isAvailable: true },
                  {
                    id: expect.any(String),
                    name: "Unavailable soy",
                    priceAmount: 10_000,
                    isAvailable: false,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(response.body).not.toContain("displayOrder");
    expect(response.body).not.toContain("archivedAt");
  });

  it("returns active table timing summaries and hides inactive tables", async () => {
    const cookies = await createStaffSession();
    const staff = await app.prisma.user.findUniqueOrThrow({ where: { username: "pos.reader" } });
    const table = await app.prisma.cafeTable.create({
      data: { name: "Table 1", seatingLimitMinutes: 45, displayOrder: 1 },
    });
    await app.prisma.cafeTable.create({
      data: { name: "Hidden table", seatingLimitMinutes: 30, displayOrder: 2, isActive: false },
    });
    const createdAt = new Date("2026-08-14T08:00:00.000Z");
    const releaseAt = new Date("2026-08-14T08:55:00.000Z");
    const order = await app.prisma.order.create({
      data: {
        orderNumber: "POS-READ-001",
        tableId: table.id,
        createdById: staff.id,
        channel: OrderChannel.TABLE,
        state: OrderState.OPEN,
        paymentStatus: PaymentStatus.UNPAID,
        subtotalAmount: 85_000,
        totalAmount: 85_000,
        balanceAmount: 85_000,
        estimatedPreparationMinutes: 10,
        tableSeatingLimitSnapshotMinutes: 45,
        estimatedTableReleaseAt: releaseAt,
        createdAt,
      },
    });

    const listResponse = await app.inject({ method: "GET", url: "/api/v1/tables", cookies });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data.tables).toEqual([
      {
        id: table.id,
        name: "Table 1",
        seatingLimitMinutes: 45,
        waiterCallEnabled: false,
        occupancyState: "AVAILABLE",
        occupiedAt: null,
        occupancyReminderAt: null,
        activeOrders: [
          {
            id: order.id,
            orderNumber: "POS-READ-001",
            paymentStatus: "UNPAID",
            estimatedPreparationMinutes: 10,
            estimatedTableReleaseAt: releaseAt.toISOString(),
            createdAt: createdAt.toISOString(),
          },
        ],
      },
    ]);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/tables/${table.id}`,
      cookies,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().data).toEqual(listResponse.json().data.tables[0]);
  });

  it("requires an active Staff or Manager session for POS reads", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/pos/catalog" });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });
});
