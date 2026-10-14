import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/client.js";
import { safeErrorDiagnostics } from "../../src/errors/database-diagnostics.js";
import { buildApp } from "../../src/app.js";
import { ApplicationError, ErrorCodes } from "../../src/errors/application-error.js";

const app = buildApp();
const captured: Array<Record<string, unknown>> = [];
app.addHook("onRequest", (request, _reply, done) => {
  request.log.error = ((record: Record<string, unknown>) => { captured.push(record); }) as typeof request.log.error;
  done();
});

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
    if (kind === "database-range") {
      return app.prisma.$queryRaw`SELECT 2147483648::int4`;
    }
    if (kind === "database-schema") {
      return app.prisma.$queryRaw`SELECT * FROM inventory_error_test_missing_table`;
    }
    if (kind === "database-check") {
      const user = await app.prisma.user.create({ data: { username: "constraint-test-user", passwordHash: "test-fixture", role: "MANAGER" } });
      return app.prisma.purchase.create({ data: { receivedAt: new Date(), createdById: user.id, supplier: "" } });
    }
    if (kind === "database-conflict") {
      throw new Prisma.PrismaClientKnownRequestError("secret query data", { code: "P2034", clientVersion: "test" });
    }
    if (kind === "database-timeout") {
      throw new Prisma.PrismaClientKnownRequestError("postgresql://user:password@host/database", { code: "P2024", clientVersion: "test" });
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
  it.each([
    ["database-range", 422, "BUSINESS_RULE_VIOLATION", "22003"],
    ["database-check", 422, "BUSINESS_RULE_VIOLATION", "23514"],
    ["database-schema", 503, "SERVICE_UNAVAILABLE", "42P01"],
    ["database-conflict", 409, "CONFLICT", undefined],
    ["database-timeout", 503, "SERVICE_UNAVAILABLE", undefined],
  ])("classifies %s and logs safe database diagnostics", async (kind, status, code, sqlState) => {
    captured.length = 0;
    const response = await app.inject({ method: "GET", url: `/test/errors/${kind}`, headers: { "x-request-id": `diagnostic-${kind}` } });
    expect(response.statusCode, response.body).toBe(status);
    expect(response.json().error).toMatchObject({ code, requestId: `diagnostic-${kind}` });
    expect(captured.at(-1)).toMatchObject({ route: "/test/errors/:kind", requestId: `diagnostic-${kind}` });
    if (sqlState) expect(captured.at(-1)?.database).toMatchObject({ sqlState });
    if (kind === "database-check") {
      expect(captured.at(-1)).toMatchObject({ errName: "PrismaClientUnknownRequestError", database: { constraint: "purchases_supplier_nonempty" } });
      expect(response.json().error.details).toEqual([expect.objectContaining({ path: "supplier" })]);
    }
    expect(JSON.stringify(captured)).not.toMatch(/password|secret query data|SELECT /);
  });

  it("keeps driver row values and credentials out of diagnostics", () => {
    const error = Object.assign(new Error("password, token, SELECT secret"), { cause: { originalCode: "23514", kind: "postgres", originalMessage: 'new row for relation "purchases" violates check constraint "purchases_supplier_nonempty"; password=secret', detail: "sensitive row values" } });
    const diagnostic = safeErrorDiagnostics(error);
    expect(diagnostic.database).toMatchObject({ sqlState: "23514", table: "purchases", constraint: "purchases_supplier_nonempty" });
    expect(JSON.stringify(diagnostic)).not.toMatch(/password|token|secret|SELECT/);
  });
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
