import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { isValidRequestId, registerErrorHandling } from "./errors/error-handler.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { databasePlugin } from "./plugins/database.js";

export function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    genReqId(request) {
      const requestId = request.headers["x-request-id"];

      return isValidRequestId(requestId) ? requestId : crypto.randomUUID();
    },
  });

  registerErrorHandling(app);

  app.register(helmet);

  app.register(cors, {
    origin: false,
  });

  app.register(sensible);

  app.register(swagger, {
    openapi: {
      info: {
        title: "Café Management API",
        description: "Authoritative backend for the café management system",
        version: "0.1.0",
      },
    },
  });

  app.register(swaggerUi, {
    routePrefix: "/documentation",
  });

  app.register(databasePlugin);

  app.register(
    async (api) => {
      api.register(healthRoutes);
      api.register(authRoutes);
    },
    {
      prefix: "/api/v1",
    },
  );

  return app;
}
