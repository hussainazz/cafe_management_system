import type { FastifyPluginAsync } from "fastify";
import {
  ActiveWaiterCallsResponseSchema,
  ErrorResponseSchema,
  PublicTableContextResponseSchema,
  PublicWaiterCallResponseSchema,
  TableContextExchangeRequestSchema,
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
import {
  createWaiterCall,
  exchangeTableQrToken,
  listPendingWaiterCalls,
  readPublicTableContext,
} from "./waiter-calls.service.js";

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
        const result = await exchangeTableQrToken(app.prisma, request.body.token);
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
