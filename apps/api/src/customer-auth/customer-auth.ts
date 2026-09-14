import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
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

type CustomerIdentity = { fullName: string; phoneNumber: string };

function identityKey() {
  return createHash("sha256").update(env.CUSTOMER_PHONE_ENCRYPTION_KEY).digest();
}

export function encryptCustomerIdentity(identity: CustomerIdentity) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", identityKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(identity), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function encryptCustomerPhone(phoneNumber: string) {
  return encryptCustomerIdentity({ fullName: "", phoneNumber });
}

export function decryptCustomerIdentity(value: string): CustomerIdentity | null {
  try {
    const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split(".");
    if (!ivEncoded || !tagEncoded || !ciphertextEncoded) return null;
    const decipher = createDecipheriv("aes-256-gcm", identityKey(), Buffer.from(ivEncoded, "base64url"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, "base64url")), decipher.final()]).toString("utf8");
    const identity = JSON.parse(plaintext) as { fullName?: unknown; phoneNumber?: unknown };
    if (typeof identity.fullName !== "string" || typeof identity.phoneNumber !== "string") return null;
    return { fullName: identity.fullName, phoneNumber: identity.phoneNumber };
  } catch {
    return null;
  }
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
