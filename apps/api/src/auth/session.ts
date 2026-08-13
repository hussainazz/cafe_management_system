import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { UserRole } from "../../generated/prisma/client.js";
import { env } from "../config/env.js";

const accessSessionLifetimeSeconds = 15 * 60;
const refreshSessionLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1_000;

export const accessCookieName = "cafe_access";
export const refreshCookieName = "cafe_refresh";

export type AccessSession = {
  userId: string;
  username: string;
  role: UserRole;
  refreshSessionId: string;
};

type AccessTokenPayload = AccessSession & { exp: number };

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", env.ACCESS_TOKEN_SECRET).update(value).digest("base64url");
}

export function createAccessToken(session: AccessSession): string {
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encode(
    JSON.stringify({ ...session, exp: Math.floor(Date.now() / 1_000) + accessSessionLifetimeSeconds }),
  );
  const signingInput = `${header}.${payload}`;

  return `${signingInput}.${sign(signingInput)}`;
}

export function readAccessToken(token: string | undefined): AccessSession | undefined {
  if (!token) return undefined;

  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return undefined;

  const expectedSignature = sign(`${header}.${payload}`);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AccessTokenPayload;
    if (
      typeof decoded.userId !== "string" ||
      typeof decoded.username !== "string" ||
      (decoded.role !== "MANAGER" && decoded.role !== "STAFF") ||
      typeof decoded.refreshSessionId !== "string" ||
      typeof decoded.exp !== "number" ||
      decoded.exp <= Math.floor(Date.now() / 1_000)
    ) {
      return undefined;
    }

    return {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      refreshSessionId: decoded.refreshSessionId,
    };
  } catch {
    return undefined;
  }
}

export function createRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHmac("sha256", env.REFRESH_TOKEN_SECRET).update(token).digest("hex");
}

export function refreshSessionExpiry(): Date {
  return new Date(Date.now() + refreshSessionLifetimeMilliseconds);
}

function cookieAttributes(path: string, maxAge: number): string {
  return [
    "HttpOnly",
    `Path=${path}`,
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    ...(env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

export function accessCookie(token: string): string {
  return `${accessCookieName}=${token}; ${cookieAttributes("/api/v1", accessSessionLifetimeSeconds)}`;
}

export function refreshCookie(token: string): string {
  return `${refreshCookieName}=${token}; ${cookieAttributes("/api/v1/auth", refreshSessionLifetimeMilliseconds / 1_000)}`;
}

export function clearAccessCookie(): string {
  return `${accessCookieName}=; ${cookieAttributes("/api/v1", 0)}`;
}

export function clearRefreshCookie(): string {
  return `${refreshCookieName}=; ${cookieAttributes("/api/v1/auth", 0)}`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  return header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
