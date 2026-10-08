import type { FastifyPluginAsync } from "fastify";
import {
  AuthRequestHeadersSchema,
  AuthenticationResponseSchema,
  LoginRequestSchema,
} from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import {
  accessCookie,
  accessCookieName,
  clearAccessCookie,
  clearRefreshCookie,
  readAccessToken,
  readCookie,
  refreshCookie,
  refreshCookieName,
} from "../../auth/session.js";
import { login, logout, logoutAll, refresh } from "./auth.service.js";
import { requireStaff } from "./authorization.js";
import { clearLoginFailures, loginRetryAfterSeconds, recordLoginFailure } from "./login-attempts.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";

const authHeaders = zodToJsonSchema(AuthRequestHeadersSchema);
const loginBody = zodToJsonSchema(LoginRequestSchema);
const authResponse = zodToJsonSchema(AuthenticationResponseSchema);

function sessionFromRequest(cookieHeader: string | undefined) {
  return readAccessToken(readCookie(cookieHeader, accessCookieName));
}

function sendSessionCookies(
  reply: { header: (name: string, value: string | string[]) => void },
  accessToken: string,
  refreshToken: string,
): void {
  reply.header("set-cookie", [accessCookie(accessToken), refreshCookie(refreshToken)]);
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/auth/login",
    {
      schema: {
        tags: ["Authentication"],
        summary: "Sign in",
        headers: authHeaders,
        body: loginBody,
        response: { 200: authResponse },
      },
    },
    async (request, reply) => {
      const credentials = request.body as { username: string; password: string };
      const retryAfterSeconds = loginRetryAfterSeconds(credentials.username);
      if (retryAfterSeconds > 0) {
        reply.header("retry-after", String(retryAfterSeconds));
        throw new ApplicationError(429, ErrorCodes.RATE_LIMITED, "Too many failed sign-in attempts. Try again later.");
      }
      let tokens;
      try {
        tokens = await login(app.prisma, credentials, request.id);
      } catch (error) {
        if (error instanceof ApplicationError && error.statusCode === 401) recordLoginFailure(credentials.username);
        throw error;
      }
      clearLoginFailures(credentials.username);
      reply.header("cache-control", "no-store");
      sendSessionCookies(reply, tokens.accessToken, tokens.refreshToken);
      return { data: tokens.user, meta: { requestId: request.id } };
    },
  );

  app.post(
    "/auth/refresh",
    {
      schema: {
        tags: ["Authentication"],
        summary: "Rotate a refresh session",
        headers: authHeaders,
        response: { 200: authResponse },
      },
    },
    async (request, reply) => {
      const tokens = await refresh(
        app.prisma,
        readCookie(request.headers.cookie, refreshCookieName),
        request.id,
      );
      reply.header("cache-control", "no-store");
      sendSessionCookies(reply, tokens.accessToken, tokens.refreshToken);
      return { data: tokens.user, meta: { requestId: request.id } };
    },
  );

  app.get(
    "/auth/me",
    {
      preHandler: requireStaff,
      schema: {
        tags: ["Authentication"],
        summary: "Read the current user",
        headers: authHeaders,
        response: { 200: authResponse },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      reply.header("cache-control", "no-store");
      return { data: user, meta: { requestId: request.id } };
    },
  );

  app.post(
    "/auth/logout",
    {
      preHandler: requireStaff,
      schema: {
        tags: ["Authentication"],
        summary: "Sign out",
        headers: authHeaders,
        response: { 204: { type: "null" } },
      },
    },
    async (request, reply) => {
      await logout(app.prisma, sessionFromRequest(request.headers.cookie), request.id);
      reply.header("cache-control", "no-store");
      reply.header("set-cookie", [clearAccessCookie(), clearRefreshCookie()]);
      return reply.status(204).send();
    },
  );

  app.post(
    "/auth/logout-all",
    {
      preHandler: requireStaff,
      schema: {
        tags: ["Authentication"],
        summary: "Sign out of all sessions",
        headers: authHeaders,
        response: { 204: { type: "null" } },
      },
    },
    async (request, reply) => {
      await logoutAll(app.prisma, sessionFromRequest(request.headers.cookie), request.id);
      reply.header("cache-control", "no-store");
      reply.header("set-cookie", [clearAccessCookie(), clearRefreshCookie()]);
      return reply.status(204).send();
    },
  );
};
