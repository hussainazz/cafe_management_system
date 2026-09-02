import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

export const tableContextCookieName = "cafe_table_context";
export const tableContextLifetimeSeconds = 12 * 60 * 60;

type TableContextPayload = {
  credentialId: string;
  issuedAt: number;
  expiresAt: number;
};

function signature(value: string): string {
  return createHmac("sha256", env.TABLE_CONTEXT_COOKIE_SECRET).update(value).digest("base64url");
}

export function createTableQrToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashTableQrToken(token: string): string {
  return createHmac("sha256", env.TABLE_QR_TOKEN_SECRET).update(token).digest("hex");
}

export function createTableContextCookieValue(credentialId: string, now = new Date()): string {
  const payload: TableContextPayload = {
    credentialId,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + tableContextLifetimeSeconds * 1_000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function readTableContextCookieValue(
  value: string | undefined,
  now = new Date(),
): TableContextPayload | undefined {
  if (!value) return undefined;
  const [encoded, actualSignature] = value.split(".");
  if (!encoded || !actualSignature) return undefined;
  const expectedSignature = signature(encoded);
  const actual = Buffer.from(actualSignature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<TableContextPayload>;
    if (
      typeof payload.credentialId !== "string" ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.issuedAt > now.getTime() ||
      payload.expiresAt <= now.getTime() ||
      payload.expiresAt - payload.issuedAt > tableContextLifetimeSeconds * 1_000
    ) {
      return undefined;
    }
    return payload as TableContextPayload;
  } catch {
    return undefined;
  }
}

function cookieAttributes(maxAge: number): string {
  return [
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

export function tableContextCookie(value: string): string {
  return `${tableContextCookieName}=${value}; ${cookieAttributes(tableContextLifetimeSeconds)}`;
}

export function clearTableContextCookie(): string {
  return `${tableContextCookieName}=; ${cookieAttributes(0)}`;
}
