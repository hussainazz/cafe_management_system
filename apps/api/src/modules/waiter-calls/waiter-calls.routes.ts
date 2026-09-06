import type { FastifyPluginAsync } from "fastify";
import {
  ActiveWaiterCallsResponseSchema,
  ErrorResponseSchema,
  PublicTableContextResponseSchema,
  PublicWaiterCallResponseSchema,
  TableContextExchangeRequestSchema,
  CustomerOtpRequestSchema,
  CustomerOtpVerifySchema,
  type TableContextExchangeRequest,
} from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { readCookie } from "../../auth/session.js";
import {
  clearTableContextCookie,
  tableContextCookie,
  tableContextCookieName,
} from "../../table-context/table-context.js";
import { requireStaff } from "../auth/authorization.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import {
  createWaiterCall,
  exchangeTableQrToken,
  listPendingWaiterCalls,
  readPublicTableContext,
} from "./waiter-calls.service.js";
import { credentialFromCookie } from "./waiter-calls.service.js";
import { customerAuthCookie, clearCustomerAuthCookie } from "../../customer-auth/customer-auth.js";
import { readCustomerAuth, requestCustomerOtp, verifyCustomerOtp } from "../../customer-auth/customer-auth.service.js";

const errorResponse = zodToJsonSchema(ErrorResponseSchema);

export const waiterCallRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TableContextExchangeRequest }>(
    "/public/table-context/exchange",
    {
      schema: {
        tags: ["Public table context"],
        summary: "Exchange a printed table QR token for short-lived table context",
        body: zodToJsonSchema(TableContextExchangeRequestSchema),
        response: {
          200: {
            type: "object",
            required: ["data", "meta"],
            properties: {
              data: {
                type: "object",
                required: ["tableName"],
                properties: { tableName: { type: "string" } },
              },
              meta: {
                type: "object",
                required: ["requestId"],
                properties: { requestId: { type: "string" } },
              },
            },
          },
          400: errorResponse,
          401: errorResponse,
          429: errorResponse,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await exchangeTableQrToken(app.prisma, request.body.token, request.headers.cookie);
        reply.header("cache-control", "no-store");
        reply.header("set-cookie", tableContextCookie(result.cookieValue));
        return { data: { tableName: result.tableName }, meta: { requestId: request.id } };
      } catch (error) {
        reply.header("set-cookie", clearTableContextCookie());
        throw error;
      }
    },
  );

  app.get(
    "/public/table-context",
    {
      schema: {
        tags: ["Public table context"],
        summary: "Read the current anonymous table context",
        response: { 200: zodToJsonSchema(PublicTableContextResponseSchema) },
      },
    },
    async (request, reply) => {
      const data = await readPublicTableContext(app.prisma, request.headers.cookie);
      reply.header("cache-control", "no-store");
      if (!data.active && readCookie(request.headers.cookie, tableContextCookieName)) {
        reply.header("set-cookie", clearTableContextCookie());
      }
      return { data, meta: { requestId: request.id } };
    },
  );

  app.post(
    "/public/customer-otp/request",
    { schema: { tags: ["Public customer authentication"], body: zodToJsonSchema(CustomerOtpRequestSchema), response: { 200: { type: "object" }, 400: errorResponse, 401: errorResponse, 429: errorResponse } } },
    async (request) => {
      const context = await credentialFromCookie(app.prisma, request.headers.cookie);
      if (!context) throw new ApplicationError(401, ErrorCodes.TABLE_CONTEXT_INVALID, "Table context required.");
      const result = await requestCustomerOtp(app.prisma, context.credential.id, (request.body as { phoneNumber: string }).phoneNumber);
      return { data: { ...result, expiresAt: result.expiresAt.toISOString(), resendAvailableAt: result.resendAvailableAt.toISOString() }, meta: { requestId: request.id } };
    },
  );

  app.post(
    "/public/customer-otp/verify",
    { schema: { tags: ["Public customer authentication"], body: zodToJsonSchema(CustomerOtpVerifySchema), response: { 200: { type: "object" }, 400: errorResponse, 401: errorResponse, 409: errorResponse, 429: errorResponse } } },
    async (request, reply) => {
      const context = await credentialFromCookie(app.prisma, request.headers.cookie);
      if (!context) throw new ApplicationError(401, ErrorCodes.TABLE_CONTEXT_INVALID, "Table context required.");
      const body = request.body as { challengeId: string; code: string };
      const challenge = await app.prisma.customerOtpChallenge.findUnique({ where: { id: body.challengeId } });
      if (!challenge || challenge.tableCredentialId !== context.credential.id) throw new ApplicationError(401, ErrorCodes.OTP_INVALID, "OTP challenge is not valid for this table.");
      const result = await verifyCustomerOtp(app.prisma, body.challengeId, body.code);
      reply.header("cache-control", "no-store");
      reply.header("set-cookie", customerAuthCookie(result.token));
      return { data: { authenticated: true, visitExpiresAt: result.visit.expiresAt.toISOString() }, meta: { requestId: request.id } };
    },
  );

  app.delete(
    "/public/customer-auth/session",
    { schema: { tags: ["Public customer authentication"], response: { 204: { type: "null" }, 401: errorResponse } } },
    async (request, reply) => {
      const auth = await readCustomerAuth(app.prisma, request.headers.cookie);
      if (auth) await app.prisma.customerAuthSession.update({ where: { id: auth.id }, data: { revokedAt: new Date() } });
      reply.header("set-cookie", clearCustomerAuthCookie());
      return reply.status(204).send();
    },
  );

  app.get(
    "/public/customer-auth",
    { schema: { tags: ["Public customer authentication"], response: { 200: { type: "object" } } } },
    async (request) => {
      const auth = await readCustomerAuth(app.prisma, request.headers.cookie);
      const context = await credentialFromCookie(app.prisma, request.headers.cookie);
      const visit = auth && context ? await app.prisma.customerTableVisit.findFirst({
        where: { customerId: auth.customerId, tableCredentialId: context.credential.id, invalidatedAt: null, expiresAt: { gt: new Date() } },
      }) : null;
      return { data: { authenticated: Boolean(auth), visitActive: Boolean(visit), visitExpiresAt: visit?.expiresAt.toISOString() ?? null }, meta: { requestId: request.id } };
    },
  );

  app.post(
    "/public/waiter-calls",
    {
      schema: {
        tags: ["Public table context"],
        summary: "Create or return the table's one pending waiter-call",
        response: {
          201: zodToJsonSchema(PublicWaiterCallResponseSchema),
          401: errorResponse,
          409: errorResponse,
          429: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const data = await createWaiterCall(app.prisma, request.headers.cookie);
      return reply.status(201).send({ data, meta: { requestId: request.id } });
    },
  );

  app.get(
    "/waiter-calls",
    {
      preHandler: requireStaff,
      schema: {
        tags: ["POS"],
        summary: "List pending waiter-calls",
        response: { 200: zodToJsonSchema(ActiveWaiterCallsResponseSchema), 401: errorResponse },
      },
    },
    async (request) => ({
      data: await listPendingWaiterCalls(app.prisma),
      meta: { requestId: request.id },
    }),
  );
};
