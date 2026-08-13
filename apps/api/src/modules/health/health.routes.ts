import type { FastifyPluginAsync } from "fastify";
import {
  HealthResponseSchema,
  ReadinessResponseSchema,
  ReadinessUnavailableResponseSchema,
  RequestIdHeaderSchema,
} from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";

const requestIdHeaders = zodToJsonSchema(RequestIdHeaderSchema);

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/health/live",
    {
      schema: {
        tags: ["Operations"],
        summary: "Check API liveness",
        headers: requestIdHeaders,
        response: {
          200: zodToJsonSchema(HealthResponseSchema),
        },
      },
    },
    async () => ({
      status: "ok",
      service: "cafe-api",
      timestamp: new Date().toISOString(),
    }),
  );

  app.get(
    "/health/ready",
    {
      schema: {
        tags: ["Operations"],
        summary: "Check API dependency readiness",
        headers: requestIdHeaders,
        response: {
          200: zodToJsonSchema(ReadinessResponseSchema),
          503: zodToJsonSchema(ReadinessUnavailableResponseSchema),
        },
      },
    },
    async (_request, reply) => {
      try {
        await app.prisma.$queryRaw`SELECT 1`;

        return {
          status: "ok",
          service: "cafe-api",
          database: "connected",
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        app.log.error({ error }, "Readiness check failed");

        return reply.status(503).send({
          status: "error",
          service: "cafe-api",
          database: "unavailable",
          timestamp: new Date().toISOString(),
        });
      }
    },
  );
};
