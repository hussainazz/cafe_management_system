import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("OpenAPI contract", () => {
  it("publishes schemas generated from the shared Zod contracts", async () => {
    const response = await app.inject({ method: "GET", url: "/documentation/json" });

    expect(response.statusCode).toBe(200);

    const document = response.json();
    const live = document.paths["/api/v1/health/live"].get;
    const ready = document.paths["/api/v1/health/ready"].get;

    expect(document.openapi).toBe("3.0.3");
    expect(live.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: "header",
          name: "x-request-id",
          schema: expect.objectContaining({ pattern: "^[A-Za-z0-9._:-]{8,128}$" }),
        }),
      ]),
    );
    expect(live.responses["200"].content["application/json"].schema).toMatchObject({
      type: "object",
      required: ["status", "service", "timestamp"],
      properties: {
        status: { enum: ["ok"] },
        timestamp: { format: "date-time" },
      },
    });
    expect(ready.responses).toHaveProperty("200");
    expect(ready.responses).toHaveProperty("503");
    expect(document.paths).toHaveProperty("/api/v1/public/table-context/exchange");
    expect(document.paths).toHaveProperty("/api/v1/public/table-context");
    expect(document.paths).toHaveProperty("/api/v1/public/waiter-calls");
    expect(document.paths).toHaveProperty("/api/v1/waiter-calls");
    expect(document.paths).toHaveProperty("/api/v1/tables/{tableId}/occupy");
    expect(document.paths).toHaveProperty("/api/v1/tables/{tableId}/make-available");
    expect(document.paths).toHaveProperty("/api/v1/tables/{tableId}/acknowledge-waiter-call");
  });
});
