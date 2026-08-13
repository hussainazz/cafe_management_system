import {
  Prisma,
  type PrismaClient,
  type User,
  type UserRole,
} from "../../../generated/prisma/client.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import { verifyPassword } from "../../auth/password.js";
import {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  refreshSessionExpiry,
  type AccessSession,
} from "../../auth/session.js";

export type AuthenticatedUser = Pick<User, "id" | "username" | "role">;

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
};

function userDto(user: Pick<User, "id" | "username" | "role">): AuthenticatedUser {
  return { id: user.id, username: user.username, role: user.role };
}

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

async function issueSession(
  prisma: PrismaExecutor,
  user: AuthenticatedUser,
): Promise<SessionTokens> {
  const refreshToken = createRefreshToken();
  const refreshSession = await prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshSessionExpiry(),
    },
  });
  const accessToken = createAccessToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    refreshSessionId: refreshSession.id,
  });

  return { accessToken, refreshToken, user };
}

async function authEvent(
  prisma: PrismaExecutor,
  eventType: string,
  requestId: string,
  userId?: string,
): Promise<void> {
  await prisma.authEvent.create({
    data: { eventType, requestId, ...(userId === undefined ? {} : { userId }) },
  });
}

export async function login(
  prisma: PrismaClient,
  input: { username: string; password: string },
  requestId: string,
): Promise<SessionTokens> {
  const user = await prisma.user.findUnique({ where: { username: input.username } });

  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    await authEvent(prisma, "LOGIN_FAILED", requestId, user?.id);
    throw new ApplicationError(
      401,
      ErrorCodes.AUTHENTICATION_REQUIRED,
      "Invalid username or password.",
    );
  }
  if (!user.isActive) {
    await authEvent(prisma, "LOGIN_DENIED_INACTIVE", requestId, user.id);
    throw new ApplicationError(
      401,
      ErrorCodes.AUTHENTICATION_REQUIRED,
      "Invalid username or password.",
    );
  }

  const tokens = await issueSession(prisma, userDto(user));
  await authEvent(prisma, "LOGIN_SUCCEEDED", requestId, user.id);
  return tokens;
}

export async function refresh(
  prisma: PrismaClient,
  refreshToken: string | undefined,
  requestId: string,
): Promise<SessionTokens> {
  if (!refreshToken) {
    throw new ApplicationError(401, ErrorCodes.SESSION_EXPIRED, "The session has expired.");
  }
  const session = await prisma.refreshSession.findFirst({
    where: { tokenHash: hashRefreshToken(refreshToken) },
    include: { user: true },
  });
  const now = new Date();

  if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) {
    if (session) {
      await authEvent(prisma, "REFRESH_DENIED", requestId, session.userId);
    }
    throw new ApplicationError(401, ErrorCodes.SESSION_EXPIRED, "The session has expired.");
  }

  return prisma.$transaction(async (transaction) => {
    const revoked = await transaction.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (revoked.count !== 1) {
      throw new ApplicationError(401, ErrorCodes.SESSION_EXPIRED, "The session has expired.");
    }
    const tokens = await issueSession(transaction, userDto(session.user));
    await authEvent(transaction, "REFRESH_SUCCEEDED", requestId, session.userId);
    return tokens;
  });
}

export async function currentUser(
  prisma: PrismaClient,
  session: AccessSession | undefined,
): Promise<AuthenticatedUser> {
  if (!session) {
    throw new ApplicationError(
      401,
      ErrorCodes.AUTHENTICATION_REQUIRED,
      "Authentication is required.",
    );
  }
  const activeSession = await prisma.refreshSession.findFirst({
    where: {
      id: session.refreshSessionId,
      userId: session.userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: { is: { isActive: true, role: session.role, username: session.username } },
    },
  });
  if (!activeSession) {
    throw new ApplicationError(401, ErrorCodes.SESSION_EXPIRED, "The session has expired.");
  }
  return { id: session.userId, username: session.username, role: session.role };
}

export async function logout(
  prisma: PrismaClient,
  session: AccessSession | undefined,
  requestId: string,
): Promise<void> {
  const user = await currentUser(prisma, session);
  await prisma.$transaction(async (transaction) => {
    await transaction.refreshSession.updateMany({
      where: { id: session!.refreshSessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await authEvent(transaction, "LOGOUT", requestId, user.id);
  });
}

export async function logoutAll(
  prisma: PrismaClient,
  session: AccessSession | undefined,
  requestId: string,
): Promise<void> {
  const user = await currentUser(prisma, session);
  await prisma.$transaction(async (transaction) => {
    await transaction.refreshSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await authEvent(transaction, "LOGOUT_ALL", requestId, user.id);
  });
}

export async function deactivateAccount(
  prisma: PrismaClient,
  userId: string,
  requestId: string,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({ where: { id: userId }, data: { isActive: false } });
    await transaction.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await authEvent(transaction, "ACCOUNT_DEACTIVATED", requestId, userId);
  });
}

export function isStaffOrManager(role: UserRole): boolean {
  return role === "STAFF" || role === "MANAGER";
}
