import type { FastifyRequest } from "fastify";
import type { UserRole } from "../../../generated/prisma/client.js";
import { readAccessToken, readCookie, accessCookieName } from "../../auth/session.js";
import { currentUser, type AuthenticatedUser } from "./auth.service.js";
import { requireRole } from "./permissions.js";

declare module "fastify" {
  interface FastifyRequest {
    authenticatedUser?: AuthenticatedUser;
  }
}

async function authenticateRequest(request: FastifyRequest): Promise<AuthenticatedUser> {
  const session = readAccessToken(readCookie(request.headers.cookie, accessCookieName));
  const user = await currentUser(request.server.prisma, session);
  request.authenticatedUser = user;
  return user;
}

export function requireAuthenticatedRole(...roles: UserRole[]) {
  return async (request: FastifyRequest): Promise<void> => {
    const user = await authenticateRequest(request);
    requireRole(user, roles);
  };
}

export const requireStaff = requireAuthenticatedRole("STAFF", "MANAGER");
export const requireManagerRoute = requireAuthenticatedRole("MANAGER");
