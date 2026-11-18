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

export const requireStaff = requireAuthenticatedRole("STAFF", "CASHIER", "MANAGER", "DEVELOPER");
export const requireManagerRoute = requireAuthenticatedRole("CASHIER", "MANAGER", "DEVELOPER");
export const requireDeveloperRoute = requireAuthenticatedRole("DEVELOPER");
export const requireAccountingReportRoute = requireAuthenticatedRole("MANAGER", "DEVELOPER");
export const requireInventoryRoute = requireAuthenticatedRole("CASHIER", "MANAGER", "DEVELOPER");
export const requireSessionRoute = requireAuthenticatedRole("STAFF", "CASHIER", "MANAGER", "DEVELOPER");
export const requirePosCatalogRoute = requireAuthenticatedRole("STAFF", "CASHIER", "MANAGER", "DEVELOPER");
export const requireCatalogReadRoute = requireAuthenticatedRole("STAFF", "CASHIER", "MANAGER", "DEVELOPER");
