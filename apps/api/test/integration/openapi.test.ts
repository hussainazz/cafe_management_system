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
    expect(document.paths).toHaveProperty("/api/v1/admin/categories");
    expect(document.paths).toHaveProperty("/api/v1/admin/categories/reorder");
    expect(document.paths).toHaveProperty("/api/v1/admin/categories/{categoryId}/products/reorder");
    expect(document.paths).toHaveProperty("/api/v1/admin/products/{productId}");
    expect(document.paths).toHaveProperty("/api/v1/admin/option-groups/{optionGroupId}");
    expect(document.paths).toHaveProperty("/api/v1/admin/tables/{tableId}");
    expect(document.paths).toHaveProperty("/api/v1/admin/users/{userId}");
    expect(document.paths).toHaveProperty("/api/v1/admin/payments");
    expect(document.paths).toHaveProperty("/api/v1/admin/reports/daily");
    expect(document.paths).toHaveProperty("/api/v1/admin/audit-log");
    expect(document.paths).toHaveProperty("/api/v1/product-images/{storageKey}");
    expect(document.paths["/api/v1/admin/products/{productId}/image"]).toMatchObject({
      put: {
        parameters: expect.arrayContaining([
          expect.objectContaining({ in: "path", name: "productId", required: true }),
        ]),
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: expect.objectContaining({ required: ["image"] }),
            },
          },
        },
        responses: { 200: expect.any(Object), 400: expect.any(Object), 404: expect.any(Object), 413: expect.any(Object) },
      },
    });
    expect(document.paths["/api/v1/admin/products/{productId}/image/archive"].post.responses)
      .toMatchObject({ 200: expect.any(Object), 404: expect.any(Object) });
    expect(document.paths["/api/v1/product-images/{storageKey}"].get.responses).toMatchObject({
      200: expect.any(Object),
      404: expect.any(Object),
    });
    expect(document.paths["/api/v1/admin/settlements/{settlementId}/edit"].post.requestBody.content["application/json"].schema)
      .toMatchObject({ type: "object", required: expect.any(Array) });
  });

  it("documents success, request, path, and structured error schemas for every API operation", async () => {
    const response = await app.inject({ method: "GET", url: "/documentation/json" });
    const document = response.json();
    const apiPaths = Object.entries(document.paths).filter(([path]) => path.startsWith("/api/v1/"));
    const errors = [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503];

    for (const [path, pathItem] of apiPaths) {
      for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        const success = Object.entries(operation.responses).find(([status]) => /^2\d\d$/.test(status));
        expect(success, `${method.toUpperCase()} ${path} success response`).toBeTruthy();
        const successSchema = Object.values((success?.[1] as any)?.content ?? {}).map((entry: any) => entry.schema);
        if (success?.[0] !== "204") {
          expect(successSchema.some(Boolean), `${method.toUpperCase()} ${path} response schema`).toBe(true);
        }

        for (const errorStatus of errors) {
          const errorSchema = operation.responses[errorStatus]?.content?.["application/json"]?.schema;
          expect(errorSchema, `${method.toUpperCase()} ${path} ${errorStatus} error schema`).toBeTruthy();
          if (errorStatus !== 503) {
            expect(errorSchema.required).toEqual(expect.arrayContaining(["error"]));
          }
        }

        for (const parameter of operation.parameters ?? []) {
          expect(parameter.schema, `${method.toUpperCase()} ${path} parameter ${parameter.name}`).toBeTruthy();
        }
        if (operation.requestBody) {
          const requestSchemas = Object.values(operation.requestBody.content ?? {}).map((entry: any) => entry.schema);
          expect(requestSchemas.some(Boolean), `${method.toUpperCase()} ${path} request body schema`).toBe(true);
        }
      }
    }
  });
});
