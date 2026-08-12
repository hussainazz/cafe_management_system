import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { ApplicationError, ErrorCodes } from "../../src/errors/application-error.js";

const app = buildApp();

app.register(async (testRoutes) => {
  testRoutes.post(
    "/test/validation",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["quantity"],
          properties: {
            quantity: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    async () => ({ ok: true }),
  );

  testRoutes.get("/test/errors/:kind", async (request) => {
    const { kind } = request.params as { kind: string };

    if (kind === "internal") {
      throw new Error("postgresql://user:password@host/database");
    }

    const errors: Record<string, ApplicationError> = {
      authentication: new ApplicationError(
        401,
        ErrorCodes.AUTHENTICATION_REQUIRED,
        "Sign in required.",
      ),
      authorization: new ApplicationError(403, ErrorCodes.FORBIDDEN, "Manager access required."),
      conflict: new ApplicationError(409, ErrorCodes.STALE_VERSION, "The order has changed."),
      business: new ApplicationError(
        422,
        ErrorCodes.UNAVAILABLE_PRODUCT,
        "This product is unavailable.",
      ),
      rate: new ApplicationError(429, ErrorCodes.RATE_LIMITED, "Try again later."),
      dependency: new ApplicationError(
        503,
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Database unavailable.",
      ),
    };

    throw errors[kind] ?? new ApplicationError(400, ErrorCodes.BAD_REQUEST, "Invalid test error.");
  });
});

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("application error envelope", () => {
  it("returns safe validation details and preserves a valid request ID", async () => {
    const requestId = "request-id-123";
    const response = await app.inject({
      method: "POST",
      url: "/test/validation",
      headers: { "x-request-id": requestId },
      payload: { quantity: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["x-request-id"]).toBe(requestId);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "One or more fields are invalid.",
        requestId,
        details: [{ path: "body.quantity", code: "minimum" }],
      },
    });
    expect(response.json().error.timestamp).toEqual(expect.any(String));
  });

  it("replaces invalid request IDs and does not expose internal errors", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test/errors/internal",
      headers: { "x-request-id": "invalid id" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(response.json().error.requestId).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(response.body).not.toContain("password");
  });

  it.each([
    ["authentication", 401, "AUTHENTICATION_REQUIRED"],
    ["authorization", 403, "FORBIDDEN"],
    ["conflict", 409, "STALE_VERSION"],
    ["business", 422, "UNAVAILABLE_PRODUCT"],
    ["rate", 429, "RATE_LIMITED"],
    ["dependency", 503, "SERVICE_UNAVAILABLE"],
  ])("returns the documented envelope for %s failures", async (kind, statusCode, code) => {
    const response = await app.inject({ method: "GET", url: `/test/errors/${kind}` });

    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toMatchObject({
      error: {
        code,
        requestId: expect.any(String),
        timestamp: expect.any(String),
      },
    });
  });

  it("uses the documented envelope for unknown application routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/unknown" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });
});
