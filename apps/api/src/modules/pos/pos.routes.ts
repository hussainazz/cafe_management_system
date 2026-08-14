import type { FastifyPluginAsync } from "fastify";
import {
  AuthRequestHeadersSchema,
  PosCatalogResponseSchema,
} from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { requireStaff } from "../auth/authorization.js";
import { readPosCatalog } from "./pos.service.js";

export const posRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/pos/catalog",
    {
      preHandler: requireStaff,
      schema: {
        tags: ["POS"],
        summary: "Read the current POS catalog",
        headers: zodToJsonSchema(AuthRequestHeadersSchema),
        response: { 200: zodToJsonSchema(PosCatalogResponseSchema) },
      },
    },
    async (request) => ({
      data: await readPosCatalog(app.prisma),
      meta: { requestId: request.id },
    }),
  );
};
