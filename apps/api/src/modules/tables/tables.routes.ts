import type { FastifyPluginAsync } from "fastify";
import {
  AuthRequestHeadersSchema,
  PosTableResponseSchema,
  PosTablesResponseSchema,
  TableIdPathSchema,
  TableOccupancyRequestSchema,
  AcknowledgeWaiterCallRequestSchema,
  ErrorResponseSchema,
  type AcknowledgeWaiterCallRequest,
} from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { requireStaff } from "../auth/authorization.js";
import { acknowledgeTableWaiterCall, listPosTables, makeTableAvailable, occupyTable, readPosTable } from "./tables.service.js";

const headers = zodToJsonSchema(AuthRequestHeadersSchema);
const tableParams = zodToJsonSchema(TableIdPathSchema);
const errors = { 400: zodToJsonSchema(ErrorResponseSchema), 401: zodToJsonSchema(ErrorResponseSchema), 404: zodToJsonSchema(ErrorResponseSchema), 409: zodToJsonSchema(ErrorResponseSchema) };

export const tablesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/tables",
    {
      preHandler: requireStaff,
      schema: {
        tags: ["POS"],
        summary: "List active tables and active-order timing",
        headers,
        response: { 200: zodToJsonSchema(PosTablesResponseSchema) },
      },
    },
    async (request) => ({
      data: await listPosTables(app.prisma),
      meta: { requestId: request.id },
    }),
  );

  app.get<{ Params: { tableId: string } }>(
    "/tables/:tableId",
    {
      preHandler: requireStaff,
      schema: {
        tags: ["POS"],
        summary: "Read an active table and active-order timing",
        headers,
        params: tableParams,
        response: { 200: zodToJsonSchema(PosTableResponseSchema) },
      },
    },
    async (request) => ({
      data: await readPosTable(app.prisma, request.params.tableId),
      meta: { requestId: request.id },
    }),
  );

  app.post<{ Params: { tableId: string } }>(
    "/tables/:tableId/occupy",
    { preHandler: requireStaff, schema: { tags: ["POS"], summary: "Mark a table occupied", headers, params: tableParams, body: zodToJsonSchema(TableOccupancyRequestSchema), response: { 200: zodToJsonSchema(PosTableResponseSchema), ...errors } } },
    async (request) => ({ data: await occupyTable(app.prisma, request.params.tableId), meta: { requestId: request.id } }),
  );

  app.post<{ Params: { tableId: string } }>(
    "/tables/:tableId/make-available",
    { preHandler: requireStaff, schema: { tags: ["POS"], summary: "Mark a table available and invalidate prior guest context", headers, params: tableParams, body: zodToJsonSchema(TableOccupancyRequestSchema), response: { 200: zodToJsonSchema(PosTableResponseSchema), ...errors } } },
    async (request) => ({ data: await makeTableAvailable(app.prisma, request.params.tableId), meta: { requestId: request.id } }),
  );

  app.post<{ Params: { tableId: string }; Body: AcknowledgeWaiterCallRequest }>(
    "/tables/:tableId/acknowledge-waiter-call",
    { preHandler: requireStaff, schema: { tags: ["POS"], summary: "Open a table and resolve its pending waiter-call", headers, params: tableParams, body: zodToJsonSchema(AcknowledgeWaiterCallRequestSchema), response: { 200: zodToJsonSchema(PosTableResponseSchema), ...errors } } },
    async (request) => ({ data: await acknowledgeTableWaiterCall(app.prisma, request.params.tableId, request.body.expectedVersion), meta: { requestId: request.id } }),
  );
};
