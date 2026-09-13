import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("test database isolation", () => {
  it("allows a test to write data", async () => {
    await app.prisma.category.create({
      data: {
        name: "Test category",
        displayOrder: 0,
      },
    });
    await app.prisma.customer.create({
      data: { fullName: "Test customer", phoneLookupHash: "test-phone-hash" },
    });

    await expect(app.prisma.category.count()).resolves.toBe(1);
    await expect(app.prisma.customer.count()).resolves.toBe(1);
  });

  it("clears data before the next test", async () => {
    await expect(app.prisma.category.count()).resolves.toBe(0);
    await expect(app.prisma.customer.count()).resolves.toBe(0);
  });
});
