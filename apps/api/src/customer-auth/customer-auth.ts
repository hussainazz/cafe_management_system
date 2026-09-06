import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

export const customerAuthCookieName = "cafe_customer_auth";
export const customerAuthLifetimeSeconds = 365 * 24 * 60 * 60;
export const customerTableVisitLifetimeSeconds = 4 * 60 * 60;
export const customerOtpLifetimeSeconds = 5 * 60;
export const customerOtpResendCooldownSeconds = 60;
export const customerOtpMaxAttempts = 5;

function hmac(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function normalizeIranMobile(input: string): string | undefined {
  const digits = input.trim().replace(/[\s()-]/g, "").replace(/^0098/, "+98").replace(/^98/, "+98");
  const national = digits.replace(/^0/, "");
  const normalized = national.startsWith("+98") ? national : `+98${national}`;
  return /^\+989\d{9}$/.test(normalized) ? normalized : undefined;
}

export function hashCustomerPhone(phone: string) {
  return hmac(env.CUSTOMER_PHONE_LOOKUP_SECRET, phone);
}

export function createOtpCode() {
  return env.CUSTOMER_OTP_DEV_CODE ?? String(randomInt(100_000, 1_000_000));
}

export function hashOtp(challengeId: string, code: string) {
  return hmac(env.CUSTOMER_OTP_SECRET, `${challengeId}:TABLE_WAITER_CALL:${code}`);
}

export function otpMatches(challengeId: string, code: string, expectedHash: string) {
  const actual = Buffer.from(hashOtp(challengeId, code));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createCustomerSessionToken() {
  return randomBytes(48).toString("base64url");
}

export function hashCustomerSessionToken(token: string) {
  return hmac(env.CUSTOMER_SESSION_SECRET, token);
}

function cookieAttributes(maxAge: number) {
  return [
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

export function customerAuthCookie(token: string) {
  return `${customerAuthCookieName}=${token}; ${cookieAttributes(customerAuthLifetimeSeconds)}`;
}

export function clearCustomerAuthCookie() {
  return `${customerAuthCookieName}=; ${cookieAttributes(0)}`;
}
