import type { FastifyPluginAsync } from "fastify";
import {
  AuthRequestHeadersSchema,
  PosTableResponseSchema,
  PosTablesResponseSchema,
  TableIdPathSchema,
} from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { requireStaff } from "../auth/authorization.js";
import { listPosTables, readPosTable } from "./tables.service.js";

const headers = zodToJsonSchema(AuthRequestHeadersSchema);
const tableParams = zodToJsonSchema(TableIdPathSchema);

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
};
