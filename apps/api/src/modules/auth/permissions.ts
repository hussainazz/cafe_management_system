import type { UserRole } from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import type { AuthenticatedUser } from "./auth.service.js";

export function requireRole(user: AuthenticatedUser, roles: readonly UserRole[]): void {
  if (!roles.includes(user.role)) {
    throw new ApplicationError(
      403,
      ErrorCodes.FORBIDDEN,
      "You do not have permission to perform this action.",
    );
  }
}

export function requireManager(user: AuthenticatedUser): void {
  requireRole(user, ["MANAGER"]);
}
