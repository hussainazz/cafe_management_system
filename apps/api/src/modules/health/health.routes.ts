import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health/live", async () => {
    return {
      status: "ok",
      service: "cafe-api",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/health/ready", async (_request, reply) => {
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
  });
};
